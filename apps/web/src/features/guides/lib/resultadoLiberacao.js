// Relatório de uma execução: não confunde canal indisponível com tentativa que falhou.
// A prévia e os resultados são snapshots do mesmo lote; nunca usa a seleção atual.
const lista = (value) => Array.isArray(value) ? value : [];
const incerto = (w) => ["indeterminado", "em_andamento"].includes(w?.estado)
  || Number(w?.indeterminadas) > 0
  || lista(w?.resultados).some((r) => ["indeterminado", "em_andamento"].includes(r.estado));
const naoUtilizado = (r, previa) => typeof r?.naoSeAplica === "boolean" ? r.naoSeAplica
  : previa?.disponivel === false && r?.tentado !== true && !r?.ok;
const mensagem = (text) => /internal (server )?error|fetch failed|failed to fetch/i.test(text || "")
  ? "O serviço não confirmou o envio. Confira o histórico antes de tentar novamente."
  : text;
const unicos = (values) => [...new Set(values.filter(Boolean).map(mensagem))];

function emailDoResultado(r, previa) {
  if (r?.ok === true) return { texto: "Enviado", tom: "ok", atencao: false, enviado: true, detalhes: [] };
  if (r && naoUtilizado(r, previa)) return { texto: "Não utilizado", tom: "neutro", atencao: false, detalhes: unicos([r.message || previa?.mensagem]) };
  return { texto: r?.status ? "Não enviado" : "Não confirmado", tom: "atencao", atencao: true,
    detalhes: unicos([r?.message || "Confira o histórico de envio antes de repetir este canal."]) };
}

function whatsappDoResultado(value, previa, esperadas) {
  const itens = lista(value);
  const omitidas = itens.filter((w) => naoUtilizado(w, previa));
  const ativas = itens.filter((w) => !naoUtilizado(w, previa));
  const aceitas = ativas.filter((w) => !incerto(w) && w.estado !== "ja_enviada" && (w.ok === true || Number(w.aceitas) > 0)).length;
  const anteriores = ativas.filter((w) => w.estado === "ja_enviada").length;
  const falhas = ativas.filter((w) => !incerto(w) && w.estado !== "ja_enviada"
    && (w.ok !== true || w.parcial === true || Number(w.falhas) > 0)).length;
  const incertas = ativas.filter(incerto).length + Math.max(0, esperadas - itens.length);
  const detalhes = unicos(itens.flatMap((w) => [w.message || w.mensagem,
    ...lista(w.resultados).filter((r) => !r.ok || incerto(r)).map((r) => r.message || r.mensagem || r.motivo)]));
  if (omitidas.length === esperadas && !ativas.length) return { texto: "Não utilizado", tom: "neutro", atencao: false, aceitas: 0, detalhes };
  const partes = [aceitas ? `${aceitas} aguardando entrega` : null,
    anteriores ? `${anteriores} com envio anterior` : null,
    falhas ? `${falhas} com falha` : null, incertas ? `${incertas} sem resultado confirmado` : null].filter(Boolean);
  return { texto: partes.join(" · ") || "Não confirmado", tom: falhas || incertas ? "atencao" : "neutro",
    atencao: Boolean(falhas || incertas || !partes.length), aceitas, detalhes };
}

export function resumirLiberacao({ results, previa }) {
  const recebidos = lista(results);
  const linhas = lista(previa?.items).map((item) => {
    const r = recebidos.find((v) => v.portalClientId === item.portalClientId);
    const row = lista(previa.rows).find((v) => v.portalClientId === item.portalClientId);
    const canais = lista(previa.canais?.linhas).find((v) => v.portalClientId === item.portalClientId);
    const esperadas = lista(item.guideIds).length;
    const liberadas = Number.isInteger(r?.liberadas) && r.liberadas >= 0 ? r.liberadas : null;
    const portal = { texto: liberadas === null ? "Não confirmado" : `${liberadas} de ${esperadas} guia${esperadas === 1 ? "" : "s"}`,
      tom: liberadas === esperadas ? "ok" : "atencao", atencao: liberadas !== esperadas };
    const email = emailDoResultado(r?.email, canais?.email);
    const whatsapp = whatsappDoResultado(r?.whatsapp, canais?.whatsapp, esperadas);
    const faltantes = lista(row?.faltantes);
    const atencao = portal.atencao || email.atencao || whatsapp.atencao || faltantes.length > 0 || Boolean(r?.error || r?.message);
    return { companyId: item.portalClientId, nome: row?.razao || "Empresa", esperadas, liberadas,
      portal, email, whatsapp, faltantes, atencao,
      detalhes: unicos([r?.message, ...faltantes.map((p) => `Parcela ${p.numeroParcela ?? "—"} · acordo ${p.acordo || "—"}: ${p.motivo || "guia ainda não disponível"}`)]),
      semAviso: !email.enviado && !whatsapp.aceitas,
    };
  });
  return { mesVencimento: previa?.mesVencimento, linhas, empresas: linhas.length,
    liberadas: linhas.reduce((s, r) => s + (r.liberadas || 0), 0),
    emails: linhas.filter((r) => r.email.enviado).length,
    aguardando: linhas.reduce((s, r) => s + r.whatsapp.aceitas, 0),
    atencao: linhas.filter((r) => r.atencao || r.semAviso).length,
  };
}
