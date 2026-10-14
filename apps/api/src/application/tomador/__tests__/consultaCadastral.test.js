import { criarConsultaCadastral } from '../consultaCadastral.js';
import { consultarCnpjGratuito } from '../consultaCnpj.js';

const CNPJ = '11222333000181';
const contexto = { escritorioId: 'escritorio-1', requestKey: 'cadastro-1' };
const bruto = { cnpj: CNPJ, razao_social: 'EMPRESA TESTE', logradouro: 'RUA TESTE', bairro: 'CENTRO',
  municipio: 'RIO DE JANEIRO', uf: 'RJ', cep: '20040020' };
const sucesso = { ok: true, cnpj: CNPJ, bruto, tomador: { nome: 'EMPRESA TESTE' } };
const falha = { ok: false, motivo: 'indisponivel', fontesTentadas: ['BRASILAPI', 'MINHA_RECEITA'] };
function preparar(overrides = {}) {
  const deps = { consultarGratuito: jest.fn().mockResolvedValue(falha), habilitarPago: true,
    serpro: { consultar: jest.fn().mockResolvedValue(sucesso) }, precoUnitarioMicros: 100000,
    reservas: { reservar: jest.fn().mockResolvedValue({ id: 'reserva-1', autorizada: true }), concluir: jest.fn() }, ...overrides };
  return { deps, consultar: criarConsultaCadastral(deps) };
}

test('gratuito suficiente nunca reserva orçamento nem chama SERPRO, mesmo sem número/email', async () => {
  const { deps, consultar } = preparar({ consultarGratuito: jest.fn().mockResolvedValue(sucesso) });
  expect(await consultar(CNPJ, contexto)).toEqual(sucesso);
  expect(deps.reservas.reservar).not.toHaveBeenCalled();
  expect(deps.serpro.consultar).not.toHaveBeenCalled();
});

test.each([
  { habilitarPago: false }, { habilitarPago: 'true' }, { reservas: null },
  { precoUnitarioMicros: null }, { precoUnitarioMicros: -1 }, { precoUnitarioMicros: NaN },
])('configuração insuficiente mantém só gratuito: %j', async override => {
  const { deps, consultar } = preparar(override);
  expect(await consultar(CNPJ, contexto)).toEqual(falha);
  expect(deps.serpro.consultar).not.toHaveBeenCalled();
});

test.each(['12345678000190', '12345678909', '12ABC345000190', '123'])('não gasta com documento inelegível %s', async doc => {
  const { deps, consultar } = preparar();
  await consultar(doc, contexto);
  expect(deps.reservas.reservar).not.toHaveBeenCalled();
});

test.each([{}, { escritorioId: 'a' }, { ...contexto, escritorioId: ' ' }])('não paga sem contexto %j', async ctx => {
  const { deps, consultar } = preparar();
  await consultar(CNPJ, ctx);
  expect(deps.reservas.reservar).not.toHaveBeenCalled();
});

test('orçamento negado ou erro na reserva não chama pago', async () => {
  const { deps, consultar } = preparar();
  deps.reservas.reservar.mockResolvedValueOnce({ autorizada: false }).mockRejectedValueOnce(new Error('db'));
  await consultar(CNPJ, contexto); await consultar(CNPJ, contexto);
  expect(deps.serpro.consultar).not.toHaveBeenCalled();
});

test('integração respeita ordem das duas gratuitas, reserva e única chamada básica', async () => {
  const ordem = [];
  const { deps, consultar } = preparar({ consultarGratuito: consultarCnpjGratuito });
  deps.reservas.reservar.mockImplementation(async () => { ordem.push('reserva'); return { id: 'r', autorizada: true }; });
  deps.serpro.consultar.mockImplementation(async () => { ordem.push('SERPRO'); return sucesso; });
  const fetchImpl = jest.fn(async url => { ordem.push(url.includes('brasilapi') ? 'BrasilAPI' : 'Minha Receita');
    return { status: 404, ok: false }; });
  const r = await consultar(CNPJ, { ...contexto, fetchImpl, log: {} });
  expect(ordem).toEqual(['BrasilAPI', 'Minha Receita', 'reserva', 'SERPRO']);
  expect(r).toMatchObject({ ok: true, fonte: 'SERPRO_BASICA', modalidade: 'BASICA' });
  expect(deps.reservas.reservar).toHaveBeenCalledWith(expect.objectContaining({ finalidade: 'EMISSOR', modalidade: 'BASICA' }));
  expect(deps.serpro.consultar).toHaveBeenCalledTimes(1);
});

test('exceção paga preserva cadastro parcial, registra incerteza e nunca repete', async () => {
  const parcial = { ...sucesso, bruto: { cnpj: CNPJ, razao_social: 'EMPRESA TESTE' } };
  const { deps, consultar } = preparar({ consultarGratuito: jest.fn().mockResolvedValue(parcial) });
  deps.serpro.consultar.mockRejectedValue(new Error('segredo não pode sair'));
  expect(await consultar(CNPJ, contexto)).toEqual({ ...parcial, consultaPaga: { status: 'INCERTA' } });
  expect(deps.serpro.consultar).toHaveBeenCalledTimes(1);
  expect(deps.reservas.concluir).toHaveBeenCalledWith({ id: 'reserva-1', status: 'INCERTA', motivo: 'consulta_sem_resultado_util' });
});

test('falha ao persistir resultado não libera reserva nem repete consulta', async () => {
  const { deps, consultar } = preparar();
  deps.reservas.concluir.mockRejectedValue(new Error('db'));
  expect(await consultar(CNPJ, contexto)).toEqual({ ...falha, consultaPaga: { status: 'INCERTA' } });
  expect(deps.serpro.consultar).toHaveBeenCalledTimes(1);
});

test('resultado pago de outro documento é recusado', async () => {
  const { deps, consultar } = preparar();
  deps.serpro.consultar.mockResolvedValue({ ...sucesso, cnpj: 'outro' });
  expect((await consultar(CNPJ, contexto)).ok).toBe(false);
  expect(deps.reservas.concluir).toHaveBeenCalledWith(expect.objectContaining({ status: 'INCERTA' }));
});

test('retorno pago mais pobre não descarta os dados gratuitos já obtidos', async () => {
  const parcial = { ...sucesso, bruto: { ...bruto, cep: '' } };
  const { deps, consultar } = preparar({ consultarGratuito: jest.fn().mockResolvedValue(parcial) });
  deps.serpro.consultar.mockResolvedValue({ ...sucesso, bruto: { cnpj: CNPJ, razao_social: 'EMPRESA TESTE' } });
  expect(await consultar(CNPJ, contexto)).toMatchObject({ bruto: parcial.bruto, consultaPaga: { status: 'CONCLUIDA' } });
});
