// ⚠⚠ SOMENTE LEITURA. *"o da lente já apareceu as saídas para colocar no fluxo, mas sincrosat
// não"* (dono, 30/08/2026). Reproduz o detector, empresa a empresa, e diz POR QUE cada contraparte
// não vira sugestão — usando a regra pura, nunca uma segunda leitura.
import { PrismaClient } from "@prisma/client";
import { lerSerie, PISO_DE_OBSERVACOES, dentroDaFaixaDaMediana } from "../src/application/fluxo/lib/recorrencia.js";
const p = new PrismaClient();
const ALVOS = (process.argv[2] || "LENTE,SINCROSAT").split(",");
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const comp = (d) => (d instanceof Date ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null);
const HOJE = "2026-08";

const empresas = await p.portalClient.findMany({ select: { id: true, razao: true } });
for (const alvo of ALVOS) {
  const e = empresas.find((x) => String(x.razao || "").toUpperCase().includes(alvo.toUpperCase()));
  if (!e) { console.log(`\n### ${alvo}: não achei`); continue; }
  const notas = await p.portalInvoice.findMany({
    where: { clientId: e.id, papel: "DEST", competencia: { not: null }, total: { not: null } },
    select: { competencia: true, total: true, emitenteDoc: true, emitenteNome: true, statusEfetivo: true, status: true },
  });
  console.log(`\n### ${e.razao} — ${notas.length} notas RECEBIDAS com competência e valor`);
  const porDoc = new Map();
  let semDoc = 0;
  for (const n of notas) {
    if (String(n.statusEfetivo || "").toLowerCase() === "cancelada" || String(n.status || "").toUpperCase() === "CANCELADA") continue;
    const doc = String(n.emitenteDoc || "").trim();
    if (!doc) { semDoc += 1; continue; }
    const l = porDoc.get(doc) || { nome: n.emitenteNome, obs: [] };
    l.obs.push({ competencia: comp(n.competencia), valor: Number(n.total) });
    porDoc.set(doc, l);
  }
  if (semDoc) console.log(`  ⚠ ${semDoc} nota(s) SEM emitenteDoc — fora do alcance por falta de chave`);
  const linhas = [];
  for (const [doc, v] of porDoc) {
    const r = lerSerie({ observacoes: v.obs, periodicidade: "MENSAL", cicloAtual: HOJE, jaMarcada: false });
    // ⚠ TRÊS leituras de "variação ≤ 10%", medidas lado a lado — elas discordam, e a escolha entre
    // elas é decisão do dono, não de fórmula.
    const vals = r.base.valores || [];
    const ultimas3 = vals.slice(-3);
    linhas.push({ doc, nome: v.nome, n: r.base.n, cons: r.base.consecutivos, leitura: r.leitura,
                  mediana: r.base.mediana, faixa: dentroDaFaixaDaMediana(vals),
                  faixa3: dentroDaFaixaDaMediana(ultimas3),
                  cv: r.base.cv, cvOk: typeof r.base.cv === "number" && r.base.cv <= 0.10,
                  desde: r.base.ciclosDesdeAUltima, janela: r.base.janela });
  }
  linhas.sort((a, b) => b.cons - a.cons || b.n - a.n);
  console.log("  contraparte".padEnd(40), "n".padStart(3), "cons".padStart(5), "mediana".padStart(12), "tudo±10".padStart(6), "ult3±10".padStart(7), "cv≤10".padStart(5), " leitura");
  for (const l of linhas.slice(0, 12)) {
    console.log(
      `  ${String(l.nome || l.doc).slice(0, 38).padEnd(38)}`,
      String(l.n).padStart(3), String(l.cons).padStart(5), brl(l.mediana).padStart(12),
      (l.faixa ? "SIM" : "não").padStart(6), (l.faixa3 ? "SIM" : "não").padStart(7),
      (l.cvOk ? "SIM" : "não").padStart(5), ` ${l.leitura}`,
      l.janela ? `(${l.janela.deCiclo}→${l.janela.ateCiclo}, há ${l.desde} ciclo(s))` : ""
    );
  }
  const sugerem = linhas.filter((l) => l.leitura === "sugere_entrada");
  console.log(`  → ${sugerem.length} SUGEREM entrada · auto pela faixa de TUDO: ${sugerem.filter((l) => l.faixa).length} · pelas ÚLTIMAS 3: ${sugerem.filter((l) => l.faixa3).length} · pelo cv≤10%: ${sugerem.filter((l) => l.cvOk).length}`);
}
await p.$disconnect();
