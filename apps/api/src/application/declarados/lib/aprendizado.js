// O HISTÓRICO VIRA REGRA — e a regra se freia sozinha quando o histórico a desmente.
//
// ⚠ ESTE MÓDULO É PURO: sem prisma, sem relógio, sem I/O.
//
// ## ⚠⚠ O APRENDIZADO É SÓ POR CNPJ, E ISSO É DECISÃO DO DONO (24/08/2026)
//
// A âncora por **descrição** não gera regra nova: ela LÊ `AccountingHistorico`, que já existe, já
// está povoada (227 registros) e **se mantém sozinha** — o contador a alimenta toda vez que lança.
// Construir uma segunda memória de descrição criaria duas fontes discordando sobre a mesma
// descrição da mesma empresa, e já há **um conflito medido** (`FAST SHOP`: o lançado diz `170`, a
// memória diz `169`).
//
// O que `RegraContabilizacao` acrescenta, e a memória não tem, é o **CNPJ do fornecedor** — a
// âncora que IDENTIFICA. Medido: **140 de 211** pares empresa×fornecedor têm 2+ notas, ou seja
// alcançam o piso. É daí que o aprendizado tira valor.

/** ⚠ O piso: duas confirmações. Uma só é um caso; duas são um hábito. */
export const PISO_DE_CONFIRMACOES = 2;

/**
 * ⚠ A folga da faixa: ±15% sobre o menor e o maior valor já confirmados.
 *
 * ⚠⚠ A FAIXA É OBRIGATÓRIA, e não é decoração: ela é o que impede uma regra de aplicar a conta de
 * uma mensalidade de R$ 300 a uma compra de R$ 30.000 do mesmo fornecedor. Regra automática com a
 * conta errada erra **em série**.
 *
 * ⚠ Os 15% são HEURÍSTICA, não norma — nenhuma regra fiscal os define. Estão nomeados e num lugar
 * só para poderem ser ajustados com dado real.
 */
export const FOLGA_DA_FAIXA = 0.15;

/** ⚠ Por que uma regra APRENDIDA foi suspensa. Vocabulário FECHADO — vai para a tela. */
export const MOTIVO_DA_SUSPENSAO = Object.freeze({
  /** O contador passou a lançar o mesmo fornecedor em outra conta. */
  DIVERGENCIA: "divergencia",
  /** As confirmações que a sustentavam sumiram (desfeitas ou recusadas). */
  BASE_DESFEITA: "base_desfeita",
});

export const FRASE_DA_SUSPENSAO = Object.freeze({
  [MOTIVO_DA_SUSPENSAO.DIVERGENCIA]:
    "Esta regra foi suspensa sozinha: o mesmo fornecedor passou a ser lançado em outra conta.",
  [MOTIVO_DA_SUSPENSAO.BASE_DESFEITA]:
    "Esta regra foi suspensa sozinha: os lançamentos que a geraram foram desfeitos.",
});

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");
const arredondar = (n) => Math.round(n * 100) / 100;

/**
 * As confirmações que CONTAM para o aprendizado.
 *
 * ⚠⚠ SÓ `CONTABILIZADO` COM CONTA APLICADA. Um declarado recusado, aguardando pagamento ou apenas
 * sugerido não é confirmação de nada — só o que virou lançamento prova que o contador decidiu.
 *
 * ⚠ E só o que foi decidido **por uma pessoa**: confirmação nascida de regra (`regraId`
 * preenchido) **não realimenta o aprendizado**. Sem isso a regra se auto-confirma — ela lança, a
 * própria linha vira "confirmação", e uma conta errada se prova certa sozinha, em série. É a mesma
 * família do `AMBIGUO` que se resolve escolhendo.
 */
export function confirmacoesQueContam(declarados) {
  return (declarados || []).filter(
    (d) => d?.estado === "CONTABILIZADO" && d?.contaAplicada && !d?.regraId,
  );
}

/**
 * O que o histórico de UM fornecedor manda fazer.
 *
 * @param {object} entrada `{ cnpjFornecedor, declarados, regraExistente }`
 * @returns {{
 *   acao: "CRIAR" | "SUSPENDER" | "NADA",
 *   proposta?: {cnpjFornecedor, contaDestino, valorMin, valorMax, confirmacoesBase},
 *   motivo?: string, frase?: string
 * }}
 */
export function decidirAprendizado({ cnpjFornecedor, declarados = [], regraExistente = null } = {}) {
  const cnpj = soDigitos(cnpjFornecedor);
  if (!cnpj) return { acao: "NADA" };

  const confirmacoes = confirmacoesQueContam(declarados);
  const contas = new Set(confirmacoes.map((d) => String(d.contaAplicada)));

  // ── A REGRA JÁ EXISTE: o histórico ainda a sustenta? ────────────────────────────────────────
  if (regraExistente) {
    // ⚠⚠ REGRA MANUAL NUNCA SE SUSPENDE SOZINHA. Ela foi uma decisão explícita de quem a escreveu;
    // desligá-la por observação seria o sistema revogando a decisão de uma pessoa. Quem a desliga
    // é o contador, na tela.
    if (regraExistente.origemRegra !== "APRENDIDA") return { acao: "NADA" };
    // ⚠ Já suspensa não se suspende de novo — isso reescreveria a data e o motivo originais.
    if (regraExistente.suspensaEm) return { acao: "NADA" };

    if (confirmacoes.length === 0) {
      return {
        acao: "SUSPENDER",
        motivo: MOTIVO_DA_SUSPENSAO.BASE_DESFEITA,
        frase: FRASE_DA_SUSPENSAO[MOTIVO_DA_SUSPENSAO.BASE_DESFEITA],
      };
    }
    // ⚠⚠ DIVERGÊNCIA SUSPENDE NA HORA. Basta UMA confirmação em outra conta: a unanimidade que
    // gerou a regra deixou de existir, e o contador mudou de ideia sobre este fornecedor.
    if (contas.size > 1 || !contas.has(String(regraExistente.contaDestino))) {
      return {
        acao: "SUSPENDER",
        motivo: MOTIVO_DA_SUSPENSAO.DIVERGENCIA,
        frase: FRASE_DA_SUSPENSAO[MOTIVO_DA_SUSPENSAO.DIVERGENCIA],
      };
    }
    return { acao: "NADA" };
  }

  // ── A REGRA NÃO EXISTE: o histórico já a justifica? ─────────────────────────────────────────
  // ⚠⚠ UNANIMIDADE **E** PISO. Duas confirmações em contas diferentes não são um hábito — são uma
  // dúvida, e dúvida não vira automação.
  if (confirmacoes.length < PISO_DE_CONFIRMACOES) return { acao: "NADA" };
  if (contas.size !== 1) return { acao: "NADA" };

  const valores = confirmacoes
    .map((d) => Number(d.valorAjustado ?? d.valor))
    .filter((v) => Number.isFinite(v) && v > 0);
  // ⚠ Sem valor legível não se inventa faixa — e faixa é obrigatória. Sem ela, nada nasce.
  if (valores.length !== confirmacoes.length) return { acao: "NADA" };

  const menor = Math.min(...valores);
  const maior = Math.max(...valores);

  return {
    acao: "CRIAR",
    proposta: {
      cnpjFornecedor: cnpj,
      contaDestino: [...contas][0],
      valorMin: arredondar(menor * (1 - FOLGA_DA_FAIXA)),
      valorMax: arredondar(maior * (1 + FOLGA_DA_FAIXA)),
      // ⚠⚠ A TRILHA É NAVEGÁVEL, e é ela que torna o aprendizado auditável. Aprendizado invisível é
      // o que impede o contador de desligar a regra no dia em que algo entrar errado.
      confirmacoesBase: confirmacoes.map((d) => d.id),
    },
  };
}
