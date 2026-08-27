/**
 * O RELATÓRIO DO EXTRATO IMPORTADO — o que vira tela, e o que é ruído.
 *
 * O servidor devolve o relatório INTEIRO (`ImportOfxService`). O critério para pôr uma linha na
 * tela é o da casa: **fica o que muda decisão, avisa consequência, ou diz o que fazer.** O resto é
 * contagem que ninguém usa.
 *
 * ⚠⚠ TRÊS LINHAS SÃO OBRIGATÓRIAS, e cada uma existe contra uma conclusão falsa:
 *
 *   · `jaImportadas` — a SOBREPOSIÇÃO DE PERÍODOS É O CASO NORMAL, não abuso. O cliente baixa
 *     01–31/jan e depois 15/jan–15/fev. Sem a frase, quem reenvia lê "0 novas" como FALHA e manda
 *     de novo, e de novo.
 *   · `foraDoEscopo` — são os CRÉDITOS. Só débito entra na fila (crédito não é despesa), e contar
 *     sem dizer é sumir: o cliente veria 40 transações no banco e 23 na tela.
 *   · `descartadas` — o que o arquivo trazia e não deu para ler, COM o motivo.
 *
 * ⚠⚠ E A REGRA MAIS DELICADA: `descartadasTotal` AUSENTE ⇒ "PELO MENOS N", NUNCA N.
 *
 * `descartadas` é uma AMOSTRA truncada em 50; `descartadasTotal` é a contagem real, e ela só existe
 * a partir de 26/08/2026. Contra um servidor antigo (ou o mock de outra sessão) o campo não vem — e
 * escrever `descartadas.length` diria "50" num arquivo com 145 mil blocos inválidos. Na dúvida, a
 * tela diz que não sabe o total.
 */

const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** ⚠ Vocabulário FECHADO. O tom decide a cor, e a cor tem significado fixo neste portal. */
export const TOM = Object.freeze({
  /** o que entrou */
  OK: "ok",
  /** o que não entrou e é NORMAL não entrar */
  NEUTRO: "neutro",
  /** o que não entrou e alguém precisa olhar */
  ATENCAO: "atencao",
});

/**
 * ⚠ Quantas transações foram DESCARTADAS, e se esse número é confiável.
 *
 * @returns {{total: number, exato: boolean}} `exato: false` ⇒ a tela escreve "pelo menos".
 */
export function contagemDeDescartadas(relatorio) {
  const amostra = Array.isArray(relatorio?.descartadas) ? relatorio.descartadas : [];
  const total = relatorio?.descartadasTotal;
  // ⚠ `!= null` e não `||`: `descartadasTotal: 0` é uma resposta legítima, e `||` a trataria como
  // ausente — a mesma armadilha do zero que este projeto já pagou na carga tributária.
  if (total != null && Number.isFinite(Number(total))) {
    return { total: Number(total), exato: true };
  }
  // ⚠⚠ Sem o campo, o que temos é o tamanho da AMOSTRA. Ele é um PISO, não o total.
  return { total: amostra.length, exato: amostra.length === 0 };
}

/**
 * As linhas do relatório, na ordem em que o cliente as lê.
 *
 * ⚠ Contagem ZERO **fica** nas três primeiras: sumir faria "não havia" e "não contei" ficarem
 * iguais. As demais só aparecem quando há o que dizer.
 */
export function linhasDoRelatorio(relatorio) {
  if (!relatorio) return [];
  const descartes = contagemDeDescartadas(relatorio);
  const linhas = [
    {
      chave: "criados",
      tom: TOM.OK,
      rotulo: "despesas novas na fila do contador",
      valor: numero(relatorio.criados),
    },
    {
      chave: "jaImportadas",
      tom: TOM.NEUTRO,
      rotulo: "já estavam importadas",
      valor: numero(relatorio.jaImportadas),
      // ⚠ A frase é o ponto desta linha, não o número.
      nota: "Períodos que se sobrepõem são normais — estas não entram duas vezes.",
    },
    {
      chave: "foraDoEscopo",
      tom: TOM.NEUTRO,
      rotulo: "entradas (créditos) no extrato",
      valor: numero(relatorio.foraDoEscopo),
      nota: "Só as saídas viram despesa. As entradas ficam de fora desta fila.",
    },
  ];

  if (descartes.total > 0) {
    linhas.push({
      chave: "descartadas",
      tom: TOM.ATENCAO,
      rotulo: "linhas que não deu para ler",
      valor: descartes.total,
      // ⚠⚠ "pelo menos" quando o total não veio — nunca um número com cara de final.
      aproximado: !descartes.exato,
      nota: "Elas estão listadas abaixo, com o motivo de cada uma.",
    });
  }

  const recusadas = Array.isArray(relatorio.recusadas) ? relatorio.recusadas.length : numero(relatorio.recusadas);
  if (recusadas > 0) {
    linhas.push({
      chave: "recusadas",
      tom: TOM.ATENCAO,
      rotulo: "recusadas ao entrar na fila",
      valor: recusadas,
    });
  }

  return linhas;
}

/**
 * ⚠⚠ O ARQUIVO JÁ IMPORTADO — a frase que só o hash permite.
 *
 * Sem ela, um extrato já importado por inteiro e um arquivo repetido dão exatamente a mesma
 * resposta ("0 novas"), e o cliente não tem como saber qual dos dois aconteceu.
 */
export function frasePorArquivoRepetido(relatorio) {
  const a = relatorio?.arquivoJaImportado;
  if (!a) return null;
  const quando = a.em ? new Date(a.em) : null;
  const data = quando && !Number.isNaN(quando.getTime())
    ? quando.toLocaleDateString("pt-BR")
    // ⚠ Data ilegível não vira "hoje" nem some: a frase continua valendo sem ela.
    : null;
  return data
    ? `Este mesmo arquivo já tinha sido enviado em ${data}.`
    : "Este mesmo arquivo já tinha sido enviado antes.";
}

/**
 * ⚠ O resumo de uma linha, para o caso em que NADA entrou.
 *
 * "0 novas" sozinho se lê como falha. Esta função diz POR QUE zero — e os motivos são diferentes.
 */
export function fraseQuandoNadaEntrou(relatorio) {
  if (!relatorio || numero(relatorio.criados) > 0) return null;
  if (numero(relatorio.jaImportadas) > 0) {
    return "Nada novo entrou porque todas as saídas deste arquivo já tinham sido importadas antes. "
      + "Isto é o esperado quando os períodos se sobrepõem.";
  }
  if (numero(relatorio.foraDoEscopo) > 0 && numero(relatorio.transacoesLidas) === 0) {
    return "Este arquivo só tem entradas (créditos). Só as saídas viram despesa.";
  }
  const descartes = contagemDeDescartadas(relatorio);
  if (descartes.total > 0) {
    return "Nenhuma saída pôde ser lida neste arquivo. Os motivos estão listados abaixo.";
  }
  return "Nenhuma saída foi encontrada neste arquivo.";
}

/**
 * ⚠⚠ A CONTA BANCÁRIA — e o que a AUSÊNCIA dela significa.
 *
 * Sem `acctId`, o dedupe fica mais frouxo: duas contas da mesma empresa com o mesmo valor no mesmo
 * dia podem ser confundidas. O servidor já avisa em `anomalias`; a tela repete, porque é o cliente
 * quem pode baixar o arquivo de novo em outro formato.
 */
export function leituraDaConta(relatorio) {
  const conta = relatorio?.conta;
  const acctId = String(conta?.acctId ?? "").trim();
  if (acctId) return { rotulo: `Conta ${acctId}`, aviso: null };
  return {
    rotulo: "Conta não identificada no arquivo",
    aviso: "Sem o número da conta, duas contas suas com o mesmo valor no mesmo dia podem ser "
      + "confundidas. Se puder, baixe o extrato de novo — alguns bancos oferecem um OFX mais completo.",
  };
}
