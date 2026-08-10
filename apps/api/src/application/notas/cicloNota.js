// O CICLO DE VIDA DE UMA NFS-e — cancelada × substituída × substituta × "não sabemos".
//
// ⚠ POR QUE ISTO É UM MÓDULO, E POR QUE ELE É PURO
//
// Estas quatro coisas não são a mesma, e até 10/08/2026 elas colapsavam numa só palavra na tela:
//
//   • cancelada  — deixou de existir para o fisco
//   • substituída — foi TROCADA por outra, e existe o vínculo entre as duas
//   • substituta  — é a que vale, e ela declara quem substituiu
//   • ⚠ "não temos o evento" — que na tela se parece com "não houve evento" e significa o OPOSTO
//
// A quarta é a perigosa, e é a mais comum: 556 NFS-e estão marcadas canceladas em produção e
// **nenhuma** tem o evento guardado (0 linhas em `PortalInvoiceEvent`, medido). Delas não se sabe
// quando, por quê, nem se foram canceladas ou substituídas. Uma tela que mostre "cancelada" e
// cale sobre isso está afirmando mais do que sabe.
//
// A regra vive aqui, sozinha e testável, porque ela vai ser lida por mais de um lugar (lista,
// detalhe, e o que vier). Duas cópias divergiriam, e aí duas telas diriam coisas diferentes sobre
// a mesma nota — que é o defeito que este projeto mais persegue.
//
// ⚠ ESTE MÓDULO NÃO DECIDE DINHEIRO. `statusEfetivo` continua sendo a única coisa que a apuração
// lê, e continua tendo dois valores (`autorizada`/`cancelada`). O que está aqui é LEITURA: nomear
// o que aconteceu, sem mexer em quanto vale.

export const SITUACAO = {
  AUTORIZADA: "autorizada",
  CANCELADA: "cancelada",
  SUBSTITUIDA: "substituida",
};

/**
 * @param {Object} p
 * @param {Object} p.nota          linha de PortalInvoice (statusEfetivo, chaveAcesso, chaveSubstituida, motivoSubstituicao)
 * @param {Object|null} [p.evento] último PortalInvoiceEvent desta nota, se houver
 * @param {Object|null} [p.substituida] a nota que ESTA substitui, se estiver na nossa base
 * @param {Object|null} [p.substituta]  a nota que substituiu ESTA, se estiver na nossa base
 */
export function derivarCiclo({ nota, evento = null, substituida = null, substituta = null } = {}) {
  if (!nota) return null;

  const cancelada = String(nota.statusEfetivo || "").toLowerCase() === "cancelada"
    || String(nota.status || "").toUpperCase() === "CANCELADA";

  // Foi substituída? Três evidências independentes, em ordem de força:
  //   1. o evento diz (`canc_por_substituicao`) — é o fato, com data e motivo;
  //   2. o evento traz a chave da substituta, mesmo sem o tipo ter sido reconhecido;
  //   3. existe, na base, outra nota que declara substituir esta (`chaveSubstituida` apontando
  //      para a chave desta) — é o que salva os casos antigos, em que o evento se perdeu.
  const chaveSubstituta = evento?.chaveSubstituta || substituta?.chaveAcesso || null;
  const porSubstituicao = Boolean(
    evento?.type === "canc_por_substituicao" || evento?.chaveSubstituta || substituta,
  );

  const situacao = !cancelada
    ? SITUACAO.AUTORIZADA
    : porSubstituicao ? SITUACAO.SUBSTITUIDA : SITUACAO.CANCELADA;

  // ⚠ Ser SUBSTITUTA é um papel, não uma situação — e uma nota pode acumular os dois (ela
  // substituiu alguém e depois foi substituída por outra; medimos 3 casos assim em produção).
  // Por isso isto é um booleano ao lado, e não mais um valor de `situacao`.
  const ehSubstituta = Boolean(nota.chaveSubstituida);

  const avisos = [];

  // ⚠ A AUSÊNCIA PRECISA SER DITA. Este é o ponto inteiro do módulo.
  if (cancelada && !evento) {
    avisos.push({
      codigo: "evento_nao_registrado",
      texto: "Esta nota está marcada como cancelada, mas nós não guardamos o evento de "
        + "cancelamento — não temos a data, o motivo, nem se foi cancelamento simples ou "
        + "substituição. Isso NÃO quer dizer que o evento não existiu: quer dizer que ele não foi "
        + "gravado por nós. A captura só passou a guardá-lo em 10/08/2026.",
    });
  }

  // Vínculo que aponta para fora da nossa base — 4 casos medidos. Diferente de "não aponta".
  if (nota.chaveSubstituida && !substituida) {
    avisos.push({
      codigo: "substituida_ausente",
      texto: "Esta nota declara substituir outra que NÃO está na nossa base. O vínculo é real (vem "
        + "do XML da própria nota); a nota substituída é que não foi capturada.",
    });
  }
  if (chaveSubstituta && !substituta) {
    avisos.push({
      codigo: "substituta_ausente",
      texto: "O evento aponta uma nota substituta que NÃO está na nossa base.",
    });
  }

  // ⚠ CONTRADIÇÃO QUE NÃO PODE FICAR MUDA: outra nota declara substituir esta, e esta continua
  // marcada como autorizada. Fiscalmente isso não existe — uma nota substituída foi cancelada.
  //
  // Medido em produção: 4 casos, todos em KAIZEN e LIFAT, e todos são linhas do lote de 62 em que
  // o XML de um EVENTO sobrescreveu a NOTA (entrou por `upsertNfseFromItem` em vez de
  // `applyNfseEvento`, casando a mesma `chaveAcesso`). O registro ficou sem número e sem valor, e
  // o cancelamento que o evento trazia virou o conteúdo da linha, deixando-a "autorizada".
  //
  // Não corrigimos o dado aqui — mexer no `statusEfetivo` dessas 62 é decisão do dono. Mas a tela
  // tem de dizer que a linha se contradiz, senão ela se apresenta como uma nota válida qualquer.
  if (situacao === SITUACAO.AUTORIZADA && (substituta || chaveSubstituta)) {
    avisos.push({
      codigo: "substituida_mas_autorizada",
      texto: "Outra nota declara substituir esta, mas esta continua marcada como AUTORIZADA — "
        + "o que não existe fiscalmente. Provavelmente o registro dela foi sobrescrito pelo "
        + "próprio evento de cancelamento (62 linhas assim, todas de julho/2026). Confira antes "
        + "de usar esta nota em apuração.",
    });
  }

  const referencia = (n, chave) => {
    if (n) return { notaId: n.id ?? null, numero: n.numero ?? null, chaveAcesso: n.chaveAcesso ?? chave ?? null, naBase: true };
    if (chave) return { notaId: null, numero: null, chaveAcesso: chave, naBase: false };
    return null;
  };

  return {
    situacao,
    ehSubstituta,
    // "esta nota substitui aquela" — o lado declarado pela própria nota (`<subst><chSubstda>`).
    substitui: referencia(substituida, nota.chaveSubstituida || null),
    motivoSubstituicao: nota.motivoSubstituicao || null,
    // "esta nota foi substituída por aquela" — o lado que vem do evento e105102.
    substituidaPor: referencia(substituta, chaveSubstituta),
    evento: evento
      ? {
        tipo: evento.type ?? null,
        tpEvento: evento.tpEvento ?? null,
        nSeqEvento: evento.nSeqEvento ?? null,
        dataEvento: evento.date ?? null,
        motivo: evento.reason ?? null,
      }
      : null,
    // ⚠ LEIA ISTO ANTES DE PINTAR QUALQUER COISA: `false` numa nota cancelada significa
    // "não sabemos", nunca "não aconteceu".
    eventoRegistrado: Boolean(evento),
    avisos,
  };
}

/**
 * Resolve o ciclo de uma PÁGINA de notas com DUAS consultas, não N.
 * `carregar` recebe as chaves e devolve as notas correspondentes daquela empresa.
 */
export function montarIndiceDeCiclo({ notas, eventos = [], relacionadas = [] }) {
  const eventoPorNota = new Map();
  for (const ev of eventos) {
    // O mais recente vence quando há mais de um (cancelamento + substituição na mesma nota).
    // Substituição vence empate: é o fato mais específico dos dois.
    const atual = eventoPorNota.get(ev.invoiceId);
    if (!atual
      || (ev.type === "canc_por_substituicao" && atual.type !== "canc_por_substituicao")
      || (new Date(ev.date || ev.createdAt || 0) > new Date(atual.date || atual.createdAt || 0)
        && atual.type !== "canc_por_substituicao")) {
      eventoPorNota.set(ev.invoiceId, ev);
    }
  }

  const porChave = new Map();
  for (const n of relacionadas) if (n.chaveAcesso) porChave.set(n.chaveAcesso, n);
  // Quem substituiu ESTA nota = a nota cuja `chaveSubstituida` é a chave desta.
  const substitutaDe = new Map();
  for (const n of [...relacionadas, ...notas]) {
    if (n.chaveSubstituida) substitutaDe.set(n.chaveSubstituida, n);
  }

  return notas.map((nota) => ({
    ...nota,
    ciclo: derivarCiclo({
      nota,
      evento: eventoPorNota.get(nota.id) || null,
      substituida: nota.chaveSubstituida ? porChave.get(nota.chaveSubstituida) || null : null,
      substituta: nota.chaveAcesso ? substitutaDe.get(nota.chaveAcesso) || null : null,
    }),
  }));
}
