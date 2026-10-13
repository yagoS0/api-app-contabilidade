import { consultarCepComAlternativa } from '../consultarCep.js';
const municipios = [['3304557', 'Rio de Janeiro', 'RJ']];
const bruto = { cep: '22770-010', ibge: '3304557', localidade: 'Rio de Janeiro', uf: 'RJ', logradouro: 'Rua sintética', bairro: 'Centro' };
const resposta = (data = bruto, status = 200) => ({ ok: status === 200, status, json: async () => data });
it.each(['rede', 'http'])('usa OpenCEP após falha %s, mantendo a prova do município', async falha => {
  const fetchImpl = jest.fn().mockImplementationOnce(async () => {
    if (falha === 'rede') throw new Error('rede');
    return resposta({}, 503);
  }).mockResolvedValue(resposta());
  const r = await consultarCepComAlternativa('22770010', { fetchImpl, municipios });
  expect(r).toMatchObject({ ok: true, fonte: 'OPENCEP', endereco: { cMun: '3304557', nro: null, xCpl: null } });
  expect(fetchImpl.mock.calls.map(c => c[0])).toEqual(['https://viacep.com.br/ws/22770010/json/', 'https://opencep.com/v1/22770010']);
});
it.each([resposta(), resposta({}, 404), resposta({ ...bruto, cep: '20040-002' })])('não troca de fonte após resposta conclusiva ou incoerente', async retorno => {
  const fetchImpl = jest.fn().mockResolvedValue(retorno);
  await consultarCepComAlternativa('22770010', { fetchImpl, municipios });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('alternativa não aceita endereço de outro CEP', async () => {
  const fetchImpl = jest.fn().mockRejectedValueOnce(new Error()).mockResolvedValue(resposta({ ...bruto, cep: '20040-002' }));
  expect(await consultarCepComAlternativa('22770010', { fetchImpl, municipios })).toMatchObject({ ok: false, motivo: 'resposta_invalida' });
});
it('timeout da primeira fonte deixa prazo para a segunda', async () => {
  const fetchImpl = jest.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(resposta());
  const r = await consultarCepComAlternativa('22770010', { fetchImpl, municipios, timeoutMs: 100 });
  expect(r).toMatchObject({ ok: true, fonte: 'OPENCEP' });
});
it('não consulta CPF, entrada inválida ou URL fornecida pelo usuário', async () => {
  const fetchImpl = jest.fn();
  for (const valor of ['12345678901', 'https://example.com', '']) {
    expect(await consultarCepComAlternativa(valor, { fetchImpl })).toMatchObject({ ok: false, motivo: 'cep_invalido' });
  }
  expect(fetchImpl).not.toHaveBeenCalled();
});
