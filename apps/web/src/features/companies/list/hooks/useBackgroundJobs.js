// C9: resumo dos processos que rodam em SEGUNDO PLANO (downloads de notas e de situações
// fiscais), pra o dashboard avisar que há coisa acontecendo mesmo depois de sair da página
// que disparou. É só um contador — o progresso detalhado continua na página de cada job.
//
// Envio de e-mails em lote NÃO entra aqui: hoje é uma chamada bloqueante, não um job de fundo.
//
// Polling só enquanto a aba está visível e para de vez quando não há job (volta a checar no
// intervalo normal) — o endpoint é barato, mas não há motivo pra bater nele com a aba escondida.

import { useCallback, useEffect, useRef, useState } from "react";

const INTERVALO_OCIOSO_MS = 30000; // nada rodando: só confere de vez em quando
const INTERVALO_ATIVO_MS = 4000;   // com job rodando: atualiza o contador mais rápido

export function useBackgroundJobs({ api, enabled = true }) {
  const [jobs, setJobs] = useState([]);
  const timerRef = useRef(null);

  const check = useCallback(async () => {
    if (!api || typeof api.getJobsAtivos !== "function") return [];
    try {
      const out = await api.getJobsAtivos();
      const lista = Array.isArray(out?.jobs) ? out.jobs : [];
      setJobs(lista);
      return lista;
    } catch {
      // Selo é informativo — falha nunca aparece como erro pro usuário.
      setJobs([]);
      return [];
    }
  }, [api]);

  useEffect(() => {
    if (!enabled) { setJobs([]); return undefined; }
    let cancelado = false;

    async function ciclo() {
      if (cancelado) return;
      if (document.visibilityState === "visible") {
        const lista = await check();
        if (cancelado) return;
        timerRef.current = setTimeout(ciclo, lista.length ? INTERVALO_ATIVO_MS : INTERVALO_OCIOSO_MS);
        return;
      }
      timerRef.current = setTimeout(ciclo, INTERVALO_OCIOSO_MS);
    }
    ciclo();

    return () => {
      cancelado = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, check]);

  const total = jobs.length;
  const processadas = jobs.reduce((s, j) => s + Number(j.processadas || 0), 0);
  const empresas = jobs.reduce((s, j) => s + Number(j.total || 0), 0);

  return { jobs, total, processadas, empresas, refresh: check };
}
