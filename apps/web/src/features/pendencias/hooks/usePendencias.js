// Q41: página Pendências (situação fiscal / SITFIS) — lista + consulta individual e em lote.

import { useCallback, useEffect, useState } from "react";

export function usePendencias({ api, feedback, enabled = true }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const load = useCallback(async () => {
    if (!api || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const out = await api.listFiscalPendencias();
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar as pendências fiscais.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api, enabled]);

  // Consulta o SITFIS de UMA empresa (chamada paga ao SERPRO) e recarrega a lista.
  const consultarUma = useCallback(async (companyId) => {
    if (!api || !companyId) return { ok: false };
    try {
      const res = await api.getSitfis(companyId);
      await load();
      return { ok: true, processando: Boolean(res?.processando), situacao: res?.situacao };
    } catch (err) {
      feedback?.setError?.(err?.reason || err?.message || "Falha ao consultar situação fiscal.");
      return { ok: false, message: err?.reason || err?.message };
    }
  }, [api, load, feedback]);

  // Consulta o SITFIS de várias empresas em sequência.
  //
  // O limite do SERPRO (AV02) é por CONTRATANTE (CNPJ do escritório), não por empresa: cada
  // /Apoiar abre um "slot de processamento". Disparar N consultas coladas queima a cota nas
  // primeiras e as demais voltam todas "processando" — sem relatório, nada é gravado, e a
  // sensação é de que "a situação fiscal não persiste". Por isso aqui:
  //   • espera o tempo que o próprio SERPRO pediu antes da próxima empresa;
  //   • para o lote após alguns limites seguidos, em vez de varrer a lista à toa.
  const consultarLote = useCallback(async (companyIds) => {
    const ids = Array.isArray(companyIds) ? companyIds.filter(Boolean) : [];
    if (!api || ids.length === 0 || running) return;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: ids.length });

    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    const LIMITES_SEGUIDOS_PARA_PARAR = 3;
    let done = 0;
    let comRelatorio = 0;
    let limitados = 0;
    let limitesSeguidos = 0;
    let firstError = null;
    let interrompido = false;

    for (let i = 0; i < ids.length; i += 1) {
      let esperarSegundos = 0;
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await api.getSitfis(ids[i]);
        if (res?.processando) {
          limitados += 1;
          limitesSeguidos += 1;
          esperarSegundos = Number(res?.tempoEsperaSegundos || 0) || 30;
        } else {
          comRelatorio += 1;
          limitesSeguidos = 0;
        }
      } catch (err) {
        if (!firstError) firstError = err?.reason || err?.message || "Falha na consulta.";
        limitesSeguidos = 0;
      }
      done += 1;
      setProgress({ done, total: ids.length });

      if (limitesSeguidos >= LIMITES_SEGUIDOS_PARA_PARAR) { interrompido = true; break; }
      // Só espera se ainda há empresa pela frente.
      if (esperarSegundos > 0 && i < ids.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await espera(Math.min(esperarSegundos, 60) * 1000);
      }
    }

    await load();
    setRunning(false);
    setProgress({ done: 0, total: 0 });

    const restantes = ids.length - done;
    if (interrompido) {
      setError(
        `Lote interrompido: o SERPRO atingiu o limite de solicitações do escritório `
        + `(${comRelatorio} com relatório, ${limitados} aguardando, ${restantes} não consultadas). `
        + `Aguarde alguns minutos e rode de novo — as que já vieram não serão reconsultadas.`,
      );
    } else if (limitados > 0) {
      setError(`Concluído: ${comRelatorio} com relatório, ${limitados} ainda em processamento no SERPRO — reconsulte essas em alguns minutos.`);
    } else if (firstError) {
      setError(`Concluído com erros: ${firstError}`);
    }
  }, [api, running, load]);

  // Q62: baixa em lote as situações fiscais (ZIP) — cria o job, faz polling e baixa o arquivo pronto.
  const [baixando, setBaixando] = useState(false);
  const baixarLote = useCallback(async (companyIds) => {
    const ids = Array.isArray(companyIds) ? companyIds.filter(Boolean) : [];
    if (!api || ids.length === 0 || baixando) return;
    setBaixando(true);
    setError(null);
    try {
      const created = await api.createSitfisDownload(ids);
      const jobId = created?.jobId;
      if (!jobId) throw new Error(created?.message || "Falha ao criar o download.");
      let job = null;
      for (let i = 0; i < 160; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const out = await api.getSitfisDownload(jobId);
        job = out?.job;
        if (!job || ["concluido", "erro", "expirado"].includes(job.status)) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (job?.status !== "concluido") throw new Error(job?.erroMensagem || "O download não concluiu.");
      const blob = await api.fetchSitfisDownloadBlob(jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.arquivoNome || "situacoes-fiscais.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback?.notifySuccess?.(`ZIP com ${job.comPdf ?? 0} situação(ões) fiscal(is) baixado.`);
    } catch (err) {
      setError(err?.message || "Falha ao baixar em lote.");
      feedback?.notifyError?.(err?.message || "Falha ao baixar em lote.");
    } finally {
      setBaixando(false);
    }
  }, [api, baixando, feedback]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, running, progress, reload: load, consultarUma, consultarLote, baixando, baixarLote };
}
