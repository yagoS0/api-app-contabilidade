// O link identifica um documento. Autorização e ações continuam dependendo do servidor.
export function lerLinkDaGuia(search = window.location.search) {
  const params = new URLSearchParams(search);
  const companyId = params.get("empresa"), guideId = params.get("guia");
  const valido = v => typeof v === "string" && /^[a-zA-Z0-9_.-]{1,150}$/.test(v);
  if (!valido(companyId) || !valido(guideId)) return null;
  const competencia = params.get("competencia") || "";
  const acao = params.get("acao");
  return { companyId, guideId, competencia: /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) ? competencia : "",
    acao: ["recalcular", "confirmar"].includes(acao) ? acao : null };
}

export function limparLinkDaGuia() {
  const url = new URL(window.location.href);
  ["empresa", "guia", "competencia", "acao"].forEach(key => url.searchParams.delete(key));
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}
