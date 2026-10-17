import { resolverConsultaCliente } from '../ConsultasClienteWhatsappService.js';

const agora = new Date('2026-10-17T15:00:00Z');
const registro = { conversa: { id: 'conversa-ficticia', portalClientId: 'empresa-ficticia' }, contexto: { versao: 2 } };
function resolver(texto, { alvo = 'GUIAS', interacao, acaoMenu, expiraEm = '2026-10-17T15:30:00Z' } = {}) {
  const anterior = { schema: 1, empresaId: 'empresa-ficticia', conversaId: 'conversa-ficticia', versao: 2,
    criadaEm: '2026-10-17T14:59:00Z', expiraEm, token: 'pergunta-ficticia', tipo: 'PERIODO', alvo,
    opcoes: ['mes.2026-10', 'mes.2026-09', 'outro'], aguardando: true };
  const client = { mensagemWhatsapp: { findFirst: async () => ({ autor: 'SISTEMA', statusEnvio: 'enviado', contextoConsulta: anterior }) } };
  return resolverConsultaCliente({ texto, interacao, acaoMenu, registro, client, agora });
}

it.each([
  ['GUIAS', 'Não consulte minhas guias de setembro'],
  ['GUIAS', 'Pode explicar a diferença entre competência e vencimento de uma guia de setembro?'],
  ['GUIAS', 'Como posso consultar minhas guias de setembro?'],
  ['FATURAMENTO', 'Me ensina a consultar o faturamento de setembro?'],
  ['FATURAMENTO', 'Não consulte meu faturamento de setembro'],
])('contexto de período %s não reautoriza negativa ou explicação: %s', async (alvo, texto) => {
  expect(await resolver(texto, { alvo })).toBeNull();
});

it.each(['GUIAS', 'FATURAMENTO'])('mês isolado ainda responde à pergunta de %s', async alvo => {
  expect(await resolver('setembro', { alvo })).toEqual({ acao: alvo, periodo: { inicio: '2026-09', fim: '2026-09' } });
});

it('preserva número da opção de período', async () => {
  expect(await resolver('2')).toMatchObject({ acao: 'OPCAO', opcao: 'mes.2026-09' });
});

it('preserva botão válido pelo ID sem interpretar o título como comando', async () => {
  expect(await resolver('Como consultar setembro?', { interacao: { id: 'altan.client.query.v1.pergunta-ficticia.mes.2026-09' } }))
    .toMatchObject({ acao: 'OPCAO', opcao: 'mes.2026-09' });
});

it('botão expirado não ganha validade pelo período no título', async () => {
  expect(await resolver('setembro', { interacao: { id: 'altan.client.query.v1.pergunta-ficticia.mes.2026-09' }, expiraEm: '2026-10-17T14:00:00Z' }))
    .toEqual({ acao: 'EXPIRADA' });
});

it('pedido misto explícito continua consultando o período', async () => {
  expect(await resolver('Me envie as guias de setembro e explique o vencimento')).toMatchObject({ acao: 'GUIAS', periodo: { inicio: '2026-09', fim: '2026-09' } });
});

it('atalho inferido de texto não supera uma negativa', async () => {
  expect(await resolver('Não consulte minhas guias de setembro', { acaoMenu: 'GUIAS_ABERTO' })).toBeNull();
});
