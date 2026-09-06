export function leituraDoResumo(resumo) {
  if (!resumo || ![resumo.conversas, resumo.naoVinculadas, resumo.conversasNaoLidas, resumo.mensagensNaoLidas]
    .every((n) => Number.isSafeInteger(n) && n >= 0)) return { selo: null, frase: "não foi possível ler" };
  return {
    selo: resumo.mensagensNaoLidas > 0 ? resumo.mensagensNaoLidas : null,
    frase: `${resumo.mensagensNaoLidas} ${resumo.mensagensNaoLidas === 1 ? "mensagem não lida" : "mensagens não lidas"} · ${resumo.naoVinculadas} ${resumo.naoVinculadas === 1 ? "número sem empresa" : "números sem empresa"}`,
  };
}
