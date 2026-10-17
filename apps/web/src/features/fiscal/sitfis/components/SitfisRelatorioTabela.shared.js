
const COLUNA_TOTAL = "Sdo. Dev. Cons.";

export function parseValorBR(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (!/^-?[\d.]+,\d{2}$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function totalDoBloco(colunas, registros, coluna = COLUNA_TOTAL) {
  if (!colunas?.includes(coluna) || !registros || registros.length < 2) return null;
  let soma = 0;
  for (const r of registros) {
    const v = parseValorBR(r[coluna]);
    if (v === null) return null;
    soma += v;
  }
  // Centavos: somar float acumula erro (0,1+0,2). O arredondamento é de APRESENTAÇÃO.
  return Math.round(soma * 100) / 100;
}

export function anotacoesComRotulo(anotacoes = [], porRegistro = []) {
  if (!Array.isArray(porRegistro) || !porRegistro.length) return null;
  const pares = [];
  for (const r of porRegistro) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    for (const [rotulo, valor] of Object.entries(r)) pares.push([rotulo, valor]);
  }
  if (pares.length !== anotacoes.length) return null;

  const restante = new Map();
  for (const v of anotacoes) restante.set(v, (restante.get(v) || 0) + 1);
  for (const [, valor] of pares) {
    const n = restante.get(valor);
    if (!n) return null;
    restante.set(valor, n - 1);
  }

  const grupos = [];
  for (const [rotulo, valor] of pares) {
    const g = grupos.find((x) => x.rotulo === rotulo);
    if (g) g.valores.push(valor);
    else grupos.push({ rotulo, valores: [valor] });
  }
  return grupos;
}
export { COLUNA_TOTAL };

