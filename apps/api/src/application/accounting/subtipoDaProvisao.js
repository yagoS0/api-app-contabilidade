// Compatibilidade de leitura: não altera lançamentos históricos no banco.
export function subtipoDaProvisao(entry) {
  if (entry?.subtipo === "PIS_COFINS") {
    return { DARF_PIS: "PIS", DARF_COFINS: "COFINS" }[entry.eventType] || entry.subtipo;
  }
  return entry?.subtipo || null;
}
