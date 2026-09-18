// Q12.A.4: state + handlers da aba Notas Fiscais.
// Único hook, instanciado pelo CompanyDetailPage via lazy load.

import { useCallback, useEffect, useRef, useState } from "react";
import { resultadoImportacao } from "../lib/resultadoImportacao";

// Competência (YYYY-MM) do mês anterior ao atual.
function prevMonthCompetencia() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function useNotasFiscais({ api, companyId, companyName, feedback }) {
  const empresaAtual = useRef(companyId);
  empresaAtual.current = companyId;
  const importacaoAtiva = useRef(false);
  const leituraNotas = useRef(0);
  const leituraCaptura = useRef(0);
  const leituraDetalhe = useRef(0);
  const capturaAtiva = useRef(false);
  const recarregarNotasAtuais = useRef(null);
  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  const [ano, setAno] = useState(() => new Date().getUTCFullYear());
  const [competencias, setCompetencias] = useState([]);
  const [procuracoes, setProcuracoes] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [erroNotas, setErroNotas] = useState(null);
  const [empresaDaLista, setEmpresaDaLista] = useState(null);
  const [empresaDaCaptura, setEmpresaDaCaptura] = useState(null);
  const [empresaDoDetalhe, setEmpresaDoDetalhe] = useState(null);
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
  const [importAndamento, setImportAndamento] = useState(null);
  const [importModalAberto, setImportModalAberto] = useState(false);
  useEffect(() => {
    if (!importing) return;
    const avisar = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [importing]);
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
    const leitura = ++leituraCaptura.current;
    const atual = () => montado.current && empresaAtual.current === companyId && leituraCaptura.current === leitura;
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
      if (!atual()) return;
      setDfeState(dfe);
      setAdnState(adn);
      setEmpresaDaCaptura(companyId);
    } catch (err) {
      if (atual()) setError(err?.message || "Falha ao carregar o estado da captura.");
    } finally {
      if (atual()) setLoading(false);
    }
  }, [api, companyId]);

  const loadNotas = useCallback(async (filtersOverride) => {
    if (!companyId || !api) return;
    const leitura = ++leituraNotas.current;
    const atual = () => montado.current && empresaAtual.current === companyId && leituraNotas.current === leitura;
    setLoadingNotas(true);
    setErroNotas(null);
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
      if (!atual()) return;
      if (!out || !Array.isArray(out.notas)) throw new Error("Não foi possível confirmar a lista de notas.");
      setNotas(out?.notas || []);
      setNotasTotal(out?.total || 0);
      setNotasSummary(summary);
      setNotasRecebidas(recebidas);
      setEmpresaDaLista(companyId);
    } catch (err) {
      if (atual()) setErroNotas(err?.message || "Falha ao carregar notas.");
    } finally {
      if (atual()) setLoadingNotas(false);
    }
  }, [api, companyId, notasFilters, ano]);
  recarregarNotasAtuais.current = loadNotas;

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadNotas(); }, [loadNotas]);
  useEffect(() => {
    leituraDetalhe.current += 1;
    setNotaAbertaId(null); setNotaAberta(null); setNotaError(null); setNotaLoading(false);
  }, [companyId, notasFilters.competencia]);

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
      await api.resolverPendenciaPosFechamento(companyId, pendId);
      feedback?.notifySuccess?.("Pendência marcada como resolvida.");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally { setSaving(false); }
  }

  async function syncDfe({ env = "prod" } = {}) {
    if (capturaAtiva.current || !companyId) return;
    capturaAtiva.current = true;
    setDfeSyncing(true);
    setDfeLastResult(null);
    try {
      const out = await api.syncDfe(companyId, { env });
      if (!montado.current || empresaAtual.current !== companyId) return;
      if (!out || typeof out.ok !== "boolean" || !out.result || (out.ok && !Number.isFinite(Number(out.result.totalDocs)))) throw new Error("Não foi possível confirmar o resultado da captura DFe. Confira o estado antes de buscar novamente.");
      setDfeLastResult(out?.result || out);
      if (out?.ok) {
        feedback?.notifySuccess?.(`Captura DFe (${env}) concluída — ${out.result?.totalDocs || 0} documentos.`);
      } else {
        feedback?.notifyError?.(out?.result?.message || out?.message || "Falha na captura DFe.");
      }
      // Recarrega estado E a lista de notas — as notas capturadas aparecem sem precisar consultar de novo.
      await Promise.all([loadAll(), recarregarNotasAtuais.current?.()]);
      if (!out.ok && montado.current && empresaAtual.current === companyId) setError(out.result?.message || out.message || "Falha na captura DFe.");
    } catch (err) {
      if (empresaAtual.current === companyId) { setError(err?.message || "Falha na captura DFe."); feedback?.notifyError?.(err?.message || "Erro."); }
    } finally {
      capturaAtiva.current = false;
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
    if (capturaAtiva.current || !companyId) return;
    capturaAtiva.current = true;
    setAdnSyncing(true);
    setAdnLastResult(null);
    try {
      const out = await api.syncAdn(companyId, { env });
      if (!montado.current || empresaAtual.current !== companyId) return;
      if (!out || typeof out.ok !== "boolean" || !out.result || (out.ok && !Number.isFinite(Number(out.result.totalDocs)))) throw new Error("Não foi possível confirmar o resultado da captura NFS-e. Confira o estado antes de buscar novamente.");
      setAdnLastResult(out?.result || out);
      if (out?.ok) {
        feedback?.notifySuccess?.(`Captura NFS-e (${env}) concluída — ${out.result?.totalDocs || 0} documentos.`);
      } else {
        feedback?.notifyError?.(out?.result?.message || out?.message || "Falha na captura ADN.");
      }
      // Recarrega estado E a lista de notas — as notas capturadas aparecem sem precisar consultar de novo.
      await Promise.all([loadAll(), recarregarNotasAtuais.current?.()]);
      if (!out.ok && montado.current && empresaAtual.current === companyId) setError(out.result?.message || out.message || "Falha na captura NFS-e.");
    } catch (err) {
      if (empresaAtual.current === companyId) { setError(err?.message || "Falha na captura NFS-e."); feedback?.notifyError?.(err?.message || "Erro."); }
    } finally {
      capturaAtiva.current = false;
      setAdnSyncing(false);
    }
  }

  // Abre a íntegra da nota. ⚠ `api.getNota` pode não existir (implementação antiga do cliente):
  // nesse caso o modal abre dizendo que a rota não está disponível, em vez de abrir vazio — modal
  // em branco é indistinguível de "esta nota não tem nada".
  const abrirNota = useCallback(async (notaId) => {
    if (!notaId) return;
    const pedido = ++leituraDetalhe.current;
    const atual = () => montado.current && empresaAtual.current === companyId && leituraDetalhe.current === pedido;
    setEmpresaDoDetalhe(companyId);
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
      if (!atual()) return;
      setNotaAberta(out?.nota || null);
      if (!out?.nota) setNotaError("A API respondeu sem os dados da nota.");
    } catch (err) {
      if (atual()) setNotaError(err?.message || "Falha ao carregar a nota.");
    } finally {
      if (atual()) setNotaLoading(false);
    }
  }, [api, companyId]);

  const fecharNota = useCallback(() => {
    leituraDetalhe.current += 1;
    setNotaAbertaId(null);
    setNotaAberta(null);
    setNotaError(null);
    setNotaLoading(false);
  }, []);

  // Marca uma nota como cancelada (some do faturamento/apuração) ou reativa.
  async function marcarNotaStatus(notaId, statusEfetivo) {
    if (!api?.marcarNotaStatus) { feedback?.notifyError?.("Ação indisponível."); return; }
    try {
      await api.marcarNotaStatus(companyId, notaId, statusEfetivo);
      if (!montado.current || empresaAtual.current !== companyId) return;
      feedback?.notifySuccess?.(statusEfetivo === "cancelada" ? "Nota marcada como cancelada." : "Nota reativada.");
      await recarregarNotasAtuais.current?.();
    } catch (err) {
      if (montado.current && empresaAtual.current === companyId) feedback?.notifyError?.(err?.message || "Falha ao atualizar a nota.");
    }
  }

  // Q56: import MANUAL de notas via upload de XML (pra empresas onde a captura automática falhou)
  async function importNotas(files, { type = "NFSE" } = {}) {
    const list = Array.isArray(files) ? files : (files ? [files] : []);
    if (!list.length || importacaoAtiva.current || !companyId) return;
    if (!api?.importInvoicesXml) {
      feedback?.notifyError?.("Import de notas não disponível.");
      return;
    }
    importacaoAtiva.current = true;
    const destino = companyId;
    setImporting(true);
    setImportResult(null);
    setImportAndamento({ companyId: destino, empresa: companyName || "Empresa selecionada", type, mock: api.mode === "mock", temZip: list.some(f => /\.zip$/i.test(f.name)), progresso: { etapa: "preparando", totalArquivos: list.length, totalLotes: Math.ceil(list.length / (type === "NFE" ? 20 : 50)) } });
    setImportModalAberto(true);
    try {
      const out = await api.importInvoicesXml(destino, list, { type, shouldContinue: () => montado.current, onProgress: (progresso) => {
        if (montado.current) setImportAndamento(atual => ({ ...atual, progresso }));
      } });
      if (!montado.current) return;
      const resultado = resultadoImportacao(out, type);
      setImportResult({ ...resultado, companyId: destino });
      if (resultado.falhou || resultado.quantidadeProblemas > 0) feedback?.notifyError?.(resultado.mensagem);
      else feedback?.notifySuccess?.(resultado.mensagem);
      if (empresaAtual.current === destino) await recarregarNotasAtuais.current?.();
    } catch (err) {
      if (montado.current) {
        setImportAndamento(atual => ({ ...atual, progresso: { ...atual?.progresso, etapa: "interrompida" } }));
        setImportResult({ companyId: destino, type, falhou: true, problemas: [], mensagem: err?.message || "Não foi possível confirmar a importação. Confira as notas antes de tentar novamente." });
        feedback?.notifyError?.(err?.message || "Falha ao importar notas.");
      }
    } finally {
      importacaoAtiva.current = false;
      if (montado.current) setImporting(false);
    }
  }

  return {
    // A aba precisa dele para emitir (o payload da NFS-e carrega `companyId`). Estava só no escopo
    // do hook: sem isso, a tela teria de recebê-lo por um segundo caminho e os dois poderiam
    // divergir ao trocar de empresa com a aba aberta.
    companyId,
    ano, setAno,
    competencias, procuracoes, pendencias,
    loading, saving, error: error || erroNotas, erroCaptura: error, erroNotas,
    reload: loadAll,
    // ⚠⚠ ESTES CINCO NÃO TÊM CONSUMIDOR — medido em 24/08/2026, varrendo cada nome em todo o
    // `src`: **zero chamadas** fora deste arquivo. (O `panel.resolverPendencia` que aparece em
    // `renderApuracaoV2Tab.jsx:522` é de OUTRO hook, o `useApuracaoV2`; não é este.)
    //
    // ⚠ E eles não morreram um a um: morreram TODOS NO MESMO EVENTO. A aba Notas Fiscais foi
    // enxugada em 23/08/2026 para duas janelas (NFS-e e NF-e), sem stats nem legendas, e os painéis
    // que os acionavam saíram da tela juntos — `ProcuracoesPanel` (`onCreate`/`onRevogar`),
    // `CompetenciaDetailPanel` (`onFechar`/`onReabrir`) e `ReabrirCompetenciaModal` (`onConfirm`).
    // Os três estão órfãos, marcados no próprio cabeçalho, e listados em `apps/web/CLAUDE.md`.
    //
    // ⚠⚠ **A CADEIA DE BAIXO ESTÁ VIVA E É REAL** — não são funções de mentira. `reabrirCompetencia`
    // chega até `CompetenciaStateMachine.reabrirCompetencia` no backend, que EXIGE `reason` e tem
    // teste próprio. Ou seja: a porta some da tela e o ato continua existindo. É exatamente por isso
    // que eles ficam **e ficam anotados**, em vez de serem apagados por parecerem inúteis.
    //
    // ⚠ E há precedente contra apagar, neste mesmo diretório: o `PendenciasList` passou meses "sem
    // consumidor" e foi RECONECTADO quando a aba Auditoria nasceu (ver `renderAuditoriaTab.jsx:13`).
    createProcuracao, revogarProcuracao,
    fecharCompetencia, reabrirCompetencia,
    resolverPendencia,
    // Q12.B
    dfeState: empresaDaCaptura === companyId ? dfeState : null, dfeSyncing, dfeLastResult, syncDfe, clearDfeError,
    // Q12.B+: NFS-e via ADN
    adnState: empresaDaCaptura === companyId ? adnState : null, adnSyncing, adnLastResult, syncAdn, clearAdnError,
    // Q12.C.1: listagem de notas
    notas: empresaDaLista === companyId ? notas : [], notasTotal: empresaDaLista === companyId ? notasTotal : 0,
    notasSummary: empresaDaLista === companyId ? notasSummary : null, notasRecebidas: empresaDaLista === companyId ? notasRecebidas : null,
    notasFilters, setNotasFilters,
    loadingNotas, loadNotas, marcarNotaStatus,
    // Íntegra da nota (clique na linha)
    notaAbertaId: empresaDoDetalhe === companyId ? notaAbertaId : null,
    notaAberta: empresaDoDetalhe === companyId ? notaAberta : null, notaLoading, notaError, abrirNota, fecharNota,
    // Q56: import manual de notas (XML)
    importing, importResult: !importResult?.companyId || importResult.companyId === companyId ? importResult : null, importNotas,
    importAndamento, importModalAberto, importModalResultado: importResult,
    fecharImportModal: () => { if (!importacaoAtiva.current) setImportModalAberto(false); },
  };
}
