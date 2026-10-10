// Banco PostgreSQL real e descartável; transporte Meta e recálculo fiscal simulados explicitamente.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url = new URL(process.env.DATABASE_URL || 'invalid:');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_check')) throw Error('Exige banco local descartável _check.');
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'fatal', INTEGRACAO_WHATSAPP: '0', INTEGRACAO_IA_COMERCIAL: '0' });
globalThis.fetch = async () => { throw Error('Rede externa bloqueada neste ensaio de banco.'); };
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { avisarPagamentoNaoConfirmado } = await import('../src/application/guides/AvisoPagamentoService.js');
const { recalcularGuiaWhatsapp } = await import('../src/application/guides/RecalcularGuiaWhatsappService.js');
const { confirmarPagamentoWhatsapp } = await import('../src/application/guides/ConfirmarPagamentoWhatsappService.js');
const { prepararGuiaPagamentoWhatsapp } = await import('../src/application/whatsapp/PrepararGuiaPagamentoWhatsapp.js');
const { enviarMensagemRastreada } = await import('../src/application/whatsapp/SaidaWhatsappService.js');
const { calendarioAvisosGuia } = await import('../src/application/guides/calendarioAvisosGuia.js');
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
  const transporte = { destinatarios: async () => ({ telefones: [contato], emails: [] }), whatsapp: async args => { await args.conferir(); enviados.push(args); } };
  const aviso = agora => avisarPagamentoNaoConfirmado({ guideId: guia.id, scheduledAt: agora.toISOString(), agora }, { db, transporte, feriados: [] });
  assert.deepEqual(calendarioAvisosGuia(guia.vencimento), { vencimento: '2026-10-16', antes: '2026-10-15', depois: '2026-10-19' });
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
  assert.equal(custos, 1); assert.equal(saidas[0].texto, 'Aguarde em quanto recalculamos.'); assert.equal(saidas[1].tipo, 'document');
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
  const provisao = await db.accountingEntry.create({data:{portalClientId:empresa.id,sourceGuideId:guia.id,tipo:'PROVISAO',subtipo:'DAS',eventType:'DAS_SIMPLES',competencia:'2026-09',data:new Date('2026-09-30'),historico:'TESTE DEV — provisão da guia',status:'RASCUNHO',statusPagamento:'ABERTO',lines:{create:[{tipo:'D',conta:'499',valor:11,ordem:0},{tipo:'C',conta:'250',valor:11,ordem:1}]}}});
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
  console.log(JSON.stringify({ passed: true, checks, banco: banco.nome, transporte: 'SIMULADO', serpro: 'SIMULADO', envioRealWhatsapp: false, mensagensPersistidas: await db.mensagemWhatsapp.count({ where: { conversaId: conversa.id, direcao: 'out' } }) }));
} finally { await db.$disconnect(); }
