// Formatação — pt-BR em um lugar só. Nenhuma tela formata por conta própria.
"use strict";

const Fmt = (() => {
  const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  /** R$ 1.234,56 — `null`/`undefined` viram traço, NUNCA "R$ 0,00" (zero é afirmação). */
  function dinheiro(v) {
    if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
    return moeda.format(Number(v));
  }

  /** "1.234,56" → 1234.56 · "1234.56" → 1234.56 · "" → null (vazio continua vazio). */
  function paraNumero(txt) {
    const s = String(txt ?? "").trim();
    if (!s) return null;
    const limpo = s.replace(/[^\d,.-]/g, "");
    // Vírgula é decimal em pt-BR; o ponto é milhar. Se houver os dois, o último manda.
    const temVirgula = limpo.includes(",");
    const normal = temVirgula ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
    const n = Number(normal);
    return Number.isFinite(n) ? n : null;
  }

  /** 00.000.000/0000-00, tolerando digitação parcial. */
  function cnpj(valor) {
    const d = String(valor ?? "").replace(/\D/g, "").slice(0, 14);
    let out = d;
    if (d.length > 2) out = `${d.slice(0, 2)}.${d.slice(2)}`;
    if (d.length > 5) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    if (d.length > 8) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
    if (d.length > 12) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    return out;
  }

  const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

  /** dd/mm/aaaa a partir de ISO. ⚠ Corta a string; `new Date("2026-08-01")` é UTC e voltaria 31/07. */
  function data(iso) {
    if (!iso) return "—";
    const [a, m, d] = String(iso).slice(0, 10).split("-");
    return d ? `${d}/${m}/${a}` : "—";
  }

  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  /** "2026-08" → "agosto de 2026". */
  function referencia(ref) {
    const [a, m] = String(ref ?? "").split("-");
    const i = Number(m) - 1;
    return MESES[i] ? `${MESES[i]} de ${a}` : String(ref ?? "—");
  }

  /** "2026-08" → "08/2026" — a forma que entra na descrição via `{mes/ano}`. */
  function mesAno(ref) {
    const [a, m] = String(ref ?? "").split("-");
    return m ? `${m}/${a}` : "";
  }

  /** Substitui `{mes/ano}` na descrição. Sem referência, deixa a variável à vista — some daria
   *  a impressão de que foi preenchida. */
  function aplicarVariaveis(texto, ref) {
    const alvo = mesAno(ref);
    return alvo ? String(texto ?? "").replace(/\{mes\/ano\}/g, alvo) : String(texto ?? "");
  }

  function pct(v) {
    if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
    return `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%`;
  }

  /** Escapa antes de qualquer `innerHTML`. Nome de cliente com `<` não pode virar tag. */
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  /** "2026-08" do mês corrente. */
  function refDeHoje(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  return { dinheiro, paraNumero, cnpj, soDigitos, data, referencia, mesAno, aplicarVariaveis, pct, esc, refDeHoje, MESES };
})();
