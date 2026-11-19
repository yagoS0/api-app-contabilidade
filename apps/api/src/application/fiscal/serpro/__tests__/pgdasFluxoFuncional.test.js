import { PgdasSimulacaoService, buildDeclaracaoPayload } from '../PgdasSimulacaoService.js';
import { classificarResultadoPgdas } from '../../../../modules/fiscal/publicPgdas.js';
import { parametros, retornoFiscal, retornoTransmitido } from './fixtures/pgdasFluxoFuncional.js';
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));

const service = retorno => new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao: jest.fn(async () => retorno) } });

test('transmissão identificada independe da disponibilidade de DAS/extrato', async () => {
  const result = await service(retornoTransmitido).transmitir(parametros);
  expect(result).toMatchObject({ numeroDeclaracao: 'DECLARACAO-FIXTURE-001', dasValor: 60,
    desfecho: { estado: 'TRANSMITIDA', confirmada: true, evidencia: { competencia: '2026-10', contribuinteCnpj: parametros.contribuinteCnpj, dataHoraTransmissao: '20261020123000' } } });
});
test('simulação nunca vira transmissão mesmo com identificador retornado', async () => {
  expect((await service(retornoTransmitido).simular(parametros)).desfecho).toMatchObject({ estado: 'SIMULACAO_CONCLUIDA', confirmada: false });
});
test.each([{}, { status: 200, dados: '{}' }, { status: 200, dados: '[{},{}]' }, { status: 503 }])('retorno incompleto não comprova transmissão: %j', async retorno => {
  await expect(service(retorno).transmitir(parametros)).rejects.toMatchObject({ desfecho: { estado: 'RESULTADO_INCERTO', confirmada: false } });
});
test('erro fiscal conserva código e mensagem do provedor', async () => {
  await expect(service(retornoFiscal).transmitir(parametros)).rejects.toMatchObject({ code: 'SERPRO_BUSINESS_ERROR', mensagens: retornoFiscal.mensagens });
});

test('identificador junto de recusa não comprova sucesso nem autoriza repetição', async () => {
  const contraditorio = { ...retornoTransmitido, mensagens: retornoFiscal.mensagens };
  await expect(service(contraditorio).transmitir(parametros)).rejects.toMatchObject({
    code: 'PGDAS_RESPOSTA_CONTRADITORIA', desfecho: { estado: 'RESULTADO_INCERTO' },
  });
});

test('erro técnico com mensagem fiscal não comprova recusa segura para repetir', async () => {
  await expect(service({ ...retornoFiscal, status: 503 }).transmitir(parametros)).rejects.toMatchObject({
    desfecho: { estado: 'RESULTADO_INCERTO', confirmada: false },
  });
});

test('status HTTP não precisa ser repetido no corpo aceito pelo cliente de transporte', async () => {
  const { status, ...body } = retornoTransmitido;
  expect((await service(body).transmitir(parametros)).desfecho.confirmada).toBe(true);
});
test('empresa divergente não é aceita', () => {
  const raw = { status: 200, dados: { idDeclaracao: 'outra', cnpjCompleto: '11111111111111' } };
  expect(classificarResultadoPgdas(raw, { ...parametros, indicadorTransmissao: true }).code).toBe('PGDAS_IDENTIDADE_DIVERGENTE');
});
test('timeout não repete transporte', async () => {
  const transmitirDeclaracao = jest.fn(async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); });
  await expect(new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao } }).transmitir(parametros)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  expect(transmitirDeclaracao).toHaveBeenCalledTimes(1);
});
test('construção local conserva zero explícito da FS12 sem Fator R; despacho permanece bloqueado', async () => {
  const folhasSalario = [{ pa: '2026-10', valor: 0 }];
  const payload = buildDeclaracaoPayload({ ...parametros, competencia: '2026-11', folhasSalario, indicadorTransmissao: false });
  expect(payload.declaracao.folhasSalario).toEqual([{ pa: 202610, valor: 0 }]);
  const transmitirDeclaracao = jest.fn();
  await expect(new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao } }).simular({ ...parametros, competencia: '2026-11', folhasSalario })).rejects.toMatchObject({ code: 'FS12_INTEGRACAO_B33_PENDENTE' });
  expect(transmitirDeclaracao).not.toHaveBeenCalled();
});
