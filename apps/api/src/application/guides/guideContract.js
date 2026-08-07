export const GUIDE_TYPES = Object.freeze([
  "INSS",
  "FGTS",
  "PIS",
  "COFINS",
  "ISS",
  "SIMPLES",
  "DARF",   // DARF genérico — quando o PDF tem 2+ tributos federais distintos (ex: PIS+COFINS, IRPJ+CSLL)
  "IRPJ",   // tributos das empresas Presumidas (LUCRO_PRESUMIDO ou LUCRO_REAL)
  "CSLL",
  "OUTRA",
]);

export const GUIDE_STATUSES = Object.freeze([
  "PENDING",
  "PROCESSING",
  "PROCESSED",
  "NEEDS_REVIEW",
  "ERROR",
]);

/**
 * A guia é uma PARCELA de parcelamento?
 *
 * ⚠ Existe porque o `tipo` não responde isso. A parcela do Simples é gravada com `tipo:"SIMPLES"`
 * (`CaptureSerproParcelaService`), exatamente como o DAS do mês — o que separa as duas é o
 * `parcelamentoId`, carimbado por `ParcelamentoV2Service`. Quem esquece disso mostra a parcela como
 * se fosse o DAS da competência, e a empresa parece em dia com um DAS que nunca foi gerado (foi o
 * que aconteceu na ERISANGELA, em DUAS telas ao mesmo tempo).
 *
 * Uma parcela de INSS parcelado também cai aqui — por isso o rótulo do destino é "Parcelamento",
 * não "PARC DAS".
 */
export function isGuiaDeParcelamento(guide) {
  return Boolean(guide?.parcelamentoId);
}

/**
 * A MESMA pergunta acima, do lado do banco.
 *
 * ⚠ `isGuiaDeParcelamento` não roda dentro de uma query, então quem precisa filtrar acabava
 * escrevendo `parcelamentoId: { not: null }` (ou `: null`) na mão — foi assim que a regra ficou
 * reimplementada em cada consumidor e as telas começaram a discordar sobre a mesma guia. Estes dois
 * filtros existem para que o `where` também aponte para este arquivo, e não para uma cópia.
 */
export const WHERE_GUIA_DE_PARCELAMENTO = Object.freeze({ parcelamentoId: { not: null } });
export const WHERE_GUIA_SEM_PARCELAMENTO = Object.freeze({ parcelamentoId: null });

/**
 * O que se precisa saber do parcelamento para NOMEAR a guia na tela.
 *
 * ⚠ Sem isto a resposta trazia `parcelamentoId` (coluna escalar da própria guia, sempre presente) e
 * nada mais: a UI sabia que era parcela mas não de qual acordo, caía no `tipo` da guia e imprimia
 * "SIMPLES" — o mesmo rótulo do DAS do mês, que é justamente o que o `parcelamentoId` existe para
 * desfazer. Quem carrega a guia para exibir carrega isto junto.
 */
export const SELECT_PARCELAMENTO_DA_GUIA = Object.freeze({
  id: true,
  tipo: true,
  numeroParcelamento: true,
  label: true,
});

/**
 * Coluna da matriz de guias (tela de envio em lote) para uma guia.
 *
 * Duas traduções, e as duas já foram esquecidas alguma vez:
 * - `SIMPLES` é o `tipo` gravado; a coluna se chama `DAS`;
 * - parcela vai para a coluna `PARC_DAS`, **antes** da tradução acima.
 */
export function colunaMatrizDaGuia(guide) {
  if (isGuiaDeParcelamento(guide)) return "PARC_DAS";
  const tipo = String(guide?.tipo || "").toUpperCase();
  return tipo === "SIMPLES" ? "DAS" : tipo;
}

export function normalizeGuideType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return GUIDE_TYPES.includes(normalized) ? normalized : "OUTRA";
}

export function normalizeCompetencia(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const yyyyMm = raw.match(/^(\d{4})-(\d{2})$/);
  if (yyyyMm) return `${yyyyMm[1]}-${yyyyMm[2]}`;

  const mmYyyy = raw.match(/^(\d{2})[\/-](\d{4})$/);
  if (mmYyyy) return `${mmYyyy[2]}-${mmYyyy[1]}`;

  const compact = raw.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  return null;
}

export function fileNameForGuide({ tipo, competencia }) {
  const safeType = normalizeGuideType(tipo);
  const comp = normalizeCompetencia(competencia);
  if (!comp) return `${safeType}.pdf`;
  const [yyyy, mm] = comp.split("-");
  return `${safeType} ${mm}-${yyyy}.pdf`;
}

