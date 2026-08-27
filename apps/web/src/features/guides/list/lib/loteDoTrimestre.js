// MARCAR VAZIO O TRIMESTRE INTEIRO — quais meses entram, e quais NÃO entram.
//
// ⚠⚠ POR QUE ISTO EXISTE. IRPJ e CSLL são apurados por TRIMESTRE (Lei 9.430/1996): nos dois meses
// que não fecham o trimestre não há guia deles, mesmo havendo faturamento. Hoje o contador afirma
// isso uma marcação por nó, por mês — 2 nós × 8 meses × 11 empresas do Presumido = ~176 afirmações
// por ano, todas dizendo a mesma coisa. É trabalho O(n) para uma decisão que se toma uma vez.
//
// ⚠⚠ O QUE O LOTE POUPA É DIGITAÇÃO, NUNCA REGISTRO. Cada mês continua sendo uma linha própria em
// `Guide`, com `vazioEm` / `vazioPor` / `vazioMotivo` próprios — é registro de afirmação fiscal, e
// uma linha só cobrindo três meses responderia "quando o contador afirmou isto?" com uma data que
// não é a do fato. O lote repete a MESMA chamada, mês a mês.
//
// ⚠⚠ E A TRAVA DE FATURAMENTO NÃO É AFROUXADA. Cada mês do lote passa pela mesma confirmação e pelo
// mesmo motivo obrigatório do caminho de um mês só (`GUIA_VAZIA_COM_FATURAMENTO`). O lote não é um
// atalho pela guarda: ele é o mesmo caminho, repetido.

/** Os três meses do trimestre a que a competência pertence. */
export function mesesDoTrimestre(competencia) {
  const [ano, mes] = String(competencia || "").split("-").map(Number);
  if (!ano || !mes || mes < 1 || mes > 12) return [];
  const primeiro = Math.floor((mes - 1) / 3) * 3 + 1;
  return [0, 1, 2].map((i) => `${ano}-${String(primeiro + i).padStart(2, "0")}`);
}

/** O mês fecha o trimestre? (mar/jun/set/dez) */
export function fechaOTrimestre(competencia) {
  const mes = Number(String(competencia || "").split("-")[1]);
  return [3, 6, 9, 12].includes(mes);
}

/**
 * ⚠⚠ QUAIS MESES O LOTE ALCANÇA — e as três exclusões são o produto.
 *
 * 1. **O mês que FECHA o trimestre fica de fora.** É nele que IRPJ/CSLL são apurados de verdade;
 *    marcá-lo vazio junto afirmaria ausência exatamente onde a guia deve existir. Esta é a exclusão
 *    que dá nome à função, e tirá-la transforma a comodidade num erro fiscal.
 * 2. **A competência que já está sendo marcada fica de fora.** Ela é marcada pelo caminho de
 *    sempre; incluí-la aqui mandaria a mesma afirmação duas vezes.
 * 3. ⚠ **Mês que ainda não terminou fica de fora.** Não se afirma ausência de guia num mês que não
 *    aconteceu — é a mesma disciplina do teto do `CompetenciaSwitcher` ("não há o que apurar num mês
 *    que não terminou"). Sem isto, marcar março em janeiro carimbaria o futuro.
 *
 * @param {string} competencia   a competência aberta na tela
 * @param {string} hoje          a competência corrente ("YYYY-MM") — o teto
 * @returns {{meses: string[], fechamento: string|null, foraPorSeremFuturos: string[]}}
 */
export function mesesDoLote(competencia, hoje) {
  const doTri = mesesDoTrimestre(competencia);
  if (!doTri.length) return { meses: [], fechamento: null, foraPorSeremFuturos: [] };

  const fechamento = doTri.find(fechaOTrimestre) || null;
  const candidatos = doTri.filter((m) => m !== fechamento && m !== competencia);
  const teto = String(hoje || "");
  // ⚠ Sem teto conhecido, NADA é excluído por data — inventar um "hoje" seria pior que não ter.
  const futuros = teto ? candidatos.filter((m) => m > teto) : [];

  return {
    meses: candidatos.filter((m) => !futuros.includes(m)),
    fechamento,
    foraPorSeremFuturos: futuros,
  };
}

/**
 * A frase que a tela mostra ao lado da opção — ela diz **quais meses**, por extenso.
 *
 * ⚠ "Marcar o trimestre inteiro" seria mentira em duas direções: o mês do fechamento NÃO entra, e
 * mês futuro também não. Um rótulo que não nomeia os meses faz o contador afirmar sobre competências
 * que ele não escolheu.
 */
export function fraseDoLote(competencia, hoje) {
  const { meses, fechamento, foraPorSeremFuturos } = mesesDoLote(competencia, hoje);
  if (!meses.length) {
    return {
      podeOferecer: false,
      // ⚠ Cada "não posso" tem motivo PRÓPRIO — consertos diferentes.
      motivo: !fechamento
        ? "Competência inválida."
        : foraPorSeremFuturos.length
          ? "Os outros meses deste trimestre ainda não terminaram — não se afirma ausência de guia num mês que não aconteceu."
          : competencia === fechamento
            ? "Este mês FECHA o trimestre: é nele que IRPJ e CSLL são apurados, então não há outros meses a marcar a partir daqui."
            : "Não há outro mês deste trimestre a marcar.",
    };
  }
  return {
    podeOferecer: true,
    meses,
    texto: `Marcar também ${meses.length === 1 ? "o mês" : "os meses"} ${meses.join(" e ")}, `
      + "com este mesmo motivo.",
    // ⚠ A ressalva do fechamento vai JUNTO, sempre: é o que impede "marcar o trimestre" de ser lido
    // como "marcar os três meses".
    ressalva: fechamento
      ? `${fechamento} NÃO entra: é o mês que fecha o trimestre, e é nele que IRPJ e CSLL são apurados.`
      : null,
  };
}

/** Cada mês é uma afirmação própria — e o desfecho de cada uma é próprio também. */
export const DESFECHO = Object.freeze({
  MARCADA: "marcada",
  FALHOU: "falhou",
});

/**
 * ⚠⚠ O RELATÓRIO DO LOTE — e ele é obrigatório, não enfeite.
 *
 * Um mês pode falhar sozinho (mês contábil fechado ⇒ 409 `MES_FECHADO`, guia já presente, erro de
 * rede) enquanto os outros passam. Sem o relatório, "marquei o trimestre" se lê como sucesso total
 * e o contador descobre o buraco na fiscalização. Silêncio parcial é pior que falha inteira.
 */
export function relatorioDoLote(resultados = []) {
  const lista = Array.isArray(resultados) ? resultados : [];
  const marcadas = lista.filter((r) => r?.desfecho === DESFECHO.MARCADA);
  const falhas = lista.filter((r) => r?.desfecho === DESFECHO.FALHOU);
  if (!lista.length) return { tom: "neutro", titulo: "Nada a marcar", texto: "Nenhum mês foi tocado." };
  if (!falhas.length) {
    return {
      tom: "ok",
      titulo: "Meses marcados",
      texto: `${marcadas.length} mês(es) marcado(s): ${marcadas.map((r) => r.competencia).join(", ")}.`,
    };
  }
  return {
    tom: "atencao",
    titulo: falhas.length === lista.length ? "Nenhum mês foi marcado" : "Parte dos meses não foi marcada",
    // ⚠ Os que FALHARAM saem NOMEADOS, com o motivo de cada um — é o que diz onde continuar à mão.
    texto: [
      marcadas.length ? `Marcados: ${marcadas.map((r) => r.competencia).join(", ")}.` : null,
      `Não marcados: ${falhas.map((r) => `${r.competencia} (${r.motivo || "motivo desconhecido"})`).join("; ")}.`,
    ].filter(Boolean).join(" "),
  };
}
