import { prepararCalculoPgdas } from '../prepararCalculoPgdas.js';
import { planejarRemessaFs12 } from '../../domain/planejarRemessaFs12.js';

function fixture() {
  const entrada = { autorId: 'contador', portalClientId: 'portal', competencia: '2026-11', revisaoEsperada: 3, contextoHash: 'a'.repeat(64) };
  const prova = { portalClientId: 'portal', companyId: 'company', competencia: entrada.competencia,
    revisaoFs12Id: 'revisao-3', revisaoFs12: 3, contextoHash: entrada.contextoHash, politicaVersao: 'PGDAS-2026-B1.v1',
    serie: [{ mes: '2026-09', valorCentavos: 12345 }, { mes: '2026-10', valorCentavos: 0 }], autorizaEfeitoFiscal: false };
  const p = {
    prepararFs12: jest.fn(async () => prova),
    // Fixture de seleção: não descreve protocolo homologado ou comportamento do SERPRO.
    planejarRemessa: jest.fn(async () => ({ versaoPolitica: 'SINTETICA_NAO_HOMOLOGADA', mesesPropostos: ['2026-10'], impedimentos: [] })),
    lerParametrosCalculo: jest.fn(async () => ({ portalClientId: 'portal', companyId: 'company', competencia: '2026-11',
      contribuinteCnpj: '00000000000100', atividades: [{ idAtividade: 1, valorInterno: 1000 }],
      folhasSalario: [{ pa: '2026-01', valor: 999 }], indicadorTransmissao: true })),
    construirPayload: jest.fn(input => ({ declaracao: input })),
  };
  return { entrada, prova, p };
}

test('separa série completa da seleção e usa zero confirmado, sem transmissão ou escrita', async () => {
  const { entrada, prova, p } = fixture();
  const out = await prepararCalculoPgdas(entrada, p);
  expect(out).toMatchObject({ estado: 'PREPARADO', autorizaEfeitoFiscal: false,
    folhasSalario: [{ pa: '2026-10', valor: 0 }], payload: { declaracao: { indicadorTransmissao: false } } });
  expect(out.prova.serie).toEqual(prova.serie);
  expect(p.prepararFs12).toHaveBeenCalledTimes(2);
  expect(p.construirPayload).toHaveBeenCalledTimes(1);
  expect(p.construirPayload.mock.calls[0][0].atividades).toEqual([{ idAtividade: 1, valorInterno: 1000 }]);
  out.prova.serie[0].valorCentavos = 5;
  expect(prova.serie[0].valorCentavos).toBe(12345);
});

test('política real mantém lista null e não constrói payload', async () => {
  const f = fixture();
  f.p.planejarRemessa.mockImplementation(() => planejarRemessaFs12());
  expect(await prepararCalculoPgdas(f.entrada, f.p)).toMatchObject({ estado: 'BLOQUEADO', payload: null,
    planejamento: { mesesPropostos: null, autorizaEfeitoFiscal: false } });
  expect(f.p.lerParametrosCalculo).not.toHaveBeenCalled();
  expect(f.p.construirPayload).not.toHaveBeenCalled();
});

test.each([null, [], undefined])('seleção inconclusiva/vazia %j nunca vira remessa presumida', async mesesPropostos => {
  const f = fixture(); f.p.planejarRemessa.mockResolvedValue({ versaoPolitica: 'fixture', mesesPropostos, impedimentos: [] });
  expect((await prepararCalculoPgdas(f.entrada, f.p)).estado).toBe('BLOQUEADO');
  expect(f.p.construirPayload).not.toHaveBeenCalled();
});

test.each([
  ['2026-09', '2026-09'], ['2026-08'], [{ mes: '2026-10', valorCentavos: 999 }],
].map(meses => [meses]))('seleção inválida não altera valor confirmado: %j', async mesesPropostos => {
  const f = fixture(); f.p.planejarRemessa.mockResolvedValue({ versaoPolitica: 'fixture', mesesPropostos, impedimentos: [] });
  await expect(prepararCalculoPgdas(f.entrada, f.p)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
  expect(f.p.construirPayload).not.toHaveBeenCalled();
});

test.each(['portalClientId', 'companyId', 'competencia'])('parâmetros de outra identidade %s são recusados', async field => {
  const f = fixture(); const data = await f.p.lerParametrosCalculo(); data[field] = 'outra'; f.p.lerParametrosCalculo.mockResolvedValue(data);
  await expect(prepararCalculoPgdas(f.entrada, f.p)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
  expect(f.p.construirPayload).not.toHaveBeenCalled();
});

test.each(['revisaoFs12Id', 'revisaoFs12', 'contextoHash', 'companyId'])('mudança %s durante preparo impede resultado', async field => {
  const f = fixture(); f.p.prepararFs12.mockResolvedValueOnce(f.prova).mockResolvedValueOnce({ ...f.prova, [field]: 'alterada' });
  await expect(prepararCalculoPgdas(f.entrada, f.p)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
  expect(f.p.construirPayload).not.toHaveBeenCalled();
});

test('confirmação ausente e revogação propagam recusa antes do payload', async () => {
  const f = fixture(); f.p.prepararFs12.mockRejectedValueOnce(Object.assign(Error('ausente'), { code: 'FS12_CONFIRMACAO_AUSENTE' }));
  await expect(prepararCalculoPgdas(f.entrada, f.p)).rejects.toMatchObject({ code: 'FS12_CONFIRMACAO_AUSENTE' });
  f.p.prepararFs12.mockResolvedValueOnce(f.prova).mockRejectedValueOnce(Object.assign(Error('revogado'), { status: 403 }));
  await expect(prepararCalculoPgdas(f.entrada, f.p)).rejects.toMatchObject({ status: 403 });
  expect(f.p.construirPayload).not.toHaveBeenCalled();
});

test('2027 permanece bloqueado até com seleção sintética', async () => {
  const f = fixture(); f.entrada.competencia = '2027-01'; f.prova.competencia = '2027-01';
  expect((await prepararCalculoPgdas(f.entrada, f.p)).estado).toBe('BLOQUEADO');
  expect(f.p.construirPayload).not.toHaveBeenCalled();
});
