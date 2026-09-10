import { pedidoDeConsulta, periodoDaConsulta, numeroDaOpcao } from '../consultaClienteWhatsapp.js';
import { respostaComMarcador } from '../../assistente/validacaoResposta.js';
const agora = new Date('2026-09-10T15:00:00Z');

it.each(['quero minha guia', 'me manda o boleto', 'guias do mês', 'pode me enviar a guia?', 'preciso do DAS', 'guia do simples nacional', 'Simples nacional 2026-08'])('entende pedido de arquivo sem exigir campos técnicos: %s', texto => {
  expect(pedidoDeConsulta(texto, agora)?.acao).toBe('GUIAS');
});
it.each(['Quero saber meu faturamemto', 'qual meu faturamento?', 'quanto faturei mês passado?', 'faturameto', 'receita bruta desse ano'])('reconhece faturamento e erros comuns: %s', texto => {
  expect(pedidoDeConsulta(texto, agora)?.acao).toBe('FATURAMENTO');
});
it.each(['não envie a guia', 'quero emitir nota do simples nacional', 'a guia veio errada', 'descrição: guia de atendimento', 'o que é uma guia?', 'cancelar o boleto', 'trocar de empresa'])('não transforma outra intenção em envio de PDF: %s', texto => {
  expect(pedidoDeConsulta(texto, agora)).toBeNull();
});
it.each([
  ['este mês', '2026-09', '2026-09'], ['mês passado', '2026-08', '2026-08'],
  ['agosto', '2026-08', '2026-08'], ['e agosto de 2025?', '2025-08', '2025-08'],
  ['08/2026', '2026-08', '2026-08'], ['2026-08', '2026-08', '2026-08'],
  ['esse ano', '2026-01', '2026-09'], ['2025', '2025-01', '2025-12'],
  ['ano passado', '2025-01', '2025-12'], ['dezembro', '2025-12', '2025-12'],
  ['08/26', '2026-08', '2026-08'], ['janeiro a agosto de 2026', '2026-01', '2026-08'],
  ['01/2026 até 08/2026', '2026-01', '2026-08'],
])('interpreta período %s com ano explícito na resposta', (texto, inicio, fim) => {
  expect(periodoDaConsulta(texto, agora)).toEqual({ inicio, fim });
});
it('usa horário brasileiro na virada do mês', () => {
  expect(periodoDaConsulta('este mês', new Date('2026-10-01T01:00:00Z'))).toEqual({ inicio: '2026-09', fim: '2026-09' });
});
it.each(['13/2026', '2026-00', 'janeiro e agosto', 'agosto a janeiro de 2026', '2025-12 e janeiro'])('mês inválido exige esclarecimento: %s', texto => expect(periodoDaConsulta(texto, agora)).toEqual({ invalido: true }));
it.each([['2', 2], ['a primeira', 1], ['quero a segunda', 2], ['opção 3', 3], ['meu telefone é 2', null], ['720,00', null]])('escolha %s é contextual', (t, n) => expect(numeroDaOpcao(t)).toBe(n));
it.each(['[Mensagem alcance]', '[resposta]', '[Insira o texto]'])('rejeita marcador do modelo %s', t => expect(respostaComMarcador(t)).toBe(true));
it('preserva uma resposta normal e nomes entre colchetes', () => expect(respostaComMarcador('Seu arquivo [Guia de agosto] está disponível.')).toBe(false));
