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
    return linhaDaParcela({ parcelaId: p.id, numeroParcela: p.numeroParcela, vencimentoContratado: p.vencimento, guia: g, parc });
  });

  // Guia que não casou com nenhuma prestação contratada continua aparecendo. Sumir com ela seria
  // esconder a única linha que tem documento para buscar — e é exatamente o caso de um acordo
  // antigo, criado antes da tabela de parcelas existir.
  for (const g of porGuiaId.values()) {
    linhas.push(linhaDaParcela({ parcelaId: null, numeroParcela: g.numeroParcela, vencimentoContratado: null, guia: g, parc }));
  }

  return linhas.sort((a, b) => (a.numeroParcela ?? 9999) - (b.numeroParcela ?? 9999));
}

function linhaDaParcela({ parcelaId, numeroParcela, vencimentoContratado, guia, parc }) {
  return {
    key: parcelaId || guia?.id || `p-${numeroParcela}`,
    numeroParcela: numeroParcela ?? null,
    totalParcelas: parc?.numParcelas ?? null,
    // O vencimento REAL (da guia) quando existe; o CONTRATADO quando não — mesma precedência que
    // `quadroDasParcelas` usa no backend para decidir atraso.
    vencimento: guia?.vencimento || vencimentoContratado || null,
    competencia: guia?.competencia || guia?.anoMesParcela || null,
    valor: guia?.valor != null ? Number(guia.valor) : null,
    guideId: guia?.id || null,
    numeroDocumento: guia?.numeroDocumento || null,
    paymentStatus: String(guia?.paymentStatus || "").toUpperCase() || null,
    baixada: Boolean(guia?.baixada),
    comprovante: guia?.comprovante || null,
    serproLastCheckedAt: guia?.serproLastCheckedAt || null,
    serproLastCheckResult: guia?.serproLastCheckResult || null,
  };
}

/**
 * O botão de busca desta linha: pode clicar, e se não, POR QUÊ.
 *
 * ⚠ O projeto proíbe desabilitado sem explicação. Todo ramo de `podeBuscar: false` devolve um
 * `motivo` que vai para o `title` do botão.
 */
export function estadoBuscaParcela(linha) {
  if (!linha?.guideId) {
    return {
      podeBuscar: false,
      motivo: "Esta prestação ainda não tem guia capturada — não existe documento para consultar no "
        + "PAGTOWEB. A guia entra pela captura do SERPRO ou por upload na aba Guias.",
    };
  }
  if (linha.paymentStatus === "PAID") {
    return {
      podeBuscar: false,
      motivo: linha.baixada
        ? "Pagamento já localizado e baixa já lançada — não há o que consultar."
        : "Pagamento já localizado. Falta só lançar a baixa (painel \"Parcelas pagas aguardando "
          + "lançamento\", acima). Consultar de novo gastaria uma chamada paga sem mudar nada.",
    };
  }
  if (!linha.numeroDocumento) {
    return {
      podeBuscar: false,
      motivo: "Esta guia não tem número de documento, e é por ele que o comprovante é localizado no "
        + "PAGTOWEB — sem ele a busca não tem o que consultar. Recapture a parcela no SERPRO.",
    };
  }
  return {
    podeBuscar: true,
    motivo: "Consulta o comprovante desta parcela no SERPRO (PAGTOWEB). A chamada é PAGA.",
  };
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
