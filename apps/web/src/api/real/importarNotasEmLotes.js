// Respeita os limites de cada rota sem exigir seleção manual de vários lotes.
// Nunca repete automaticamente uma requisição cujo resultado ficou desconhecido.
export async function importarNotasEmLotes(request, companyId, files, type) {
  const list = (Array.isArray(files) ? files : files ? [files] : []).filter(Boolean);
  const nfe = type === "NFE";
  const limite = nfe ? 20 : 50;
  const totais = { ok: true, detalhes: [], errors: [], arquivos: [], motivos: {} };
  const campos = ["importadas", "duplicadas", "ignoradas", "recusadas", "documentos", "emitidas", "recebidas", "eventosDeCancelamento", "created", "updated", "duplicates", "rejeitadas"];
  for (let inicio = 0; inicio < list.length; inicio += limite) {
    const formData = new FormData();
    for (const file of list.slice(inicio, inicio + limite)) formData.append("files", file);
    let out;
    try {
      out = await request(`/clients/${companyId}/invoices/import/${nfe ? "nfe" : "xml"}`, { method: "POST", body: formData });
      if (!out || typeof out !== "object" || !(nfe ? "importadas" in out || out.ok === false : "created" in out)) {
        throw new Error("import_result_unknown");
      }
    } catch (err) {
      const confirmadas = Number(totais.importadas || 0) + Number(totais.created || 0);
      return { ...totais, ok: false, mensagem: `Importação interrompida. ${confirmadas} nova(s), ${totais.updated || 0} atualizada(s) e ${Number(totais.duplicadas || 0) + Number(totais.duplicates || 0)} duplicada(s) confirmadas nos lotes anteriores. ${err?.payload?.message || "Não foi possível confirmar o resultado do último lote. Confira as notas antes de tentar novamente."} Os arquivos seguintes não foram enviados.` };
    }
    if (list.length <= limite) return out;
    for (const campo of campos) totais[campo] = (totais[campo] || 0) + Number(out?.[campo] || 0);
    for (const campo of ["detalhes", "errors", "arquivos"]) {
      totais[campo].push(...(out?.[campo] || []));
    }
    for (const [motivo, quantidade] of Object.entries(out?.motivos || {})) totais.motivos[motivo] = (totais.motivos[motivo] || 0) + quantidade;
    totais.detalhesTruncados ||= out?.detalhesTruncados === true;
    if (out?.ok === false) return { ...totais, ok: false, mensagem: out.mensagem || "A importação foi interrompida. Confira o resultado dos lotes já enviados antes de tentar novamente." };
  }
  return totais;
}
