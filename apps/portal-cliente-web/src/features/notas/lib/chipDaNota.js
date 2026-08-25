// O CHIP DA NOTA — e a única coisa que ele decide: quando o `ciclo` sabe MAIS que o `status`.
//
// ⚠⚠ O DEFEITO QUE ISTO CONSERTA (24/08/2026): uma nota SUBSTITUÍDA aparecia como **"Cancelada"**
// nesta tela e como **"Substituída"** na tela do contador — o mesmo documento fiscal, dois fatos.
//
// `PortalInvoice.status` sabe distinguir as duas **quando o ADN mandou o evento**:
// `InvoiceSyncEngine.mapInvoiceStatusFromAdn` traduz `E105102` / `cancelled_substitution` em
// `"SUBSTITUIDA"`. O problema é quando ele não mandou — e esse é o caso COMUM, não a borda: medido
// em produção, **556 NFS-e canceladas com ZERO eventos guardados**
// (`apps/api/src/application/notas/cicloNota.js`).
//
// `derivarCiclo` tem uma terceira evidência que o `status` não tem: *"existe, na base, outra nota
// que declara substituir esta"* (`chaveSubstituida` apontando para a chave desta) — 22 notas em
// produção. Era por ela que o escritório acertava e este portal errava.
//
// ⚠ O `ciclo` passou a viajar no contrato do cliente em 24/08/2026 (`serializeInvoice`,
// `apps/api/src/routes/portalInvoices.js`), com `situacao` e `ehSubstituta` e mais nada.
//
// ── ⚠⚠ A PRECEDÊNCIA É ESTREITA DE PROPÓSITO ──────────────────────────────────────────────────
//
// O `ciclo` **só vence numa coisa**: dizer `substituida`. Em todo o resto o `status` manda, e a
// razão é que eles respondem perguntas diferentes:
//
//   • `ciclo.situacao` tem TRÊS valores (`autorizada` | `cancelada` | `substituida`) e o próprio
//     módulo avisa que ele *"não decide dinheiro"* — é leitura do ciclo de vida;
//   • `status` tem CINCO (`EMITIDA`/`CANCELADA`/`SUBSTITUIDA`/`REJEITADA`/`PENDENTE`) e é o que
//     esta lista sempre mostrou.
//
// Deixar `autorizada` vencer apagaria **REJEITADA** e **PENDENTE** da tela: `derivarCiclo` chama de
// `autorizada` tudo que não está cancelado, inclusive a nota que a Receita RECUSOU. Uma nota
// rejeitada exibida como "Emitida" é o pior desfecho possível desta lista — quem emitiu concluiria
// que tem nota fiscal onde não tem.
//
// ⚠ E `cancelada` do ciclo também não vence: se o `status` já diz `SUBSTITUIDA` (o ADN mandou o
// evento), ele é MAIS específico, e rebaixá-lo para "Cancelada" desfaria o acerto.
//
// ⚠ AUSENTE NÃO É NADA: sem `ciclo` — nota nossa recém-emitida, backend antigo, campo fora de um
// `select` — o comportamento é exatamente o de antes. É a regra da casa: o modo de falhar tem de
// ser "como era", nunca "afirma outra coisa".

/**
 * `PortalInvoice.status` → o vocabulário do chip (`apps/api/prisma/schema.prisma`).
 *
 * ⚠ O de-para é EXPLÍCITO, e não um `toLowerCase()` torcendo para bater: `data-status` é o
 * vocabulário do protótipo (e o que o app mobile espelha), não o do banco.
 */
export const CHIP_POR_STATUS = Object.freeze({
  EMITIDA: { status: "emitida", rotulo: "Emitida" },
  CANCELADA: { status: "cancelada", rotulo: "Cancelada" },
  SUBSTITUIDA: { status: "substituida", rotulo: "Substituída" },
  REJEITADA: { status: "rejeitada", rotulo: "Rejeitada" },
  PENDENTE: { status: "processando", rotulo: "Pendente" },
});

/** A situação do `ciclo` que este módulo aceita como mais forte que o `status`. Uma só. */
const SITUACAO_QUE_VENCE = "substituida";

/**
 * O chip de UMA nota.
 *
 * @param {{status?: string, ciclo?: {situacao?: string}}} nota
 * @returns {{status: string|null, rotulo: string}} `status` é o `data-status` do DOM; `rotulo`, o
 *   texto. ⚠ `status: null` para valor fora da lista — e o chip então sai **sem cor**, que é o modo
 *   de falhar que `guias/lib/rotuloGuia.js` e o lote já nomeiam aqui: silencioso, e por isso
 *   travado por teste que lê o CSS.
 */
export function chipDaNota(nota) {
  // ⚠ Aceita a string crua também: esta função nasceu recebendo `nota.status` direto, e há chamador
  // fora desta tela no dia em que alguém copiar a linha. Passar a string é o caminho SEM ciclo.
  const daNota = typeof nota === "string" || nota == null ? { status: nota } : nota;

  const situacao = String(daNota?.ciclo?.situacao || "").toLowerCase();
  const bruto = String(daNota?.status || "").toUpperCase();

  if (situacao === SITUACAO_QUE_VENCE) return CHIP_POR_STATUS.SUBSTITUIDA;
  return CHIP_POR_STATUS[bruto] || { status: null, rotulo: String(daNota?.status ?? "") || "—" };
}
