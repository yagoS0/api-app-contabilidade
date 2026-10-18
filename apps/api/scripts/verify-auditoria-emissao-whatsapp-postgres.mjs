// Auditoria local: não carrega .env e não habilita integrações. Banco descartável preparado pelo Principal.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Exige PostgreSQL');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Exige loopback');
assert.match(url.pathname, /^\/[a-zA-Z0-9_]+_governance_test$/, 'Exige banco descartável _governance_test');
assert.equal(url.search, '', 'Parâmetros de conexão alternativos não são permitidos');
assert.equal(url.hash, '');
url.hostname = '127.0.0.1';
process.env.DATABASE_URL = url.toString();
process.env.DIRECT_URL = url.toString();
process.env.DOTENV_CONFIG_PATH = join(tmpdir(), `altan-audit-no-env-${randomUUID()}`);
assert.equal(existsSync(process.env.DOTENV_CONFIG_PATH), false);
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'fatal' });
const configSource = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
const flags = new Set([...Object.keys(process.env).filter(k => k.startsWith('INTEGRACAO_')),
  ...Array.from(configSource.matchAll(/\bINTEGRACAO_[A-Z0-9_]+\b/g), m => m[0])]);
for (const flag of flags) process.env[flag] = '0';
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw Error('Rede JS proibida na auditoria local'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
// Prisma usa o engine nativo; somente a URL validada acima é fornecida a ele.
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const prefix = `audit-${randomUUID()}`;

const { autorizarEmissaoDoCliente } = await import('../src/application/nfse/autorizacaoEmissaoDoCliente.js');
const { criarPendencia, confirmarEExecutar, recuperarEmissaoPersistida, DEPS_PADRAO } = await import('../src/application/assistente/AcoesPendentesService.js');
const { TIPOS, STATUS } = await import('../src/application/assistente/confirmacaoPendente.js');
const { comControleEmissao, conferirControleEmissao, persistirDesfechoControlado } = await import('../src/application/whatsapp/ControleEmissaoWhatsapp.js');
const { listarEmissoesInterrompidas, conferirEmissaoInterrompida } = await import('../src/application/whatsapp/ConciliacaoEmissaoWhatsappService.js');
try {
  const [database] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(database.name, url.pathname.slice(1));
  const company = await db.portalClient.create({ data: { cnpj: prefix, razao: 'EMISSAO SINTETICA SEM VALIDADE FISCAL', emissaoClienteLiberada: true } });
  const other = await db.portalClient.create({ data: { cnpj: prefix + '-other', razao: 'OUTRA EMPRESA SINTETICA' } });
  const user = await db.user.create({ data: { email: prefix + '@example.invalid', passwordHash: 'SEM-LOGIN', accountType: 'CLIENT', status: 'active' } });
  await db.companyClientUser.create({ data: { companyId: company.id, userId: user.id, role: 'CLIENT_ADMIN', status: 'ACTIVE' } });
  await db.contatoWhatsapp.create({ data: { portalClientId: company.id, userId: user.id, nome: 'SINTETICO',
    telefoneE164: prefix, ativo: true, permissoesAssistente: ['EMISSAO_NFSE'] } });
  const conversation = await db.conversaWhatsapp.create({ data: {
    portalClientId: company.id, telefoneE164: prefix, chaveEscopo: prefix, escopoVerificado: true,
  } });
  const now = new Date();
  const create = () => criarPendencia({ conversaId: conversation.id, portalClientId: company.id,
    userId: user.id, tipo: TIPOS.EMITIR_NFSE, payload: { teste: true },
    corpo: 'SIMULACAO LOCAL: nenhum documento fiscal sera emitido', agora: now, client: db });
  let executions = 0;
  const executores = { [TIPOS.EMITIR_NFSE]: async () => {
    executions++;
    return { texto: 'Executor sintético', filaHumana: false, resultado: { simulado: true } };
  } };
  const confirm = (acaoId, extra = {}) => confirmarEExecutar({ acaoId, conversaId: conversation.id,
    portalClientId: company.id, userId: user.id, agora: now, client: db, executores, ...extra });
  const first = await create();
  assert.equal((await confirm(first.acao.id, { portalClientId: other.id })).executou, false);
  const both = await Promise.all([confirm(first.acao.id), confirm(first.acao.id)]);
  assert.equal(both.filter(r => r.executou).length, 1);
  assert.equal(executions, 1);
  assert.equal((await db.acaoPendenteWhatsapp.findUnique({ where: { id: first.acao.id } })).status, STATUS.EXECUTADA);
  assert.equal((await confirm(first.acao.id)).executou, false);

  const revoked = await create();
  await db.portalClient.update({ where: { id: company.id }, data: { emissaoClienteLiberada: false } });
  assert.equal((await confirm(revoked.acao.id)).executou, false);
  assert.equal(executions, 1);
  assert.equal((await db.acaoPendenteWhatsapp.findUnique({ where: { id: revoked.acao.id } })).status, STATUS.CANCELADA);
  assert.equal((await autorizarEmissaoDoCliente({ portalClientId: other.id, userId: user.id, client: db })).ok, false);
  await db.portalClient.update({ where: { id: company.id }, data: { emissaoClienteLiberada: true } });
  const owner = await db.client.create({ data: { name: prefix, email: prefix + '-owner@example.invalid', login: prefix, passwordHash: 'SEM-LOGIN' } });
  const legacy = await db.company.create({ data: { clientId: owner.id, razaoSocial: 'SINTETICA', cnpj: prefix + '-legacy', atividades: [] } });
  const invoice = await db.serviceInvoice.create({ data: { companyId: legacy.id, tomadorDoc: '00000000000', tomadorNome: 'SEM VALIDADE FISCAL', valorServicos: 1 } });
  const uncertain = await create();
  let simulatedPosts = 0;
  const deps = { ...DEPS_PADRAO, resolveLegacyCompanyId: async () => legacy.id, NfseService: {
    issue: async ({ antesDeEnviar, autorizarEnvioFinal }) => {
      await antesDeEnviar(invoice.id);
      const saved = await db.acaoPendenteWhatsapp.findUnique({ where: { id: uncertain.acao.id } });
      assert.equal(saved.resultado.nfseId, invoice.id);
      assert.equal(saved.resultado.indeterminado, true);
      await autorizarEnvioFinal();
      simulatedPosts++;
      return { status: 'rejected', codigo: 'E0014', invoiceId: invoice.id, indeterminado: true };
    },
  } };
  const result = await confirm(uncertain.acao.id, { executores: null, deps });
  assert.equal(simulatedPosts, 1);
  assert.equal(result.resultado.indeterminado, true);
  assert.doesNotMatch(result.texto, /Nada foi emitido/);
  await assert.rejects(create, { code: 'NFSE_RESULTADO_INDETERMINADO' });
  const action = await db.acaoPendenteWhatsapp.findUnique({ where: { id: uncertain.acao.id } });
  assert.equal((await recuperarEmissaoPersistida(action, { client: db, deps })).resultado.indeterminado, true, 'pending não é prova nem autorização');
  await db.serviceInvoice.update({ where: { id: invoice.id }, data: { status: 'issued', numeroNfse: 'TESTE-1', chaveAcesso: 'SINTETICA-SEM-VALIDADE' } });
  const recovered = await recuperarEmissaoPersistida(action, { client: db, deps });
  assert.equal(recovered.resultado.indeterminado, false);
  assert.equal(recovered.resultado.recuperada, true);
  assert.equal(simulatedPosts, 1, 'recuperação não emite novamente');
  await create();
  await db.portalClient.update({ where: { id: company.id }, data: { companyId: legacy.id } });
  const pendingInvoice = await db.serviceInvoice.create({ data: { companyId: legacy.id, tomadorDoc: '00000000000', tomadorNome: 'SUPERVISAO SINTETICA', valorServicos: 1, status: 'pending', idDps: 'SINTETICO', xmlDps: '<DPS/>', configuracaoFiscal: {} } });
  const supervisionada = await db.acaoPendenteWhatsapp.create({ data: { conversaId: conversation.id, portalClientId: company.id, userId: user.id,
    tipo: TIPOS.EMITIR_NFSE, status: STATUS.CONFIRMADA, codigo: 'PGTS', payload: {}, textoDeConfirmacao: 'SINTETICO', expiraEm: now,
    resultado: { nfseId: pendingInvoice.id, indeterminado: true } } });
  const argsSupervisao = { habilitada: true, conversaId: conversation.id, acaoId: supervisionada.id, autorId: user.id, motivo: 'Ensaio supervisionado local', client: db,
    conferirEscopo: async () => ({ ...conversation, portalClientId: company.id }) };
  const ler = async () => (await listarEmissoesInterrompidas(argsSupervisao)).itens.find(i => i.acaoId === supervisionada.id);
  const versaoOriginal = (await ler()).versao;
  await comControleEmissao({ acaoId: supervisionada.id, client: db, executar: async () => {
    assert.equal((await ler()).situacao, 'PROCESSANDO');
    await assert.rejects(conferirEmissaoInterrompida({ ...argsSupervisao, versao: versaoOriginal }), { code: 'NFSE_EXECUCAO_ATIVA' });
  } });
  let consultasSinteticas = 0;
  const consultar = async ({ invoiceId, supervisao }) => {
    await conferirControleEmissao(supervisao); consultasSinteticas++;
    const nfse = await db.serviceInvoice.update({ where: { id: invoiceId }, data: { status: 'issued', chaveAcesso: '4'.repeat(50), numeroNfse: '18' } });
    return { estado: 'MESMA', recuperada: true, nfse };
  };
  const supervision = await conferirEmissaoInterrompida({ ...argsSupervisao, versao: versaoOriginal, consultar });
  assert.equal(supervision.recuperada, true);
  await assert.rejects(conferirEmissaoInterrompida({ ...argsSupervisao, versao: versaoOriginal, consultar }), { code: 'NFSE_CONCILIACAO_ESTADO_ALTERADO' });
  assert.equal(consultasSinteticas, 1);
  // O engine encerra a transação antes do callback terminar: o token não ganha
  // autorização para POST e o retorno tardio não rebaixa o resultado recuperado.
  let controleExpirado;
  await assert.rejects(comControleEmissao({ acaoId: supervisionada.id, client: db, timeoutMs: 50, executar: async controle => {
    controleExpirado = controle;
    await new Promise(resolve => setTimeout(resolve, 120));
    await assert.rejects(conferirControleEmissao(controle));
  } }));
  await comControleEmissao({ acaoId: supervisionada.id, client: db, executar: async controle => conferirControleEmissao(controle) });
  const antesTardio = await db.serviceInvoice.findUnique({ where: { id: pendingInvoice.id } });
  const tardio = await persistirDesfechoControlado({ client: db, controle: controleExpirado, invoiceId: pendingInvoice.id, versao: antesTardio, data: { status: 'falha_envio', falhaCodigo: 'TIMEOUT_SINTETICO' } });
  assert.equal(tardio.status, 'issued');
  assert.equal(tardio.configuracaoFiscal.historicoDesfechos.at(-1).tardio, true);
  const snapshotColisao = await db.serviceInvoice.findUnique({ where: { id: pendingInvoice.id } });
  let injetouColisao = false;
  const clientColisao = { serviceInvoice: {
    findUnique: args => db.serviceInvoice.findUnique(args),
    updateMany: async args => {
      if (!injetouColisao) {
        injetouColisao = true;
        await db.serviceInvoice.update({ where: { id: pendingInvoice.id }, data: {
          updatedAt: snapshotColisao.updatedAt,
          configuracaoFiscal: { ...snapshotColisao.configuracaoFiscal, evidenciaConcorrente: 'MESMO_MILISSEGUNDO' },
        } });
      }
      return db.serviceInvoice.updateMany(args);
    },
  } };
  const colisao = await persistirDesfechoControlado({ client: clientColisao, controle: controleExpirado,
    invoiceId: pendingInvoice.id, versao: snapshotColisao, data: { status: 'falha_envio', falhaCodigo: 'TARDIO_2' } });
  assert.equal(colisao.status, 'issued');
  assert.equal(colisao.configuracaoFiscal.evidenciaConcorrente, 'MESMO_MILISSEGUNDO');
  assert.equal(colisao.configuracaoFiscal.historicoDesfechos.length, snapshotColisao.configuracaoFiscal.historicoDesfechos.length + 1);
  console.log('PASS: CAS JSON preserva escrita concorrente com updatedAt idêntico e histórico tardio.');
  assert.equal((await ler()).situacao, 'RECUPERADA');
  console.log('PASS: supervisão PG com lock ativo, pending interrompido, resultado sintético MESMA, replay, timeout real da transação e resposta tardia preservada sem rebaixamento.');
  assert.equal(networkAttempts, 0);
  console.log('PASS: persistência da pendência, isolamento de empresa, reserva concorrente, replay e revogação reconferida.');
  console.log('PASS: executor WhatsApp real com serviço fiscal sintético; vínculo pré-envio durável, resultado incerto bloqueado e recuperação por prova local sem reenvio.');
  console.log('LIMITES: autorizador fiscal sintético; não testa emissão NFS-e, modelos de IA, transporte, DPS, certificado ou webhook real.');
} finally {
  await db.$disconnect();
}
// Fixtures são conservadas exclusivamente no banco descartável para inspeção.
