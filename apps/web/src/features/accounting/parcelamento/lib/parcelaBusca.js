// Regra de TELA da busca de pagamento da parcela — quem pode ser buscada, e o que a resposta quer
// dizer. Mora em `lib/` com teste próprio (convenção do módulo: o teste de componente cobre só a
// ligação, não a regra de novo).
//
// ⚠ AUSÊNCIA NUNCA É RESPOSTA. Cada caminho aqui devolve um TEXTO — nenhum devolve `null` para o
// componente inventar o que dizer. Esta busca é clicada contra o SERPRO real, é PAGA, e todo
// caminho de recusa precisa chegar à tela com o motivo.
//
// ⚠ "NÃO LOCALIZADO" NÃO É ERRO. Quer dizer "a Receita ainda não tem comprovante desse documento" —
// desfecho normal de uma parcela que vence semana que vem. Achatá-lo num vermelho de falha ensina o
// contador a ignorar o vermelho justamente onde ele significa que a chamada quebrou.

/**
 * As prestações do acordo, como LINHAS de tela.
 *
 * ⚠ O CONTRATO E O FATO VÊM DE LUGARES DIFERENTES, e é por isso que há um join aqui.
 * `parcelasContratadas` diz quais prestações EXISTEM e quando vencem (F2.1 — existe para V1 e V2,
 * inclusive em débito automático, onde guia não existe por definição). `guides` diz o que
 * ACONTECEU com cada uma (valor, pagamento, número do documento). Listar só as guias esconderia as
 * prestações ainda não capturadas; listar só o contrato não teria o que buscar.
 */
export function montarParcelasDoAcordo(parc) {
  const guides = Array.isArray(parc?.guides) ? parc.guides : [];
  const porGuiaId = new Map(guides.map((g) => [g.id, g]));
  const contratadas = Array.isArray(parc?.parcelasContratadas) ? parc.parcelasContratadas : [];

  const linhas = contratadas.map((p) => {
    const g = p.guia ? (porGuiaId.get(p.guia.id) || p.guia) : null;
    if (g) porGuiaId.delete(g.id);
    return linhaDaParcela({
      parcelaId: p.id,
      numeroParcela: p.numeroParcela,
      vencimentoContratado: p.vencimento,
      competenciaContratada: p.competencia,
      valorPrevisto: p.valorPrevisto,
      origemBaixa: p.origemBaixa,
      guia: g,
      parc,
    });
  });

  // Guia que não casou com nenhuma prestação contratada continua aparecendo. Sumir com ela seria
  // esconder a única linha que tem documento para buscar — e é exatamente o caso de um acordo
  // antigo, criado antes da tabela de parcelas existir.
  for (const g of porGuiaId.values()) {
    linhas.push(linhaDaParcela({ parcelaId: null, numeroParcela: g.numeroParcela, vencimentoContratado: null, guia: g, parc }));
  }

  return linhas.sort((a, b) => (a.numeroParcela ?? 9999) - (b.numeroParcela ?? 9999));
}

function linhaDaParcela({
  parcelaId, numeroParcela, vencimentoContratado, competenciaContratada,
  valorPrevisto, origemBaixa, guia, parc,
}) {
  const valorDaGuia = guia?.valor != null ? Number(guia.valor) : null;
  const contratado = valorPrevisto != null && valorPrevisto !== "" ? Number(valorPrevisto) : null;
  return {
    key: parcelaId || guia?.id || `p-${numeroParcela}`,
    numeroParcela: numeroParcela ?? null,
    totalParcelas: parc?.numParcelas ?? null,
    // O vencimento REAL (da guia) quando existe; o CONTRATADO quando não — mesma precedência que
    // `quadroDasParcelas` usa no backend para decidir atraso.
    vencimento: guia?.vencimento || vencimentoContratado || null,
    competencia: guia?.competencia || guia?.anoMesParcela || competenciaContratada || null,
    // ⚠ VALOR DA GUIA E VALOR CONTRATADO SÃO FATOS DIFERENTES, e por isso viajam em campos
    // diferentes — quem decide qual mostrar é `valorDaLinha`, e ela DIZ de onde o número veio.
    // Antes só o da guia chegava aqui: num contrato migrado (60 prestações, nenhuma guia) a coluna
    // Valor mostrava "—" nas 60, com o card logo acima anunciando "VALOR DA PARCELA R$ 1.200,00".
    valor: valorDaGuia,
    valorPrevisto: Number.isFinite(contratado) ? contratado : null,
    // ⚠ `origemBaixa` É O PREDICADO DE QUITAÇÃO da prestação sem guia (F2.2/F2.3) — o mesmo que
    // `parcelaRowQuitada` usa no backend e que `cartaoParcelamento.contarHistoricas` já lê para o
    // card. Sem ele, as 22 prestações quitadas de um contrato migrado eram desenhadas idênticas às
    // 38 que nunca foram pagas.
    origemBaixa: origemBaixa ? String(origemBaixa).toUpperCase() : null,
    guideId: guia?.id || null,
    // ⚠ A FORMA DE PAGAMENTO É DO CONTRATO, e ela VIAJA NA LINHA porque é ela que decide se
    // "sem guia" é um estado transitório ou o estado definitivo desta prestação. Em débito
    // automático a guia não existe por definição — mandar esperar a captura do SERPRO seria
    // mandar esperar um documento que nunca vai chegar.
    formaPagamento: parc?.formaPagamento || null,
    numeroDocumento: guia?.numeroDocumento || null,
    paymentStatus: String(guia?.paymentStatus || "").toUpperCase() || null,
    baixada: Boolean(guia?.baixada),
    comprovante: guia?.comprovante || null,
    serproLastCheckedAt: guia?.serproLastCheckedAt || null,
    serproLastCheckResult: guia?.serproLastCheckResult || null,
  };
}

/**
 * ⚠ "SEM GUIA" NÃO QUER DIZER A MESMA COISA NOS TRÊS CONTRATOS, e a diferença é de trabalho, não
 * de redação.
 *
 * Em **débito automático** a prestação é debitada na conta e **não gera guia** — é o caso normal de
 * uma classe inteira de clientes (o dono: *"alguns parcelamentos, ainda mais no Lucro Presumido,
 * não vão ter parcelas pois são em débito automático"*). Dizer a esse contador que "a guia entra
 * pela captura do SERPRO ou por upload" é mandá-lo esperar um documento que **nunca vai chegar**, e
 * uma espera inútil é pior que nenhuma explicação.
 *
 * Em **guia mensal** a mesma frase é verdadeira: falta capturar.
 *
 * E `formaPagamento: null` é o **não declarado** — o default do backend, e o valor de todo contrato
 * criado antes de `139c4efe`. Aqui não se afirma nem uma coisa nem outra: o texto diz os dois
 * desfechos e o que separa um do outro, porque inventar qual é seria inventar o dado.
 */
function motivoSemGuia(formaPagamento) {
  if (formaPagamento === "DEBITO_AUTOMATICO") {
    return {
      rotulo: "débito automático — sem guia",
      motivo: "Este parcelamento é pago por débito automático: a prestação sai direto da conta e "
        + "não gera guia, então não existe documento para consultar no PAGTOWEB — e não vai "
        + "existir. O pagamento se comprova pelo extrato bancário, não por comprovante do SERPRO.",
    };
  }
  if (formaPagamento === "GUIA_MENSAL") {
    return {
      rotulo: "sem guia capturada",
      motivo: "Esta prestação ainda não tem guia capturada — não existe documento para consultar no "
        + "PAGTOWEB. A guia entra pela captura do SERPRO ou por upload na aba Guias.",
    };
  }
  return {
    rotulo: "sem guia capturada",
    motivo: "Esta prestação não tem guia capturada, então não há documento para consultar no "
      + "PAGTOWEB. A forma de pagamento deste parcelamento não foi declarada: se for débito "
      + "automático, guia não existe e não vai existir; se for guia mensal, ela entra pela captura "
      + "do SERPRO ou por upload na aba Guias.",
  };
}

/**
 * ⚠ O VOCABULÁRIO DE `parcelas.origemBaixa` MORA NO BACKEND — `ORIGENS_BAIXA_PARCELA`, em
 * `apps/api/src/application/accounting/ancoraBaixa.js`. Aqui ele é **cópia declarada**, pelo mesmo
 * motivo de `src/lib/vocabulario.js` e de `_derivarAnaliticaMock`: o `Dockerfile` não copia
 * `packages/` e cruzar apps quebra o boot. Quem acrescentar uma via de baixa lá acrescenta aqui.
 *
 * ⚠ AS TRÊS RESPOSTAS NÃO SÃO A MESMA COISA, e achatá-las foi o defeito:
 *   · `HISTORICO` — quitada ANTES de o contrato entrar no sistema (contrato migrado). Ela **não
 *     gera `AccountingEntry`**: é quitada, mas não há baixa nossa a mostrar nem a estornar;
 *   · `MANUAL` / `DEBITO_AUTOMATICO` — baixada de verdade, com lançamento, pela via da DECLARAÇÃO
 *     (o contador afirma) ou da PROVA (SERPRO, ainda não implementada);
 *   · `GUIA` — a via do documento; ali quem responde "foi quitada?" é a própria guia.
 */
const QUITACAO_SEM_GUIA = Object.freeze({
  HISTORICO: {
    situacao: "quitada (histórica)",
    detalhe: "quitada antes de o contrato entrar no sistema — sem lançamento contábil nosso",
    rotulo: "quitada (histórica)",
    motivo: "Esta prestação foi declarada como já paga na adesão do parcelamento (contrato migrado "
      + "de outra contabilidade). Ela está quitada e não há pagamento nosso a localizar — nem "
      + "lançamento contábil, porque o pagamento não passou por este escritório.",
  },
  MANUAL: {
    situacao: "baixada (declarada)",
    detalhe: "baixa lançada por declaração do contador, sem documento",
    rotulo: "baixa já lançada (declarada)",
    motivo: "Esta prestação já foi baixada por declaração (o contador afirmou que o débito saiu da "
      + "conta) e a baixa já está lançada. Não há o que consultar no PAGTOWEB.",
  },
  DEBITO_AUTOMATICO: {
    situacao: "baixada (débito automático)",
    detalhe: "baixa lançada com a prova do débito automático",
    rotulo: "baixa já lançada",
    motivo: "Esta prestação já foi baixada pela via do débito automático e a baixa já está lançada. "
      + "Não há o que consultar no PAGTOWEB.",
  },
  GUIA: {
    situacao: "baixada",
    detalhe: "baixa lançada a partir da guia",
    rotulo: "baixa já lançada",
    motivo: "Pagamento já localizado e baixa já lançada — não há o que consultar.",
  },
});

/** A leitura de `origemBaixa`, já com o fallback nomeado para uma via que ainda não conhecemos. */
function quitacaoDaLinha(linha) {
  const origem = linha?.origemBaixa ? String(linha.origemBaixa).toUpperCase() : null;
  if (!origem) return null;
  return QUITACAO_SEM_GUIA[origem] || {
    situacao: "quitada",
    detalhe: `quitada (origem "${origem}")`,
    rotulo: "quitada",
    motivo: `Esta prestação consta quitada (origem "${origem}") — não há pagamento a localizar. `
      + "Esta via de baixa é mais nova que esta tela; confira o razão para saber se ela gerou lançamento.",
  };
}

/**
 * A SITUAÇÃO da prestação na coluna do acordeão — e ela tem de concordar com o card logo acima.
 *
 * ⚠ ELA LIA SÓ A GUIA. Num contrato migrado o card dizia "22 de 60 (22 históricas)" e as 22
 * quitadas apareciam aqui como "sem guia", indistinguíveis das 38 que nunca foram pagas: duas
 * afirmações opostas sobre a mesma prestação, a 200px de distância.
 *
 * ⚠ QUITADA (HISTÓRICA) ≠ BAIXADA (DECLARADA). A histórica não tem lançamento contábil — dizer
 * "baixada" nela mandaria alguém procurar no razão uma baixa que não existe.
 */
export function situacaoDaLinha(linha) {
  const q = quitacaoDaLinha(linha);
  if (q) return { texto: q.situacao, detalhe: q.detalhe, cor: "var(--state-ok)" };
  if (linha?.baixada) return { texto: "baixada", detalhe: null, cor: "var(--state-ok)" };
  if (String(linha?.paymentStatus || "").toUpperCase() === "PAID") {
    return { texto: "paga · falta lançar", detalhe: null, cor: "var(--state-warn)" };
  }
  if (!linha?.guideId) return { texto: "sem guia", detalhe: null, cor: "var(--state-neutral)" };
  return { texto: "em aberto", detalhe: null, cor: "var(--state-neutral)" };
}

/**
 * O número da coluna Valor, **com a procedência**.
 *
 * ⚠ SÃO DOIS FATOS. `guia.valor` é o que o documento diz; `parcela.valorPrevisto` é o que o
 * contrato contratou. Mostrar só o primeiro fazia o acordeão exibir "—" nas 60 prestações de um
 * contrato sem guia, com o card ao lado anunciando o valor da parcela. Colapsar os dois num campo
 * só faria o contrário: a tela afirmaria que existe documento onde não existe.
 */
export function valorDaLinha(linha) {
  if (linha?.valor != null && Number.isFinite(Number(linha.valor))) {
    return { valor: Number(linha.valor), fonte: "guia" };
  }
  if (linha?.valorPrevisto != null && Number.isFinite(Number(linha.valorPrevisto))) {
    return { valor: Number(linha.valorPrevisto), fonte: "contrato" };
  }
  return { valor: null, fonte: null };
}

/**
 * O botão de busca desta linha: pode clicar, e se não, POR QUÊ.
 *
 * ⚠ O projeto proíbe desabilitado sem explicação. Todo ramo de `podeBuscar: false` devolve um
 * `motivo` que vai para o `title` do botão — e um `rotulo` curto, que é o que cabe NA LINHA quando
 * o mesmo motivo se repete em 60 prestações (ver `agruparBloqueios`).
 */
export function estadoBuscaParcela(linha) {
  // ⚠ A QUITAÇÃO VEM PRIMEIRO, e a ordem é o conserto. Sem esta leitura, uma prestação já quitada
  // sem guia caía no ramo "sem guia capturada" e a tela mandava capturar no SERPRO — que é uma
  // chamada PAGA — o documento de uma parcela que já está paga.
  const q = quitacaoDaLinha(linha);
  if (q) return { podeBuscar: false, rotulo: q.rotulo, motivo: q.motivo };
  if (!linha?.guideId) {
    return { podeBuscar: false, ...motivoSemGuia(linha?.formaPagamento || null) };
  }
  if (linha.paymentStatus === "PAID") {
    return {
      podeBuscar: false,
      rotulo: linha.baixada ? "baixa já lançada" : "falta lançar a baixa",
      motivo: linha.baixada
        ? "Pagamento já localizado e baixa já lançada — não há o que consultar."
        : "Pagamento já localizado. Falta só lançar a baixa (painel \"Parcelas pagas aguardando "
          + "lançamento\", acima). Consultar de novo gastaria uma chamada paga sem mudar nada.",
    };
  }
  if (!linha.numeroDocumento) {
    return {
      podeBuscar: false,
      rotulo: "guia sem nº de documento",
      motivo: "Esta guia não tem número de documento, e é por ele que o comprovante é localizado no "
        + "PAGTOWEB — sem ele a busca não tem o que consultar. Recapture a parcela no SERPRO.",
    };
  }
  return {
    podeBuscar: true,
    rotulo: null,
    motivo: "Consulta o comprovante desta parcela no SERPRO (PAGTOWEB). A chamada é PAGA.",
  };
}

/**
 * Os motivos de bloqueio do acordo, UM POR MOTIVO, com as prestações de cada um.
 *
 * ⚠ POR QUE AGRUPAR. Um contrato de 60 prestações sem guia repetia o MESMO parágrafo 60 vezes,
 * dentro de um card de 360px. O texto não estava errado — estava 60 vezes, e uma parede de
 * explicação idêntica não se lê: vira textura. Aqui a explicação aparece UMA vez, dizendo em
 * quantas prestações vale e quais são; a linha guarda só o rótulo curto, e o `title` do botão
 * continua com o texto inteiro.
 *
 * ⚠ Isto NÃO esconde nada: nenhuma linha some, nenhum motivo some. O que sai é a repetição.
 */
export function agruparBloqueios(linhas) {
  const porMotivo = new Map();
  for (const linha of Array.isArray(linhas) ? linhas : []) {
    const estado = estadoBuscaParcela(linha);
    if (estado.podeBuscar) continue;
    const atual = porMotivo.get(estado.motivo)
      || { rotulo: estado.rotulo, motivo: estado.motivo, numeros: [] };
    atual.numeros.push(linha.numeroParcela ?? null);
    porMotivo.set(estado.motivo, atual);
  }
  return [...porMotivo.values()].map((g) => ({ ...g, quantidade: g.numeros.length }));
}

/**
 * "1, 2, 3, 4, 5 e mais 55" — a lista de prestações de um grupo sem virar ela mesma uma parede.
 * ⚠ O que é cortado é DITO ("e mais 55"), nunca omitido em silêncio.
 */
export function resumoDosNumeros(numeros, limite = 8) {
  const uteis = (numeros || []).filter((n) => n != null);
  if (!uteis.length) return "";
  if (uteis.length <= limite) return uteis.join(", ");
  return `${uteis.slice(0, limite).join(", ")} e mais ${uteis.length - limite}`;
}

function fmtQuando(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * O texto da confirmação, REPETINDO os dados sobre os quais a chamada paga vai sair.
 *
 * ⚠ O clique não pode ser gratuito e silencioso — a chamada custa dinheiro. É o mesmo cuidado que o
 * menu SERPRO da aba Lançamentos toma (lá o estado é lido ANTES do POST, porque a resposta chegaria
 * tarde demais). Aqui o estado que se lê antes é `serproLastCheckedAt`: já consultada há pouco, o
 * texto diz quando e com que desfecho, para que "clicar de novo" seja uma decisão e não um reflexo.
 */
export function textoDaConfirmacao(linha, parcelamentoLabel) {
  const partes = [];
  const numero = linha.numeroParcela != null
    ? `parcela ${linha.numeroParcela}${linha.totalParcelas ? `/${linha.totalParcelas}` : ""}`
    : "parcela";
  partes.push(`Consultar no SERPRO o pagamento da ${numero} de ${parcelamentoLabel || "este parcelamento"}.`);
  partes.push("");
  partes.push(`Documento nº ${linha.numeroDocumento}`);
  if (linha.valor != null) {
    partes.push(`Valor: R$ ${Number(linha.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }
  if (linha.competencia) partes.push(`Competência: ${linha.competencia}`);

  const quando = fmtQuando(linha.serproLastCheckedAt);
  if (quando) {
    partes.push("");
    partes.push(`⚠ Esta guia já foi consultada em ${quando}${linha.serproLastCheckResult ? ` (${linha.serproLastCheckResult})` : ""}.`);
  }
  partes.push("");
  partes.push("⚠ Esta consulta ao SERPRO é PAGA. Confirmar?");
  return partes.join("\n");
}

/**
 * O desfecho de uma busca que o servidor RESPONDEU (200).
 *
 * `encontrado: false` é um desfecho legítimo, não uma falha — daí o tom próprio.
 */
export function resumoDoResultado(resposta) {
  if (resposta?.encontrado) {
    const c = resposta.comprovante || null;
    const total = c?.total != null
      ? `R$ ${Number(c.total).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;
    const detalhe = c?.dataArrecadacao
      ? `Arrecadado em ${c.dataArrecadacao}${total ? ` — total ${total}` : ""}. `
        + "A baixa continua com você: use \"Dar baixa\" no painel acima, já preenchido com a data e a quebra reais."
      : "O comprovante foi localizado, mas sem data/valores legíveis. Confira antes de lançar a baixa.";
    return { tom: "ok", titulo: "Pagamento localizado", detalhe };
  }
  return {
    tom: "neutro",
    titulo: "Pagamento ainda não localizado",
    detalhe: (resposta?.motivo && String(resposta.motivo).trim())
      || "A Receita ainda não tem comprovante deste documento. Isso não é erro — se a parcela venceu "
        + "há pouco, o comprovante pode levar alguns dias para aparecer.",
  };
}

// As recusas que custam explicação própria. Todas chegam como `err.code` (o `realApi` sobe o código
// junto da mensagem justamente para telas que precisam AGIR por código, não só exibir texto).
const FALHAS = {
  SERPRO_CHAMADA_REPETIDA: {
    titulo: "Consulta repetida — bloqueada pela guarda de custo",
    padrao: "Esta mesma consulta saiu há menos de 5 minutos e é paga. Aguarde a janela fechar antes de repetir.",
  },
  SERPRO_TETO_DIARIO: {
    titulo: "Teto diário desta empresa atingido",
    padrao: "Esta empresa já consumiu o teto de consultas pagas ao SERPRO hoje. Um ADMIN pode liberar, ou tente amanhã.",
  },
  SERPRO_TETO_MENSAL_ESCRITORIO: {
    titulo: "Teto mensal do escritório atingido",
    padrao: "O escritório já consumiu o orçamento de consultas pagas ao SERPRO deste mês. Um ADMIN pode liberar.",
  },
  SERPRO_PAGTOWEB_DISABLED: {
    titulo: "Integração PAGTOWEB desligada",
    padrao: "A busca de comprovante está desligada neste ambiente (INTEGRACAO_SERPRO_PAGTOWEB). "
      + "Nenhuma consulta foi feita — ligue a flag no ambiente para usar esta tela.",
  },
  PAGTOWEB_FALHOU: {
    titulo: "O SERPRO não respondeu à consulta",
    padrao: "A chamada saiu e falhou. Pode ter sido cobrada mesmo assim — confira antes de repetir.",
  },
};

/**
 * ⚠ Mensagem do servidor que é um CÓDIGO, não uma frase, não serve de explicação.
 *
 * `SERPRO_PAGTOWEB_DISABLED` chega com `message: "serpro_pagtoweb_disabled"` — o `Error` que o
 * serviço lança tem o código como texto. Preferir a "mensagem do servidor" cegamente colocaria isso
 * na tela como se fosse o motivo, e o contador ficaria com o nome de uma flag de ambiente no lugar
 * da explicação. Uma frase tem espaço; um identificador não tem nenhum.
 */
function pareceCodigo(mensagem) {
  return Boolean(mensagem) && !/\s/.test(mensagem);
}

/** A falha (não-200), com o motivo REAL do servidor à frente do texto padrão. */
export function motivoDaFalha(err) {
  const code = String(err?.code || "").trim().toUpperCase();
  const conhecida = FALHAS[code];
  const bruta = String(err?.message || "").trim();
  const mensagem = pareceCodigo(bruta) ? "" : bruta;
  if (conhecida) {
    return { tom: "erro", titulo: conhecida.titulo, detalhe: mensagem || conhecida.padrao, code };
  }
  return {
    tom: "erro",
    titulo: "Falha ao buscar o pagamento",
    // Código cru vira contexto, não explicação — mas não se perde: é ele que identifica a recusa
    // num chamado de suporte.
    detalhe: mensagem
      || (bruta ? `O servidor recusou a consulta com o código ${bruta} e sem explicação.` : "O servidor recusou a consulta e não disse por quê."),
    code: code || null,
  };
}
