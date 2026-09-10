export function leituraDoResumo(resumo) {
  if (!resumo || ![resumo.conversas, resumo.naoVinculadas, resumo.conversasNaoLidas, resumo.mensagensNaoLidas]
    .every((n) => Number.isSafeInteger(n) && n >= 0)) return { selo: null, frase: "não foi possível ler" };
  const historico = resumo.historicoMensagensNaoLidas ?? 0;
  const lixeira = resumo.lixeiraMensagensNaoLidas ?? 0;
  if (![historico, lixeira].every(n => Number.isSafeInteger(n) && n >= 0)) return { selo: null, frase: "não foi possível ler" };
  const avisoHistorico = historico > 0 ? `${historico} ${historico === 1 ? "mensagem não lida no histórico anterior" : "mensagens não lidas no histórico anterior"}` : null;
  return {
    selo: resumo.mensagensNaoLidas + historico || null,
    avisoHistorico,
    frase: `${resumo.mensagensNaoLidas} ${resumo.mensagensNaoLidas === 1 ? "mensagem não lida" : "mensagens não lidas"} · ${resumo.naoVinculadas} ${resumo.naoVinculadas === 1 ? "número sem empresa" : "números sem empresa"}${avisoHistorico ? ` · ${avisoHistorico}` : ""}${lixeira > 0 ? ` · ${lixeira} não lidas na lixeira` : ""}`,
  };
}
