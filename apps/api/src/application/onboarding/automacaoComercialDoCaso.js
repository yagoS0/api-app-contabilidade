// Retomar uma ficha é trabalho humano. Não equivale a devolver a pessoa inteira à IA.
export function automacaoComercialBloqueada(caso) {
  return caso?.triagem?.retomadaManual?.bloqueiaAutomacao === true;
}

export function trabalhoFiscalAnteriorARetomada(caso, trabalho) {
  const em = caso?.triagem?.retomadaManual?.em;
  return Boolean(em && (!trabalho?.createdAt || new Date(trabalho.createdAt) <= new Date(em)));
}
