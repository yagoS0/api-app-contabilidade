import { erroFs12 } from './serieManualFs12.js';

// Only B31's authenticated, complete revision is an authority. No monthly API,
// accounting aggregate, browser array or missing value supplies an implicit zero.
export function selecionarSerieDeclaratoriaFs12({ competencia, prova, revisaoEsperada, contextoHash }) {
  if (!['2026-11', '2026-12'].includes(competencia))
    throw erroFs12('FS12_POLITICA_NAO_HOMOLOGADA', 'A competência ainda não possui integração FS12 homologada.', 409);
  if (!prova || prova.competencia !== competencia || prova.revisaoFs12 !== revisaoEsperada
      || prova.contextoHash !== contextoHash || !Array.isArray(prova.serie) || !prova.serie.length)
    throw erroFs12('FS12_CALCULO_CONFLITO', 'Confirme a revisão atual da folha antes de calcular.', 409);
  return prova.serie.map(({ mes, valorCentavos }) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || !Number.isSafeInteger(valorCentavos) || valorCentavos < 0)
      throw erroFs12('FS12_SERIE_INVALIDA', 'A série confirmada não é íntegra.', 409);
    return { pa: mes, valor: valorCentavos / 100 };
  });
}
