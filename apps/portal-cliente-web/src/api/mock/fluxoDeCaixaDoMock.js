/**
 * O PAYLOAD DO FLUXO DE CAIXA, NO MODO OFFLINE.
 *
 * ⚠⚠ ISTO NÃO É "DADO DE DEMONSTRAÇÃO", e por isso não mora em `features/painel/lib/dadosDeDemonstracao.js`.
 * O fluxo de caixa PASSOU A SER REAL em 27/08/2026: este arquivo reproduz o CONTRATO que o servidor
 * responde (`GET /client/companies/:id/fluxo-de-caixa`), para a tela poder ser exercida sem backend.
 * O que continua sendo ficção é o DRE, e ele ficou lá.
 *
 * ⚠⚠ **REESCRITO EM 28/08/2026 PELA LEI 1 DA `CONSTITUICAO-do-produto.md`**, e as três mudanças
 * grandes vieram de lá:
 *
 * | | antes | agora |
 * |---|---|---|
 * | janela | 12 meses **à frente** | **4 passados + corrente + 7 futuros** |
 * | guia gerada em aberto | `FATO`, no mês do vencimento | `COMPROMISSO`, no **mês corrente** |
 * | guia paga | **não existia no payload** | `FATO`, no mês do **pagamento** |
 *
 * ⚠⚠ **O PASSADO SÓ CARREGA O QUE FOI PAGO** — é o critério de aceite nº 12 da Constituição, e ele
 * não é regra de tela: é o que a Lei 1 produz. Este mock **tem de obedecê-lo**, senão a tela offline
 * mostraria âmbar no passado e ninguém conseguiria conferir o desenho que chega ao cliente.
 *
 * ⚠⚠ `demonstracao: false`, como o servidor responde — é ele que apaga o selo.
 *
 * ⚠⚠ NÃO EXISTE `total`, nem `saldo`, nem `saldoAcumulado`. Sem âncora de conciliação não há
 * acumulado (Lei 3), e a coluna Saldo é Fase 3. ⚠ O `alertaDeGuias` chama a soma dele de `valor`,
 * e **não** de `total`, pelo mesmo motivo: a palavra proibida não pode entrar por uma porta lateral.
 *
 * ⚠⚠ ELE NÃO É DERIVADO DAS GUIAS DE `estado.guias`, E ISSO É ESCOLHA — com o custo NOMEADO.
 * Consequência visível offline: o card "A vencer" (que sai de `getFluxo`) e o alerta de guias
 * mostram números DIFERENTES na mesma página. Em PRODUÇÃO eles concordam — e desde 28/08/2026 eles
 * concordam **mais**, porque as duas leituras passaram a comparar com o mesmo DIA.
 * ⚠ Derivar daqui custaria RAMOS, e ramo perdido é a falha mais cara deste projeto: a fixture de
 * guias não tem nenhuma sem vencimento, nenhuma PAGA, e todas as competências dela estão no passado.
 *
 * ⚠ TODOS OS RAMOS DA TELA SÃO ALCANÇÁVEIS: passado confirmado (preto) · mês corrente com
 * compromisso · futuro previsto · **Resultado NEGATIVO** · mês sem nada (traço) · a coluna Folha ·
 * a guia vencida e a que vence em 5 dias · o que não tem mês · o prazo NÃO configurado · a empresa
 * sem apuração. Este projeto foi mordido oito vezes por ramo que só existia em produção.
 */

/** ⚠ A empresa do fluxo MAGRO — é a única forma de alcançar `semImposto` e `recorrenciaIndisponivel`. */
const EMPRESA_SEM_APURACAO = "pc-006";

/** ⚠ `SPEC-fluxo-de-caixa-v3.md` §3.1 — a janela padrão. Espelha `MESES_PASSADOS_NA_JANELA`. */
const MESES_PASSADOS = 4;
const HORIZONTE = 12;

/**
 * ⚠ O limite da navegação para trás, offline. Ele existe para o ramo `podeVoltar: false` ser
 * alcançável sem backend — sem ele a seta ‹ nunca desabilitaria na tela de demonstração, e o
 * desenho do limite só apareceria em produção.
 */
const MESES_DE_HISTORICO = 8;

const FRASE_SERIE_SEM_DIA = "A recorrência diz de quanto em quanto tempo, não em que dia do mês.";

function somarMeses(competencia, n) {
  const [a, m] = String(competencia).split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

const mesesDe = (c) => {
  const [a, m] = String(c).split("-").map(Number);
  return a * 12 + (m - 1);
};

/**
 * ⚠⚠ O PASSADO — e ele é feito SÓ de fato, por construção.
 *
 * Entrada vem da nota de competência fechada (`FATO` pela simplificação declarada do §7.1: assume-se
 * que 100% do faturado foi recebido, e a marca viaja em `base.simplificacao`); Impostos vêm da guia
 * PAGA; Folha vem do lançamento.
 *
 * ⚠ **A coluna Saída fica VAZIA no passado, e isso é a verdade do dado — não um esquecimento.** A
 * única fonte de saída que não é imposto nem folha é a série recorrente, e ela projeta do mês
 * corrente para a FRENTE. Despesa avulsa passada não chega a este portal: quem lança é o escritório.
 */
function linhasDoPassado(ciclo) {
  const linhas = [];
  const valores = [18500, 19200, 20400, 19800];
  for (let k = MESES_PASSADOS; k >= 1; k -= 1) {
    const comp = somarMeses(ciclo, -k);
    const receita = valores[MESES_PASSADOS - k];
    linhas.push({
      fonte: "NOTA_EMITIDA", direcao: "ENTRADA", procedencia: "FATO", competencia: comp,
      // ⚠⚠ **DIA 1, E NÃO "no mês" — decisão do dono, 29/08/2026**: *"todo dia 1 deve ter o valor de
      // faturamento do mês anterior, ou seja, no dia primeiro temos as entradas"*. As três linhas de
      // `NOTA_EMITIDA` deste mock diziam `dia: null` com o motivo `projecao_por_mes` e a frase
      // *"prazo de 1 mês (padrão — ninguém configurou o prazo desta empresa)"* — **as duas coisas
      // ficaram falsas** quando `FluxoDeCaixaService` parou de ler `PortalClient.prazoRecebimentoMeses`
      // e passou a cravar o dia 1. Mock que descreve a regra revogada esconde o ramo novo offline.
      // ⚠ A regra "dia ausente nunca vira dia inventado" **continua valendo para todas as outras
      // fontes** (recorrência, imposto previsto, folha): elas seguem em "no mês", aqui e no servidor.
      dia: 1,
      diaDesconhecido: null,
      valor: receita, rotulo: "Recebimento — CLINICA LAIF LTDA",
      base: {
        frase: `nota nº 1.2${k}0, emitida em ${somarMeses(comp, -1)}`,
        documental: true,
        // ⚠⚠ A SUPOSIÇÃO VIAJA MARCADA. Sem ela, "confirmado" seria indistinguível de um
        // recebimento provado — e `PortalInvoice` não tem `recebidoEm`.
        // ⚠ O que promove esta linha a FATO é a APURAÇÃO da competência da nota (dono: *"a apuração
        // quer dizer que o dinheiro entrou"*), e a prova é o índice da RFB — nunca a afirmação do
        // contador. Por isso `apuracaoProvada` viaja junto, e o mês passado a tem.
        simplificacao: "recebimento_presumido_pela_apuracao",
        apuracaoProvada: true,
      },
      referencia: { tipo: "nota", id: `n-p${k}` },
    });
    // ⚠ A guia PAGA — o único imposto que é FATO. Ela cai no mês do PAGAMENTO.
    linhas.push({
      fonte: "GUIA", direcao: "SAIDA", procedencia: "FATO", competencia: comp, dia: 20,
      diaDesconhecido: null, valor: Math.round(receita * 0.0865 * 100) / 100, rotulo: "SIMPLES",
      base: { frase: "SIMPLES paga", pagaEm: comp },
      referencia: { tipo: "guia", id: `g-p${k}` },
    });
    linhas.push(linhaDeFolha(comp, 2480, "FATO"));
  }
  return linhas;
}

/** ⚠ A folha: fonte PRÓPRIA, e coluna própria no v3 §3.2. Ela não é uma `SERIE_DESPESA`. */
function linhaDeFolha(competencia, valor, procedencia) {
  return {
    fonte: "FOLHA", direcao: "SAIDA", procedencia, competencia, dia: null,
    diaDesconhecido: {
      motivo: "folha_sem_dia",
      frase: "A folha é lançada por competência, e a data do pagamento não está no lançamento.",
    },
    valor, rotulo: "Folha de pagamento",
    base: {
      frase: `1 lançamento(s) de folha na competência ${competencia}`,
      lancamentos: 1,
      // ⚠ Só o passado carrega a suposição; o mês corrente ainda está aberto.
      simplificacao: procedencia === "FATO" ? "pagamento_integral_presumido" : null,
    },
  };
}

function linhasDoPresenteEDoFuturo(ciclo) {
  const mes = (n) => somarMeses(ciclo, n);
  return [
    /**
     * ⚠⚠ A GUIA EM ABERTO — `COMPROMISSO`, e no MÊS CORRENTE.
     *
     * O vencimento dela caiu no mês corrente, então ela mantém o DIA. É o caso em que o dia vale.
     */
    {
      fonte: "GUIA", direcao: "SAIDA", procedencia: "COMPROMISSO", competencia: mes(0), dia: 20,
      diaDesconhecido: null, valor: 1847.55, rotulo: "SIMPLES",
      base: {
        frase: `SIMPLES gerada, competência ${mes(-1)} · vence em ${mes(0)}-20`,
        vencimento: `${mes(0)}-20`, atrasada: true,
      },
      referencia: { tipo: "guia", id: "g-1" },
    },
    /**
     * ⚠⚠ A GUIA VENCIDA DE MÊS PASSADO — ela sai do mês CORRENTE, e o DIA dela não vale mais.
     *
     * É o ramo que a Lei 1 criou: apontar para o dia 20 de um mês que já passou diria que o dinheiro
     * sai numa data que ficou para trás.
     */
    {
      fonte: "GUIA", direcao: "SAIDA", procedencia: "COMPROMISSO", competencia: mes(0), dia: null,
      diaDesconhecido: {
        motivo: "compromisso_em_atraso",
        frase: "Esta guia venceu em outro mês e continua em aberto — o dinheiro sai do mês corrente.",
      },
      valor: 3422, rotulo: "INSS",
      base: {
        frase: `INSS gerada, competência ${mes(-2)} · vence em ${mes(-1)}-20`,
        vencimento: `${mes(-1)}-20`, atrasada: true,
      },
      referencia: { tipo: "guia", id: "g-2" },
    },
    // ⚠ A folha do mês corrente é COMPROMISSO: o mês está aberto e ela ainda pode mudar.
    linhaDeFolha(mes(0), 2480, "COMPROMISSO"),
    /**
     * ⚠⚠ A ENTRADA DO MÊS CORRENTE — e ela é CONFIRMADA (errata §7.1: nota de competência anterior
     * ao mês corrente vira Entrada confirmada no mês seguinte).
     *
     * ⚠ É ela que faz o mês corrente ter **mistura** de preto e âmbar na mesma linha — o critério
     * de aceite nº 4 do v3 exige que exista pelo menos um mês assim, e sem esta linha ele só
     * apareceria em produção.
     */
    {
      fonte: "NOTA_EMITIDA", direcao: "ENTRADA", procedencia: "FATO", competencia: mes(0),
      dia: 1,
      diaDesconhecido: null,
      valor: 21350, rotulo: "Recebimento — CLINICA LAIF LTDA",
      base: {
        frase: `nota nº 1.288, emitida em ${mes(-1)}`,
        documental: true,
        simplificacao: "recebimento_presumido_pela_apuracao",
        apuracaoProvada: true,
      },
      referencia: { tipo: "nota", id: "n-0" },
    },
    // ⚠⚠ PREVISÃO por MÊS: a nota prova o FATURAMENTO, nunca o RECEBIMENTO — e o dia não existe.
    {
      fonte: "NOTA_EMITIDA", direcao: "ENTRADA", procedencia: "PREVISAO", competencia: mes(1),
      dia: 1,
      diaDesconhecido: null,
      valor: 12500, rotulo: "Recebimento — CLINICA LAIF LTDA",
      base: {
        // ⚠⚠ ESTA É A LINHA QUE MANTÉM OS DOIS RAMOS ALCANÇÁVEIS OFFLINE: a nota é do mês CORRENTE,
        // que ainda não foi apurado — então ela continua PREVISÃO, sem `simplificacao` e com
        // `apuracaoProvada: false`. É o contraponto das duas de cima. Sem ele, o mock diria que
        // toda entrada é fato, e o ramo em que a apuração AINDA NÃO promoveu a linha só existiria
        // em produção — a quinta vez que este mock esconderia um ramo.
        frase: `nota nº 1.234, emitida em ${mes(0)}`,
        documental: true, simplificacao: null, apuracaoProvada: false,
      },
      referencia: { tipo: "nota", id: "n-1" },
    },
    // ⚠⚠ A FAIXA mín/máx — a mediana sozinha erraria por um terço rotineiramente.
    {
      fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(1),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 130, rotulo: "ANTHROPIC PBC",
      base: {
        frase: "recorrência marcada · MENSAL", n: 3, min: 120, max: 140, cv: 0.0769,
        origem: "DETECTADA", valorDeclarado: null, valorObservado: 130,
      },
      referencia: { tipo: "serie", id: "s-1" },
    },
    // ⚠⚠ O CONFRONTO: o cliente declarou R$ 1.000 e apareceu R$ 1.180 — "o observado vence" (dono).
    {
      fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(1),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 1180, rotulo: "Jantar com clientes",
      base: {
        frase: "recorrência marcada · MENSAL", n: 3, min: 900, max: 1400, cv: 0.21,
        origem: "DECLARADA", valorDeclarado: 1000, valorObservado: 1180,
      },
      referencia: { tipo: "serie", id: "s-4" },
    },
    // ⚠ RECEITA recorrente com valor CONSTANTE — a tela não inventa "entre X e Y".
    {
      fonte: "SERIE_RECEITA", direcao: "ENTRADA", procedencia: "PREVISAO", competencia: mes(2),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 8000, rotulo: "CLINICA LAIF LTDA",
      base: {
        frase: "recorrência marcada · MENSAL", n: 5, min: 8000, max: 8000, cv: 0,
        origem: "DETECTADA", valorDeclarado: null, valorObservado: 8000,
      },
      referencia: { tipo: "serie", id: "s-2" },
    },
    // ⚠⚠ "Imposto PREVISTO", nunca "imposto calculado" — e a frase da alíquota é OBRIGATÓRIA.
    {
      fonte: "IMPOSTO_PROJETADO", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(2),
      dia: null,
      diaDesconhecido: {
        motivo: "imposto_segue_a_receita",
        frase: "O imposto projetado acompanha o mês da receita que o gerou.",
      },
      valor: 883.2, rotulo: "Imposto previsto sobre a receita prevista",
      base: {
        frase: `com base na alíquota de ${mes(-2)} (declaração transmitida)`,
        aliquota: 0.1104, competenciaDaAliquota: mes(-2),
        procedenciaDaAliquota: "TRANSMITIDA", receitaPrevista: 8000,
      },
      referencia: null,
    },
    /**
     * ⚠⚠ O MÊS DE RESULTADO NEGATIVO — despesa grande sem entrada nenhuma no mesmo mês.
     *
     * Sem ele a tela nunca mostraria o vermelho do Resultado negativo offline, e o desenho de um
     * mês ruim só apareceria na frente de um cliente com um mês ruim.
     */
    {
      fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(3),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 6400, rotulo: "SEGURO ANUAL DA FROTA",
      base: {
        frase: "recorrência marcada · ANUAL", n: 2, min: 6100, max: 6400, cv: 0.03,
        origem: "DECLARADA", valorDeclarado: 6400, valorObservado: null,
      },
      referencia: { tipo: "serie", id: "s-6" },
    },
    // ⚠ Uma linha no fim da janela: sem ela os últimos meses nasceriam todos vazios e o desenho de
    // "mês distante com algo" não existiria offline.
    {
      fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(6),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 890, rotulo: "COPIADORA SAO JORGE LTDA",
      base: {
        frase: "recorrência marcada · MENSAL", n: 6, min: 850, max: 920, cv: 0.03,
        origem: "DETECTADA", valorDeclarado: null, valorObservado: 890,
      },
      referencia: { tipo: "serie", id: "s-5" },
    },
  ];
}

/**
 * @param {string} companyId
 * @param {string} competencia o mês CORRENTE — o "hoje"
 * @param {{janelaInicio?: string, cientes?: Iterable<string>}} opcoes
 */
export function fluxoDeCaixaDoMock(companyId, competencia, opcoes = {}) {
  const ciclo = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(competencia || "")) ? String(competencia) : "2026-08";
  const magro = companyId === EMPRESA_SEM_APURACAO;
  const linhas = magro ? [] : [...linhasDoPassado(ciclo), ...linhasDoPresenteEDoFuturo(ciclo)];

  /**
   * ⚠⚠ A JANELA E O "HOJE" SÃO DUAS COISAS — e o mock precisa honrar as duas, senão as setas ‹ ›
   * não podem ser exercidas offline e o limite só apareceria em produção.
   */
  const padrao = mesesDe(ciclo) - MESES_PASSADOS;
  const minimo = mesesDe(ciclo) - MESES_DE_HISTORICO;
  const pedido = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(opcoes.janelaInicio || ""))
    ? mesesDe(opcoes.janelaInicio)
    : padrao;
  const inicioEmMeses = Math.max(minimo, Math.min(pedido, padrao));
  const inicio = somarMeses(ciclo, inicioEmMeses - mesesDe(ciclo));

  // ⚠ Os 12 meses nascem TODOS, inclusive os vazios: mês sem linha é resposta, não ausência.
  const meses = Array.from({ length: HORIZONTE }).map((_, k) => {
    const comp = somarMeses(inicio, k);
    const doMes = linhas.filter((l) => l.competencia === comp);
    const soma = (proc, dir) => doMes
      .filter((l) => l.procedencia === proc && l.direcao === dir)
      .reduce((s, l) => s + (Number(l.valor) || 0), 0);
    return {
      competencia: comp,
      linhas: doMes,
      // ⚠⚠ SEM A CHAVE `total`, aqui também. `compromisso` é a chave NOVA da Lei 1.
      totais: {
        fato: { entrada: soma("FATO", "ENTRADA"), saida: soma("FATO", "SAIDA") },
        compromisso: { entrada: soma("COMPROMISSO", "ENTRADA"), saida: soma("COMPROMISSO", "SAIDA") },
        previsao: { entrada: soma("PREVISAO", "ENTRADA"), saida: soma("PREVISAO", "SAIDA") },
        desconhecido: { quantas: 0 },
      },
    };
  });

  /** ⚠ As mesmas guias em aberto do payload, na forma que o pop-up consome. */
  const emAberto = magro ? [] : [
    {
      id: "g-2", rotulo: "INSS", valor: 3422, vencimento: `${somarMeses(ciclo, -1)}-20`,
      atrasada: true, competencia: somarMeses(ciclo, -2), estado: "overdue",
    },
    {
      id: "g-1", rotulo: "SIMPLES", valor: 1847.55, vencimento: `${ciclo}-20`,
      atrasada: true, competencia: somarMeses(ciclo, -1), estado: "overdue",
    },
    // ⚠ A que AINDA VAI VENCER — sem ela o estado `due_soon` (âmbar, não vermelho) só existiria em
    // produção, e o pop-up ofereceria um único desenho.
    {
      id: "g-3", rotulo: "FGTS", valor: 640.18, vencimento: `${somarMeses(ciclo, 1)}-01`,
      atrasada: false, competencia: somarMeses(ciclo, -1), estado: "due_soon",
    },
  ];

  const cientes = new Set(opcoes.cientes || []);
  const itens = emAberto;

  return {
    // ⚠⚠ É ESTE CAMPO que apaga o selo, e ele espelha o do servidor.
    demonstracao: false,
    cicloAtual: ciclo,
    horizonte: HORIZONTE,
    meses,
    /** ⚠ Os limites viajam para a tela DESABILITAR a seta — botão que não responde parece defeito. */
    janela: {
      inicio,
      podeVoltar: inicioEmMeses > minimo,
      podeAvancar: inicioEmMeses < padrao,
      padrao: somarMeses(ciclo, -MESES_PASSADOS),
      horizonte: HORIZONTE,
    },
    // ⚠⚠ NADA SOME EM SILÊNCIO: o que não coube em mês nenhum sai NOMEADO, com o conserto.
    semMes: magro ? [] : [
      {
        motivo: "guia_sem_vencimento",
        frase: "Esta guia está em aberto e não tem data de vencimento gravada, então não dá para "
          + "dizer em que mês o dinheiro sai. Recapture a guia para trazer o vencimento.",
        rotulo: "SIMPLES", valor: 1233.9, referencia: { tipo: "guia", id: "g-9" },
      },
    ],
    // ⚠⚠ A GUIA VENCIDA — lista de CONFERÊNCIA. Ela NÃO se soma ao mês corrente: é a mesma guia.
    vencidas: {
      quantas: itens.filter((g) => g.atrasada).length,
      valor: itens.filter((g) => g.atrasada).reduce((s, g) => s + g.valor, 0),
      linhas: itens.filter((g) => g.atrasada),
    },
    /**
     * ⚠⚠ O QUE ALIMENTA O POP-UP. `ackPending` é calculado contra as ciências já dadas — offline
     * elas vivem em memória, e é isso que faz o "Estou ciente" poder ser exercido sem backend.
     */
    alertaDeGuias: {
      diasDeAntecedencia: 5,
      itens,
      valor: itens.reduce((s, g) => s + g.valor, 0),
      ackPending: itens.some((g) => !cientes.has(g.id)),
    },
    foraDoHorizonte: magro ? 0 : 1,
    /*
     * ⚠⚠ `prazoRecebimento` SAIU DAQUI EM 29/08/2026, junto com a ressalva que ele alimentava.
     *
     * Ele era `magro ? {meses:2, configurado:true} : {meses:1, configurado:false}` — os dois ramos
     * de propósito, porque *"ninguém configurou"* ≠ *"configurado como 1"*. O servidor parou de
     * mandar o campo quando a entrada passou a cair no **dia 1 do mês seguinte**, sempre; mantê-lo
     * aqui faria o modo offline acender uma ressalva que produção nunca mais acende — a divergência
     * mock × real que este projeto já pagou várias vezes.
     */
    /** ⚠ Sem folha lançada a COLUNA não existe — e é o servidor que decide, não a tela. */
    folha: magro
      ? { disponivel: false, contasConsideradas: [] }
      : { disponivel: true, contasConsideradas: ["41101"] },
    // ⚠⚠ A ausência do imposto previsto é NOMEADA — nunca uma linha que simplesmente não aparece.
    semImposto: magro
      ? {
        motivo: "sem_apuracao",
        frase: "Não há apuração com receita e DAS para medir a alíquota efetiva, então o imposto "
          + "sobre a receita prevista não é projetado. Um número aqui sairia de uma alíquota que "
          + "ninguém mediu.",
      }
      : null,
    aliquotaUsada: magro ? null : {
      valor: 0.1104, competencia: somarMeses(ciclo, -2), procedencia: "TRANSMITIDA",
      frase: `com base na alíquota de ${somarMeses(ciclo, -2)} (declaração transmitida)`,
    },
    // ⚠⚠ "não pudemos ler" ≠ "esta empresa não tem nada que se repete".
    recorrenciaIndisponivel: magro,
    notas: { canceladas: magro ? 0 : 1 },
  };
}
