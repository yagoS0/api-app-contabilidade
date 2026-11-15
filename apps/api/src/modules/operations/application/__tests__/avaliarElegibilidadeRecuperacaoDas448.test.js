import { avaliarElegibilidadeRecuperacaoDas448 } from '../avaliarElegibilidadeRecuperacaoDas448.js';
const input = { companyId: 'empresa', competencia: '2026-10', servico: 'GERARDAS12' };
const fonte = () => ({ consulta: 'ok', items: [], truncated: false });
const contexto = () => ({ fiscal: { chamadas: fonte(), cache: fonte(), despachos: fonte() }, guias: { guias: fonte(), pagamentos: fonte() }, contabilidade: { circular: fonte(), lancamentos: fonte() }, lacunas: [] });
const ports = () => ({ autorizar: jest.fn(), consultarContexto: jest.fn(async () => contexto()), lerHistorico: jest.fn(async () => fonte()) });
test('duas observações delimitadas autorizadas; seletor não reduz universo', async () => {
  const p = ports(); const r = await avaliarElegibilidadeRecuperacaoDas448({ ...input, documentoId: 'ausente' }, p);
  expect(p.autorizar).toHaveBeenCalledTimes(2); expect(p.consultarContexto).toHaveBeenCalledTimes(2);
  expect(p.consultarContexto.mock.calls[0][0]).not.toHaveProperty('documentoId');
  expect(r.classificacao).toBe('NAO_VERIFICAVEL'); expect(r.lacunas).toContain('DOCUMENTO_NAO_LOCALIZADO_NO_ESCOPO');
});
test.each(['auth','ator','executar','forcar','provas','reservaId'])('entrada fechada recusa %s', async key => {
  const p = ports(); await expect(avaliarElegibilidadeRecuperacaoDas448({ ...input, [key]: true }, p)).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' }); expect(p.autorizar).not.toHaveBeenCalled();
});
test.each([{ servico: undefined }, { servico: 'TRANSDECLARACAO11' }, { limit: 0 }, { limit: 101 }, { limit: '10' },
  { competencia: '0000-10' }, { competencia: '2026-13' }, { documentoId: null }, { companyId: '../outra' }])('validação estrita %j', async patch => {
  const p = ports(); await expect(avaliarElegibilidadeRecuperacaoDas448({ ...input, ...patch }, p)).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
  expect(p.autorizar).not.toHaveBeenCalled();
});
test('DAS cobrança permanece serviço explícito', async () => {
  const p = ports(); await avaliarElegibilidadeRecuperacaoDas448({ ...input, servico: 'GERARDASCOBRANCA17' }, p);
  expect(p.consultarContexto.mock.calls[0][0].servico).toBe('GERARDASCOBRANCA17');
});
test('recusa de autorização é fatal antes das leituras', async () => {
  const p = ports(); p.autorizar.mockRejectedValue(new Error('negado'));
  await expect(avaliarElegibilidadeRecuperacaoDas448(input, p)).rejects.toThrow('negado'); expect(p.consultarContexto).not.toHaveBeenCalled();
});
test('bloqueio da primeira observação sobrevive mudança', async () => {
  const p = ports(); const c = contexto(); c.fiscal.chamadas.items = [{ estadoLocal: 'incerta' }]; p.consultarContexto.mockResolvedValueOnce(c);
  const r = await avaliarElegibilidadeRecuperacaoDas448(input, p); expect(r.classificacao).toBe('BLOQUEADO'); expect(r.lacunas).toContain('EVIDENCIAS_ALTERADAS_ENTRE_OBSERVACOES');
});
test('falha de fonte não vira vazio nem terceira tentativa', async () => {
  const p = ports(); p.lerHistorico.mockRejectedValue(new Error('segredo'));
  const r = await avaliarElegibilidadeRecuperacaoDas448(input, p); expect(r.classificacao).toBe('NAO_VERIFICAVEL'); expect(p.lerHistorico).toHaveBeenCalledTimes(2); expect(JSON.stringify(r)).not.toContain('segredo');
});


test('lacunas históricas controladas permanecem explícitas sem mensagens livres', async () => {
  const p = ports(); p.lerHistorico.mockResolvedValue({ ...fonte(), lacunas: ['TIPO_HISTORICO_NAO_ASSOCIAVEL_A_DAS','IDENTIDADE_HISTORICA_INCONSISTENTE','SECRET_FREE_TEXT'] });
  const r = await avaliarElegibilidadeRecuperacaoDas448(input, p);
  expect(r.lacunas).toEqual(expect.arrayContaining(['TIPO_HISTORICO_NAO_ASSOCIAVEL_A_DAS','IDENTIDADE_HISTORICA_INCONSISTENTE']));
  expect(JSON.stringify(r)).not.toContain('SECRET_FREE_TEXT');
});
