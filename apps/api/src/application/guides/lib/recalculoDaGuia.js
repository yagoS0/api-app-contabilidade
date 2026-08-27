// RECALCULAR UMA GUIA — quem pode, qual serviço do SERPRO, e o que se diz ANTES do clique.
//
// ⚠⚠ ESTAS REGRAS SAÍRAM DE `GuidePaymentStatusService.js` EM 27/08/2026, sem mudar comportamento.
// Elas sempre foram puras; o arquivo é que carrega o Prisma no topo, e por isso nenhuma delas
// tinha teste — inclusive `isGuideOverdue`, que decide se o SERPRO recebe `GERARDASCOBRANCA17` (DAS
// de cobrança, COM juros e multa) ou `GERARDAS12`. `GuidePaymentStatusService` as reexporta, então
// os cinco importadores continuam funcionando sem uma linha de mudança.
//
// ⚠⚠ O QUE MUDA DE VERDADE AQUI: recalcular guia VENCIDA gera uma guia NOVA, com acréscimos. Até
// hoje a tela não sabia o que era "vencida" — zero ocorrências de `OVERDUE` fora de um mapa de
// rótulo — e o contador clicava sem saber que ia receber outro valor. Com o CLIENTE também podendo
// disparar (cada clique é uma chamada PAGA, contra o teto do escritório inteiro), isso deixa de ser
// detalhe.

function normalizar(valor) {
  return String(valor || "").trim().toUpperCase();
}

/**
 * ⚠⚠ O VENCIMENTO PODE SER DERIVADO, E ISSO PRECISA APARECER.
 *
 * Sem `Guide.vencimento` gravado, a regra assume o **dia 20 do mês seguinte** à competência. Esse
 * número é uma suposição sobre um prazo real — e é ele que decide qual serviço do SERPRO é chamado.
 * A derivação é o comportamento de sempre e NÃO foi mexida; o que passou a existir é a marca
 * `derivado`, para a tela nunca dizer "venceu em 20/07" sobre uma data que ninguém registrou.
 */
export function vencimentoDaGuia(guide, now = new Date()) {
  if (guide?.vencimento) return { data: new Date(guide.vencimento), derivado: false };
  const competencia = String(guide?.competencia || "").trim();
  const m = competencia.match(/^(\d{4})-(\d{2})$/);
  if (!m) return { data: null, derivado: false };
  const ano = Number(m[1]);
  const mes = Number(m[2]) - 1;
  if (!Number.isInteger(ano) || !Number.isInteger(mes)) return { data: null, derivado: false };
  return {
    data: new Date(Date.UTC(ano, mes + 1, 20, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds())),
    derivado: true,
  };
}

/** ⚠ Assinatura preservada: devolve `Date|null`, exatamente como antes. */
export function getGuideDueDate(guide, now = new Date()) {
  return vencimentoDaGuia(guide, now).data;
}

export function isGuidePaid(guide) {
  return normalizar(guide?.paymentStatus) === "PAID";
}

export function isGuideOverdue(guide, now = new Date()) {
  if (normalizar(guide?.paymentStatus) === "OVERDUE") return true;
  const { data } = vencimentoDaGuia(guide, now);
  if (!data) return false;
  return data.getTime() < now.getTime();
}

export function canGuideConfirmPayment(guide) {
  return !isGuidePaid(guide);
}

/**
 * ⚠⚠ QUAIS GUIAS SE RECALCULAM — e a lista é de INCLUSÃO, fechada.
 *
 * Até 27/08/2026 era só o DAS (`source SERPRO` + `tipo SIMPLES`). A **DARF consolidada do Lucro
 * Presumido** entrou por decisão do dono: ela é `tipo: "OUTRA"` com `source: "SERPRO"`, emitida pelo
 * `GERARGUIA31`.
 *
 * ⚠⚠ MAS `tipo: "OUTRA"` + SERPRO NÃO IDENTIFICA A DARF DO LP: a guia de INSS/DCTFWeb é as duas
 * coisas também. O que identifica é o `sourceFileId`, escrito num lugar só
 * (`LucroPresumidoProvisaoService`). Aceitar por tipo mandaria a guia de INSS para o serviço errado.
 *
 * ⚠⚠ GUIA DE PARCELAMENTO PASSOU A SER RECUSADA NO SERVIDOR, e isto É uma mudança de payload —
 * `canRecalculate` era `true` para uma parcela (ela é `tipo: "SIMPLES"`, `source: "SERPRO"`, não
 * paga) e passa a ser `false`. **Não muda nada na tela do contador**: `renderCompanyGuidesTable`
 * já desabilita o botão para parcela incondicionalmente (`if (ehParcela) recalcDisabled = true`),
 * com o motivo no `title` — *"Recalcular emite o DAS do MÊS, que é outro documento"*. Ou seja, a
 * política é a que já existia; o que mudou é ONDE ela é aplicada.
 *
 * ⚠ E o motivo de movê-la para cá agora: a rota passa a ser alcançável pelo PORTAL DO CLIENTE. Uma
 * regra que só mora na tela do escritório não protege a porta nova — nem um `curl`. Medido: nenhum
 * teste do backend dependia do valor antigo.
 *
 * ⚠ Guia PAGA nunca se recalcula.
 */
export const PREFIXO_DARF_LP = "serpro:dctfweb:lp:";

export const ESPECIE_RECALCULO = Object.freeze({
  DAS_SIMPLES: "DAS_SIMPLES",
  DARF_PRESUMIDO: "DARF_PRESUMIDO",
});

export function especieDoRecalculo(guide) {
  if (normalizar(guide?.source) !== "SERPRO") return null;
  // ⚠ Parcela antes de tudo: ela é `tipo: "SIMPLES"` e passaria pela regra do DAS.
  if (guide?.parcelamentoId) return null;
  if (normalizar(guide?.tipo) === "SIMPLES") return ESPECIE_RECALCULO.DAS_SIMPLES;
  if (String(guide?.sourceFileId || "").startsWith(PREFIXO_DARF_LP)) return ESPECIE_RECALCULO.DARF_PRESUMIDO;
  return null;
}

export function canGuideRecalculate(guide) {
  if (isGuidePaid(guide)) return false;
  return especieDoRecalculo(guide) !== null;
}

/**
 * ⚠⚠ O AVISO QUE VAI ANTES DO CLIQUE — nos DOIS portais, e a frase é a mesma.
 *
 * Recalcular guia vencida não "atualiza" a guia: ela **gera outra**, com juros e multa. Quem clica
 * precisa saber disso ANTES, não ao ver o valor novo.
 *
 * ⚠ E o texto distingue as três coisas que a tela não pode confundir:
 *   · guia EM ABERTO ⇒ recalcular devolve o mesmo tipo de guia, sem acréscimos esperados;
 *   · guia VENCIDA com vencimento GRAVADO ⇒ a data é dita;
 *   · guia VENCIDA com vencimento DERIVADO ⇒ a data é dita **como derivada**. Afirmar "venceu em
 *     20/07" sobre uma data que ninguém registrou é inventar prazo fiscal.
 *
 * @param {{guide: object, now?: Date, ehCliente?: boolean}} p
 */
export function avisoDeRecalculo({ guide, now = new Date(), ehCliente = false } = {}) {
  const especie = especieDoRecalculo(guide);
  if (!especie || isGuidePaid(guide)) return null;

  const vencida = isGuideOverdue(guide, now);
  const { data, derivado } = vencimentoDaGuia(guide, now);
  const dataTexto = data ? data.toISOString().slice(0, 10).split("-").reverse().join("/") : null;

  const custo = ehCliente
    // ⚠ O CLIENTE NÃO VÊ ORÇAMENTO DO ESCRITÓRIO. Ele precisa saber que o pedido tem custo e não é
    // instantâneo — o teto mensal, o valor e o consumo são assunto interno.
    ? "O pedido é feito ao sistema da Receita e pode demorar alguns segundos."
    : "⚠ Cada recálculo é uma chamada PAGA ao SERPRO, contra o teto mensal do escritório.";

  if (!vencida) {
    return {
      vencida: false,
      especie,
      titulo: "Gerar a guia de novo",
      texto: `Esta guia ainda não venceu${dataTexto ? ` (vence em ${dataTexto}${derivado ? ", data estimada" : ""})` : ""}. `
        + "O recálculo pede uma guia nova à Receita com os mesmos valores. " + custo,
      tom: "neutro",
    };
  }

  return {
    vencida: true,
    especie,
    titulo: "Esta guia está vencida",
    texto: (dataTexto
      ? derivado
        // ⚠ "Estimado" fica ANTES da data, não numa nota de rodapé: quem lê rápido lê o começo.
        ? `O vencimento não está gravado nesta guia; pela competência, ele seria por volta de ${dataTexto} — data ESTIMADA, confira no documento. `
        : `Ela venceu em ${dataTexto}. `
      : "")
      + "Recalcular NÃO atualiza esta guia: a Receita gera uma guia NOVA, com juros e multa, e o "
      + "valor a pagar será maior. " + custo,
    // ⚠ Âmbar, nunca vermelho: nesta casa vermelho BLOQUEIA, e isto não bloqueia nada — informa.
    tom: "atencao",
  };
}

/**
 * ⚠⚠ OS ACRÉSCIMOS VIERAM? — TRÊS respostas, e a terceira é a que impede a mentira.
 *
 * O PGDAS-D tem serviço próprio para a guia vencida (`GERARDASCOBRANCA17`). A DCTFWeb, até onde este
 * repositório sabe, tem **um só** (`GERARGUIA31`) — e **NÃO ESTÁ CONFIRMADO que ele devolva a DARF
 * com acréscimos quando ela está vencida**. Pela regra 1 isto não se supõe.
 *
 * O que se pode fazer é OLHAR: `emitirDarfDctfweb` devolve `composicao.itens` com
 * `{codigo, principal, multa, juros, total}` lidos do texto do DARF. Então:
 *
 *   · multa ou juros > 0 ............ vieram. Afirmação apoiada em dado.
 *   · itens lidos, todos zerados .... NÃO vieram. Também é afirmação apoiada em dado.
 *   · nenhum item legível ........... ⚠ NÃO SE SABE. E "não sei" nunca vira "sem acréscimos":
 *                                     a composição sai de uma heurística sobre o texto do PDF, e
 *                                     falha de leitura não é prova de ausência de juros.
 */
export const ACRESCIMOS = Object.freeze({
  PRESENTES: "presentes",
  AUSENTES: "ausentes",
  NAO_LEGIVEIS: "nao_legiveis",
});

/**
 * ⚠⚠ O TEXTO MUDA COM O PÚBLICO, e isto foi ACHADO NO NAVEGADOR (27/08/2026), não pelo teste.
 *
 * A frase saía *"confira no documento antes de ENVIAR AO CLIENTE"* — e ela apareceu na tela DO
 * cliente, que não vai enviar nada a cliente nenhum. Uma instrução dirigida a outra pessoa não é só
 * estranha: ela faz quem lê achar que o aviso não é para ele, e este aviso é justamente o que
 * impede alguém de pagar uma guia a menor.
 *
 * ⚠ `ehCliente` defaulta para `false` de propósito: os chamadores antigos são todos do escritório.
 */
export function leituraDosAcrescimos(composicao, { ehCliente = false } = {}) {
  const confira = ehCliente ? "Confira no documento antes de pagar." : "Confira no documento antes de enviar ao cliente.";
  const itens = Array.isArray(composicao?.itens) ? composicao.itens : [];
  if (!itens.length) {
    return {
      estado: ACRESCIMOS.NAO_LEGIVEIS,
      multa: null,
      juros: null,
      texto: "Não foi possível ler a composição do documento para conferir juros e multa. "
        + "Isto NÃO quer dizer que a guia veio sem acréscimos — quer dizer que não deu para "
        + `conferir aqui. ${confira}`,
      tom: "atencao",
    };
  }
  const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const multa = itens.reduce((s, i) => s + numero(i?.multa), 0);
  const juros = itens.reduce((s, i) => s + numero(i?.juros), 0);
  if (multa > 0 || juros > 0) {
    return {
      estado: ACRESCIMOS.PRESENTES,
      multa: arredondar(multa),
      juros: arredondar(juros),
      texto: "A guia nova veio com juros e multa.",
      tom: "neutro",
    };
  }
  return {
    estado: ACRESCIMOS.AUSENTES,
    multa: 0,
    juros: 0,
    // ⚠⚠ ESTA É A FALHA VISÍVEL. Se o serviço não souber gerar a guia vencida, quem clicou recebe
    // uma guia sem acréscimos e a apresentaríamos como "recalculada" — pagaria a menor e ficaria
    // devendo a diferença sem saber. A tela diz o que se viu, e manda conferir.
    texto: "A guia nova veio SEM juros e multa. Numa guia vencida isso pode significar que este "
      + `serviço da Receita não gera a versão com acréscimos. ${confira}`,
    tom: "atencao",
  };
}

function arredondar(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * ⚠⚠ A RECUSA QUE CHEGA AO CLIENTE — e ela é uma LISTA FECHADA, nunca o eco do erro.
 *
 * As três recusas da guarda de orçamento (`SerproCallGuard`) carregam, na própria mensagem, o
 * consumo do escritório, o teto e a conta que o deriva:
 *
 *   "O escritório já consumiu 412 consultas pagas ao SERPRO neste mês (teto 500, = 34 empresas × …)"
 *
 * Repassar `err.message` ao portal do cliente publicaria o orçamento interno do escritório na tela
 * de um cliente — e o mesmo vale para os erros do próprio serviço, que carregam idServiço, CNPJ do
 * procurador e nomes de configuração.
 *
 * ⚠ POR ISSO A TRADUÇÃO FALHA FECHADO: código que não estiver na lista cai na frase genérica. Um
 * código NOVO do SERPRO nasce traduzido como "não deu, fale com o contador" em vez de vazar.
 *
 * ⚠ E ela devolve `podeTentarDeNovo`, porque as duas coisas são diferentes para quem está na tela:
 * repetição em pouco tempo passa sozinha; teto estourado só o escritório resolve.
 */
const RECUSA_PARA_CLIENTE = Object.freeze({
  SERPRO_CHAMADA_REPETIDA: {
    mensagem: "Esta guia foi pedida à Receita há pouco. Aguarde alguns minutos e tente de novo.",
    podeTentarDeNovo: true,
  },
  SERPRO_TETO_DIARIO: {
    mensagem: "Não foi possível recalcular agora. Fale com o seu contador.",
    podeTentarDeNovo: false,
  },
  SERPRO_TETO_MENSAL_ESCRITORIO: {
    mensagem: "Não foi possível recalcular agora. Fale com o seu contador.",
    podeTentarDeNovo: false,
  },
});

const RECUSA_GENERICA = Object.freeze({
  mensagem: "Não foi possível gerar a guia atualizada agora. Tente mais tarde ou fale com o seu contador.",
  podeTentarDeNovo: true,
});

export function traduzirRecusaParaCliente(err) {
  const conhecida = RECUSA_PARA_CLIENTE[String(err?.code || "")];
  return {
    // ⚠ O CÓDIGO viaja (a tela pode querer distinguir os casos); a MENSAGEM ORIGINAL, nunca.
    codigo: String(err?.code || "RECALCULO_FALHOU"),
    ...(conhecida || RECUSA_GENERICA),
  };
}
