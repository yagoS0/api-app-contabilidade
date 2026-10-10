jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarRelatorioFiscalLead } from '../RelatorioFiscalLeadService.js';

const user = { id: 'contador', role: 'contador' }, cnpj = '11222333000181', procurador = '39254243000191';
const agora = new Date('2026-10-10T12:00:00Z');
const clone = value => structuredClone(value);
function setup() {
  const ficha = { id: 'o', cnpj, versao: 3, status: 'RASCUNHO', criadoPorId: 'contador', dados: { razaoSocial: 'Empresa Teste' } };
  const conversa = { id: 'c', canalId: 'comercial', telefoneE164: '5511999990000', vinculoNumeroId: null, portalClientId: null };
  const caso = { id: 'a', onboardingId: 'o', conversaId: 'c', representanteVerificadoEm: agora, evidenciaRepresentante: 'Conferência sintética', createdAt: agora,
    autorizacao: { cnpj, estado: 'ATIVA', prova: { status: 'ATIVA', validUntil: '2099-01-01', systems: ['SITFIS'], procuradorCnpj: procurador } } };
  const analise = { id: 'f', onboardingId: 'o', cnpj, tipo: 'SITFIS', status: 'CONCLUIDA', createdAt: agora, documentoCifrado: 'cifrado',
    resultado: { relatorioDisponivel: true, leitura: { relatorio: { contribuinte: { cnpj, nome: 'Empresa Teste' }, diagnosticos: [] } } } };
  const eventos = [], mensagens = [];
  const db = {
    onboarding: { findUnique: jest.fn(async () => clone(ficha)), updateMany: jest.fn(async ({ where }) => ({ count: where.versao === ficha.versao ? 1 : 0 })) },
    atendimentoLead: { findFirst: jest.fn(async () => clone(caso)) },
    conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => where.id === conversa.id ? clone(conversa) : null), update: jest.fn(async ({ data }) => Object.assign(conversa, data)) },
    canalWhatsapp: { findUnique: jest.fn(async () => ({ ativo: true, finalidade: 'COMERCIAL' })) },
    contatoWhatsapp: { findFirst: jest.fn(async () => null) },
    onboardingAnalise: { findFirst: jest.fn(async ({ where }) => where.cnpj === analise.cnpj && analise.status === 'CONCLUIDA' ? clone(analise) : null) },
    onboardingEvento: { findFirst: jest.fn(async ({ where }) => clone(eventos.find(e => e.tipo === where.tipo && e.dados[where.dados.path[0]] === where.dados.equals) || null)),
      create: jest.fn(async ({ data }) => { const e = { ...clone(data), id: 'revisao-' + eventos.length, createdAt: agora }; eventos.push(e); return clone(e); }) },
    mensagemWhatsapp: { findMany: jest.fn(async ({ where }) => clone(mensagens.filter(m => m.referenciaComercial.relatorioFiscalChave === where.referenciaComercial.equals))) },
  };
  db.$transaction = fn => fn(db);
  const gerarPdf = jest.fn(async () => Buffer.from('%PDF-teste'));
  const enviarDocumento = jest.fn(async () => ({ wamid: 'meta-1' }));
  const envio = jest.fn(async args => { await args.antesDeEnviar(); const r = await args.enviar(); const m = { id: 'm', conversaId: args.conversa.id, statusEnvio: 'enviado', referenciaComercial: args.referenciaComercial }; mensagens.push(m); return { ...r, mensagem: m }; });
  const consumo = jest.fn(async () => ({ gpt: {}, serpro: { custoConfirmado: null } }));
  const deps = { db, agora: () => agora, gerarPdf, procuradorAtual: jest.fn(async () => procurador), consumo,
    janela: jest.fn(async () => ({ situacao: 'ABERTA' })), transportePara: jest.fn(async () => ({ enviarDocumento })), enviarRastreada: envio,
    leases: { adquirir: jest.fn(async () => ({ id: 'lease' })), renovar: jest.fn(async () => true), liberar: jest.fn(async () => {}) } };
  return { ficha, conversa, caso, analise, eventos, mensagens, db, deps, gerarPdf, enviarDocumento, envio, s: criarRelatorioFiscalLead(deps) };
}

test('gera tabela do lead sem criar cliente nem chamar provedor fiscal', async () => {
  const t = setup(); expect((await t.s.tabela('o', 'f', user, (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash)).toString()).toBe('%PDF-teste');
  expect(t.gerarPdf).toHaveBeenCalledWith(expect.objectContaining({ escritorio: 'ALTAN', empresa: { razao: 'Empresa Teste', cnpj } }));
  expect(t.envio).not.toHaveBeenCalled();
});
test('revisão explícita vincula conteúdo e versão; envio idempotente', async () => {
  const t = setup(); await expect(t.s.enviar('o', 'f', user, { conversaId: 'c' })).rejects.toMatchObject({ code: 'relatorio_nao_revisado' });
  await t.s.revisar('o', 'f', user, { versao: 3, conteudoHash: (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash }); await t.s.revisar('o', 'f', user, { versao: 3, conteudoHash: (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash });
  expect(t.eventos).toHaveLength(2);
  expect(t.eventos[1]).toMatchObject({ tipo: 'JORNADA_SITFIS_CONFERIDA', dados: { analiseId: 'f', cnpj } });
  expect(await t.s.enviar('o', 'f', user, { conversaId: 'c' })).toMatchObject({ enviado: true, envio: { estado: 'ENVIADO' } });
  expect(await t.s.enviar('o', 'f', user, { conversaId: 'c' })).toMatchObject({ jaEnviado: true });
  expect(t.enviarDocumento).toHaveBeenCalledTimes(1);
});
test.each(['cnpj','procuracao','representante','relatorio','procurador','destino'])('alteração de %s invalida envio revisado', async alvo => {
  const t = setup(); await t.s.revisar('o', 'f', user, { versao: 3, conteudoHash: (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash });
  if (alvo === 'cnpj') t.ficha.cnpj = '04252011000110';
  if (alvo === 'procuracao') t.caso.autorizacao.estado = 'REVOGADA';
  if (alvo === 'representante') t.caso.representanteVerificadoEm = null;
  if (alvo === 'relatorio') t.analise.resultado.leitura.relatorio.diagnosticos.push({ orgao: 'Alterado' });
  if (alvo === 'procurador') t.deps.procuradorAtual.mockResolvedValue('04252011000110');
  if (alvo === 'destino') t.conversa.telefoneE164 = '5511888880000';
  await expect(t.s.enviar('o', 'f', user, { conversaId: 'c' })).rejects.toMatchObject({ status: 409 });
  expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('revogação durante geração do PDF impede rede', async () => {
  const t = setup(); await t.s.revisar('o', 'f', user, { versao: 3, conteudoHash: (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash });
  t.gerarPdf.mockImplementation(async () => { t.caso.autorizacao.estado = 'REVOGADA'; return Buffer.from('%PDF'); });
  await expect(t.s.enviar('o', 'f', user, { conversaId: 'c' })).rejects.toMatchObject({ code: 'procuracao_nao_verificada' });
  expect(t.enviarDocumento).not.toHaveBeenCalled(); expect(t.deps.leases.liberar).toHaveBeenCalled();
});
test.each(['enviando','indeterminado'])('envio %s não é repetido', async statusEnvio => {
  const t = setup(); await t.s.revisar('o', 'f', user, { versao: 3, conteudoHash: (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash });
  t.mensagens.push({ id: 'm', conversaId: 'c', statusEnvio, referenciaComercial: { relatorioFiscalChave: t.eventos[0].dados.chave } });
  await expect(t.s.enviar('o', 'f', user)).rejects.toMatchObject({ code: 'envio_incerto' });
  expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('janela fechada impede envio, mesmo com revisão', async () => {
  const t = setup(); await t.s.revisar('o', 'f', user, { versao: 3, conteudoHash: (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash }); t.deps.janela.mockResolvedValue({ situacao: 'FECHADA' });
  await expect(t.s.enviar('o', 'f', user)).rejects.toMatchObject({ code: 'FORA_DA_JANELA' }); expect(t.enviarDocumento).not.toHaveBeenCalled();
});
test('CNPJ extraído divergente impede PDF e revisão', async () => {
  const t = setup(); t.analise.resultado.leitura.relatorio.contribuinte.cnpj = '04252011000110';
  await expect(t.s.tabela('o', 'f', user, (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash)).rejects.toMatchObject({ code: 'relatorio_cnpj_divergente' });
  expect(t.gerarPdf).not.toHaveBeenCalled();
});
test('relatório antigo e ficha desatualizada não podem ser revisados', async () => {
  const t = setup(); await expect(t.s.revisar('o', 'antigo', user, { versao: 3, conteudoHash: (await t.s.carregar('o', user)).relatorios[0]?.conteudoHash })).rejects.toMatchObject({ code: 'tabela_fiscal_indisponivel' });
  await expect(t.s.revisar('o', 'f', user, { versao: 2 })).rejects.toMatchObject({ code: 'formulario_alterado' });
  expect(t.eventos).toHaveLength(0);
});
test('painel retorna bloqueio seguro e consumo sem executar consulta', async () => {
  const t = setup(); t.caso.autorizacao.estado = 'REVOGADA';
  expect(await t.s.carregar('o', user)).toMatchObject({ relatorios: [], bloqueio: { codigo: 'procuracao_nao_verificada' }, consumo: { serpro: { custoConfirmado: null } } });
  expect(t.gerarPdf).not.toHaveBeenCalled(); expect(t.envio).not.toHaveBeenCalled();
});
test('usuário sem papel não acessa tabela', async () => {
  const t = setup(); await expect(t.s.tabela('o', 'f', { id: 'cliente', role: 'cliente' })).rejects.toMatchObject({ status: 403 });
  expect(t.gerarPdf).not.toHaveBeenCalled();
});

test.each(['leitura','razaoSocial'])('alteração de %s após abrir exige nova revisão', async alvo => {
 const t = setup(); const conteudoHash = (await t.s.carregar('o', user)).relatorios[0].conteudoHash;
 await t.s.tabela('o','f',user,conteudoHash);
 if(alvo === 'leitura') t.analise.resultado.leitura.relatorio.diagnosticos.push({orgao:'RFB'});
 else t.ficha.dados.razaoSocial='Nome atualizado';
 await expect(t.s.revisar('o','f',user,{versao:3,conteudoHash})).rejects.toMatchObject({code:'relatorio_alterado'});
 await expect(t.s.tabela('o','f',user,conteudoHash)).rejects.toMatchObject({code:'relatorio_alterado'});
 expect(t.eventos).toHaveLength(0);
});
