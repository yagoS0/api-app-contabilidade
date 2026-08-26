// GERA AS TABELAS DE IRPF E DO TETO DO INSS a partir das páginas OFICIAIS versionadas.
//
// Elas existem para uma pergunta só, e é a que o dono descreveu como a mais valiosa do produto:
// **quanto de pró-labore é preciso para o Fator R chegar a 28%, e quanto isso custa ao sócio.**
//
// ⚠⚠ ATÉ AQUI O PROJETO SE RECUSAVA A TER ESTES NÚMEROS, E A RECUSA ESTAVA ESCRITA:
// `tabelasFiscais.js` diz "RAT/FAP, terceiros, tabela do IRPF e teto do RGPS são PARÂMETRO DE
// ENTRADA (§9) — variam por CNAE, por FAP da empresa e por portaria anual. Não têm valor aqui de
// propósito." A recusa continua CERTA para RAT/FAP e terceiros (variam por empresa). O que muda é
// que IRPF e teto do RGPS **não variam por empresa** — variam por ANO —, e um valor com vigência
// datada, fonte oficial e hash é o oposto de um número chutado. ⚠ Sem `VIGENCIA`, não entram.
//
// ⚠ SÓ LEITURA E ZERO REDE. As páginas foram baixadas uma vez, à mão, e estão em `docs/irpf/`.
//
// Uso:
//   node apps/api/scripts/gerar-tabelas-pessoa-fisica.mjs             # confere e reescreve
//   node apps/api/scripts/gerar-tabelas-pessoa-fisica.mjs --conferir  # só confere

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const FONTE_IRPF = path.join(RAIZ, "docs/irpf/rfb-tabelas-2026.html");
const FONTE_INSS = path.join(RAIZ, "docs/irpf/inss-tabela-contribuicao-2026.html");
const SAIDA = path.join(RAIZ, "apps/web/src/features/planejamento/lib/tabelasPessoaFisica.data.js");

const SO_CONFERE = process.argv.includes("--conferir");
const VIGENCIA = "2026";

function morrer(msg) {
  console.error(`\n⚠⚠ GERAÇÃO ABORTADA — ${msg}\n`);
  console.error("As tabelas NÃO foram reescritas. Numero de imposto de pessoa fisica que muda sem");
  console.error("alguem conferir e exatamente o que este gate existe para impedir.\n");
  process.exit(1);
}

const limparCelula = (c) => {
  const t = c.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return t.replace(/ /g, " ").replace(/\s+/g, " ").trim();
};

/** "R$ 2.428,80" → 2428.8 · "7,5%" → 0.075 · "-" → null */
function numero(bruto) {
  const t = String(bruto || "").trim();
  if (!t || t === "-" || t === "—") return null;
  const pct = /%\s*$/.test(t);
  const n = Number(t.replace(/[R$\s%]/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

function tabelasDoHtml(caminho) {
  if (!fs.existsSync(caminho)) morrer(`fonte não encontrada: ${caminho}`);
  const bytes = fs.readFileSync(caminho);
  const html = new TextDecoder("utf-8").decode(bytes);
  const brutas = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  const tabelas = brutas.map((tb) => {
    const linhas = tb.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    return linhas
      .map((l) => (l.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(limparCelula))
      .filter((c) => c.some(Boolean));
  }).filter((t) => t.length);
  return { tabelas, sha: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

// ─── IRPF ─────────────────────────────────────────────────────────────────────────────────────
const irpf = tabelasDoHtml(FONTE_IRPF);

// ⚠ ANCORADO NO CABEÇALHO, não na posição: a página tem DEZ tabelas (mensal, anual, PLR, ganho de
// capital, JCP…). "A primeira" quebraria na próxima reorganização do portal, em silêncio.
const ehIncidencia = (t) => /Base de c/i.test(t[0]?.[0] || "") && /Al[íi]quota/i.test(t[0]?.[1] || "");
const ehReducao = (t) => /Rendimentos Tribut/i.test(t[0]?.[0] || "") && /Redu/i.test(t[0]?.[1] || "");

const incidencias = irpf.tabelas.filter(ehIncidencia);
const reducoes = irpf.tabelas.filter(ehReducao);
if (incidencias.length < 2) morrer(`esperava as tabelas de incidência MENSAL e ANUAL, achei ${incidencias.length}`);
if (reducoes.length < 2) morrer(`esperava as tabelas de redução MENSAL e ANUAL, achei ${reducoes.length}`);

// ⚠ A MENSAL É A DE MENOR TETO — não "a primeira". A anual tem os mesmos rótulos com valores 12×.
const faixasDe = (t) => t.slice(1).map((linha) => ({
  ate: (() => {
    const m = /at[ée]\s+R\$\s*([\d.,]+)/i.exec(linha[0]);
    return m ? numero(m[1]) : null; // `null` = a última faixa, sem teto
  })(),
  aliquota: numero(linha[1]) || 0,
  deduzir: numero(linha[2]) || 0,
}));
const porTeto = (a, b) => (faixasDe(a)[0].ate || Infinity) - (faixasDe(b)[0].ate || Infinity);
const incidenciaMensal = faixasDe([...incidencias].sort(porTeto)[0]);

// ⚠⚠ E A ESCOLHA DA MENSAL PRECISA DE PROVA, NÃO DE CONFIANÇA. Achado por experimento: trocando o
// critério para "a segunda da lista", o gerador pegava a tabela ANUAL e GRAVAVA — sem abortar, sem
// aviso. A consequência é a pior possível para esta conta: com a faixa isenta em R$ 29.145,60 em
// vez de R$ 2.428,80, um pró-labore de R$ 5.000 sairia com IRRF ZERO e a simulação de Fator R
// diria que subir o pró-labore é quase de graça.
//
// A prova é a RELAÇÃO entre as duas: a anual é a mensal ×12, faixa a faixa. Duas tabelas que não
// guardam essa relação não são a mesma tabela em duas escalas — e aí não se sabe qual é qual.
const incidenciaAnual = faixasDe([...incidencias].sort(porTeto)[incidencias.length - 1]);
if (incidenciaAnual.length !== incidenciaMensal.length) {
  morrer(`a tabela mensal tem ${incidenciaMensal.length} faixas e a anual ${incidenciaAnual.length} — não são a mesma tabela`);
}
for (const [i, f] of incidenciaMensal.entries()) {
  const a = incidenciaAnual[i];
  if (f.ate == null || a.ate == null) continue;
  if (Math.abs(a.ate - f.ate * 12) > 0.02) {
    morrer(`a faixa ${i + 1} da anual (${a.ate}) não é 12x a da mensal (${f.ate}) — provavelmente as duas foram trocadas`);
  }
  if (Math.abs(a.aliquota - f.aliquota) > 1e-9) morrer(`a alíquota da faixa ${i + 1} difere entre mensal e anual`);
}
console.log(`OK: a tabela anual é 12x a mensal, faixa a faixa — a mensal é a mensal`);

const reducaoMensalBruta = [...reducoes].sort((a, b) => {
  const va = numero((/R\$\s*([\d.,]+)/.exec(a[1]?.[0]) || [])[1]) || Infinity;
  const vb = numero((/R\$\s*([\d.,]+)/.exec(b[1]?.[0]) || [])[1]) || Infinity;
  return va - vb;
})[0];

// "até R$ 5.000,00" · "de R$ 5.000,01 até R$ 7.350,00"
const isencaoAte = numero((/R\$\s*([\d.,]+)/.exec(reducaoMensalBruta[1][0]) || [])[1]);
const faixaParcial = reducaoMensalBruta[2][0];
const limiteParcial = numero((/at[ée]\s+R\$\s*([\d.,]+)/i.exec(faixaParcial) || [])[1]);
// "R$ 978,62 - (0,133145 x rendimentos tributáveis …)"
const formula = reducaoMensalBruta[2][1];
const constante = numero((/R\$\s*([\d.,]+)/.exec(formula) || [])[1]);
const fator = Number((/\(\s*([\d,]+)\s*[x×]/i.exec(formula) || [])[1]?.replace(",", "."));

if (![isencaoAte, limiteParcial, constante, fator].every((n) => Number.isFinite(n) && n > 0)) {
  morrer(`não consegui ler a tabela de redução mensal: ${JSON.stringify({ isencaoAte, limiteParcial, constante, fator })}`);
}

// ⚠⚠ A PROVA DA FÓRMULA DO REDUTOR — e ela é o coração deste gate.
// A Receita publica a regra em DUAS formas: uma faixa isenta ("até R$ X de redução, de modo que o
// imposto devido seja zero") e uma fórmula linear para a faixa seguinte. As duas TÊM de se
// encontrar nos extremos, e é isso que se confere:
//   · no fim da faixa isenta, a fórmula tem de dar exatamente a redução máxima anunciada
//   · no fim da faixa parcial, a fórmula tem de dar ZERO
// Uma constante ou um fator transcritos errados quebram um dos dois. Sem esta prova, a única
// checagem possível seria "os números parecem certos".
const reducaoMaxima = numero((/at[ée]\s+R\$\s*([\d.,]+)/i.exec(reducaoMensalBruta[1][1]) || [])[1]);
const noInicio = constante - fator * isencaoAte;
const noFim = constante - fator * limiteParcial;
if (reducaoMaxima == null) morrer("não achei a redução máxima da faixa isenta");
if (Math.abs(noInicio - reducaoMaxima) > 0.01) {
  morrer(`a fórmula do redutor não fecha no INÍCIO: em ${isencaoAte} ela dá ${noInicio.toFixed(4)}, `
    + `e a tabela anuncia ${reducaoMaxima}`);
}
if (Math.abs(noFim) > 0.01) {
  morrer(`a fórmula do redutor não fecha no FIM: em ${limiteParcial} ela dá ${noFim.toFixed(4)}, e deveria dar zero`);
}

const descontoSimplificado = (() => {
  const html = fs.readFileSync(FONTE_IRPF, "utf-8");
  const m = /desconto simplificado[^R]*R\$\s*([\d.,]+)/i.exec(limparCelula(html));
  return m ? numero(m[1]) : null;
})();
if (!descontoSimplificado) morrer("não achei o limite mensal de desconto simplificado");

// ─── INSS ─────────────────────────────────────────────────────────────────────────────────────
const inss = tabelasDoHtml(FONTE_INSS);
const textoInss = limparCelula(fs.readFileSync(FONTE_INSS, "utf-8"));
const teto = numero((/8\.475,55/.exec(textoInss) || [])[0]);
const piso = numero((/1\.621,00/.exec(textoInss) || [])[0]);
if (!teto || !piso) morrer("não achei o teto e o piso do salário de contribuição na página do INSS");

// ⚠ PROVA CRUZADA: a página anuncia a faixa de CONTRIBUIÇÃO de 20% ("entre R$ 324,20 e
// R$ 1.695,11"). Se 20% do piso e 20% do teto não baterem com ela, um dos quatro números está
// errado — e nenhum deles pode estar.
const c20piso = numero((/324,20/.exec(textoInss) || [])[0]);
const c20teto = numero((/1\.695,11/.exec(textoInss) || [])[0]);
if (c20piso && Math.abs(piso * 0.20 - c20piso) > 0.01) morrer(`20% do piso (${(piso * 0.2).toFixed(2)}) não bate com ${c20piso}`);
if (c20teto && Math.abs(teto * 0.20 - c20teto) > 0.01) morrer(`20% do teto (${(teto * 0.2).toFixed(2)}) não bate com ${c20teto}`);

// ─── RELATÓRIO ────────────────────────────────────────────────────────────────────────────────
console.log(`\nIRPF   ${path.relative(RAIZ, FONTE_IRPF)}\n       SHA-256 ${irpf.sha}`);
console.log(`INSS   ${path.relative(RAIZ, FONTE_INSS)}\n       SHA-256 ${inss.sha}`);
console.log(`\nvigência ${VIGENCIA}`);
console.log(`\nIRPF — incidência mensal (${incidenciaMensal.length} faixas)`);
for (const f of incidenciaMensal) {
  console.log(`  até ${String(f.ate ?? "∞").padStart(10)}  ${(f.aliquota * 100).toFixed(1).padStart(5)}%  deduz ${f.deduzir.toFixed(2)}`);
}
console.log(`\nIRPF — redutor (Lei 15.270/2025)`);
console.log(`  isento até ${isencaoAte} · parcial até ${limiteParcial} · redução = ${constante} - ${fator} x rendimentos`);
console.log(`  ✓ no início dá ${noInicio.toFixed(2)} (anunciado ${reducaoMaxima}) · no fim dá ${noFim.toFixed(4)} (zero)`);
console.log(`\nINSS — teto ${teto} · piso ${piso}  ✓ conferidos contra a faixa de 20% da página`);
console.log(`desconto simplificado mensal: ${descontoSimplificado}`);

if (SO_CONFERE) { console.log("\n(--conferir: nada foi escrito)\n"); process.exit(0); }

const saida = `// GERADO POR \`apps/api/scripts/gerar-tabelas-pessoa-fisica.mjs\` — NÃO EDITAR À MÃO.
//
// IRPF e teto do INSS, vigência ${VIGENCIA}. Elas existem para UMA pergunta — quanto custa ao sócio
// subir o pró-labore até o Fator R alcançar 28% — e não devem ser usadas para calcular folha real.
//
//   IRPF  docs/irpf/rfb-tabelas-2026.html   SHA-256 ${irpf.sha}
//   INSS  docs/irpf/inss-tabela-contribuicao-2026.html   SHA-256 ${inss.sha}
//
// ⚠⚠ ELAS TÊM VIGÊNCIA, E A VIGÊNCIA VAI À TELA. Mudam por portaria/lei ANUAL — uma tabela de
// pessoa física sem data impressa envelhece calada, e o número velho é indistinguível do certo.
//
// ⚠ O QUE CONTINUA FORA, e a recusa segue valendo: **RAT/FAP e contribuições a terceiros**. Eles
// variam por CNAE e pelo FAP de CADA empresa — não são tabela anual, são cadastro. Ver
// \`tabelasFiscais.js\`, \`ENCARGOS_FOLHA\`.

/** A vigência, para a tela IMPRIMIR. Sem ela, nada aqui deve ser usado. */
export const VIGENCIA_PESSOA_FISICA = "${VIGENCIA}";

/** Tabela progressiva MENSAL do IRPF. \`ate: null\` = última faixa. */
export const IRPF_MENSAL = Object.freeze([
${incidenciaMensal.map((f) => `  { ate: ${f.ate === null ? "null" : f.ate}, aliquota: ${f.aliquota}, deduzir: ${f.deduzir} },`).join("\n")}
]);

/** Limite mensal do desconto simplificado (substitui as demais deduções legais). */
export const DESCONTO_SIMPLIFICADO_MENSAL = ${descontoSimplificado};

/**
 * O REDUTOR da Lei 15.270/2025 — a isenção até R$ 5.000 e a redução parcial até R$ 7.350.
 *
 * ⚠ A fórmula é da própria Receita, e ela FECHA nos dois extremos (conferido na geração):
 * em \`isentoAte\` dá exatamente \`reducaoMaxima\`; em \`parcialAte\` dá zero.
 */
export const IRPF_REDUTOR_MENSAL = Object.freeze({
  isentoAte: ${isencaoAte},
  parcialAte: ${limiteParcial},
  reducaoMaxima: ${reducaoMaxima},
  constante: ${constante},
  fator: ${fator},
});

/** Salário de contribuição do RGPS — o teto é o que limita o INSS do pró-labore. */
export const INSS_SALARIO_CONTRIBUICAO = Object.freeze({ piso: ${piso}, teto: ${teto} });
`;

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, saida, "utf-8");
console.log(`\nescrito: ${path.relative(RAIZ, SAIDA)}\n`);
