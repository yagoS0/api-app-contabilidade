// Banco PostgreSQL real e descartável; transporte Meta e recálculo fiscal simulados explicitamente.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const url = new URL(process.env.DATABASE_URL || 'invalid:');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_check')) throw Error('Exige banco local descartável _check.');
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'fatal', INTEGRACAO_WHATSAPP: '0', INTEGRACAO_IA_COMERCIAL: '0' });
// Inclui flags herdadas e futuras declarações de configuração antes de importar serviços.
const integrationFlags = new Set([...Object.keys(process.env).filter(key => key.startsWith('INTEGRACAO_')),
  ...readFileSync(new URL('../src/config.js', import.meta.url), 'utf8').matchAll(/\bINTEGRACAO_[A-Z0-9_]+\b/g)].map(value => Array.isArray(value) ? value[0] : value));
for (const key of integrationFlags) process.env[key] = '0';
globalThis.fetch = async () => { throw Error('Rede externa bloqueada neste ensaio de banco.'); };
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { avisarPagamentoNaoConfirmado } = await import('../src/application/guides/AvisoPagamentoService.js');
const { recalcularGuiaWhatsapp } = await import('../src/application/guides/RecalcularGuiaWhatsappService.js');
const { confirmarPagamentoWhatsapp } = await import('../src/application/guides/ConfirmarPagamentoWhatsappService.js');
const { prepararGuiaPagamentoWhatsapp } = await import('../src/application/whatsapp/PrepararGuiaPagamentoWhatsapp.js');
const { enviarMensagemRastreada } = await import('../src/application/whatsapp/SaidaWhatsappService.js');
const { calendarioAvisosGuia } = await import('../src/application/guides/calendarioAvisosGuia.js');
const { generateEntriesFromCircular } = await import('../src/application/accounting/AccountingEntryGeneratorService.js');
const { reabrirFechamento } = await import('../src/application/notas/apuracao/v2/FechamentoService.js');
const prefix = `dev-guia-${randomUUID()}`;
let checks = 0;
const ok = texto => { checks++; console.log(`OK ${checks}: ${texto}`); };
const antes = new Date('2026-10-15T12:00:00Z');
const depois = new Date('2026-10-19T12:00:00Z');
const enviados = [];
const codigoSintetico = '8' + '0'.repeat(47); // Somente banco isolado/transporte falso; jamais enviado à Meta.
try {
  const [banco] = await db.$queryRaw`SELECT current_database() AS nome`;
  assert.equal(banco.nome, url.pathname.slice(1));
  const empresa = await db.portalClient.create({ data: { cnpj: prefix, razao: 'TESTE DEV - sem validade fiscal', municipio: 'Cidade de teste' } });
  const contato = await db.contatoWhatsapp.create({ data: { portalClientId: empresa.id, nome: 'Destinatário sintético DEV', telefoneE164: prefix, ativo: true, optInEm: antes } });
  const conversa = await db.conversaWhatsapp.create({ data: { portalClientId: empresa.id, telefoneE164: contato.telefoneE164, chaveEscopo: prefix, escopoVerificado: true } });
  const guia = await db.guide.create({ data: { portalClientId: empresa.id, tipo: 'SIMPLES', source: 'SERPRO', competencia: '2026-09', valor: 10, vencimento: new Date('2026-10-17T00:00:00Z'), status: 'PROCESSED', liberadaCliente: true, paymentStatus: 'OPEN', hash: `${prefix}:original` } });
  // O extrato é sintético; o gerador contábil e sua persistência são os mesmos da aplicação.
  await db.companyMonthlyCircular.create({ data: { portalClientId: empresa.id, competencia: guia.competencia, receitaBruta: 100, receitaServicos: 100, dasTotal: 10, pgdasNumeroDeclaracao: `${prefix}:pgdas` } });
  const gerar = () => generateEntriesFromCircular({ portalClientId: empresa.id, competencia: guia.competencia, fonteValor: 'EXTRATO', txTimeoutMs: 30000 });
  assert.equal((await gerar()).ok, true);
  await gerar();
  const provisao = await db.accountingEntry.findFirst({ where: { portalClientId: empresa.id, eventType: 'DAS_SIMPLES' }, include: { lines: true } });
  assert.ok(provisao); assert.equal(provisao.statusPagamento, 'ABERTO');
  assert.equal(await db.accountingEntry.count({ where: { portalClientId: empresa.id, eventType: 'DAS_SIMPLES' } }), 1);
  assert.equal(await db.accountingEntry.count({ where: { portalClientId: empresa.id, eventType: 'RECEITA_SERVICO' } }), 1);
  assert.equal(Number(provisao.lines.find(l => l.tipo === 'D').valor), 10);
  ok('extrato sintético gera receita e provisão pelo serviço real; repetição conserva um lançamento por evento');
  const transporte = { destinatarios: async () => ({ telefones: [contato], emails: [] }), whatsapp: async args => { await args.conferir(); enviados.push(args); } };
  const aviso = agora => avisarPagamentoNaoConfirmado({ guideId: guia.id, scheduledAt: agora.toISOString(), agora }, { db, transporte, feriados: [] });
  assert.deepEqual(calendarioAvisosGuia(guia.vencimento), { vencimento: '2026-10-16', antes: '2026-10-15', depois: '2026-10-19' });
  await aviso(antes);
  assert.equal(enviados.length, 0);
  ok('sem recibo de entrega da versão atual, lembrete permanece bloqueado');
  await db.envioGuia.create({ data: {
    guideId: guia.id, canal: 'WHATSAPP', destino: contato.telefoneE164, status: 'entregue', entregueEm: antes,
    historicoTentativas: { create: {
      status: 'entregue', entregueEm: antes, arquivoSha256: guia.hash,
      snapshot: { guideId: guia.id, portalClientId: empresa.id, telefone: contato.telefoneE164,
        competencia: guia.competencia, valor: Number(guia.valor), vencimento: guia.vencimento.toISOString() },
    } },
  } });
  await Promise.all([aviso(antes), aviso(antes)]);
  assert.equal(enviados.length, 1); assert.equal(enviados[0].fase, 'ANTES'); assert.equal(enviados[0].acoes.length, 0);
  ok('vencimento sábado antecipa para sexta e aviso da quinta é persistido uma vez sob concorrência');
  await aviso(depois); await aviso(depois);
  assert.equal(enviados.length, 2); assert.equal(enviados[1].fase, 'DEPOIS');
  const botao = enviados[1].acoes[0]; assert.ok(botao.id.startsWith('altan.payment.recalculate.')); assert.equal(botao.url, undefined);
  ok('segunda-feira emite aviso posterior separado com recálculo por botão, sem portal');
  let custos = 0;
  const saidas = [];
  const cloud = {
    enviarTexto: async a => { saidas.push({ tipo: 'text', ...a }); return { wamid: `${prefix}:text:${randomUUID()}` }; },
    enviarGuiaComPagamento: async a => { saidas.push({ tipo: 'document', linhaDigitavel: a.linhaDigitavel, nomeArquivo: a.nomeArquivo, bytes: a.conteudoPdf.length }); return { wamid: `${prefix}:pdf:${randomUUID()}` }; },
    enviarBotoes: async a => { saidas.push({ tipo: 'interactive', ...a }); return { wamid: `${prefix}:button:${randomUUID()}` }; },
  };
  const mensagem = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'interactive', corpo: 'Recalcular guia', providerMessageId: `${prefix}:click` } });
  const conferirAcesso = async () => {};
  const enviar = a => enviarMensagemRastreada({ conversa, corpo: a.corpo, tipo: a.tipo || 'text', turnoIaId: a.idTurno, client: db, autor: 'SISTEMA', antesDeEnviar: conferirAcesso, enviar: a.chamada });
  const executar = () => recalcularGuiaWhatsapp({ id: botao.id, conversa, mensagem, client: db, cloud, enviar, conferirAcesso, agora: depois }, {
    recalcular: async () => { custos++; return db.guide.update({ where: { id: guia.id }, data: { hash: `${prefix}:atualizada`, valor: 11, vencimento: new Date('2026-10-20T00:00:00Z'), linhaDigitavel: codigoSintetico, linhaDigitavelLidaEm: depois } }); },
    carregarPdf: async () => Buffer.from('%PDF-1.4 TESTE SINTETICO SEM VALIDADE FISCAL'),
    prepararPagamento: (a, deps) => prepararGuiaPagamentoWhatsapp(a, { ...deps, janela: async () => ({ situacao: 'ABERTA' }) }),
  });
  const r = await executar();
  assert.equal(r.codigo?.status, 'ENVIADO', JSON.stringify({ r, saidas, reservas: await db.appSetting.findMany({ where: { key: { startsWith: 'recalculo_whatsapp:' } } }) }));
  assert.equal(custos, 1); assert.equal(saidas[0].texto, 'Aguarde enquanto atualizamos sua guia.'); assert.equal(saidas[1].tipo, 'document');
  assert.equal(saidas[2].tipo, 'interactive'); assert.equal(saidas[1].linhaDigitavel, codigoSintetico);
  const novoBotao = saidas[2].botoes[0].id;
  const novoToken = await db.appSetting.findUnique({ where: { key: novoBotao } }); assert.equal(novoToken.value.hash, `${prefix}:atualizada`);
  ok('recálculo simulado entrega aguarde → PDF com código na mesma mensagem → confirmação; saídas e tokens persistem no PostgreSQL');
  await executar(); assert.equal(custos, 1); assert.equal(saidas.filter(s => s.tipo === 'document').length, 1);
  ok('reentrega do clique antigo não recalcula nem entrega PDF novamente');
  const clique = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'interactive', corpo: 'Confirmar pagamento', providerMessageId: `${prefix}:confirm` } });
  const confirmar = (m, id) => confirmarPagamentoWhatsapp({ id, conversa, mensagem: m, client: db, conferirAcesso, agora: depois });
  const pergunta = await confirmar(clique, novoBotao); assert.match(pergunta.texto, /Em que data/);
  assert.equal((await db.guide.findUnique({ where: { id: guia.id } })).paymentStatus, 'OPEN');
  assert.deepEqual(pergunta.botoes.map(b=>b.titulo), ['Hoje','Data de vencimento','Digitar uma data']);
  const data = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'interactive', corpo: 'Hoje', providerMessageId: `${prefix}:date` } });
  const confirmacoes = await Promise.all([confirmar(data,pergunta.botoes[0].id), confirmar(data,pergunta.botoes[0].id)]); assert.deepEqual(confirmacoes[0], confirmacoes[1]);
  const paga = await db.guide.findUnique({ where: { id: guia.id } }); assert.equal(paga.paymentStatus, 'PAID'); assert.equal(paga.paymentStatusSource, 'CLIENTE'); assert.equal(paga.baixada, false); assert.equal(paga.paymentConfirmedAt.toISOString().slice(0, 10), '2026-10-19');
  ok('botão novo solicita a data; resposta concorrente registra declaração do cliente sem baixa contábil');
  const total = enviados.length; assert.equal((await aviso(new Date('2026-10-21T12:00:00Z'))).motivo, 'PAGAMENTO_JA_CONFIRMADO'); assert.equal(enviados.length, total);
  ok('pagamento confirmado cancela novo aviso antes do transporte');
  const semAnexo = await db.mensagemWhatsapp.create({data:{conversaId:conversa.id,direcao:'in',tipo:'interactive',corpo:'Sem comprovante',providerMessageId:`${prefix}:no-proof`}});
  assert.match((await confirmar(semAnexo,confirmacoes[0].botoes[0].id)).texto,/Pagamento registrado/);
  ok('botão Sem comprovante conclui a confirmação persistida');
  await gerar();
  const preservada = await db.accountingEntry.findUnique({ where: { id: provisao.id }, include: { lines: true } });
  assert.equal(preservada.statusPagamento, 'ABERTO');
  assert.equal(Number(preservada.lines.find(l => l.tipo === 'D').valor), 10);
  assert.equal(await db.accountingEntry.count({ where: { portalClientId: empresa.id, eventType: 'DAS_SIMPLES' } }), 1);
  ok('guia recalculada e declaração CLIENTE não sobrescrevem principal do extrato nem criam baixa');
  const contador = await db.user.create({data:{email:`${prefix}@example.invalid`,passwordHash:'SEM_LOGIN_TESTE_LOCAL',accountType:'FIRM',status:'active'}});
  await db.companyFirmAccess.create({data:{companyId:empresa.id,userId:contador.id,role:'ACCOUNTANT',status:'ACTIVE'}});
  const {default:express}=await import('express');const {default:request}=await import('supertest');
  const {createAccountingEntriesRouter}=await import('../src/routes/firm/accountingEntries.js');
  const app=express();
  // Sessão autenticada do teste é injetada; o middleware real confere o vínculo do contador no banco.
  app.use((req,res,next)=>{if(req.headers['x-test-session']==='contador')req.auth={user:contador};next()});
  app.use('/companies/:companyId',createAccountingEntriesRouter({log:{error:console.error,warn:()=>{},info:()=>{}}}));
  const rota=`/companies/${empresa.id}/entries/circular?year=2026`;
  assert.equal((await request(app).get(rota)).status,401);
  const circular=await request(app).get(rota).set('x-test-session','contador');assert.equal(circular.status,200,JSON.stringify(circular.body));
  const linha=circular.body.provisoes.find(e=>e.id===provisao.id);assert.ok(linha,'Provisão deve aparecer na circular');
  assert.equal(linha.pagamentoLocalizado,true);assert.equal(linha.statusPagamento,'ABERTO');
  assert.equal(linha.sourceGuide.paymentStatusSource,'CLIENTE');assert.equal(linha.sourceGuide.paymentConfirmedAt.slice(0,10),'2026-10-19');
  const pendentes=await request(app).get(`/companies/${empresa.id}/pagamentos-pendentes?competencia=2026-10`).set('x-test-session','contador');
  assert.equal(pendentes.status,200);assert.ok(pendentes.body.itens.some(e=>e.id===provisao.id));
  assert.equal(await db.accountingEntry.count({where:{portalClientId:empresa.id,tipo:'BAIXA'}}),0);
  ok('rota HTTP da circular e pagamentos pendentes mostram confirmação e data, preservam acesso e não criam baixa automática');
  // R04–R06: serviço e transações reais; somente dados sintéticos do cluster descartável.
  const plain = value => JSON.parse(JSON.stringify(value));
  const criarTransmitida = competencia => db.apuracaoSnapshot.create({ data: {
    portalClientId: empresa.id, competencia, rbt12: 100, receitaPorTipo: {},
    estado: 'transmitida', idempotencyKey: `${prefix}:${competencia}`,
    numeroDeclaracao: `${prefix}:declaracao:${competencia}`, reciboNumero: `${prefix}:recibo:${competencia}`,
    transmitidoEm: antes, erroMensagem: 'erro sintético anterior',
  } });
  const auditorias = competencia => db.appSetting.findMany({ where: { AND: [
    { key: { startsWith: 'apuracao_reabertura:' } },
    { value: { path: ['portalClientId'], equals: empresa.id } },
    { value: { path: ['competencia'], equals: competencia } },
  ] } });
  const reabrir = competencia => reabrirFechamento({ portalClientId: empresa.id, competencia,
    userId: contador.id, motivo: '  Receita posterior sintética  ' });
  const conferirReaberta = async anterior => {
    const atual = await db.apuracaoSnapshot.findUnique({ where: { id: anterior.id } });
    assert.equal(atual.estado, 'aberta');
    assert.match(atual.idempotencyKey, /^reaberta:/);
    assert.notEqual(atual.idempotencyKey, anterior.idempotencyKey);
    assert.equal(atual.erroMensagem, null);
    for (const campo of ['numeroDeclaracao', 'reciboNumero', 'transmitidoEm']) assert.deepEqual(atual[campo], anterior[campo]);
    const eventos = await auditorias(anterior.competencia);
    assert.equal(eventos.length, 1);
    const evento = eventos[0].value;
    assert.equal(evento.evento, 'APURACAO_REABERTA');
    assert.equal(evento.dominio, 'APURACAO');
    assert.equal(evento.snapshotId, anterior.id);
    assert.equal(evento.userId, contador.id);
    assert.equal(evento.motivo, 'Receita posterior sintética');
    assert.equal(evento.estadoAnterior, 'transmitida');
    assert.equal(evento.estadoAtual, 'aberta');
    assert.equal(evento.revisaoAnterior, anterior.idempotencyKey);
    assert.equal(evento.novaRevisao, atual.idempotencyKey);
    assert.equal(evento.numeroDeclaracaoAnterior, anterior.numeroDeclaracao);
    assert.equal(evento.transmitidoEmAnterior, anterior.transmitidoEm.toISOString());
    assert.ok(Number.isFinite(Date.parse(evento.ocorridoEm)));
    assert.deepEqual(evento.snapshotAnterior, plain(anterior));
  };
  const transmitida = await criarTransmitida('2026-08');
  assert.equal((await reabrir(transmitida.competencia)).ok, true);
  await conferirReaberta(transmitida);
  ok('reabertura real persiste revisão e auditoria completas, preservando declaração e recibo');

  const rollback = await criarTransmitida('2026-07');
  // A constraint existe apenas neste banco descartável e só rejeita a auditoria desta fixture.
  // A falha ocorre no PostgreSQL após o UPDATE real; não se substitui $transaction por mock.
  assert.match(empresa.id, /^[a-f0-9-]+$/i);
  const constraint = 'altan_test_reabertura_audit_fault';
  await db.$executeRawUnsafe(`ALTER TABLE "AppSetting" ADD CONSTRAINT "${constraint}" CHECK (
    NOT (COALESCE(value->>'evento', '') = 'APURACAO_REABERTA'
      AND COALESCE(value->>'portalClientId', '') = '${empresa.id}'
      AND COALESCE(value->>'competencia', '') = '${rollback.competencia}'))`);
  try {
    await assert.rejects(reabrir(rollback.competencia), error => String(error.message).includes(constraint));
    assert.deepEqual(plain(await db.apuracaoSnapshot.findUnique({ where: { id: rollback.id } })), plain(rollback));
    assert.equal((await auditorias(rollback.competencia)).length, 0);
  } finally {
    await db.$executeRawUnsafe(`ALTER TABLE "AppSetting" DROP CONSTRAINT "${constraint}"`);
  }
  const constraints = await db.$queryRaw`SELECT conname FROM pg_constraint WHERE conname = ${constraint}`;
  assert.equal(constraints.length, 0);
  ok('falha real de auditoria reverte todo o snapshot; constraint da fixture removida em finally');

  const concorrente = await criarTransmitida('2026-06');
  // Duas chamadas simultâneas reais; não pressupõe ordem de agendamento nem força o ramo CAS.
  const tentativas = await Promise.allSettled([reabrir(concorrente.competencia), reabrir(concorrente.competencia)]);
  assert.equal(tentativas.filter(t => t.status === 'fulfilled' && t.value.ok === true).length, 1);
  const recusadas = tentativas.filter(t => t.status === 'rejected');
  assert.equal(recusadas.length, 1);
  assert.ok(['CALCULO_DESATUALIZADO', 'ESTADO_INVALIDO'].includes(recusadas[0].reason.code));
  await conferirReaberta(concorrente);
  ok(`duas reaberturas concorrentes reais produzem uma transição e uma auditoria; segunda recusada: ${recusadas[0].reason.code}`);
  console.log(JSON.stringify({ passed: true, checks, banco: banco.nome, transporte: 'SIMULADO', serpro: 'SIMULADO', envioRealWhatsapp: false, mensagensPersistidas: await db.mensagemWhatsapp.count({ where: { conversaId: conversa.id, direcao: 'out' } }) }));
} finally { await db.$disconnect(); }
