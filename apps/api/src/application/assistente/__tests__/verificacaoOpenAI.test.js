import { diagnosticarConfiguracaoOpenAI, verificarConexaoOpenAI } from '../VerificacaoOpenAI.js';
const env = { OPENAI_API_KEY: 'chave-que-nao-pode-aparecer', IA_LEADS_OPENAI: '0', WHATSAPP_COLETA_COMERCIAL: '0', IA_LEADS_CANAIS_PILOTO: 'comercial', IA_LEADS_TETO_TOTAL_CENTAVOS: '300', IA_LEADS_TELEFONES_PILOTO: '5511999990000' };
test('diagnóstico offline não chama modelo nem expõe chave/telefones', async () => {
  const cliente = { interpretar: jest.fn() }; const r = await verificarConexaoOpenAI({ env, cliente });
  expect(r).toMatchObject({ chaveConfigurada: true, conexaoVerificada: false, chamadasExternas: 0, configuracaoPilotoPronta: false });
  expect(cliente.interpretar).not.toHaveBeenCalled(); expect(JSON.stringify(r)).not.toContain(env.OPENAI_API_KEY); expect(JSON.stringify(r)).not.toContain(env.IA_LEADS_TELEFONES_PILOTO);
});
test.each([undefined, '', ' ', '\n'])('chave ausente não faz teste real: %p', chave => {
  expect(diagnosticarConfiguracaoOpenAI({ OPENAI_API_KEY: chave }).chaveConfigurada).toBe(false);
});
test('números inválidos ou piloto vazio não liberam automação', () => {
  for (const piloto of ['', 'abc', '123', '5511999990000,abc']) expect(diagnosticarConfiguracaoOpenAI({ ...env, IA_LEADS_OPENAI: '1', WHATSAPP_COLETA_COMERCIAL: '1', IA_LEADS_TELEFONES_PILOTO: piloto }).configuracaoPilotoPronta).toBe(false);
  expect(diagnosticarConfiguracaoOpenAI({ ...env, IA_LEADS_OPENAI: '1', WHATSAPP_COLETA_COMERCIAL: '1' }).configuracaoPilotoPronta).toBe(true);
});

test.each([{ IA_LEADS_CANAIS_PILOTO: '' }, { IA_LEADS_TETO_TOTAL_CENTAVOS: '0' }, { IA_LEADS_TETO_TOTAL_CENTAVOS: 'abc' }, { IA_LEADS_TETO_TOTAL_CENTAVOS: '1.5' }, { IA_LEADS_TELEFONES_PILOTO: '', IA_COMERCIAL_TELEFONES_PILOTO: '5511999990000' }])('configuração incompleta não libera piloto: %p', override => {
  expect(diagnosticarConfiguracaoOpenAI({ ...env, IA_LEADS_OPENAI: '1', WHATSAPP_COLETA_COMERCIAL: '1', ...override }).configuracaoPilotoPronta).toBe(false);
});
test.each([undefined, 0, -1, 0.001, 2, 'texto', Infinity])('teste real exige teto válido: %p', async maxUsd => {
  const cliente = { interpretar: jest.fn() }; const r = await verificarConexaoOpenAI({ env, live: true, maxUsd, cliente });
  expect(r.codigo).toBe('TETO_DO_TESTE_INVALIDO'); expect(cliente.interpretar).not.toHaveBeenCalled();
});
test('sem chave não consome a chamada autorizada', async () => {
  const cliente = { interpretar: jest.fn() }; const r = await verificarConexaoOpenAI({ env: {}, live: true, maxUsd: 0.03, cliente });
  expect(r).toMatchObject({ codigo: 'OPENAI_SEM_CHAVE', chamadasExternas: 0 }); expect(cliente.interpretar).not.toHaveBeenCalled();
});
test('uma chamada fictícia verifica contrato sem ativar piloto', async () => {
  const cliente = { interpretar: jest.fn(async () => ({ usage: { input_tokens: 10, output_tokens: 10 } })) };
  const r = await verificarConexaoOpenAI({ env, live: true, maxUsd: 0.03, cliente });
  expect(r).toMatchObject({ ok: true, conexaoVerificada: true, chamadasExternas: 1, iaLigada: false });
  expect(cliente.interpretar).toHaveBeenCalledTimes(1); expect(cliente.interpretar.mock.calls[0][0].texto).toBe('Quero abrir uma empresa.');
  expect(env.IA_LEADS_OPENAI).toBe('0');
});
test.each(['OPENAI_AUTENTICACAO', 'OPENAI_PERMISSAO', 'OPENAI_TIMEOUT', 'OPENAI_SALDO_INSUFICIENTE', 'CODIGO_COM_SEGREDO'])('erro %s é sanitizado e não tenta novamente', async codigo => {
  const cliente = { interpretar: jest.fn(async () => { throw Object.assign(Error('segredo'), { codigo }); }) };
  const r = await verificarConexaoOpenAI({ env, live: true, maxUsd: 0.03, cliente });
  expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toMatch(/chave-que|CODIGO_COM_SEGREDO|"segredo"/); expect(cliente.interpretar).toHaveBeenCalledTimes(1);
});
