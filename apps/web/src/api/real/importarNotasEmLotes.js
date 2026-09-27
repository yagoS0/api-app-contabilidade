// Respeita os limites de cada rota sem exigir seleção manual de vários lotes.
// Nunca repete automaticamente uma requisição cujo resultado ficou desconhecido.
export async function importarNotasEmLotes(request, companyId, files, type, onProgress, shouldContinue = () => true, background = null) {
  if (background) return importarEmSegundoPlano(background, companyId, files, type, onProgress, shouldContinue);
  const list = (Array.isArray(files) ? files : files ? [files] : []).filter(Boolean);
  const nfe = type === "NFE";
  const limite = nfe ? 20 : 50;
  const totais = { ok: true, detalhes: [], errors: [], arquivos: [], motivos: {} };
  const campos = ["importadas", "duplicadas", "ignoradas", "recusadas", "documentos", "emitidas", "recebidas", "eventosDeCancelamento", "created", "updated", "duplicates", "rejeitadas"];
  let lotesConcluidos = 0;
  let arquivosConcluidos = 0;
  const informar = (etapa, loteAtual = 0, resultadoDesconhecido = false) => onProgress?.({
    etapa, loteAtual, lotesConcluidos, totalLotes: Math.ceil(list.length / limite),
    arquivosConcluidos, totalArquivos: list.length, resultadoDesconhecido,
    totais: { novas: totais.importadas || totais.created || 0, atualizadas: totais.updated || 0,
      duplicadas: totais.duplicadas || totais.duplicates || 0,
      recusadas: nfe ? (totais.ignoradas || 0) + (totais.recusadas || 0) : totais.errors.length },
  });
  informar("preparando");
  for (let inicio = 0; inicio < list.length; inicio += limite) {
    if (!shouldContinue()) {
      informar("interrompida", lotesConcluidos);
      return { ...totais, ok: false, mensagem: "A sessão de importação foi encerrada. Os lotes confirmados foram preservados; os próximos arquivos não foram enviados." };
    }
    const formData = new FormData();
    for (const file of list.slice(inicio, inicio + limite)) formData.append("files", file);
    let out;
    informar("processando", lotesConcluidos + 1);
    try {
      out = await request(`/clients/${companyId}/invoices/import/${nfe ? "nfe" : "xml"}`, { method: "POST", body: formData });
      if (!out || typeof out !== "object" || !(nfe ? "importadas" in out || out.ok === false : "created" in out)) {
        throw new Error("import_result_unknown");
      }
    } catch (err) {
      informar("interrompida", lotesConcluidos + 1, ![400, 413, 422].includes(err?.status));
      const confirmadas = Number(totais.importadas || 0) + Number(totais.created || 0);
      return { ...totais, ok: false, mensagem: `Importação interrompida. ${confirmadas} nova(s), ${totais.updated || 0} atualizada(s) e ${Number(totais.duplicadas || 0) + Number(totais.duplicates || 0)} duplicada(s) confirmadas nos lotes anteriores. ${err?.payload?.message || "Não foi possível confirmar o resultado do último lote. Confira as notas antes de tentar novamente."} Os arquivos seguintes não foram enviados.` };
    }
    for (const campo of campos) totais[campo] = (totais[campo] || 0) + Number(out?.[campo] || 0);
    for (const campo of ["detalhes", "errors", "arquivos"]) {
      totais[campo].push(...(out?.[campo] || []));
    }
    for (const [motivo, quantidade] of Object.entries(out?.motivos || {})) totais.motivos[motivo] = (totais.motivos[motivo] || 0) + quantidade;
    totais.detalhesTruncados ||= out?.detalhesTruncados === true;
    totais.mock ||= out?.mock === true;
    lotesConcluidos += 1;
    arquivosConcluidos += Math.min(limite, list.length - inicio);
    informar(out?.ok === false ? "interrompida" : arquivosConcluidos === list.length ? "concluida" : "processando", lotesConcluidos);
    if (list.length <= limite) return out;
    if (out?.ok === false) return { ...totais, ok: false, mensagem: out.mensagem || "A importação foi interrompida. Confira o resultado dos lotes já enviados antes de tentar novamente." };
  }
  return totais;
}

async function importarEmSegundoPlano(background, companyId, files, type, onProgress, shouldContinue) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean), limit = type === "NFE" ? 20 : 50;
  const batches = [], totalLotes = Math.ceil(list.length / limit);
  let failure = null, arquivosEnviados = 0, arquivosConcluidos = 0, lotesConcluidos = 0;
  const totals = { ok: true, errors: [], arquivos: [], detalhes: [], motivos: {} };
  const report = (etapa) => onProgress?.({ etapa, totalLotes, lotesConcluidos, loteAtual: Math.min(batches.length + 1, totalLotes),
    totalArquivos: list.length, arquivosEnviados, arquivosConcluidos, segundoPlano: true,
    totais: { novas: (totals.created || 0) + (totals.importadas || 0), atualizadas: totals.updated || 0,
      duplicadas: (totals.duplicates || 0) + (totals.duplicadas || 0), recusadas: (totals.recusadas || 0) + totals.errors.length } });
  // Primeiro envia os arquivos. A partir do aceite, o servidor processa independentemente da página.
  for (let i = 0; i < list.length; i += limit) {
    if (!shouldContinue()) { failure = "A sessão foi encerrada. Os arquivos já recebidos continuam em Tarefas."; break; }
    const part = list.slice(i, i + limit), form = new FormData();
    part.forEach(file => form.append("files", file)); report("enviando");
    try {
      const out = await background.start(`/clients/${companyId}/invoices/import/${type === "NFE" ? "nfe" : "xml"}`, { method: "POST", body: form });
      batches.push({ out, size: part.length }); arquivosEnviados += part.length; report("enviando");
    } catch (err) { failure = `O envio dos arquivos foi interrompido. ${err.message} Confira Tarefas antes de repetir; os lotes já aceitos continuam no servidor.`; break; }
  }
  report("processando");
  for (const batch of batches) {
    try {
      const out = await background.result(batch.out);
      if (!out || typeof out !== "object" || !(type === "NFE" ? "importadas" in out || out.ok === false : "created" in out)) {
        throw new Error("Não foi possível confirmar o resultado deste lote. Confira as notas antes de repetir.");
      }
      for (const [key, value] of Object.entries(out || {})) {
        if (typeof value === "number") totals[key] = (totals[key] || 0) + value;
        else if (["errors", "arquivos", "detalhes"].includes(key) && Array.isArray(value)) totals[key].push(...value);
        else if (key === "motivos") for (const [motivo, n] of Object.entries(value || {})) totals.motivos[motivo] = (totals.motivos[motivo] || 0) + n;
      }
      if (out?.ok === false) failure = out.mensagem || "Há arquivos que não puderam ser importados.";
      totals.detalhesTruncados ||= out?.detalhesTruncados;
      arquivosConcluidos += batch.size; lotesConcluidos++; report("processando");
    } catch (err) { failure = `${err.message} Os resultados dos lotes aceitos estão disponíveis em Tarefas.`; }
  }
  report(failure ? "interrompida" : "concluida");
  return { ...totals, ok: !failure, ...(failure ? { mensagem: failure } : {}) };
}
