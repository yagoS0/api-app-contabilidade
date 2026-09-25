// Caracterização do atendimento atual: nenhum modelo, chamada fiscal ou envio real.
// Confirmar pagamento por conversa ainda é um fluxo futuro; o teste não o simula como pronto.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { resolverConsultaCliente, atenderConsultaCliente } from '../ConsultasClienteWhatsappService.js';
import { declarouPagamento } from '../consultaClienteWhatsapp.js';

const agora = new Date('2026-09-24T15:00:00.000Z');
const guia = { guideId: 'guia-sintetica', tipo: 'Simples Nacional', tipoCodigo: 'SIMPLES', competencia: '2026-08', vencimento: '21/09/2026', vencida: true, valorFormatado: 'R$ 490,00' };
function cenario(corpo, resposta = { ok: true, guias: [guia] }) {
  const registro = { conversa: { id: 'conversa-sintetica', portalClientId: 'empresa-sintetica', telefoneE164: '5521999998888' }, mensagem: { id: 'mensagem-sintetica', corpo } };
  const client = { mensagemWhatsapp: { findFirst: jest.fn(async () => null) } };
  const cloud = { enviarTexto: jest.fn(async () => ({})), enviarBotoes: jest.fn(async () => ({})), enviarLista: jest.fn(async () => ({})) };
  const arquivos = [];
  const executar = jest.fn(async (nome, entrada) => {
    if (nome === 'enviar_pdf_da_guia') { arquivos.push(entrada.guideId); return { ok: true, enviado: true }; }
    if (nome === 'preparar_recalculo') return { ok: true, textoDeConfirmacao: 'Confirme a atualização pelo código de teste.' };
    return resposta;
  });
  const resolver = () => resolverConsultaCliente({ texto: corpo, registro, client, agora });
  const atender = async () => {
    const pedido = await resolver();
    if (pedido) await atenderConsultaCliente({ pedido, registro, sessao: { portalClientId: registro.conversa.portalClientId }, agora, executar, client, cloud,
      enviar: async saida => saida.chamada(), antesDeEnviar: async () => {}, permitida: () => true, vincularOpcoes: itens => itens, rotular: texto => texto });
    return pedido;
  };
  return { registro, client, cloud, executar, arquivos, resolver, atender };
}

describe('pedidos de guia escritos pelo cliente', () => {
  test.each(['manda minha guia', 'me manda a guia', 'pode enviar meu DAS?', 'preciso do boleto do simples'])('%s usa as guias salvas sem perguntar competência nem consultar a Receita', async texto => {
    const c = cenario(texto);
    expect(await c.atender()).toMatchObject({ acao: 'GUIAS' });
    expect(c.executar.mock.calls.map(([nome]) => nome)).toEqual(['quanto_devo', 'enviar_pdf_da_guia']);
    expect(c.arquivos).toEqual(['guia-sintetica']);
    expect(c.cloud.enviarTexto).not.toHaveBeenCalled();
  });
  test('falha ao ler as guias não afirma dívida nem sucesso de envio', async () => {
    const c = cenario('manda minha guia', { ok: false });
    await c.atender();
    expect(c.cloud.enviarTexto.mock.calls[0][0].texto).toBe('Não consegui consultar as guias agora.');
    expect(c.arquivos).toEqual([]);
    expect(c.executar.mock.calls.map(([nome]) => nome)).toEqual(['quanto_devo']);
  });
  test('lista vazia pede conferência de liberação e não afirma quitação', async () => {
    const c = cenario('manda minha guia', { ok: true, guias: [] });
    await c.atender();
    expect(c.cloud.enviarTexto.mock.calls[0][0].texto).toBe('Ainda não encontrei uma guia liberada para pagar neste mês. A equipe pode conferir se falta liberar algum arquivo.');
    expect(c.arquivos).toEqual([]);
  });
  test('recalcular já tem preparação com confirmação; não executa recálculo ao interpretar a frase', async () => {
    const c = cenario('quero recalcular minha guia');
    expect(await c.atender()).toMatchObject({ acao: 'GUIAS', recalculo: true });
    expect(c.executar.mock.calls.map(([nome]) => nome)).toEqual(['quanto_devo', 'preparar_recalculo']);
    expect(c.cloud.enviarTexto.mock.calls[0][0].texto).toBe('Confirme a atualização pelo código de teste.');
    expect(c.arquivos).toEqual([]);
  });
});

describe('limites atuais: declaração e comprovante não são confirmação fiscal por chat', () => {
  test.each(['já paguei', 'paguei ontem', 'segue o comprovante', 'essa guia já foi paga', 'já paguei a guia'])('%s sai do core de consulta sem escrever pagamento nem acionar consulta fiscal', async texto => {
    const c = cenario(texto);
    expect(await c.atender()).toBeNull();
    expect(declarouPagamento(texto)).toBe(true);
    expect(c.executar).not.toHaveBeenCalled();
  });
  test.each(['quais guias já paguei?', 'manda as guias que já paguei', 'quero ver minhas guias pagas'])('%s conserva a consulta histórica', async texto => {
    const c = cenario(texto, { ok: true, guias: [] });
    expect(declarouPagamento(texto)).toBe(false);
    expect(await c.atender()).toMatchObject({ acao: 'GUIAS', pagas: true });
    expect(c.executar).toHaveBeenCalledWith('listar_guias', { status: 'PAID' }, expect.anything());
    expect(c.cloud.enviarTexto.mock.calls[0][0].texto).toBe('Não encontrei guias registradas como pagas no histórico disponível. A equipe pode conferir se o pagamento ainda não foi registrado.');
  });
  test('consulta histórica vazia informa o período pedido e não declara falta de pagamento', async () => {
    const c = cenario('quais guias já paguei em agosto de 2026?', { ok: true, guias: [] });
    await c.atender();
    expect(c.executar).toHaveBeenCalledWith('listar_guias', { competencia: '2026-08', status: 'PAID' }, expect.anything());
    expect(c.cloud.enviarTexto.mock.calls[0][0].texto).toBe('Não encontrei guias registradas como pagas para agosto de 2026. A equipe pode conferir se o pagamento ainda não foi registrado.');
    expect(c.cloud.enviarTexto.mock.calls[0][0].texto).not.toMatch(/para pagar neste mês|não (?:houve|foi feito) pagamento|inadimpl/i);
  });
  test.each(['não paguei', 'não paguei a guia', 'nunca paguei essa guia', 'não tenho comprovante', 'vou pagar a guia', 'pagamos quando for possível', 'acho que paguei a guia', 'já paguei?', 'essa guia já foi paga?', 'será que já paguei a guia?', 'descrição: já paguei o serviço', 'valor: 1500, já paguei'])('%s não é declaração afirmativa', texto => expect(declarouPagamento(texto)).toBe(false));
  test.each(['Bom dia, já paguei a guia', 'Já paguei o DAS, pode conferir?', 'paguei ontem, pode conferir?', 'Paguei ontem, mas ainda aparece como aberto', 'eu já paguei', 'nós já pagamos o DAS', 'guia paga', 'o DAS foi pago', 'as guias já foram pagas', 'essa guia eu já paguei', 'efetuei o pagamento do imposto', 'realizei o pagamento', 'fiz o pagamento ontem', 'o pagamento da guia foi realizado', 'enviei o comprovante de pagamento'])('%s reconhece o relato para conferência, sem comprovar quitação', texto => expect(declarouPagamento(texto)).toBe(true));
});
