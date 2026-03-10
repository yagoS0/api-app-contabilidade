export const GUIDE_TYPES = Object.freeze([
  "INSS",
  "FGTS",
  "PIS",
  "COFINS",
  "ISS",
  "SIMPLES",
  "OUTRA",
]);

export const GUIDE_STATUSES = Object.freeze([
  "PENDING",
  "PROCESSING",
  "PROCESSED",
  "NEEDS_REVIEW",
  "ERROR",
]);

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

