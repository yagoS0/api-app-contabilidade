// Q12.A.4: state + handlers da aba Notas Fiscais.
// Único hook, instanciado pelo CompanyDetailPage via lazy load.

import { useCallback, useEffect, useState } from "react";

// Competência (YYYY-MM) do mês anterior ao atual.
function prevMonthCompetencia() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function useNotasFiscais({ api, companyId, feedback }) {
  const [ano, setAno] = useState(() => new Date().getUTCFullYear());
  const [competencias, setCompetencias] = useState([]);
  const [procuracoes, setProcuracoes] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Q12.B
  const [dfeState, setDfeState] = useState(null);
  const [dfeSyncing, setDfeSyncing] = useState(false);
  const [dfeLastResult, setDfeLastResult] = useState(null);
  // Q12.B+: ADN/NFS-e
  const [adnState, setAdnState] = useState(null);
  const [adnSyncing, setAdnSyncing] = useState(false);
  const [adnLastResult, setAdnLastResult] = useState(null);

  // Q56: import MANUAL de notas (XML)
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  // Q12.C.1: listagem de notas + resumo
  const [notas, setNotas] = useState([]);
  const [notasTotal, setNotasTotal] = useState(0);
  const [notasSummary, setNotasSummary] = useState(null);
  // ⚠ SEGUNDO resumo, e ele responde OUTRA pergunta — por isso não dá para reusar o de cima.
  // `notasSummary` é da JANELA ativa (`type` fixo, `papel` livre, porque as caixas Emitidas/
  // Recebidas são o seletor de papel). Este é o inverso: `papel` fixo em DEST e `type` LIVRE,
  // para responder "quantas notas esta empresa RECEBEU nesta competência?" — que é a pergunta do
  // dono e que atravessa as duas janelas. Somar as duas janelas na tela não serviria: cada uma
  // carrega só uma PÁGINA (100), e o resumo ignora paginação de propósito.
  const [notasRecebidas, setNotasRecebidas] = useState(null);
  // Q19: filtro de competência das notas começa no mês ANTERIOR ao atual (default).
  // Q20: + filtro por atividade (cfop / servico = código LC116 ou nome).
  // papel começa em EMIT: as notas EMITIDAS são o faturamento (o que a apuração usa), então é
  // o que o contador quer ver ao abrir. As caixas do resumo trocam esse filtro.
  // `incluirCanceladas`: a listagem esconde canceladas por padrão (não são faturamento), mas
  // precisamos conseguir VER quais foram canceladas pra conferir o cancelamento — senão o
  // contador de canceladas do resumo aponta para notas invisíveis.
  const [notasFilters, setNotasFilters] = useState({ papel: "EMIT", type: "", competencia: prevMonthCompetencia(), search: "", cfop: "", servico: "", incluirCanceladas: "", limit: 100, offset: 0 });
  const [loadingNotas, setLoadingNotas] = useState(false);
  // Íntegra de UMA nota (clique na linha). Estado próprio: a lista é enxuta de propósito, e o
  // detalhe carrega itens + XML, que não cabem — nem devem caber — em toda linha da tabela.
  const [notaAberta, setNotaAberta] = useState(null);      // { id, ...campos } quando carregada
  const [notaAbertaId, setNotaAbertaId] = useState(null);  // marcado ANTES do fetch: o modal abre
                                                           // com o esqueleto, não depois da rede
  const [notaLoading, setNotaLoading] = useState(false);
  const [notaError, setNotaError] = useState(null);

  const loadAll = useCallback(async () => {
    if (!companyId || !api) return;
    setLoading(true);
    setError(null);
    try {
      // Q12.B++: procurações são registradas no e-CAC da Receita, não no nosso banco.
      // Não carregamos listProcuracoes mais aqui. competências/pendências movem-se
      // pra página global de Apuração — não carregadas aqui.
      // Q12.B+++.X: summary não vem aqui — vai junto com loadNotas (mesmos filtros).
      const [dfe, adn] = await Promise.all([
        api.getDfeState ? api.getDfeState(companyId) : Promise.resolve(null),
        api.getAdnState ? api.getAdnState(companyId) : Promise.resolve(null),
      ]);
      setDfeState(dfe);
      setAdnState(adn);
    } catch (err) {
      setError(err?.message || "Falha ao carregar Notas Fiscais.");
    } finally {
      setLoading(false);
    }
  }, [api, companyId]);

  const loadNotas = useCallback(async (filtersOverride) => {
    if (!companyId || !api) return;
    setLoadingNotas(true);
    try {
      const f = filtersOverride || notasFilters;
      // Listagem + summary em paralelo com os mesmos filtros — MENOS `papel`: as caixas
      // Emitidas/Recebidas SÃO o seletor de papel, então precisam continuar mostrando os dois
      // valores. Se o summary respeitasse o papel, clicar em "Emitidas" zerava a caixa de
      // "Recebidas" e não dava mais pra voltar por ela.
      const summaryArgs = { ano, type: f.type, competencia: f.competencia, search: f.search, cfop: f.cfop, servico: f.servico };
      // ⚠ MESMOS filtros de texto/atividade da tabela, e NENHUM `type`: o bloco "Notas recebidas"
      // conta as DUAS espécies. Se ele ignorasse `search`/`cfop`/`servico`, o número da tela
      // deixaria de fechar com as linhas no instante em que alguém digitasse na busca — e total
      // que não fecha com a lista é pior que total nenhum (regra escrita em `resumoDaEmissao`).
      const recebidasArgs = { ano, papel: "DEST", competencia: f.competencia, search: f.search, cfop: f.cfop, servico: f.servico };
      const [out, summary, recebidas] = await Promise.all([
        api.listNotas(companyId, f),
        api.getNotasSummary ? api.getNotasSummary(companyId, summaryArgs) : Promise.resolve(null),
        api.getNotasSummary ? api.getNotasSummary(companyId, recebidasArgs) : Promise.resolve(null),
      ]);
      setNotas(out?.notas || []);
      setNotasTotal(out?.total || 0);
      setNotasSummary(summary);
      setNotasRecebidas(recebidas);
    } catch (err) {
      setError(err?.message || "Falha ao carregar notas.");
    } finally {
      setLoadingNotas(false);
    }
  }, [api, companyId, notasFilters, ano]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadNotas(); }, [loadNotas]);

  async function createProcuracao(body) {
    setSaving(true);
    try {
      const out = await api.createProcuracao(companyId, body);
      if (!out?.ok) throw new Error(out?.message || "Falha ao criar procuração.");
      feedback?.notifySuccess?.("Procuração cadastrada.");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
      throw err;
    } finally { setSaving(false); }
  }

  async function revogarProcuracao(procId) {
    setSaving(true);
    try {
      await api.revogarProcuracao(companyId, procId);
      feedback?.notifySuccess?.("Procuração revogada.");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally { setSaving(false); }
  }

  async function fecharCompetencia(competencia) {
    setSaving(true);
    try {
      const out = await api.fecharCompetencia(companyId, competencia);
      if (!out?.ok) throw new Error(out?.message || "Falha ao fechar competência.");
      feedback?.notifySuccess?.(`Competência ${competencia} fechada.`);
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
      throw err;
    } finally { setSaving(false); }
  }

  async function reabrirCompetencia(competencia, reason) {
    setSaving(true);
    try {
      const out = await api.reabrirCompetencia(companyId, competencia, reason);
      if (!out?.ok) throw new Error(out?.message || "Falha ao reabrir competência.");
      feedback?.notifySuccess?.(`Competência ${competencia} reaberta.`);
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
      throw err;
    } finally { setSaving(false); }
  }

  async function resolverPendencia(pendId) {
    setSaving(true);
    try {
      await api.resolverPendencia(companyId, pendId);
      feedback?.notifySuccess?.("Pendência marcada como resolvida.");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally { setSaving(false); }
  }

  async function syncDfe({ env = "prod" } = {}) {
    setDfeSyncing(true);
    setDfeLastResult(null);
    try {
      const out = await api.syncDfe(companyId, { env });
      setDfeLastResult(out?.result || out);
      if (out?.ok) {
        feedback?.notifySuccess?.(`Captura DFe (${env}) concluída — ${out.result?.totalDocs || 0} documentos.`);
      } else {
        feedback?.notifyError?.(out?.result?.message || out?.message || "Falha na captura DFe.");
      }
      // Recarrega estado E a lista de notas — as notas capturadas aparecem sem precisar consultar de novo.
      await Promise.all([loadAll(), loadNotas()]);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally {
      setDfeSyncing(false);
    }
  }

  async function clearDfeError() {
    try {
      await api.clearDfeError(companyId);
      feedback?.notifySuccess?.("Erro DFe limpo.");
      await loadAll();
    } catch (err) { feedback?.notifyError?.(err?.message || "Erro."); }
  }
  async function clearAdnError() {
    try {
      await api.clearAdnError(companyId);
      feedback?.notifySuccess?.("Erro ADN limpo.");
      await loadAll();
    } catch (err) { feedback?.notifyError?.(err?.message || "Erro."); }
  }

  async function syncAdn({ env = "prod" } = {}) {
    setAdnSyncing(true);
    setAdnLastResult(null);
    try {
      const out = await api.syncAdn(companyId, { env });
      setAdnLastResult(out?.result || out);
      if (out?.ok) {
        feedback?.notifySuccess?.(`Captura NFS-e (${env}) concluída — ${out.result?.totalDocs || 0} documentos.`);
      } else {
        feedback?.notifyError?.(out?.result?.message || out?.message || "Falha na captura ADN.");
      }
      // Recarrega estado E a lista de notas — as notas capturadas aparecem sem precisar consultar de novo.
      await Promise.all([loadAll(), loadNotas()]);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally {
      setAdnSyncing(false);
    }
  }

  // Abre a íntegra da nota. ⚠ `api.getNota` pode não existir (implementação antiga do cliente):
  // nesse caso o modal abre dizendo que a rota não está disponível, em vez de abrir vazio — modal
  // em branco é indistinguível de "esta nota não tem nada".
  const abrirNota = useCallback(async (notaId) => {
    if (!notaId) return;
    setNotaAbertaId(notaId);
    setNotaAberta(null);
    setNotaError(null);
    if (!api?.getNota) {
      setNotaError("Detalhe da nota indisponível nesta versão da API.");
      return;
    }
    setNotaLoading(true);
    try {
      const out = await api.getNota(companyId, notaId);
      setNotaAberta(out?.nota || null);
      if (!out?.nota) setNotaError("A API respondeu sem os dados da nota.");
    } catch (err) {
      setNotaError(err?.message || "Falha ao carregar a nota.");
    } finally {
      setNotaLoading(false);
    }
  }, [api, companyId]);

  const fecharNota = useCallback(() => {
    setNotaAbertaId(null);
    setNotaAberta(null);
    setNotaError(null);
  }, []);

  // Marca uma nota como cancelada (some do faturamento/apuração) ou reativa.
  async function marcarNotaStatus(notaId, statusEfetivo) {
    if (!api?.marcarNotaStatus) { feedback?.notifyError?.("Ação indisponível."); return; }
    try {
      await api.marcarNotaStatus(companyId, notaId, statusEfetivo);
      feedback?.notifySuccess?.(statusEfetivo === "cancelada" ? "Nota marcada como cancelada." : "Nota reativada.");
      await loadNotas();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao atualizar a nota.");
    }
  }

  // Q56: import MANUAL de notas via upload de XML (pra empresas onde a captura automática falhou)
  async function importNotas(files) {
    const list = Array.isArray(files) ? files : (files ? [files] : []);
    if (!list.length) return;
    if (!api?.importInvoicesXml) {
      feedback?.notifyError?.("Import de notas não disponível.");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const out = await api.importInvoicesXml(companyId, list);
      setImportResult(out || null);
      const created = out?.created ?? 0;
      const updated = out?.updated ?? 0;
      const dup = out?.duplicates ?? 0;
      const errs = Array.isArray(out?.errors) ? out.errors.length : 0;
      if (errs && !created && !updated) {
        feedback?.notifyError?.(`Nenhuma nota importada — ${errs} arquivo(s) com erro.`);
      } else {
        feedback?.notifySuccess?.(
          `Importação concluída — ${created} nova(s), ${updated} atualizada(s)` +
          (dup ? `, ${dup} duplicada(s)` : "") +
          (errs ? `, ${errs} com erro` : "") + "."
        );
      }
      await loadNotas();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao importar notas.");
    } finally {
      setImporting(false);
    }
  }

  return {
    // A aba precisa dele para emitir (o payload da NFS-e carrega `companyId`). Estava só no escopo
    // do hook: sem isso, a tela teria de recebê-lo por um segundo caminho e os dois poderiam
    // divergir ao trocar de empresa com a aba aberta.
    companyId,
    ano, setAno,
    competencias, procuracoes, pendencias,
    loading, saving, error,
    reload: loadAll,
    createProcuracao, revogarProcuracao,
    fecharCompetencia, reabrirCompetencia,
    resolverPendencia,
    // Q12.B
    dfeState, dfeSyncing, dfeLastResult, syncDfe, clearDfeError,
    // Q12.B+: NFS-e via ADN
    adnState, adnSyncing, adnLastResult, syncAdn, clearAdnError,
    // Q12.C.1: listagem de notas
    notas, notasTotal, notasSummary, notasRecebidas,
    notasFilters, setNotasFilters,
    loadingNotas, loadNotas, marcarNotaStatus,
    // Íntegra da nota (clique na linha)
    notaAbertaId, notaAberta, notaLoading, notaError, abrirNota, fecharNota,
    // Q56: import manual de notas (XML)
    importing, importResult, importNotas,
  };
}
