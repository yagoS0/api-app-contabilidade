import { LeadsOpenAIClient, normalizarUsageOpenAI, prepararPedidoLead, RESERVA_LEADS_CENTAVOS, MAX_BYTES_PEDIDO_LEADS, MAX_TOKENS_SAIDA_LEADS } from '../LeadsOpenAIClient.js';
import { validarInterpretacaoLead, MODELO_LEADS } from '../interpretacaoLeadIa.js';
import { custoEstimadoCentavos } from '../precosIa.js';
import { prepararPreatendimento } from '../../onboarding/preatendimentoComercial.js';

const texto = 'Me chamo Ana, produzo cerâmica artesanal e atendo em Recife';
const dado = (campo, valor, evidencia = valor) => ({ campo, valor, evidencia });
const resultado = (dados = [], comportamento = 'DADOS') => ({ intencao: null, evidenciaIntencao: null, comportamento, dados });
const uso = { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 20 } };
const resposta = (value = resultado(), overrides = {}) => ({ status: 'completed', usage: uso, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], ...overrides });
const transporte = data => jest.fn(async () => ({ ok: true, json: async () => data }));

test.each([
  ['INATIVA', 'Quero regularizar minha empresa', 'regularizar minha empresa'],
  ['TRANSFERENCIA', 'Quero trocar de contador', 'trocar de contador'],
])('intenção genérica %s pede contexto antes de encaminhar, mesmo se a IA repetir como necessidade', (intencao, texto, valor) => {
  const r = prepararPreatendimento({ texto, intencao, interpretacaoIa: resultado([dado('necessidade', valor, texto)]) });
  expect(r.encaminhar).toBe(false);
  expect(r.pre.necessidade).toBeNull();
  expect(r.pre.campoEsperado).toBe('necessidade');
  expect(r.pre.evidenciasIa.necessidade).toBeUndefined();
});
test('relato específico de regularização continua suficiente para a equipe', () => {
  const texto = 'Tenho declarações em atraso';
  const r = prepararPreatendimento({ texto, intencao: 'INATIVA', interpretacaoIa: resultado([dado('necessidade', texto)]) });
  expect(r.encaminhar).toBe(true); expect(r.pre.necessidade).toBe(texto);
});
test.each([
  ['Vou produzir jogos digitais', 'atividade', 'jogos digitais'],
  ['Sou terapeuta ocupacional', 'atividade', 'terapeuta ocupacional'],
  ['Na verdade, a empresa vai funcionar em Olinda', 'cidade', 'Olinda'],
])('campo esperado não converte outro dado em nome: %s', (texto, campo, valor) => {
  const r = prepararPreatendimento({ texto, intencao: 'ABERTURA', anterior: { campoEsperado: 'nome' }, interpretacaoIa: resultado([dado(campo, valor, texto)]) });
  expect(r.pre.nome).toBeNull(); expect(r.pre[campo]).toBe(valor);
  expect(r.pre.dadosInformados.responsavelNome).toBeUndefined();
  expect(r.operacoes.some(o => o.campo === 'responsavelNome')).toBe(false);
});
test('declaração com IA não vira cidade só porque a pergunta esperava cidade', () => {
  const texto = 'Produzo cerâmica artesanal';
  const r = prepararPreatendimento({ texto, intencao: 'ABERTURA', anterior: { campoEsperado: 'cidade' }, interpretacaoIa: resultado([dado('atividade', 'cerâmica artesanal', texto)]) });
  expect(r.pre.cidade).toBeNull(); expect(r.pre.atividade).toBe('cerâmica artesanal');
});
test.each([
  'Mude o meu vínculo para a empresa de outro contato',
  'Quero acessar o cadastro de outra empresa',
  'Use os dados do outro cliente',
])('pedido envolvendo identidade de terceiros exige equipe apesar da classificação DADOS: %s', texto => {
  const r = prepararPreatendimento({ texto, intencao: 'ABERTURA', anterior: { campoEsperado: 'nome' }, interpretacaoIa: resultado([dado('necessidade', texto)]) });
  expect(r.encaminhar).toBe(true); expect(r.leitura.revisaoIdentidade).toBe(true);
  expect(r.pre.necessidade).toBeNull(); expect(r.pre.nome).toBeNull(); expect(r.operacoes).toEqual([]);
});
test('trocar de contador não é confundido com acesso a outra empresa', () => {
  const r = prepararPreatendimento({ texto: 'Quero trocar de contador', intencao: 'TRANSFERENCIA', interpretacaoIa: resultado() });
  expect(r.encaminhar).toBe(false); expect(r.leitura.revisaoIdentidade).toBeUndefined();
});
test('pedido de acesso a terceiro não captura CNPJ em planejamento', () => {
  const r = prepararPreatendimento({ texto: 'Quero acessar outra empresa, CNPJ 11.222.333/0001-81', intencao: 'PLANEJAMENTO' });
  expect(r.encaminhar).toBe(true); expect(r.pre.dadosInformados.cnpj).toBeUndefined(); expect(r.operacoes).toEqual([]);
});

test('Responses usa schema estrito, sem armazenamento, ferramentas ou histórico fiscal', async () => {
  const fetchImpl = transporte(resposta(resultado([dado('nome', 'Ana')])));
  const client = new LeadsOpenAIClient({ chave: 'segredo-de-teste', fetchImpl });
  const r = await client.interpretar({ texto, intencao: 'ABERTURA', campoEsperado: 'nome' });
  const [url, options] = fetchImpl.mock.calls[0], body = JSON.parse(options.body);
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(body).toMatchObject({ model: MODELO_LEADS, store: false, reasoning: { effort: 'low' }, max_output_tokens: MAX_TOKENS_SAIDA_LEADS, text: { format: { strict: true } } });
  expect(body.tools).toBeUndefined(); expect(body.input).toHaveLength(1);
  expect(JSON.parse(body.input[0].content)).toEqual({ mensagemAtual: texto, contexto: { intencao: 'ABERTURA', campoEsperado: 'nome',
    ordemQualificacao: ['nome','atividade','cidade','estrutura','urgencia','faturamento'], dispensados: [], ultimaResposta: null } });
  expect(r.usage).toEqual({ input_tokens: 80, output_tokens: 40, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 });
});

test.each([
  ['recusa', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'não' }] }] }, 'OPENAI_RECUSA'],
  ['incompleta', { status: 'incomplete' }, 'OPENAI_INCOMPLETA'],
  ['falha', { status: 'failed' }, 'OPENAI_INCOMPLETA'],
  ['sem uso', { usage: null }, 'OPENAI_USO_AUSENTE'],
  ['sem saída', { output: [] }, 'OPENAI_SAIDA_INVALIDA'],
  ['JSON quebrado', { output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] }, 'OPENAI_JSON_INVALIDO'],
  ['alucinação', { output: resposta(resultado([dado('cidade', 'Londres')])).output }, 'OPENAI_EVIDENCIA_INVALIDA'],
])('%s não produz interpretação utilizável', async (_, overrides, codigo) => {
  const fetchImpl = transporte(resposta(resultado(), overrides));
  await expect(new LeadsOpenAIClient({ chave: 'x', fetchImpl }).interpretar({ texto })).rejects.toMatchObject({ codigo });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each([[400, 'OPENAI_PEDIDO_INVALIDO'], [401, 'OPENAI_AUTENTICACAO'], [403, 'OPENAI_PERMISSAO'], [404, 'OPENAI_MODELO_INDISPONIVEL'], [429, 'OPENAI_LIMITE'], [500, 'OPENAI_SERVIDOR'], [503, 'OPENAI_SERVIDOR']])('HTTP %s não repete nem vaza conteúdo', async (status, codigo) => {
  const fetchImpl = jest.fn(async () => ({ ok: false, status, json: jest.fn(() => { throw Error('segredo'); }) }));
  await expect(new LeadsOpenAIClient({ chave: 'x', fetchImpl }).interpretar({ texto })).rejects.toMatchObject({ message: codigo });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('saldo insuficiente informa somente código conhecido, nunca corpo do provedor', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 'insufficient_quota', message: 'segredo-injetado' } }) }));
  await expect(new LeadsOpenAIClient({ chave: 'x', fetchImpl }).interpretar({ texto })).rejects.toMatchObject({ message: 'OPENAI_SALDO_INSUFICIENTE' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('timeout aborta e mantém consumo desconhecido', async () => {
  const fetchImpl = jest.fn((_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('chave secreta')))));
  await expect(new LeadsOpenAIClient({ chave: 'x', fetchImpl, timeoutMs: 5 }).interpretar({ texto })).rejects.toMatchObject({ codigo: 'OPENAI_TIMEOUT', usage: undefined });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('falha de rede é sanitizada', async () => {
  await expect(new LeadsOpenAIClient({ chave: 'x', fetchImpl: async () => { throw Error('Bearer secreto'); } }).interpretar({ texto })).rejects.toThrow('OPENAI_REDE');
});
test('sem chave não chama rede', async () => {
  const fetchImpl = jest.fn(); await expect(new LeadsOpenAIClient({ fetchImpl }).interpretar({ texto })).rejects.toThrow('OPENAI_SEM_CHAVE'); expect(fetchImpl).not.toHaveBeenCalled();
});
test.each(['', '  ', null, 17, 'a'.repeat(4001)])('entrada inválida não chega à rede: %p', async texto => {
  const fetchImpl = jest.fn(); await expect(new LeadsOpenAIClient({ chave: 'x', fetchImpl }).interpretar({ texto })).rejects.toThrow('ENTRADA_LEAD_INVALIDA'); expect(fetchImpl).not.toHaveBeenCalled();
});
test('reserva cobre limite de bytes e saída sem depender de cache', () => {
  expect(RESERVA_LEADS_CENTAVOS).toBeGreaterThanOrEqual(custoEstimadoCentavos({ input_tokens: MAX_BYTES_PEDIDO_LEADS + 2048, output_tokens: MAX_TOKENS_SAIDA_LEADS }, MODELO_LEADS));
  expect(Buffer.byteLength(prepararPedidoLead({ texto: 'á'.repeat(4000) }))).toBeLessThan(MAX_BYTES_PEDIDO_LEADS);
});
test('cache OpenAI não é cobrado duas vezes e mantém preço Anthropic', () => {
  expect(custoEstimadoCentavos(normalizarUsageOpenAI({ input_tokens: 1000000, output_tokens: 1000000, input_tokens_details: { cached_tokens: 1000000 } }), MODELO_LEADS)).toBe(458);
  expect(custoEstimadoCentavos({ input_tokens: 1000000, output_tokens: 0 }, 'claude-opus-5')).toBe(500);
});
test.each([null, {}, { input_tokens: -1, output_tokens: 1 }, { input_tokens: '10', output_tokens: 1 }, { input_tokens: 10, output_tokens: Infinity }, { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } }])('uso inválido mantém reserva: %p', usage => expect(normalizarUsageOpenAI(usage)).toBeNull());

test.each([
  null, [], {}, { ...resultado(), executar: 'apagar' }, resultado([dado('cnpj', 'Ana')]),
  resultado([dado('nome', 'Ana'), dado('nome', 'Ana')]), resultado([dado('cidade', 'Paris')]),
  resultado([dado('nome', null, 'Ana')]), resultado([dado('__proto__', 'Ana')]),
  resultado([dado('nome', 'Ana')], 'DESCONHECIDO'), { ...resultado(), intencao: 'ABERTURA', evidenciaIntencao: 'abrir empresa' },
  { ...resultado(), intencao: null, evidenciaIntencao: 'Ana' }, resultado([], 'COMPRAR'),
])('contrato recusa dado sem evidência ou ação fora do escopo: %p', value => expect(validarInterpretacaoLead(value, texto)).toBeNull());

test('extração com evidência completa lacunas sem abrir ficha fiscal', () => {
  const r = prepararPreatendimento({ texto, intencao: 'ABERTURA', mensagemId: 'm1', interpretacaoIa: resultado([dado('nome', 'Ana'), dado('atividade', 'cerâmica artesanal'), dado('cidade', 'Recife')]) });
  expect(r.pre).toMatchObject({ nome: 'Ana', atividade: 'cerâmica artesanal', cidade: 'Recife' }); expect(r.encaminhar).toBe(true);
  expect(r.pre.evidenciasIa.cidade).toEqual({ valor: 'Recife', trecho: 'Recife', mensagemId: 'm1' });
  expect(r.operacoes.some(o => o.valor === 'cerâmica artesanal')).toBe(false);
});
test.each(['HUMANO', 'DESCONHECIDO'])('%s encaminha mesmo sem nome/atividade/cidade', comportamento => {
  expect(prepararPreatendimento({ texto: 'é complicado explicar isso', intencao: 'ABERTURA', interpretacaoIa: resultado([], comportamento) }).encaminhar).toBe(true);
});
test.each(['PAUSAR', 'RETOMAR'])('%s não consome pergunta nem grava texto como nome', comportamento => {
  const r = prepararPreatendimento({ texto: 'estou chegando ao trabalho', intencao: 'ABERTURA', anterior: { campoEsperado: 'nome', perguntasFeitas: 2 }, interpretacaoIa: resultado([], comportamento) });
  expect(r.pre.perguntasFeitas).toBe(2); expect(r.pre.nome).toBeFalsy(); expect(r.operacoes).toEqual([]);
});
test('correção preserva evidência e não ressuscita valor da ficha', () => {
  const r = prepararPreatendimento({ texto: 'Corrigindo: Recife', intencao: 'ABERTURA', mensagemId: 'm2', anterior: { cidade: 'Olinda' }, interpretacaoIa: resultado([dado('cidade', 'Recife')]) });
  const anterior = structuredClone(r.pre);
  const next = prepararPreatendimento({ texto: 'ok', intencao: 'ABERTURA', anterior: r.pre, dadosFicha: { municipioAtendimento: 'Olinda' }, mensagemId: 'm3' });
  expect(next.pre.cidade).toBe('Recife'); expect(r.pre).toEqual(anterior);
});
test('remoção explícita mantém desconhecido sem reaproveitar cadastro', () => {
  const r = prepararPreatendimento({ texto: 'Não será mais em Recife', intencao: 'ABERTURA', mensagemId: 'm2', anterior: { cidade: 'Recife' }, interpretacaoIa: resultado([dado('cidade', null, 'Não será mais em Recife')]) });
  const next = prepararPreatendimento({ texto: 'ok', intencao: 'ABERTURA', anterior: r.pre, dadosFicha: { municipioAtendimento: 'Recife' }, mensagemId: 'm3' });
  expect(next.pre.cidade).toBeNull();
});
test('IA não ultrapassa três perguntas e não responde dúvida tributária desconhecida', () => {
  expect(prepararPreatendimento({ texto: 'preciso entender melhor', intencao: 'ABERTURA', anterior: { perguntasFeitas: 3 }, interpretacaoIa: resultado() }).encaminhar).toBe(true);
  expect(prepararPreatendimento({ texto: 'essa operação dá direito ao crédito?', intencao: 'PLANEJAMENTO', interpretacaoIa: resultado([], 'DUVIDA') }).encaminhar).toBe(true);
});
test('declaração nova substitui evidência antiga mesmo com IA desativada', () => {
  const anterior = { atividade: 'cerâmica', evidenciasIa: { atividade: { valor: 'cerâmica', trecho: 'cerâmica', mensagemId: 'antiga' } } };
  const r = prepararPreatendimento({ texto: 'Tenho uma loja de roupas', intencao: 'TRANSFERENCIA', anterior, mensagemId: 'nova' });
  expect(r.pre.atividade).toBe('loja de roupas'); expect(r.pre.evidenciasIa.atividade).toBeUndefined(); expect(anterior.atividade).toBe('cerâmica');
});
test.each(['cidade', 'atividade', 'necessidade'])('dúvida sem interrogação não vira %s', campoEsperado => {
  const r = prepararPreatendimento({ texto: 'Gostaria de saber se esse caminho serve', intencao: 'ABERTURA', anterior: { campoEsperado }, mensagemId: 'duvida', interpretacaoIa: resultado([], 'DUVIDA') });
  expect(r.pre[campoEsperado]).toBeFalsy(); expect(r.operacoes).toEqual([]); expect(r.encaminhar).toBe(true);
});
test('CNPJ citado numa dúvida de planejamento não vira dado confirmado', () => {
  const r = prepararPreatendimento({ texto: 'O que significa o CNPJ 11.222.333/0001-81?', intencao: 'PLANEJAMENTO', interpretacaoIa: resultado([], 'DUVIDA') });
  expect(r.pre.dadosInformados.cnpj).toBeUndefined(); expect(r.operacoes).toEqual([]);
});
test('declaração explícita junto da dúvida mantém somente a extração com evidência', () => {
  const r = prepararPreatendimento({ texto: 'Sou Ana e queria saber se Recife serve', intencao: 'ABERTURA', anterior: { campoEsperado: 'cidade' }, interpretacaoIa: resultado([dado('nome', 'Ana')], 'DUVIDA') });
  expect(r.pre.nome).toBe('Ana'); expect(r.pre.cidade).toBeFalsy(); expect(r.operacoes).toEqual([]);
});

test.each([['Sou o Caetano', 'nome', 'Caetano'], ['Eu me chamo Iara', 'nome', 'Iara'], ['em Recife', 'cidade', 'Recife']])('retira introdução sem inventar texto: %s', (texto, campo, valor) => {
  const r = validarInterpretacaoLead(resultado([dado(campo, texto)]), texto);
  expect(r.dados[0]).toEqual(dado(campo, valor, texto));
});
test.each(['RETOMAR', 'PAUSAR'])('%s pode carregar dado explicitamente informado', comportamento => {
  const texto = comportamento === 'RETOMAR' ? 'voltei, sou a Joana' : 'sou a Joana, vou responder depois';
  const r = prepararPreatendimento({ texto, intencao: 'ABERTURA', interpretacaoIa: resultado([dado('nome', 'Joana', texto)], comportamento) });
  expect(r.pre.nome).toBe('Joana'); expect(r.pre.perguntasFeitas).toBe(0); expect(r.operacoes).toEqual([]);
});
test('desconhecimento não é cadastrado como cidade mesmo se a IA classificar errado', () => {
  const texto = 'ainda não sei a cidade';
  const r = prepararPreatendimento({ texto, intencao: 'ABERTURA', anterior: { campoEsperado: 'cidade' }, interpretacaoIa: resultado([dado('cidade', texto)]) });
  expect(r.pre.cidade).toBeNull(); expect(r.encaminhar).toBe(true);
});
test('falha da IA encaminha sem voltar a inferir profissão como nome', () => {
  const r = prepararPreatendimento({ texto: 'Vou produzir jogos digitais', intencao: 'ABERTURA', anterior: { campoEsperado: 'nome' }, falhaIa: true });
  expect(r.pre.nome).toBeNull(); expect(r.pre.atividade).toBeNull(); expect(r.operacoes).toEqual([]); expect(r.encaminhar).toBe(true);
});
test('contexto de correção usa apenas dados curtos da própria triagem', () => {
  const r = JSON.parse(prepararPedidoLead({ texto: 'ops, é Liana', resumo: { nome: 'Luana', cidade: 'Recife', cnpj: 'segredo', telefone: 'segredo', necessidade: 'x'.repeat(900) } }));
  const dados = JSON.parse(r.input[0].content).contexto.dadosColetados;
  expect(dados.nome).toBe('Luana'); expect(dados.cidade).toBe('Recife'); expect(dados.necessidade).toHaveLength(700);
  expect(dados.cnpj).toBeUndefined(); expect(dados.telefone).toBeUndefined();
});
test('retomada não muda intenção por uma evidência semanticamente irrelevante', () => {
  const r = validarInterpretacaoLead({ ...resultado([dado('nome', 'Joana', 'sou a Joana')], 'RETOMAR'), intencao: 'PLANEJAMENTO', evidenciaIntencao: 'voltei' }, 'voltei, sou a Joana');
  expect(r.intencao).toBeNull(); expect(r.evidenciaIntencao).toBeNull(); expect(r.dados[0].valor).toBe('Joana');
});
test.each(['PAUSAR', 'RETOMAR'])('intenção espúria em %s é descartada, preservando apenas dados literais', comportamento => {
  const texto = 'voltei, sou a Marina, faço fotografia em Recife';
  const entrada = { ...resultado([dado('nome', 'Marina', 'sou a Marina')], comportamento), intencao: 'ABERTURA', evidenciaIntencao: 'faz fotografia em Recife' };
  expect(validarInterpretacaoLead(entrada, texto)).toMatchObject({ intencao: null, evidenciaIntencao: null, dados: [dado('nome', 'Marina', 'sou a Marina')] });
  expect(entrada.intencao).toBe('ABERTURA');
  expect(validarInterpretacaoLead({ ...entrada, dados: [dado('nome', 'Bruna', 'sou a Marina')] }, texto)).toBeNull();
});
test('novo pedido explícito na retomada continua exigindo evidência literal', () => {
  expect(validarInterpretacaoLead({ ...resultado([], 'RETOMAR'), intencao: 'ABERTURA', evidenciaIntencao: 'texto inventado' }, 'voltei, quero abrir uma empresa')).toBeNull();
});
test('queixa preserva relato literal com fonte própria mesmo se IA só encaminhar', () => {
  const texto = 'O atendimento demora demais';
  const r = prepararPreatendimento({ texto, intencao: 'TRANSFERENCIA', anterior: { campoEsperado: 'necessidade' }, mensagemId: 'nova', interpretacaoIa: resultado([], 'HUMANO') });
  expect(r.pre.necessidade).toBe(texto); expect(r.pre.evidenciasIa.necessidade).toBeUndefined();
  expect(r.pre.evidenciasDeclaradas.necessidade).toEqual({ valor: texto, trecho: texto, mensagemId: 'nova' });
  expect(r.operacoes).toEqual([]); expect(r.encaminhar).toBe(true);
});
test('relato de regularização conserva situação e dúvida na mensagem completa', () => {
  const texto = 'ficou parada uns anos. nem sei o que tá atrasado';
  const r = prepararPreatendimento({ texto, intencao: 'INATIVA', anterior: { campoEsperado: 'necessidade' }, interpretacaoIa: resultado([dado('necessidade', 'nem sei o que tá atrasado')]) });
  expect(r.pre.necessidade).toBe(texto); expect(r.pre.evidenciasDeclaradas.necessidade.trecho).toBe(texto);
});
test('pergunta de preço não vira necessidade ao preservar relato', () => {
  const r = prepararPreatendimento({ texto: 'Quanto custa?', intencao: 'TRANSFERENCIA', anterior: { campoEsperado: 'necessidade' }, interpretacaoIa: resultado([], 'DUVIDA') });
  expect(r.pre.necessidade).toBeNull(); expect(r.pre.evidenciasDeclaradas).toBeUndefined();
});
test('dúvida entre fechar e retomar preserva incerteza e segue à equipe sem confirmar objetivo fiscal', () => {
  const texto = 'não sei se é melhor fechar ou voltar a vender';
  const r = prepararPreatendimento({ texto, intencao: 'INATIVA', anterior: { campoEsperado: 'necessidade' }, interpretacaoIa: resultado([], 'DUVIDA') });
  expect(r.pre.necessidade).toBe(texto); expect(r.encaminhar).toBe(true);
  expect(r.operacoes).toEqual([]); expect(r.pre.dadosInformados.objetivoEmpresa).toBeUndefined();
});
test('retomar vendas fica no relato mesmo se a IA classificar DADOS sem extrair necessidade', () => {
  const texto = 'Vou retomar as vendas no próximo mês';
  const r = prepararPreatendimento({ texto, intencao: 'INATIVA', anterior: { campoEsperado: 'necessidade' }, interpretacaoIa: resultado([]) });
  expect(r.pre.necessidade).toBe(texto); expect(r.pre.evidenciasDeclaradas.necessidade.trecho).toBe(texto);
  expect(r.encaminhar).toBe(true); expect(r.operacoes).toEqual([]);
});
test('retomar a conversa sem falar das atividades não preenche necessidade', () => {
  const r = prepararPreatendimento({ texto: 'Vou retomar nossa conversa', intencao: 'INATIVA', anterior: { campoEsperado: 'necessidade' }, interpretacaoIa: resultado([], 'RETOMAR') });
  expect(r.pre.necessidade).toBeNull(); expect(r.encaminhar).toBe(false);
});
