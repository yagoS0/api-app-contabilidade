export const TRIBUTOS_CIRCULAR_LP = ["PIS", "COFINS", "IRPJ", "CSLL"];
export const EVENTOS_BAIXA_LP = Object.fromEntries(TRIBUTOS_CIRCULAR_LP.flatMap((t) => [[`BAIXA_DARF_${t}`, t], [`BAIXA_${t}`, t]]));

export function planejarClassificacaoCircular(entries) {
  const changes = [], revisar = [];
  for (const e of entries) {
    let destino = null;
    if (e.subtipo === "PIS_COFINS") destino = { DARF_PIS: "PIS", DARF_COFINS: "COFINS" }[e.eventType];
    if (e.tipo === "BAIXA" && (!e.subtipo || e.subtipo === "PIS_COFINS")) {
      destino = EVENTOS_BAIXA_LP[e.eventType] || (TRIBUTOS_CIRCULAR_LP.includes(e.openEntry?.subtipo) ? e.openEntry.subtipo : null);
    }
    if (destino && destino !== e.subtipo) changes.push({ id: e.id, antes: e.subtipo, depois: destino });
    if (e.tipo !== "BAIXA" && EVENTOS_BAIXA_LP[e.eventType]) revisar.push({ id: e.id, motivo: "EVENTO_DE_BAIXA_COM_OUTRO_TIPO" });
    if (e.subtipo === "PIS_COFINS" && !destino) revisar.push({ id: e.id, motivo: "TRIBUTO_NAO_IDENTIFICADO" });
    const despesaOriginal = e.openEntry?.lines?.filter((l) => l.tipo === "D").map((l) => l.conta) || [];
    if (e.tipo === "BAIXA" && (e.lines || []).some((l) => l.tipo === "C" && despesaOriginal.includes(l.conta))) {
      revisar.push({ id: e.id, motivo: "CREDITO_REPETE_DEBITO_DA_PROVISAO_CONFERIR_BANCO" });
    }
  }
  return { changes, revisar };
}
