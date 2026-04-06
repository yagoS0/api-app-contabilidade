import { normalizeGuideType } from "./guideContract.js";

const LABELS = {
  INSS: "INSS",
  SIMPLES: "Simples Nacional",
  FGTS: "FGTS",
  PIS: "PIS",
  COFINS: "COFINS",
  ISS: "ISS",
  OUTRA: "pagamento",
};

/**
 * Rótulo curto para assunto e corpo de e-mail.
 */
export function guideTypeEmailLabel(tipo) {
  const t = normalizeGuideType(tipo);
  return LABELS[t] || "pagamento";
}
