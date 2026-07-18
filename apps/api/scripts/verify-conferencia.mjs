// Verificação offline do engine de diff da Camada 2 (Robustez — conferência ADN).
// Pura: sem banco, sem ADN. Prova a lógica do "28 vs 27".
//   node scripts/verify-conferencia.mjs

import { diffConjuntos } from "../src/application/notas/apuracao/v2/ConferenciaAdnService.js";

let ok = true;
function check(nome, cond) {
  console.log(`${cond ? "✓" : "✗"} ${nome}`);
  if (!cond) ok = false;
}

// 28 vs 27: ADN tem A,B,C; nós só A,B → falta C (divergente).
const d1 = diffConjuntos(new Set(["A", "B"]), new Set(["A", "B", "C"]));
check("faltante detectado (C), ok=false", d1.faltantes.length === 1 && d1.faltantes[0] === "C" && d1.ok === false);

// Conjuntos iguais → ok.
check("sem divergência → ok=true", diffConjuntos(new Set(["A", "B"]), new Set(["A", "B"])).ok === true);

// Extra (nós temos, ADN não) NÃO trava — ok depende só de faltantes.
const d3 = diffConjuntos(new Set(["A", "B", "X"]), new Set(["A", "B"]));
check("extra não gera faltante; ok=true", d3.extras.length === 1 && d3.faltantes.length === 0 && d3.ok === true);

// Nosso vazio, ADN com 1 → falta 1.
check("nosso vazio, ADN=1 → 1 faltante", diffConjuntos(new Set(), new Set(["A"])).faltantes.length === 1);

console.log(ok ? "\n✅ DIFF OK" : "\n❌ FALHOU");
process.exit(ok ? 0 : 1);
