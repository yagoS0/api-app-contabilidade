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
    // ⚠⚠ A GUARDA ERA DE UM LADO SÓ — achado por agente adversarial em 26/08/2026.
    //
    // Ela protegia contra o total AUSENTE e não contra o total MENOR que a amostra que a própria
    // tela desenha. Com `descartadasTotal` negativo, `0` ou `[]` (que `Number` converte em 0), a
    // linha sumia E a tabela junto: **50 descartes nomeados desapareciam em silêncio**, que é o
    // desfecho exato que este módulo existe para impedir.
    //
    // ⚠ A amostra é um PISO observável: a tela tem os itens na mão. Nenhum total pode ser menor que
    // o que ela já consegue mostrar.
    return { total: Math.max(Number(total), amostra.length), exato: true };
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
      // ⚠ Singular quando é UMA — e uma só é o caso mais comum do envio. "1 linhas" numa tela que
      // traduz cada motivo com cuidado destoa de tudo ao redor.
      rotulo: descartes.total === 1 ? "linha que não deu para ler" : "linhas que não deu para ler",
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
      // ⚠ Um chip âmbar com um número e mais nada não diz o que houve nem o que fazer. O servidor
      // manda o `motivo` de cada uma (`ImportOfxService`), e elas saem listadas abaixo.
      nota: "Elas estão listadas abaixo, com o motivo de cada uma.",
    });
  }

  return linhas;
}

/**
 * ⚠⚠ OS AVISOS DE QUALIDADE DO DEDUPE — que somiam da tela.
 *
 * O servidor devolve `anomalias` com **frase pronta** (`declarados/lib/dedupeOfx.js`), e são três:
 * `sem_conta_bancaria`, `sem_fitid` e `fitid_repetido`. A tela só cobria o primeiro, e por conta
 * própria (derivando de `conta.acctId`); os outros dois nunca apareciam.
 *
 * ⚠⚠ E isso é caro justamente por causa do que a tela PROMETE. Ela diz que *"enviar o mesmo período
 * duas vezes é seguro"*. Com `sem_fitid`, o servidor avisa que *"duas iguais no mesmo dia continuam
 * entrando as duas"* — ou seja, a promessa tem uma exceção, e ela estava muda. A fonte já diz por
 * quê: *"escondê-los faria um dedupe frouxo parecer um dedupe firme"*.
 *
 * ⚠ A frase é a DO SERVIDOR, sempre. A tela não reescreve — ela mostra. Um segundo texto aqui
 * divergiria do que o servidor afirma sobre o mesmo arquivo.
 */
export function avisosDoExtrato(relatorio) {
  const brutos = Array.isArray(relatorio?.anomalias) ? relatorio.anomalias : [];
  return brutos
    .map((a) => ({
      codigo: String(a?.codigo ?? "").trim() || null,
      frase: String(a?.frase ?? "").trim() || null,
      n: Number.isFinite(Number(a?.n)) ? Number(a.n) : null,
    }))
    // ⚠ Aviso SEM frase não vira linha em branco nem código cru na tela: ele é descartado, e o
    // servidor é quem tem de mandar a frase. Mostrar `sem_fitid` ao cliente não diz nada a ele.
    .filter((a) => a.frase);
}

/**
 * ⚠ A frase da AMOSTRA — "mostrando as N primeiras de M".
 *
 * Ela morava no JSX, lendo `descartadasTruncadas` cru. Regra de tela mora em `lib/`, com teste:
 * é a regra da casa, e é o que permite provar que ela some quando não há truncamento.
 */
export function fraseDaAmostraDeDescartes(relatorio) {
  if (!relatorio?.descartadasTruncadas) return null;
  const amostra = Array.isArray(relatorio.descartadas) ? relatorio.descartadas.length : 0;
  const { total } = contagemDeDescartadas(relatorio);
  if (!amostra || total <= amostra) return null;
  return `Mostrando as ${amostra} primeiras de ${total}.`;
}

/**
 * ⚠⚠ O MOTIVO DE UM DESCARTE, na língua do cliente.
 *
 * O servidor manda `frase` pronta em cada descarte (`FRASE_DO_DESCARTE`, `accounting/lib/ofx.js`) —
 * e a tela mostrava o CÓDIGO (`sem_data`, `valor_zero`) numa coluna chamada "Motivo". Código cru
 * chegando ao olho do cliente é exatamente o que `lib/mensagens.js` existe para impedir.
 *
 * ⚠ Foi o MOCK que treinou a tela a fazer isso: ele omitia `frase`. Achado por agente de
 * verificação em 26/08/2026.
 */
export function motivoLegivel(item) {
  const frase = String(item?.frase ?? "").trim();
  if (frase) return frase;
  // ⚠ Sem a frase, o código é melhor que um traço — ele é a única pista de quem for perguntar ao
  // contador. Mas ele é a RESERVA, não o padrão.
  return String(item?.motivo ?? item?.codigo ?? "").trim() || "—";
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

  // ⚠⚠ AS RECUSADAS VÊM PRIMEIRO, E ELAS DERRUBAM AS DUAS FRASES DE "TOTALIDADE" — achado por
  // agente adversarial em 26/08/2026.
  //
  // Sem esta guarda, `criados: 0 · jaImportadas: 5 · recusadas: 10` dizia *"todas as saídas deste
  // arquivo já tinham sido importadas antes — isto é o esperado"*, mandando o cliente ficar
  // tranquilo sobre DEZ saídas que foram RECUSADAS. E `recusadas: 40` sozinho dizia *"nenhuma saída
  // foi encontrada"* — com a tabela de quarenta recusadas logo abaixo, contradizendo a manchete.
  //
  // ⚠ Alcançável por qualquer erro não-P2002 do Prisma no laço do import: um soluço de conexão.
  const recusadas = Array.isArray(relatorio.recusadas)
    ? relatorio.recusadas.length
    : numero(relatorio.recusadas);
  if (recusadas > 0) {
    return `Nada novo entrou, e ${recusadas === 1 ? "uma saída foi recusada" : `${recusadas} saídas foram recusadas`} `
      + "ao entrar na fila. Os motivos estão listados abaixo — fale com o seu contador se não estiver claro.";
  }

  if (numero(relatorio.jaImportadas) > 0) {
    return "Nada novo entrou porque todas as saídas deste arquivo já tinham sido importadas antes. "
      + "Isto é o esperado quando os períodos se sobrepõem.";
  }
  // ⚠⚠ A CONDIÇÃO ANTERIOR ERA IMPOSSÍVEL EM PRODUÇÃO — achado por agente de verificação em
  // 26/08/2026, e o defeito nasceu do MOCK.
  //
  // Ela exigia `transacoesLidas === 0` com `foraDoEscopo > 0`. Medido na fonte: `transacoesLidas` é
  // `transacoes.length` (`ImportOfxService`), e `transacoes` INCLUI os créditos (`lib/ofx.js`
  // marca `sinal: amount < 0 ? "DEBITO" : "CREDITO"`); `foraDoEscopo` é `identidades.length -
  // debitos.length`, sobre um `.map` 1:1. Logo `foraDoEscopo > 0` IMPLICA `transacoesLidas > 0`,
  // sempre — e este ramo nunca rodava contra o servidor real.
  //
  // ⚠ O sentinela do mock criado para tornar o ramo alcançável offline é o que o tornava
  // inalcançável online: ele devolvia uma FORMA que o servidor não consegue produzir. É o
  // "mock esconde ramo" invertido.
  //
  // O teste certo é "TODAS as lidas são crédito", que é o que a frase afirma.
  const lidas = numero(relatorio.transacoesLidas);
  const creditos = numero(relatorio.foraDoEscopo);
  if (creditos > 0 && creditos === lidas) {
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
