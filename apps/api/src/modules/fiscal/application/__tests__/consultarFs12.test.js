import { consultarFs12 } from '../consultarFs12.js';

const entrada = { portalClientId: 'portal-a', competencia: '2026-11' };
const contexto = { empresaId: 'company-a', competenciaApuracao: '2026-11', inicioAtividade: '2020-01',
  regimeDoPeriodo: { empresaId: 'company-a', competencia: '2026-11', tipo: 'SIMPLES_NACIONAL', referencia: 'hist:r1' } };
const portas = (ctx = contexto) => ({ lerContexto: jest.fn(async () => ctx), agora: () => '2026-11-16T12:00:00.000Z' });

test('consulta B1 sem receber fatos fiscais do navegador', async () => {
  const p = portas();
  const out = await consultarFs12({ ...entrada, evidencias: [{ valorCentavos: 0 }], conferencia: 'CONFERIDA' }, p);
  expect(p.lerContexto).toHaveBeenCalledWith(entrada);
  expect(out.politica.janela.competencias).toHaveLength(12);
  expect(out.qualidade.totalCentavos).toBeNull();
  expect(out.qualidade.cobertura.conferidas).toEqual([]);
  expect(out.evidenciaSuficiente).toBe(false);
  expect(out.integracao.permiteNovoCalculo).toBe(false);
  expect(out.autorizaEfeitoFiscal).toBe(false);
});
test.each([false, true])('sem movimento %s não dispensa folha; Fator R não determina exigência', async semMovimento => {
  const out = await consultarFs12(entrada, portas({ ...contexto, semMovimento, exigenciaHistorica: false }));
  expect(out.politica.exigida).toBe(true);
});
test('primeiro PA usa somente mês de abertura', async () => {
  const out = await consultarFs12(entrada, portas({ ...contexto, inicioAtividade: '2026-11' }));
  expect(out.politica.janela.competencias).toEqual(['2026-11']);
});
test('sem comprovação de regime ou abertura não inventa janela', async () => {
  for (const patch of [{ regimeDoPeriodo: null }, { inicioAtividade: null }]) {
    expect((await consultarFs12(entrada, portas({ ...contexto, ...patch }))).politica.janela).toBeNull();
  }
});
test('2027 continua pendente de homologação', async () => {
  const out = await consultarFs12({ ...entrada, competencia: '2027-01' }, portas({ ...contexto,
    competenciaApuracao: '2027-01', regimeDoPeriodo: { ...contexto.regimeDoPeriodo, competencia: '2027-01' } }));
  expect(out.politica.regra).toBe('HOMOLOGACAO_2027_PENDENTE');
});
test('falha, contexto trocado e ausência não viram folha zero', async () => {
  await expect(consultarFs12(entrada, portas(null))).rejects.toMatchObject({ status: 404 });
  await expect(consultarFs12(entrada, portas({ ...contexto, competenciaApuracao: '2026-12' }))).rejects.toMatchObject({ status: 503 });
  await expect(consultarFs12(entrada, { ...portas(), lerContexto: async () => { throw Error('leitura falhou'); } })).rejects.toThrow('leitura falhou');
});
test.each(['2026-00', '2026-13', '', null])('recusa PA inválido %s antes da leitura', async competencia => {
  const p = portas();
  await expect(consultarFs12({ ...entrada, competencia }, p)).rejects.toMatchObject({ status: 400 });
  expect(p.lerContexto).not.toHaveBeenCalled();
});
