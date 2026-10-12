import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cnpjTemDvValido } from '@contabilidade/shared/documentos-fiscais';
import { vincularEstabelecimentos, salvarConfiguracaoConsumo } from '../src/application/fiscal/consumo/ApuracaoConsumoService.js';
import { listarColetasCbs, abrirColetaCbs, consultarColetaCbs, baixarArquivoColetaCbs } from '../src/application/fiscal/consumo/ColetaCbsService.js';
import { criarProtecaoCbs } from '../src/application/fiscal/consumo/CbsProtecao.js';
import { reprocessarArquivoCbs } from '../src/application/fiscal/consumo/ReplayCbsService.js';
import { criarReservaEmissaoCbs } from '../src/infrastructure/cbs/CbsTokenReserva.js';
const [url, clientPath] = process.argv.slice(2);
const parsed = new URL(url);
if (parsed.hostname !== '127.0.0.1' || parsed.username !== 'coleta_cbs_test' || parsed.pathname !== '/coleta_cbs_check') throw Error('Somente banco descartável coleta_cbs_check.');
const { PrismaClient } = createRequire(import.meta.url)(path.join(clientPath, 'index.js'));
const db = new PrismaClient({ datasources: { db: { url } } });
const checks = [], admin = { id: 'admin-teste', role: 'admin' }, ambiente = 'HOMOLOGACAO';
function doc(base) { return Array.from({ length: 100 }, (_, n) => base + String(n).padStart(2, '0')).find(cnpjTemDvValido); }
function intencao(extra = {}) { return { id: randomUUID(), ambiente, ...extra }; }
try {
  const reservarToken = criarReservaEmissaoCbs(db), tokenEntrada = { credencialId: 'credencial-ficticia-quota', janelaMs: 3600000, limite: 2 };
  const quotaResults = await Promise.allSettled(Array.from({ length: 6 }, () => reservarToken(tokenEntrada)));
  const concedidas = quotaResults.filter(r => r.status === 'fulfilled' && r.value === true).length;
  assert.ok(concedidas >= 1 && concedidas <= 2);
  assert.equal(await db.apuracaoCbsTokenEmissao.count({ where: { credencialId: tokenEntrada.credencialId } }), concedidas);
  // Se o Serializable recusou concorrentes, novas intenções explícitas ocupam só o saldo.
  for (let n = concedidas; n < 2; n++) assert.equal(await reservarToken(tokenEntrada), true);
  assert.equal(await reservarToken(tokenEntrada), false);
  assert.equal(await reservarToken({ ...tokenEntrada, credencialId: 'outra-credencial-ficticia' }), true);
  const tokenRegistro = await db.apuracaoCbsTokenEmissao.findFirst({ where: { credencialId: tokenEntrada.credencialId } });
  await assert.rejects(db.apuracaoCbsTokenEmissao.update({ where: { id: tokenRegistro.id }, data: { createdAt: new Date(0) } }));
  await assert.rejects(db.apuracaoCbsTokenEmissao.delete({ where: { id: tokenRegistro.id } }));
  const cancelado = new AbortController(); cancelado.abort();
  await assert.rejects(reservarToken({ ...tokenEntrada, signal: cancelado.signal }));
  assert.equal(await db.apuracaoCbsTokenEmissao.count({ where: { credencialId: tokenEntrada.credencialId } }), 2);
  checks.push('Cota OAuth durável concorrente respeita duas reservas por credencial/hora; outra credencial isolada e histórico imutável');
  assert.equal(await db.portalClient.count(), 0);
  const a = await db.portalClient.create({ data: { razao: 'Coleta fictícia A', cnpj: doc('123456780001') } });
  const b = await db.portalClient.create({ data: { razao: 'Coleta fictícia B', cnpj: doc('876543210001') } });
  const grupo = await vincularEstabelecimentos(db, a.id, { portalClientIds: [a.id] }, admin);
  const grupoB = await vincularEstabelecimentos(db, b.id, { portalClientIds: [b.id] }, admin);
  const credenciais = new Map();
  for (const empresa of [a, b]) {
    const cred = await db.companyCredential.create({ data: { portalClientId: empresa.id, rotulo: 'Fictícia sem segredo' } });
    credenciais.set(empresa.id, cred.id);
    await salvarConfiguracaoConsumo(db, empresa.id, { ...intencao(), versao: 0, tributo: 'CBS', habilitado: true,
      dados: { motivo: 'Ensaio isolado', credencialId: cred.id, credencialPortalClientId: empresa.id } }, admin);
  }
  let aberturas = 0, consultas = 0, downloads = 0;
  let bytes;
  const segredo = 'https://storage.example.test/a?signature=segredo-ficticio';
  const protecao = criarProtecaoCbs(randomBytes(32));
  const deps = { protecao, agora: () => new Date('2026-10-11T12:00:00Z'), cliente: {
    ambiente,
    contexto: { contribuinteId: grupo.id, credencialId: credenciais.get(a.id) },
    abrir: async () => { aberturas++; return { tiqueteSolicitacao: `ticket-${randomUUID()}`, tEASegundos: '120' }; },
    consultar: async () => { consultas++; return { estado: 'CONCLUIDA', urlAssinada: segredo, urlAssinadaExpiraEm: '2026-10-12T12:00:00Z' }; },
    baixar: async recebido => { downloads++; assert.equal(recebido.urlAssinada, segredo); return bytes; },
  } };
  const off = await listarColetasCbs(db, a.id, { ambiente }, admin);
  assert.equal(off.capacidades.abrir, false);
  await assert.rejects(abrirColetaCbs(db, a.id, intencao({ recurso: 'DEBITOS' }), admin), { status: 503 });
  assert.equal(await db.apuracaoCbsColeta.count(), 0);
  assert.equal(await db.apuracaoCbsTentativa.count(), 0);
  checks.push('Runtime ausente bloqueia execução sem reservar coleta/tentativa');
  const entrada = intencao({ recurso: 'DEBITOS' });
  const results = await Promise.allSettled([entrada, intencao({ recurso: 'DEBITOS' })].map(x => abrirColetaCbs(db, a.id, x, admin, deps)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  assert.equal(aberturas, 1);
  const coleta = results.find(r => r.status === 'fulfilled').value;
  const row = await db.apuracaoCbsColeta.findUnique({ where: { id: coleta.id } });
  bytes = Buffer.from(` ${JSON.stringify({ tiqueteSolicitacao: row.ticket, ni: grupo.cnpjBase, niConsumidor: a.cnpj,
    geradoEm: '2026-10-11T12:00:00Z', apuracao: [{ pa: '10/2026', debitos: [] }] })}\n`);
  assert.equal((await abrirColetaCbs(db, a.id, { ...entrada, id: row.requestKey }, admin, deps)).id, coleta.id);
  assert.equal(aberturas, 1);
  await assert.rejects(abrirColetaCbs(db, a.id, { ...entrada, id: row.requestKey, recurso: 'CREDITOS' }, admin, deps), { status: 409 });
  const depsB = { ...deps, cliente: { ...deps.cliente, contexto: { contribuinteId: grupoB.id, credencialId: credenciais.get(b.id) } } };
  await assert.rejects(consultarColetaCbs(db, b.id, coleta.id, intencao(), admin, depsB), { status: 404 });
  await assert.rejects(consultarColetaCbs(db, a.id, coleta.id, intencao({ ambiente: 'PRODUCAO' }), admin, deps));
  assert.equal(consultas, 0);
  checks.push('Concorrência real em abertura chama transporte uma vez; intenção idempotente e grupo/ambiente isolados');
  const consultaIntent = intencao();
  const disponivel = await consultarColetaCbs(db, a.id, coleta.id, consultaIntent, admin, deps);
  assert.equal(disponivel.estado, 'DISPONIVEL');
  await consultarColetaCbs(db, a.id, coleta.id, consultaIntent, admin, deps);
  assert.equal(consultas, 1);
  const comDownload = await db.apuracaoCbsColeta.findUnique({ where: { id: coleta.id } });
  assert.ok(Buffer.isBuffer(comDownload.dadosDownloadCifrados));
  assert.equal(comDownload.dadosDownloadCifrados.includes(Buffer.from('segredo-ficticio')), false);
  const baixarIntent = intencao();
  const arquivada = await baixarArquivoColetaCbs(db, a.id, coleta.id, baixarIntent, admin, deps);
  assert.equal(arquivada.estado, 'ARQUIVADA');
  await baixarArquivoColetaCbs(db, a.id, coleta.id, baixarIntent, admin, deps);
  assert.equal(downloads, 1);
  const arquivo = await db.apuracaoCbsArquivo.findUnique({ where: { coletaId: coleta.id } });
  assert.equal(arquivo.sha256, createHash('sha256').update(bytes).digest('hex'));
  const scope = { contribuinteId: grupo.id, ambiente, coletaId: coleta.id, finalidade: 'arquivo' };
  assert.deepEqual(protecao.decifrar(arquivo.conteudoCifrado, scope), bytes);
  for (const changed of [{ contribuinteId: grupoB.id }, { ambiente: 'PRODUCAO' }, { coletaId: randomUUID() }, { finalidade: 'download' }]) {
    assert.throws(() => protecao.decifrar(arquivo.conteudoCifrado, { ...scope, ...changed }), /INTEGRIDADE/);
  }
  assert.equal((await db.apuracaoCbsColeta.findUnique({ where: { id: coleta.id } })).dadosDownloadCifrados, null);
  const list = await listarColetasCbs(db, a.id, { ambiente }, admin, deps);
  assert.ok(!JSON.stringify(list).includes(segredo));
  assert.ok(!JSON.stringify(list).includes('conteudoCifrado'));
  assert.equal(list.coletas[0].cobertura, 'NAO_VALIDADA');
  assert.equal(list.coletas[0].valoresOficiais, null);
  checks.push('Download único; bytes exatos cifrados e hash; AAD bloqueia troca grupo/ambiente/coleta/finalidade; DTO sem segredos');
  const antesReplay = { aberturas, consultas, downloads, tentativas: await db.apuracaoCbsTentativa.count(), arquivos: await db.apuracaoCbsArquivo.count() };
  const replay = await reprocessarArquivoCbs(db, a.id, coleta.id, { ambiente }, admin, { protecao });
  assert.equal(replay.sha256, arquivo.sha256);
  assert.equal(replay.cobertura, 'NAO_VALIDADA');
  assert.equal(replay.totaisOficiais, null);
  assert.deepEqual(await reprocessarArquivoCbs(db, a.id, coleta.id, { ambiente }, admin, { protecao }), replay);
  await assert.rejects(reprocessarArquivoCbs(db, b.id, coleta.id, { ambiente }, admin, { protecao }), { status: 404 });
  await assert.rejects(reprocessarArquivoCbs(db, a.id, coleta.id, { ambiente: 'PRODUCAO' }, admin, { protecao }), { status: 404 });
  await assert.rejects(reprocessarArquivoCbs(db, a.id, coleta.id, { ambiente }, { id: 'sem-acesso', role: 'STAFF' }, { protecao }), { status: 403 });
  await assert.rejects(reprocessarArquivoCbs(db, a.id, coleta.id, { ambiente }, admin), { status: 503 });
  await assert.rejects(reprocessarArquivoCbs(db, a.id, coleta.id, { ambiente }, admin, { protecao: criarProtecaoCbs(randomBytes(32)) }), { status: 409 });
  assert.deepEqual({ aberturas, consultas, downloads, tentativas: await db.apuracaoCbsTentativa.count(), arquivos: await db.apuracaoCbsArquivo.count() }, antesReplay);
  checks.push('Replay local determinístico sem escrita/transporte; cifra, autorização e grupo/ambiente verificados');
  await assert.rejects(db.apuracaoCbsArquivo.update({ where: { id: arquivo.id }, data: { tamanhoBytes: 1 } }));
  await assert.rejects(db.apuracaoCbsArquivo.delete({ where: { id: arquivo.id } }));
  const configB = await db.apuracaoConsumoConfiguracao.findFirst({ where: { contribuinteId: grupoB.id } });
  await assert.rejects(db.apuracaoCbsColeta.create({ data: { contribuinteId: grupo.id, ambiente, recurso: 'DEBITOS', configuracaoId: configB.id,
    requestKey: randomUUID(), requestHash: 'a'.repeat(64), criadoPorId: admin.id } }));
  await assert.rejects(db.apuracaoCbsArquivo.create({ data: { coletaId: coleta.id, contribuinteId: grupoB.id, ambiente, sha256: arquivo.sha256,
    tamanhoBytes: arquivo.tamanhoBytes, conteudoCifrado: arquivo.conteudoCifrado, criadoPorId: admin.id } }));
  checks.push('Arquivo imutável no banco; FKs compostas recusam configuração/arquivo de outro grupo');
  const recusada = intencao({ recurso: 'CREDITOS' });
  await assert.rejects(abrirColetaCbs(db, a.id, recusada, admin, { ...deps, cliente: { ...deps.cliente,
    abrir: async () => { throw Object.assign(Error('erro fictício'), { code: 'CBS_HTTP_429', resultadoIncerto: false }); } } }));
  assert.equal((await db.apuracaoCbsColeta.findFirst({ where: { requestKey: recusada.id } })).estado, 'ERRO');
  const incerta = intencao({ recurso: 'CREDITOS' });
  await assert.rejects(abrirColetaCbs(db, a.id, incerta, admin, { ...deps, cliente: { ...deps.cliente,
    abrir: async () => { throw Object.assign(Error('erro fictício'), { code: 'CBS_TEMPO_ESGOTADO', resultadoIncerto: true }); } } }));
  assert.equal((await db.apuracaoCbsColeta.findFirst({ where: { requestKey: incerta.id } })).estado, 'INCERTA');
  await assert.rejects(abrirColetaCbs(db, a.id, intencao({ recurso: 'CREDITOS' }), admin, deps), { status: 409 });
  checks.push('Erro 429 explícito libera estado ERRO; timeout mantém INCERTA e impede nova abertura');
  const expColeta = await abrirColetaCbs(db, b.id, intencao({ recurso: 'DEBITOS' }), admin, depsB);
  const expResult = await consultarColetaCbs(db, b.id, expColeta.id, intencao(), admin, { ...depsB, cliente: { ...depsB.cliente,
    consultar: async () => ({ estado: 'CONCLUIDA', urlAssinada: segredo, urlAssinadaExpiraEm: '2026-10-10T12:00:00Z' }) } });
  assert.equal(expResult.estado, 'EXPIRADA');
  assert.equal((await db.apuracaoCbsColeta.findUnique({ where: { id: expColeta.id } })).dadosDownloadCifrados, null);
  checks.push('Expiração descarta URL assinada cifrada sem reabertura automática');
  const configA = await db.apuracaoConsumoConfiguracao.findFirst({ where: { contribuinteId: grupo.id, ambiente } });
  const duplicate = { contribuinteId: grupo.id, ambiente, recurso: 'DEBITOS', configuracaoId: configA.id,
    estado: 'ERRO', ticket: row.ticket, requestKey: randomUUID(), requestHash: 'b'.repeat(64), criadoPorId: admin.id };
  await assert.rejects(db.apuracaoCbsColeta.create({ data: duplicate }), { code: 'P2002' });
  const configProducao = await salvarConfiguracaoConsumo(db, a.id, { ...intencao({ ambiente: 'PRODUCAO' }), versao: 0, tributo: 'CBS', habilitado: false,
    dados: { motivo: 'Separação de ambiente no ensaio' } }, admin);
  const otherEnv = await db.apuracaoCbsColeta.create({ data: { ...duplicate, ambiente: 'PRODUCAO', configuracaoId: configProducao.id, requestKey: randomUUID() } });
  assert.equal(otherEnv.ticket, row.ticket);
  checks.push('Ticket repetido no mesmo grupo/ambiente recusado; mesmo ticket em outro ambiente permitido');
  const timed = await abrirColetaCbs(db, b.id, intencao({ recurso: 'DEBITOS' }), admin, depsB);
  await consultarColetaCbs(db, b.id, timed.id, intencao(), admin, depsB);
  const savedBefore = await db.apuracaoCbsColeta.findUnique({ where: { id: timed.id } });
  const countsBefore = await db.apuracaoCbsTentativa.count();
  const later = { ...depsB, agora: () => new Date('2026-10-13T12:00:00Z') };
  const timedList = await listarColetasCbs(db, b.id, { ambiente }, admin, later);
  assert.equal(timedList.coletas.find(c => c.id === timed.id).estado, 'EXPIRADA');
  assert.deepEqual(await db.apuracaoCbsColeta.findUnique({ where: { id: timed.id } }), savedBefore);
  assert.equal(await db.apuracaoCbsTentativa.count(), countsBefore);
  const next = await abrirColetaCbs(db, b.id, intencao({ recurso: 'DEBITOS' }), admin, later);
  assert.equal(next.estado, 'PENDENTE');
  const expiredSaved = await db.apuracaoCbsColeta.findUnique({ where: { id: timed.id } });
  assert.equal(expiredSaved.estado, 'EXPIRADA');
  assert.equal(expiredSaved.dadosDownloadCifrados, null);
  assert.equal((await db.apuracaoCbsColeta.findFirst({ where: { requestKey: incerta.id } })).estado, 'INCERTA');
  await consultarColetaCbs(db, b.id, next.id, intencao(), admin, { ...later, cliente: { ...later.cliente,
    consultar: async () => ({ estado: 'ERRO', codigoErro: 'APURACAO-408' }) } });
  assert.equal((await db.apuracaoCbsColeta.findUnique({ where: { id: next.id } })).erroCodigo, 'APURACAO-408');
  checks.push('GET deriva expiração sem escrita; POST explícito encerra disponibilidade vencida e preserva outro grupo; código APURACAO-408 preservado');
  const reserved = await abrirColetaCbs(db, b.id, intencao({ recurso: 'DEBITOS' }), admin, later);
  await db.apuracaoCbsColeta.update({ where: { id: reserved.id }, data: { estado: 'DISPONIVEL', arquivoExpiraEm: new Date('2026-10-12T12:00:00Z'),
    dadosDownloadCifrados: Buffer.alloc(30), operacaoEmCursoId: randomUUID() } });
  await assert.rejects(abrirColetaCbs(db, b.id, intencao({ recurso: 'DEBITOS' }), admin, later), { status: 409 });
  const stillReserved = await db.apuracaoCbsColeta.findUnique({ where: { id: reserved.id } });
  assert.equal(stillReserved.estado, 'DISPONIVEL');
  assert.ok(stillReserved.operacaoEmCursoId);
  checks.push('Disponibilidade vencida com operação reservada não é expirada nem reaberta automaticamente');
  const user = await db.user.create({ data: { email: 'coleta-test@example.invalid', passwordHash: 'not-a-password', role: 'user', accountType: 'FIRM' } });
  await db.companyFirmAccess.create({ data: { companyId: a.id, userId: user.id, role: 'STAFF' } });
  await assert.rejects(listarColetasCbs(db, a.id, { ambiente }, user, deps), { status: 403 });
  await db.companyFirmAccess.update({ where: { companyId_userId: { companyId: a.id, userId: user.id } }, data: { role: 'ACCOUNTANT' } });
  await listarColetasCbs(db, a.id, { ambiente }, user, deps);
  const filial = await db.portalClient.create({ data: { razao: 'Filial fictícia', cnpj: doc('123456780002') } });
  await vincularEstabelecimentos(db, a.id, { portalClientIds: [filial.id] }, admin);
  await assert.rejects(listarColetasCbs(db, a.id, { ambiente }, user, deps), { status: 403 });
  checks.push('STAFF recusado; ACCOUNTANT precisa acesso a todos estabelecimentos do grupo');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await db.$disconnect(); }
