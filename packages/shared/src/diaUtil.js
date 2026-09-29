// Ajuste de dia útil para vencimento de obrigação.
//
// O que este arquivo SABE e o que ele NÃO sabe — a distinção importa:
//
//   • Fim de semana é conhecido sempre. Sábado e domingo não dependem de lei, município nem ano,
//     e são a maioria esmagadora dos ajustes. Isso aqui resolve sozinho.
//   • Feriado vem de FORA, do banco (`Feriado`). A tabela é incompleta por natureza: feriado
//     municipal varia por município, e Carnaval e Corpus Christi são ponto facultativo federal —
//     não feriado —, ainda que banco não opere. Nada disso é chutado aqui.
//
// Feriado desconhecido = data não se move. É a falha segura: mostrar a data legal crua é melhor
// que antecipar para um dia que talvez fosse útil. O contrário (inventar feriado) produziria
// prazo errado sem ninguém perceber.
//
// Tudo em UTC, como `CalendarioFiscalService`: data fiscal não muda com fuso.

const MODOS = new Set(["ANTECIPAR", "POSTERGAR", "MANTER"]);

/** Passos máximos ao procurar dia útil. Emenda real não passa de 4-5 dias; 15 é folga com teto. */
const LIMITE_BUSCA = 15;

const pad2 = (n) => String(n).padStart(2, "0");

/** Date (UTC) → "YYYY-MM-DD". */
export function paraISO(data) {
  return `${data.getUTCFullYear()}-${pad2(data.getUTCMonth() + 1)}-${pad2(data.getUTCDate())}`;
}

/** "YYYY-MM-DD" → Date em UTC, à meia-noite. */
export function deISO(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function ehFimDeSemana(data) {
  const dia = data.getUTCDay();
  return dia === 0 || dia === 6;
}

/**
 * Move a data para um dia útil, conforme o modo.
 *
 * @param {Date} data
 * @param {"ANTECIPAR"|"POSTERGAR"|"MANTER"} modo
 * @param {(iso: string) => boolean} ehFeriado  consulta ao conjunto de feriados já carregado
 * @returns {Date} a mesma data (MANTER, ou já útil) ou a mais próxima no sentido do modo
 */
export function ajustarParaDiaUtil(data, modo, ehFeriado = () => false) {
  const m = MODOS.has(modo) ? modo : "ANTECIPAR";
  if (m === "MANTER") return data;

  const passo = m === "ANTECIPAR" ? -1 : 1;
  let atual = new Date(data.getTime());
  for (let i = 0; i < LIMITE_BUSCA; i += 1) {
    if (!ehFimDeSemana(atual) && !ehFeriado(paraISO(atual))) return atual;
    atual = new Date(atual.getTime());
    atual.setUTCDate(atual.getUTCDate() + passo);
  }
  // Não achou dia útil em 15 passos: devolve a data original em vez de uma data arbitrária longe
  // dela. Só aconteceria com a tabela de feriados povoada errado, e nesse caso a data crua é a
  // resposta menos danosa.
  return data;
}

/**
 * Monta o consultor de feriados a partir das linhas do banco.
 *
 * O município entra no filtro porque feriado municipal de uma cidade não vale para empresa de
 * outra — aplicar a todas anteciparia vencimento sem motivo.
 *
 * @param {Array<{data: Date, abrangencia: string, municipio: string|null}>} feriados
 * @param {string|null} municipioDaEmpresa
 */
export function criarConsultorDeFeriados(feriados = [], municipioDaEmpresa = null) {
  const alvo = String(municipioDaEmpresa || "").trim().toLowerCase();
  const set = new Set();
  for (const f of feriados) {
    const abrangencia = String(f.abrangencia || "").toUpperCase();
    if (abrangencia === "MUNICIPAL") {
      const mun = String(f.municipio || "").trim().toLowerCase();
      if (!alvo || mun !== alvo) continue;
    }
    set.add(paraISO(f.data instanceof Date ? f.data : new Date(f.data)));
  }
  return (iso) => set.has(iso);
}
