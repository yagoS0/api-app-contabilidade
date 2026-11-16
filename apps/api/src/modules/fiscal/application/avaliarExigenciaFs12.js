import { determinarPoliticaDeclaratoriaFs12 } from "../domain/politicaDeclaratoriaFs12.js";
import { avaliarEvidenciaMensalFs12 } from "../domain/evidenciaMensalFs12.js";

// Somente coordenação de fatos explícitos. Sem adaptador, cache, relógio ou escrita.
export function avaliarExigenciaFs12({ contexto, evidencias, avaliadoEm } = {}) {
  const politica = determinarPoliticaDeclaratoriaFs12(contexto);
  const qualidade = avaliarEvidenciaMensalFs12({ contexto, evidencias, avaliadoEm });
  return { politica, qualidade,
    evidenciaSuficiente: politica.situacao === "EXIGIDA" && qualidade.situacao === "COMPLETA_CONFERIDA",
    autorizaEfeitoFiscal: false };
}
