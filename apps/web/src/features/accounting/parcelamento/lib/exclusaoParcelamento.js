// A REGRA DE TELA DA EXCLUSÃO DO CONTRATO — e do desfazer da rescisão.
//
// ⚠ POR QUE ISTO É UMA LIB COM TESTE PRÓPRIO, e não texto dentro do JSX: o que decide se esta tela
// respeita a autonomia do contador não é o layout, é O QUE ELA DIZ. "Tem certeza que deseja
// excluir?" e "60 prestações, 1 guia, 4 lançamentos somando R$ 12.633,96 — 2 deles em competência
// fechada, que virarão contra-lançamento em 08/2026" são o mesmo botão com duas éticas diferentes.
// A segunda frase é uma REGRA (quais números, em que ordem, com que ressalva), e regra de tela
// mora em `lib/` neste projeto, com teste, para não virar decoração que alguém "simplifica".
//
// ⚠ NENHUM NÚMERO É CALCULADO AQUI. Todos vêm do preview do servidor — ele é o único que sabe o que
// existe AGORA. Esta camada só escolhe as palavras e a ordem.

/** Mínimo do motivo. O servidor recusa (`MOTIVO_OBRIGATORIO`) e o banco também (CHECK). */
export const MOTIVO_MIN = 5;

export function motivoCurto(texto) {
  return String(texto || "").trim().length < MOTIVO_MIN;
}

export function formatarMoeda(valor) {
  // ⚠ AUSÊNCIA NÃO VIRA "R$ 0,00". `Number(null)` é 0 e passa em `isFinite`: sem esta guarda, um
  // valor que o servidor não sabe apareceria como zero — e zero é uma AFIRMAÇÃO sobre dinheiro.
  if (valor == null || valor === "") return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatarCompetencia(comp) {
  const [yyyy, mm] = String(comp || "").split("-");
  return yyyy && mm ? `${mm}/${yyyy}` : String(comp || "—");
}

const plural = (n, um, muitos) => (Number(n) === 1 ? um : muitos);

/**
 * O QUE VAI ACONTECER — uma linha por consequência, com os números reais.
 *
 * ⚠ A ORDEM NÃO É ARBITRÁRIA: primeiro o que some do RAZÃO (é o que o contador vai ter de explicar
 * para alguém), depois o que acontece com o DOCUMENTO (a guia, que não some), depois o contrato.
 * A consequência mais cara aparece primeiro porque é a que decide o clique.
 *
 * `tom` só distingue o que exige atenção do que é informativo — quem pinta é a tela.
 */
export function linhasDoQueVaiAcontecer(preview) {
  if (!preview) return [];
  const linhas = [];
  const l = preview.lancamentos || {};
  const p = preview.prestacoes || {};
  const g = preview.guias || {};

  if (l.apagados > 0) {
    linhas.push({
      chave: "lancamentos_apagados",
      tom: "atencao",
      texto: `${l.apagados} ${plural(l.apagados, "lançamento sai", "lançamentos saem")} do razão, `
        + `${plural(l.apagados, "somando", "somando")} ${formatarMoeda(preview.totalDesfeito)} em débitos.`,
    });
  }
  if (l.preservados > 0) {
    // ⚠ ESTA FRASE É A EXIGÊNCIA 3, E ELA DIZ QUE A AÇÃO ACONTECEU — DE OUTRO JEITO. O contador não
    // está sendo impedido; ele está sendo informado de que, em mês fechado, desfazer é lançar o
    // contrário, à vista de todos, no mês corrente. Sem esta frase a tela vira uma recusa disfarçada.
    linhas.push({
      chave: "contra_lancamento",
      tom: "atencao",
      texto: `${l.preservados} ${plural(l.preservados, "lançamento está", "lançamentos estão")} em `
        + `competência fechada (${(preview.competenciasFechadas || []).map(formatarCompetencia).join(", ")}) `
        + `e ${plural(l.preservados, "NÃO será apagado", "NÃO serão apagados")}: `
        + `${plural(l.preservados, "nasce um contra-lançamento espelhado", "nascem contra-lançamentos espelhados")} `
        + `em ${formatarCompetencia(preview.competenciaContraLancamento)}. O saldo de um mês já `
        + "reportado não muda para trás — ele é corrigido no mês corrente.",
    });
  }
  if (p.total > 0) {
    linhas.push({
      chave: "prestacoes",
      tom: p.quitadas > 0 ? "atencao" : "info",
      texto: `${p.total} ${plural(p.total, "prestação do contrato deixa", "prestações do contrato deixam")} de existir`
        + (p.quitadas > 0
          ? ` — e ${p.quitadas} ${plural(p.quitadas, "dela consta QUITADA", "delas constam QUITADAS")}. `
            + "O dinheiro que saiu da conta do cliente não volta; só você sabe se ele saiu."
          : "."),
    });
  }
  if (g.total > 0) {
    // ⚠ A GUIA NÃO É APAGADA, e a tela diz o que ela VIRA. Ver `AtosParcelamentoService.js`: uma
    // guia sem `parcelamentoId` volta a valer como a guia do tributo dela no dashboard, e a tag
    // daquele mês muda de lugar. Quem exclui precisa saber disso ANTES.
    const colunas = (g.voltamAContarComo || []).filter(Boolean);
    linhas.push({
      chave: "guias",
      tom: "info",
      texto: `${g.total} ${plural(g.total, "guia é DESVINCULADA", "guias são DESVINCULADAS")} — `
        + `${plural(g.total, "ela continua", "elas continuam")} na aba Guias, com PDF e histórico de envio. `
        + (colunas.length
          ? `No painel ${plural(g.total, "ela volta", "elas voltam")} a contar como ${colunas.join(" / ")}.`
          : ""),
    });
  }
  if (l.linhasDeRastreio > 0) {
    linhas.push({
      chave: "linhas_leves",
      tom: "info",
      texto: `${l.linhasDeRastreio} ${plural(l.linhasDeRastreio, "linha de rastreio sai", "linhas de rastreio saem")} junto `
        + "(sem contas, sem valor — não mudam saldo nenhum).",
    });
  }
  linhas.push(preview.cabecalhoRemovido
    ? { chave: "cabecalho", tom: "info", texto: "O contrato deixa de existir." }
    : {
      chave: "cabecalho",
      tom: "info",
      // ⚠ "Excluí e ele ainda está em algum lugar" sem explicação é pior que não excluir.
      texto: "O contrato some de todas as telas, mas a linha dele é PRESERVADA por dentro: é ela que "
        + "mantém os lançamentos da competência fechada agrupados. Sem isso, o fechamento daquele mês "
        + "travaria com \"lançamento desbalanceado\".",
    });
  return linhas;
}

/**
 * O AVISO DA FILA — a ausência que deixou de ser muda.
 *
 * ⚠ ISTO É METADE DO PROBLEMA DO DONO. `whereParcelaSemGuiaPendente` exclui o parcelamento
 * RESCINDIDO (e faz certo: fila de trabalho sobre acordo morto é trabalho inventado). Só que a fila
 * vazia é EXATAMENTE o mesmo pixel de "não há nada pendente" — e foi assim que 69 prestações de dois
 * contratos sumiram sem uma palavra, com o dono concluindo que a baixa sem guia não funcionava.
 *
 * Devolve `null` quando não há nada escondido: aviso que aparece sempre é aviso que ninguém lê.
 */
export function avisoForaDaFila(foraDaFila) {
  const total = Number(foraDaFila?.prestacoes) || 0;
  if (!total) return null;
  const contratos = Array.isArray(foraDaFila?.contratos) ? foraDaFila.contratos : [];
  return {
    total,
    contratos,
    titulo: `${total} ${plural(total, "prestação está", "prestações estão")} fora desta fila porque o `
      + `${plural(contratos.length, "acordo foi rescindido", "acordo foi rescindido")}`,
    // ⚠ O texto NOMEIA a causa e o caminho de volta. "A fila está vazia" sem isto manda o contador
    // procurar defeito onde há decisão.
    detalhe: "Prestação de parcelamento RESCINDIDO não entra em fila de baixa — não há mais o que "
      + "prevenir. Se a rescisão foi por engano, desfaça-a e elas voltam para cá.",
    linhas: contratos.map((c) => ({
      parcelamentoId: c.parcelamentoId,
      texto: `${c.label || c.tipo || "Contrato"}${c.numeroParcelamento ? ` nº ${c.numeroParcelamento}` : ""}`
        + ` — ${c.prestacoes} ${plural(c.prestacoes, "prestação", "prestações")}`,
    })),
  };
}

/**
 * As recusas dos dois atos, cada uma com a SAÍDA — nunca só o código.
 *
 * ⚠ O servidor já manda a mensagem pronta na maioria dos casos; este mapa é o fallback para quando
 * ela não vem (erro de rede que carrega só o código). Recusa sem motivo legível é o defeito que
 * este módulo já corrigiu em quatro telas.
 */
export const RECUSAS_ATO = Object.freeze({
  parcelamento_nao_encontrado: "Parcelamento não encontrado — ele já pode ter sido excluído.",
  MOTIVO_OBRIGATORIO: `Informe o motivo (mínimo ${MOTIVO_MIN} caracteres). Ele fica gravado com o seu nome e a data.`,
  CONFERENCIA_DIVERGENTE: "O contrato mudou desde que esta tela abriu — confira os números de novo.",
  CONTRATO_MUDOU: "O contrato mudou enquanto a operação era processada. Nada foi feito; tente de novo.",
  MES_CORRENTE_FECHADO: "A competência de hoje está fechada, e é nela que o contra-lançamento teria de nascer. Reabra o mês corrente.",
  LOTE_JA_EXPORTADO: "Há lançamento já EXPORTADO neste contrato — ele já saiu daqui para a contabilidade.",
  PARCELAMENTO_NAO_RESCINDIDO: "Este parcelamento não está rescindido — não há rescisão a desfazer.",
});

export function explicarRecusaAto(code, mensagemDoServidor) {
  const doServidor = String(mensagemDoServidor || "").trim();
  // A mensagem do servidor vence: ela é a única que sabe o número, a competência e o histórico.
  if (doServidor && doServidor !== code) return doServidor;
  return RECUSAS_ATO[code] || "O servidor recusou a operação.";
}

/**
 * O que o botão de desfazer a rescisão promete — e o que ele NÃO promete.
 *
 * ⚠ A ÚLTIMA LINHA É A MAIS IMPORTANTE: desfazer aqui corrige o REGISTRO DESTE ESCRITÓRIO. A
 * rescisão do acordo perante a Receita é ato dela, e nenhuma tela nossa a desfaz. Prometer o
 * contrário seria o tipo de erro que o contador só descobre no e-CAC, meses depois.
 */
export function linhasDoDesfazerRescisao(preview) {
  if (!preview) return [];
  const linhas = [];
  const l = preview.lancamentos || {};
  const p = preview.prestacoes || {};

  linhas.push({
    chave: "status",
    tom: "info",
    texto: "O contrato volta a ficar ATIVO e reaparece na aba Parcelamentos.",
  });
  if (p.voltamParaFila > 0) {
    linhas.push({
      chave: "fila",
      tom: "atencao",
      texto: `${p.voltamParaFila} ${plural(p.voltamParaFila, "prestação vencida volta", "prestações vencidas voltam")} `
        + "para a fila \"Prestações vencidas sem guia\".",
    });
  }
  if (l.total > 0) {
    linhas.push(l.preservados > 0
      ? {
        chave: "lancamentos",
        tom: "atencao",
        texto: `${l.preservados} de ${l.total} lançamentos da rescisão estão em competência fechada: `
          + `eles NÃO são apagados — nascem contra-lançamentos em ${formatarCompetencia(preview.competenciaContraLancamento)}.`,
      }
      : {
        chave: "lancamentos",
        tom: "atencao",
        texto: `${l.total} ${plural(l.total, "lançamento da rescisão sai", "lançamentos da rescisão saem")} do razão `
          + `(${formatarMoeda(preview.totalDesfeito)}).`,
      });
  } else {
    // ⚠ ZERO É RESPOSTA, e é o caso dos dois contratos rescindidos de produção: a rescisão não gerou
    // lançamento nenhum (não havia provisão a estornar). Dizer isso evita a suspeita de que algo
    // ficou para trás.
    linhas.push({
      chave: "lancamentos",
      tom: "info",
      texto: "Esta rescisão não gerou lançamento contábil nenhum — não há nada a desfazer no razão.",
    });
  }
  const risco = preview.riscoAoReativar;
  if (risco?.avaliavel && risco?.nivel && risco.nivel !== "ok") {
    // ⚠ O contrato pode voltar JÁ rescindível. Quem desfaz precisa ver isso antes, não depois.
    linhas.push({
      chave: "risco",
      tom: "atencao",
      texto: risco.nivel === "rescindivel"
        ? `Atenção: ao voltar, o contrato já estará com ${risco.emAtraso} prestações em atraso — no nível RESCINDÍVEL.`
        : `Ao voltar, o contrato ficará com ${risco.emAtraso} ${plural(risco.emAtraso, "prestação em atraso", "prestações em atraso")}.`,
    });
  }
  linhas.push({
    chave: "escopo",
    tom: "info",
    texto: "Isto corrige o registro DESTE escritório. A rescisão do acordo perante a Receita é ato "
      + "dela — o portal não fala com a RFB aqui.",
  });
  return linhas;
}
