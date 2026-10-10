import { SuporteOpenAIClient, argumentosValidos, pedidoHumanoExplicito } from '../SuporteOpenAIClient.js';
import { custoEstimadoMicrousd } from '../precosIa.js';
import { suporteNoPiloto } from '../pilotoSuporte.js';
import { correcaoExplicita } from '../correcaoDoPedido.js';

const usage = { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } };
const texto = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const chamada = (name = 'consultar', args = { nome: 'Gusmed' }, id = 'fc1') => ({ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id });
const ferramenta = { name: 'consultar', description: 'Consulta', input_schema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'], additionalProperties: false } };
test.each(['Não quero robô, quero um atendente', 'Quero falar com uma pessoa', 'Me passa para o contador', 'Preciso da equipe humana', 'Chama o escritório para mim', 'Quero atendimento humano', 'Encaminhe minha dúvida ao contador'])('reconhece solicitação explícita: %s', t => {
  expect(pedidoHumanoExplicito(t)).toBe(true);
});
test.each(['Não quero atendimento humano', 'O que faz um atendente?', 'Meu cliente disse quero atendimento humano', 'Quero emitir uma nota'])('não força transferência em %s', t => expect(pedidoHumanoExplicito(t)).toBe(false));
test('pedido humano aciona ferramenta autorizada sem consumir tokens', async () => {
  const s = setup([]); s.executar.mockResolvedValue({ ok: true });
  const r = await s.client.responder({ messages: [{ role: 'user', content: 'Não quero robô, quero um atendente' }], ferramentas: [{ name: 'chamar_escritorio' }], executar: s.executar });
  expect(r.ferramentasChamadas).toEqual(['chamar_escritorio']); expect(r.iteracoes).toBe(0);
  expect(s.fetchImpl).not.toHaveBeenCalled(); expect(s.autorizar).not.toHaveBeenCalled();
});
test('não confirma encaminhamento quando a ferramenta recusa', async () => {
  const s = setup([]); s.executar.mockResolvedValue({ ok: false });
  await expect(s.client.responder({ messages: [{ role: 'user', content: 'Quero atendimento humano' }], ferramentas: [{ name: 'chamar_escritorio' }], executar: s.executar })).rejects.toThrow('IA_ENCAMINHAMENTO_FALHOU');
  expect(s.fetchImpl).not.toHaveBeenCalled();
});
function setup(saidas, opcoes = {}) {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ status: 'completed', usage, output: saidas.shift() }) }));
  const autorizar = jest.fn(async () => ({ ok: true, contexto: { chamadaId: 'c1' } }));
  const concluir = jest.fn(async () => {}), executar = jest.fn(async () => ({ ok: true, documento: 'sintetico' }));
  const client = new SuporteOpenAIClient({ chave: 'fake', fetchImpl, autorizar, concluir, ...opcoes });
  const run = () => client.responder({ system: [{ text: 'Regras' }], messages: [{ role: 'user', content: 'Emite para Gusmed' }], ferramentas: [ferramenta], executar });
  return { client, run, fetchImpl, autorizar, concluir, executar };
}
test('consulta, preserva raciocínio, devolve resultado e contabiliza cada rodada com cache', async () => {
  const reasoning = { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque' };
  const s = setup([[reasoning, chamada()], [texto('Confira o resumo')]]);
  const r = await s.run();
  expect(r.texto).toBe('Confira o resumo'); expect(r.usage.input_tokens).toBe(120);
  expect(r.usage.cache_read_input_tokens).toBe(80); expect(s.autorizar).toHaveBeenCalledTimes(2); expect(s.concluir).toHaveBeenCalledTimes(2);
  const body = JSON.parse(s.fetchImpl.mock.calls[1][1].body);
  expect(body.store).toBe(false); expect(body.parallel_tool_calls).toBe(false);
  expect(body.input).toContainEqual(reasoning); expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'fc1' }));
  expect(s.executar).toHaveBeenCalledWith('consultar', { nome: 'Gusmed' });
});
test('orçamento recusado impede transporte', async () => {
  const s = setup([], { autorizar: async () => ({ ok: false, motivo: 'TETO_PILOTO' }) });
  await expect(s.run()).rejects.toMatchObject({ codigo: 'TETO_PILOTO' }); expect(s.fetchImpl).not.toHaveBeenCalled();
});

test.each(['CONFIRMAR <código>', 'CONFIRMAR X9Z8', 'CONFIRMAR [código]'])('não publica código ou marcador inventado: %s', async comando => {
  const s = setup([[texto(comando)]]);
  expect((await s.run()).texto).toBe('O sistema envia um resumo do pedido com o código de confirmação. Confira os dados e siga a instrução desse resumo. A preparação sozinha não executa o pedido.');
});
test('preserva código existente no contexto e linguagem comum', async () => {
  const s = setup([[texto('Não consigo confirmar se o valor mudou. CONFIRMAR A7K2')]]);
  const r = await s.client.responder({ system: 'Pedido pendente, código A7K2.', messages: [{ role: 'user', content: 'Como confirmo?' }], ferramentas: [], executar: s.executar });
  expect(r.texto).toBe('Não consigo confirmar se o valor mudou. CONFIRMAR A7K2');
});
test('falha de PDF transfere de fato, sem depender de promessa do modelo', async () => {
  const s = setup([[chamada()]]);
  s.executar.mockResolvedValueOnce({ ok: false, motivo: 'GUIA_SEM_PDF' }).mockResolvedValueOnce({ ok: true });
  const r = await s.client.responder({ messages: [{ role: 'user', content: 'Envie a guia' }], ferramentas: [ferramenta, { name: 'chamar_escritorio' }], executar: s.executar });
  expect(s.executar).toHaveBeenLastCalledWith('chamar_escritorio', expect.objectContaining({ motivo: expect.any(String) }));
  expect(r.ferramentasChamadas).toEqual(['consultar', 'chamar_escritorio']); expect(s.fetchImpl).toHaveBeenCalledTimes(1);
});
test.each(['Já encaminhei para a equipe verificar.', 'Vou encaminhar ao escritório.', 'Isso cabe ao contador.\n\nJá encaminhei para a equipe.'])('promessa do modelo exige encaminhamento concreto: %s', async resposta => {
  const s = setup([[texto(resposta)]]); s.executar.mockResolvedValue({ ok: true });
  const r = await s.client.responder({ messages: [{ role: 'user', content: 'Posso deduzir a viagem?' }], ferramentas: [{ name: 'chamar_escritorio' }], executar: s.executar });
  expect(s.executar).toHaveBeenCalledWith('chamar_escritorio', expect.any(Object));
  expect(r.ferramentasChamadas).toEqual(['chamar_escritorio']);
});
test('promessa não é enviada quando encaminhamento concreto falha', async () => {
  const s = setup([[texto('Já encaminhei para a equipe verificar.')]]); s.executar.mockResolvedValue({ ok: false });
  await expect(s.client.responder({ messages: [{ role: 'user', content: 'Posso deduzir?' }], ferramentas: [{ name: 'chamar_escritorio' }], executar: s.executar })).rejects.toThrow('IA_ENCAMINHAMENTO_FALHOU');
});
test('nova rodada precisa de saldo, mesmo após ferramenta', async () => {
  const s = setup([[chamada()]]); s.autorizar.mockResolvedValueOnce({ ok: true, contexto: {} }).mockResolvedValueOnce({ ok: false, motivo: 'TETO_PILOTO' });
  await expect(s.run()).rejects.toMatchObject({ codigo: 'TETO_PILOTO' }); expect(s.fetchImpl).toHaveBeenCalledTimes(1);
});
test.each([chamada('desconhecida'), chamada('consultar', { nome: 3 }), chamada('consultar', { nome: 'x', portalClientId: 'outra' }), { ...chamada(), arguments: '{' }])('recusa argumentos/ferramentas inválidos sem executar', async c => {
  const s = setup([[c]]); await expect(s.run()).rejects.toThrow(); expect(s.executar).not.toHaveBeenCalled();
});
test('erro de contexto da ferramenta interrompe turno', async () => {
  const s = setup([[chamada()]]); s.executar.mockRejectedValue(Object.assign(new Error('Mudou'), { codigo: 'CONTEXTO_ALTERADO' }));
  await expect(s.run()).rejects.toMatchObject({ codigo: 'CONTEXTO_ALTERADO' }); expect(s.fetchImpl).toHaveBeenCalledTimes(1);
});
test('resposta sem usage mantém reserva', async () => {
  const s = setup([]); s.fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ status: 'completed', output: [texto('oi')] }) });
  await expect(s.run()).rejects.toMatchObject({ codigo: 'OPENAI_USO_AUSENTE' });
  expect(s.concluir).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ usageCompleto: false }));
});
test('erro de rede não repete chamada nem expõe segredo', async () => {
  const s = setup([]); s.fetchImpl.mockRejectedValue(new Error('fake secret texto privado'));
  await expect(s.run()).rejects.toThrow('OPENAI_REDE'); expect(s.fetchImpl).toHaveBeenCalledTimes(1);
});
test('incompleta não executa ferramenta', async () => {
  const s = setup([]); s.fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ status: 'incomplete', usage, output: [chamada()] }) });
  expect((await s.run()).stopReason).toBe('max_tokens'); expect(s.executar).not.toHaveBeenCalled();
});
test('falha ao contabilizar impede execução da ferramenta', async () => {
  const s = setup([[chamada()]], { concluir: async () => { throw new Error('db off'); } });
  await expect(s.run()).rejects.toThrow('db off'); expect(s.executar).not.toHaveBeenCalled();
});
test('recusa sai sem texto e sem ferramentas', async () => {
  const s = setup([[{ type: 'message', content: [{ type: 'refusal' }] }]]);
  expect((await s.run()).recusou).toBe(true);
});
test('custo pequeno preserva precisão', () => {
  expect(custoEstimadoMicrousd({ input_tokens: 3000, output_tokens: 500 }, 'gpt-5.4-mini')).toBe(4500);
});
test('piloto exige telefone e canal explicitamente incluídos', () => {
  const c = { telefoneE164: '5521994400833', canalId: 'suporte' };
  expect(suporteNoPiloto(c, { enabled: true, telefones: [], canais: [] })).toBe(false);
  expect(suporteNoPiloto(c, { enabled: true, telefones: [c.telefoneE164], canais: ['suporte'] })).toBe(true);
  expect(suporteNoPiloto({ ...c, canalId: 'comercial' }, { enabled: true, telefones: [c.telefoneE164], canais: ['suporte'] })).toBe(false);
});
test('uniões nulas mantêm validação de enum e tipo', () => {
  const schema = { anyOf: [{ type: 'string', enum: ['A'] }, { type: 'null' }] };
  expect(argumentosValidos(null, schema)).toBe(true); expect(argumentosValidos('B', schema)).toBe(false);
});
test.each(['na verdade são 12 mil', 'Corrigindo, é para outra empresa', 'Troque o tomador', 'O valor correto é 12000'])('suspende confirmação anterior para %s', texto => {
  expect(correcaoExplicita(texto)).toBe(true);
});
test.each(['Posso mudar o valor?', 'Qual é o valor?', 'CONFIRMAR A7K2', 'sim'])('preserva protocolo de confirmação e dúvidas em %s', texto => {
  expect(correcaoExplicita(texto)).toBe(false);
});
