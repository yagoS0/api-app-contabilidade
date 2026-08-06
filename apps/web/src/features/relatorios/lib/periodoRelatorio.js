// O PERÍODO DE UM RELATÓRIO — e o período ANTERIOR, para comparar.
//
// ⚠ POR QUE O INTERVALO É PRÓPRIO DESTA TELA
// O resto da empresa vive numa competência global (um mês). Relatório de um mês só não é
// relatório: a pergunta aqui é a evolução, e ela precisa de intervalo. Esta é a única exceção
// documentada à regra de "um controle por estado global" — e ela está escrita aqui, no código que
// a cria, para ninguém "consertar" a exceção depois achando que foi esquecimento.
//
// ⚠ O PERÍODO ANTERIOR TEM O MESMO TAMANHO, e isso é o que torna a comparação honesta. Comparar
// um trimestre com "o mês passado" ou com "o ano anterior inteiro" produz uma variação que não
// significa nada — e é o tipo de número que vai para o cliente sem ninguém conferir.

/** `"2026-07"` → `{ ano, mes }`; entrada inválida → `null`. */
export function parse(comp) {
  const m = String(comp || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? { ano: Number(m[1]), mes: Number(m[2]) } : null;
}

const chave = (ano, mes) => `${ano}-${String(mes).padStart(2, "0")}`;

/** Anda `n` meses (negativo recua). Passa por `Date` com dia 1 — 31/03 recuando não vira 02/03. */
export function deslocar(comp, n) {
  const p = parse(comp);
  if (!p) return comp;
  const d = new Date(p.ano, p.mes - 1 + n, 1);
  return chave(d.getFullYear(), d.getMonth() + 1);
}

/** Quantos meses o intervalo cobre, inclusive nas pontas. */
export function meses(de, ate) {
  const a = parse(de); const b = parse(ate);
  if (!a || !b) return 0;
  const n = (b.ano - a.ano) * 12 + (b.mes - a.mes) + 1;
  return n > 0 ? n : 0;
}

/**
 * Os intervalos que a tela oferece, todos ancorados numa competência de referência.
 *
 * ⚠ Nenhum deles inclui o mês corrente por padrão: a referência é a competência de trabalho (o mês
 * fechado). Relatório que inclui um mês ainda em aberto mostra queda em toda linha, todo mês, e o
 * contador aprende a ignorar o último ponto — que é o pior lugar para se aprender a ignorar.
 */
export function intervalosDisponiveis(referencia) {
  const p = parse(referencia);
  if (!p) return [];
  return [
    { chave: "mes", rotulo: "Mês", de: referencia, ate: referencia },
    { chave: "trimestre", rotulo: "Trimestre", de: deslocar(referencia, -2), ate: referencia },
    { chave: "ano", rotulo: "Ano-calendário", de: chave(p.ano, 1), ate: referencia },
    { chave: "doze", rotulo: "Últimos 12 meses", de: deslocar(referencia, -11), ate: referencia },
  ];
}

/**
 * O período anterior, do MESMO tamanho, imediatamente antes.
 *
 * Um trimestre compara com o trimestre anterior; doze meses comparam com os doze anteriores.
 */
export function periodoAnterior(de, ate) {
  const n = meses(de, ate);
  if (!n) return null;
  return { de: deslocar(de, -n), ate: deslocar(ate, -n) };
}

/**
 * A variação entre dois totais.
 *
 * ⚠ BASE ZERO NÃO TEM VARIAÇÃO PERCENTUAL. Sair de R$ 0 para R$ 10.000 não é "crescimento de
 * ∞%" nem de "100%": é aparecimento. Devolver um número ali produziria a linha mais chamativa do
 * relatório em cima da divisão por zero — então `percentual` vem `null` e a tela diz o que
 * aconteceu em palavras.
 */
export function variacao(atual, anterior) {
  const a = Number(atual) || 0;
  const b = Number(anterior) || 0;
  const absoluta = a - b;
  if (b === 0) {
    return {
      absoluta,
      percentual: null,
      // Os três casos que a tela precisa distinguir e que um "0%" achataria num só.
      leitura: a === 0 ? "sem movimento nos dois períodos" : "não havia movimento no período anterior",
    };
  }
  return { absoluta, percentual: absoluta / b, leitura: null };
}

/** Soma um tipo (RECEITA, DESPESA…) ao longo das linhas do relatório. */
export function somaPorTipo(linhas, tipo) {
  return (linhas || []).reduce((s, l) => s + (Number(l?.porTipo?.[tipo]) || 0), 0);
}

/** O total do período. */
export function somaTotal(linhas) {
  return (linhas || []).reduce((s, l) => s + (Number(l?.total) || 0), 0);
}
