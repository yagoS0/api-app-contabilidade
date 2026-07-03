// Q50 — Históricos agnósticos de competência.
// A memória de históricos (AccountingHistorico) deduplica pelo TEXTO; como os textos automáticos
// embutem a competência ("VR REF DAS SIMPLES NACIONAL - 06/2026", "IRPJ - 2026-06 (cód 2089)"),
// cada mês virava um registro novo. Forma canônica: a competência vira o token {{competencia}}
// (a MESMA convenção dos templates/EVENT_DEFINITIONS), e é resolvida com a competência do
// lançamento ATUAL na hora de aplicar/exibir.
//
// Lookbehind evita mutilar datas completas DD/MM/AAAA de memos bancários (OFX):
// "05/06/2026" NÃO vira "05/{{competencia}}".

const RE_MM_YYYY = /(?<![\d/])(0[1-9]|1[0-2])\/((?:19|20)\d{2})(?!\d)/g;
const RE_YYYY_MM = /(?<!\d)((?:19|20)\d{2})-(0[1-9]|1[0-2])(?!\d)/g;

/** Texto canônico: competências (MM/AAAA ou AAAA-MM) viram {{competencia}}; espaços colapsados. */
export function normalizarHistorico(text) {
  return String(text || "")
    .replace(RE_MM_YYYY, "{{competencia}}")
    .replace(RE_YYYY_MM, "{{competencia}}")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve o texto canônico com a competência informada (YYYY-MM → label MM/AAAA). */
export function aplicarCompetencia(text, competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  const label = m ? `${m[2]}/${m[1]}` : String(competencia || "");
  return normalizarHistorico(text).replaceAll("{{competencia}}", label);
}
