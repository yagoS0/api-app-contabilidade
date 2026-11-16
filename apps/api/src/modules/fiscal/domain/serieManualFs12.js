import { determinarPoliticaDeclaratoriaFs12, indiceCompetenciaFs12 } from './politicaDeclaratoriaFs12.js';
export function erroFs12(code, message, status = 422) {
  return Object.assign(new Error(message), { code, status });
}
export function validarIdentidadeFs12({ portalClientId, competencia, autorId }) {
  if (!autorId) throw erroFs12('FS12_SEM_AUTENTICACAO', 'Autenticação necessária.', 401);
  if (typeof portalClientId !== 'string' || !portalClientId.trim() || indiceCompetenciaFs12(competencia) === null)
    throw erroFs12('CONTEXTO_FS12_INVALIDO', 'Informe empresa e competência válidas.', 400);
}
// Nenhuma coerção, arredondamento ou preenchimento implícito de valores.
export function validarSerieManualFs12(contexto, entrada) {
  const politica = determinarPoliticaDeclaratoriaFs12(contexto);
  const meses = politica.janela?.competencias;
  if (politica.situacao !== 'EXIGIDA' || !meses?.length)
    throw erroFs12('FS12_CONTEXTO_PENDENTE', 'Confira o contexto fiscal e a janela da folha antes de confirmar.');
  if (!Array.isArray(entrada) || entrada.length !== meses.length)
    throw erroFs12('FS12_SERIE_INCOMPLETA', 'Informe todos os meses exigidos, inclusive zeros explícitos.');
  const mapa = new Map();
  let totalCentavos = 0;
  for (const item of entrada) {
    if (!item || !meses.includes(item.mes) || mapa.has(item.mes)
      || !Number.isSafeInteger(item.valorCentavos) || item.valorCentavos < 0)
      throw erroFs12('FS12_SERIE_INVALIDA', 'Confira os meses e valores em centavos, sem duplicatas ou valores negativos.');
    totalCentavos += item.valorCentavos;
    if (!Number.isSafeInteger(totalCentavos)) throw erroFs12('FS12_TOTAL_EXCEDIDO', 'O total excede o limite monetário seguro.');
    mapa.set(item.mes, item.valorCentavos);
  }
  return { politica, serie: meses.map(mes => ({ mes, valorCentavos: mapa.get(mes) })), totalCentavos };
}
