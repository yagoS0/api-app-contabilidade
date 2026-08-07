import { useEffect, useState } from "react";
import { useAccountingEntries } from "../../features/accounting/hooks/useManageAccountingEntries";
import { useChartOfAccounts } from "../../features/accounting/hooks/useManageChartOfAccounts";
import { parseCompetencia, competenciaPadrao } from "../../lib/competencia";

export function useManageAccountingWorkspace({ api, page, selectedCompanyId, companyDetailTab, feedback }) {
  const accountingEntriesState = useAccountingEntries();
  const chartOfAccountsState = useChartOfAccounts();
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBaixa, setSavingBaixa] = useState(false);
  const [savingCircular, setSavingCircular] = useState(false);
  const [approvingCircularEntryId, setApprovingCircularEntryId] = useState("");
  const [circularData, setCircularData] = useState(null);
  const [loadingCircular, setLoadingCircular] = useState(false);
  // ⚠ O ano da matriz nasce do ANO DA COMPETÊNCIA, não do relógio.
  // A competência de trabalho é o mês fechado, então em JANEIRO ela aponta para dezembro do ano
  // anterior — com `new Date().getFullYear()` a Circular abria no ano novo, vazia, exatamente no
  // mês em que se fecha o ano. Depois de aberta o seletor de ano é livre: ele navega a MATRIZ
  // (12 meses são o eixo dela), enquanto a competência diz em que mês se está trabalhando.
  const [circularYear, setCircularYear] = useState(
    () => parseCompetencia(competenciaPadrao())?.ano || new Date().getFullYear(),
  );

  // ⚠ COMPETÊNCIA GLOBAL — uma só para a empresa inteira.
  //
  // Eram DUAS, com defaults DIFERENTES: os lançamentos nasciam no mês anterior (competência
  // fechada, que é como o contador trabalha) e a Circular no mês corrente. Trocar de aba mudava o
  // mês sem dizer nada, e cada tela mostrava um período diferente da mesma empresa — a pessoa
  // comparava número de julho com número de agosto sem ter como perceber.
  //
  // A fonte agora é `accountingEntriesState.filters.competencia`, porque o `useEffect` de carga dos
  // lançamentos já observa `filters`: escrever ali recarrega sozinho, sem um segundo caminho de
  // sincronização para divergir. O default vence o do calendário do escritório (mês anterior), o
  // mesmo do dashboard.
  const circularCompetencia = accountingEntriesState.filters.competencia;
  function setCircularCompetencia(value) {
    if (!value) return;
    accountingEntriesState.setFilter("competencia", value);
    // Mudou de ANO no header? A matriz vai junto — senão a pessoa trabalha em dezembro/2025 olhando
    // a grade de 2026. Trocar só o mês DENTRO do ano não mexe na matriz (ela já mostra os 12).
    //
    // ⚠ O reload leva os DOIS valores novos explicitamente. `handleCircularYearChange` chamaria
    // `loadCircular(ano)` e a competência cairia no default do parâmetro — que é o valor DESTE
    // render, ainda o antigo. A revisão da Circular viria do mês errado, calada.
    const ano = parseCompetencia(value)?.ano;
    if (ano && ano !== circularYear) {
      setCircularYear(ano);
      loadCircular(ano, value);
    }
  }
  const [entriesMessage, setEntriesMessage] = useState("");
  const [entriesError, setEntriesError] = useState("");

  // Fiscal operation state
  const [runningFiscalAction, setRunningFiscalAction] = useState(null);
  const [lastFiscalResult, setLastFiscalResult] = useState(null);

  // Fiscal execution history
  const [fiscalExecutions, setFiscalExecutions] = useState([]);
  const [loadingFiscalExecutions, setLoadingFiscalExecutions] = useState(false);

  async function loadChartOfAccounts(companyId = selectedCompanyId) {
    if (!companyId) return;
    chartOfAccountsState.setLoading(true);
    try {
      const data = await api.getChartOfAccounts(companyId);
      chartOfAccountsState.setAccounts(data);
    } catch {
      chartOfAccountsState.setAccounts([]);
    } finally {
      chartOfAccountsState.setLoading(false);
    }
  }

  // A tabela mostra TODOS os lançamentos da competência — ela não pagina.
  //
  // ⚠ A rota `GET /entries` pagina, e o default dela é 50. Como esta função não mandava
  // `page`/`limit`, só a PRIMEIRA página chegava: mês com mais de 50 lançamentos exibia os
  // 50 mais antigos (`orderBy: data asc`) e escondia o resto **sem nenhum aviso na tela** —
  // não há controle de paginação na aba, e o `total` não é renderizado em lugar nenhum. O
  // sintoma era "lançamento sumindo", e não há controle de paginação na aba que sugerisse
  // existir uma página 2.
  //
  // O RODAPÉ ESTAVA SE CONTRADIZENDO, e é a assinatura do defeito: a contagem sai de
  // `total` (o `count` do backend, sempre certo) e as somas D/C saem de `entries` (só o
  // que chegou). Num mês de 450 lançamentos ele dizia "450 lançamentos no total · D <soma
  // de 50> · C <soma de 50> ✓ ok" — com o "✓ ok" e tudo, porque os 50 carregados batem
  // entre si. Número certo ao lado de soma errada, carimbado de conferido.
  // (O gate de fechamento não foi afetado: `validateFechamentoContabil` /
  // `fechamentoBlockers` fazem a própria query no banco.)
  //
  // O CSV nunca teve limite (`/entries/export/csv` não pagina), então tela e exportação
  // discordavam — é o teste mais rápido se a lista for contestada de novo.
  //
  // O teto de 200 por chamada fica no backend de propósito (guarda da query). Quem percorre
  // as páginas é aqui: até 200 lançamentos no mês continua sendo UMA requisição, igual antes.
  async function loadAccountingEntries(companyId = selectedCompanyId) {
    if (!companyId) return;
    accountingEntriesState.setLoading(true);
    setEntriesError("");
    try {
      const PAGINA = 200; // = teto do backend; pedir mais não traz mais
      const primeira = await api.getAccountingEntries(companyId, {
        ...accountingEntriesState.filters,
        page: 1,
        limit: PAGINA,
      });
      const todos = [...primeira.data];
      const total = Number(primeira.total || 0);

      // `numeroPagina`, não `page`: o hook já recebe uma prop `page` (qual tela do app está
      // aberta). Um contador de paginação com esse nome a sombreia dentro do laço.
      for (let numeroPagina = 2; todos.length < total; numeroPagina += 1) {
        const proxima = await api.getAccountingEntries(companyId, {
          ...accountingEntriesState.filters,
          page: numeroPagina,
          limit: PAGINA,
        });
        // Página vazia com `total` ainda por alcançar é o servidor se contradizendo.
        // Parar aqui evita laço infinito, mas NÃO pode ser silencioso: exibir menos do que
        // existe sem dizer nada é exatamente o defeito que esta função passou a corrigir.
        if (!proxima.data.length) {
          setEntriesError(
            `Carregados ${todos.length} de ${total} lançamentos — o servidor parou de responder ` +
              `com dados. A lista está incompleta; recarregue antes de fechar o mês.`
          );
          break;
        }
        todos.push(...proxima.data);
      }

      accountingEntriesState.setEntries(todos);
      accountingEntriesState.setTotal(total);
    } catch (err) {
      setEntriesError(err?.message || "Falha ao carregar lançamentos.");
      accountingEntriesState.setEntries([]);
    } finally {
      accountingEntriesState.setLoading(false);
    }
  }

  async function loadCircular(year = circularYear, competencia = circularCompetencia) {
    if (!selectedCompanyId) return;
    setLoadingCircular(true);
    setEntriesError("");
    try {
      const yearly = await api.getCircular(selectedCompanyId, { year });
      let review = null;
      if (competencia) {
        try {
          review = await api.getCircularAccountingEntries(selectedCompanyId, competencia);
        } catch {
          review = null;
        }
      }
      setCircularData({
        ...yearly,
        circular: review?.circular || null,
        accountingReview: review || null,
        reviewEntries: Array.isArray(review?.entries) ? review.entries : [],
        reviewAllEntries: Array.isArray(review?.allEntries) ? review.allEntries : [],
      });
    } catch (err) {
      setEntriesError(err?.message || "Falha ao carregar circular.");
    } finally {
      setLoadingCircular(false);
    }
  }

  async function handleSaveCircular(input) {
    if (!selectedCompanyId) return;
    setSavingCircular(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      // Frente B: a matriz edita a célula de um mês específico → aceita override por input.competencia.
      const { competencia: compOverride, ...patch } = input || {};
      const competencia = compOverride || circularCompetencia;
      await api.updateCircular(selectedCompanyId, competencia, patch);
      await loadCircular(circularYear, competencia);
      setEntriesMessage("Circular atualizada e lançamentos regenerados.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao salvar circular.");
    } finally {
      setSavingCircular(false);
    }
  }

  async function handleApproveCircularEntry(entryId) {
    if (!selectedCompanyId || !entryId) return;
    setApprovingCircularEntryId(entryId);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.approveAccountingEntry(selectedCompanyId, entryId);
      await loadCircular(circularYear, circularCompetencia);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento da circular aprovado.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao aprovar lançamento.");
    } finally {
      setApprovingCircularEntryId("");
    }
  }

  async function handleCreateBaixa(entryId, input) {
    if (!selectedCompanyId) return;
    setSavingBaixa(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      // Q47: INSS na Circular é sintético (synthetic-inss-<guideId>) — a baixa é roteada pela guia.
      if (String(entryId).startsWith("synthetic-inss-")) {
        const guideId = String(entryId).replace("synthetic-inss-", "");
        await api.saveInssBaixa(selectedCompanyId, guideId, input);
      } else {
        await api.createBaixa(selectedCompanyId, entryId, input);
      }
      await loadAccountingEntries(selectedCompanyId);
      if (companyDetailTab === "circular") await loadCircular(circularYear, circularCompetencia);
      setEntriesMessage("Baixa registrada com sucesso.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao criar baixa.");
    } finally {
      setSavingBaixa(false);
    }
  }

  async function searchHistoricos(q) {
    if (!selectedCompanyId) return [];
    return api.searchHistoricos(selectedCompanyId, q);
  }

  async function getHistoricosByCode(codigo) {
    if (!selectedCompanyId) return [];
    return api.getHistoricosByCode(selectedCompanyId, codigo);
  }

  async function loadAllHistoricos() {
    if (!selectedCompanyId) return [];
    return api.getAllHistoricos(selectedCompanyId);
  }

  async function handleUpdateHistorico(id, input) {
    if (!selectedCompanyId) return { ok: false };
    return api.updateHistorico(selectedCompanyId, id, input);
  }

  async function handleDeleteHistorico(id) {
    if (!selectedCompanyId) return;
    return api.deleteHistorico(selectedCompanyId, id);
  }

  async function handleCreateEntry(input) {
    if (!selectedCompanyId) return null;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      const result = await api.createAccountingEntry(selectedCompanyId, input);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento adicionado.");
      return result;
    } catch (err) {
      setEntriesError(err?.message || "Falha ao criar lançamento.");
      return null;
    } finally {
      setSavingEntry(false);
    }
  }

  // Q52: folha/pró-labore — cada linha do modal vira um lançamento individual;
  // o backend cria todos os da competência numa transaction (1 lote por mês).
  async function handleCreateFolha(payload) {
    if (!selectedCompanyId) return null;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      const result = await api.createFolhaEntries(selectedCompanyId, payload);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamentos de folha/pró-labore adicionados.");
      return result;
    } catch (err) {
      setEntriesError(err?.message || "Falha ao criar lançamentos de folha/pró-labore.");
      // Re-lança para o caller (loop de repetição) parar no mês que falhou.
      throw err;
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleLoadPayrollTemplate(kind, competencia) {
    if (!selectedCompanyId) return null;
    return api.getPayrollTemplate(selectedCompanyId, kind, competencia);
  }

  async function handleLoadBaixaTemplate(entryId) {
    if (!selectedCompanyId) return null;
    // Q47: INSS sintético → template roteado pela guia (contas da folha / caixa).
    if (String(entryId).startsWith("synthetic-inss-")) {
      const guideId = String(entryId).replace("synthetic-inss-", "");
      return api.getInssBaixaTemplate(selectedCompanyId, guideId);
    }
    return api.getBaixaTemplate(selectedCompanyId, entryId);
  }

  async function handleUpdateEntry(entryId, input) {
    if (!selectedCompanyId) return { ok: false, error: "no_company" };
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      const result = await api.updateAccountingEntry(selectedCompanyId, entryId, input);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento atualizado.");
      return result;
    } catch (err) {
      setEntriesError(err?.message || "Falha ao atualizar lançamento.");
      // Re-lança para o caller (modal) também conseguir exibir.
      throw err;
    } finally {
      setSavingEntry(false);
    }
  }

  /**
   * O texto do confirm de exclusão, com histórico, data e valor do lançamento.
   * Lançamento não encontrado na lista carregada cai na frase genérica — melhor perguntar de forma
   * vaga do que afirmar dados de outro lançamento.
   */
  function descreverExclusao(entryId) {
    const e = (accountingEntriesState.entries || []).find((x) => x.id === entryId);
    if (!e) return "Excluir este lançamento?";
    const valor = Number(e.totalD || e.totalC || e.valor || 0)
      .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const data = e.data ? new Date(e.data).toLocaleDateString("pt-BR") : "";
    const partes = [e.historico || "Lançamento sem histórico", data, `R$ ${valor}`].filter(Boolean);
    return `Excluir o lançamento?\n\n${partes.join(" · ")}\n\nEsta ação não pode ser desfeita.`;
  }

  async function handleDeleteEntryNoConfirm(entryId) {
    if (!selectedCompanyId) return;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.deleteAccountingEntry(selectedCompanyId, entryId);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento excluído.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao excluir lançamento.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleDeleteEntry(entryId) {
    if (!selectedCompanyId) return;
    // ⚠ O confirm NOMEIA o que vai sumir. "Excluir este lançamento?" é indistinguível de linha para
    // linha: quem clicou no ⌫ errado lê a mesma frase que leria no certo, confirma, e só descobre
    // o engano quando o mês não fecha. Ação irreversível repete os dados no texto (regra 5).
    if (!window.confirm(descreverExclusao(entryId))) return;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.deleteAccountingEntry(selectedCompanyId, entryId);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento excluído.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao excluir lançamento.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleBulkDeleteEntries(entryIds) {
    if (!selectedCompanyId) return { ok: false };
    const ids = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
    if (!ids.length) return { ok: false };
    const label = ids.length === 1 ? "este lançamento" : `estes ${ids.length} lançamentos`;
    if (!window.confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`)) return { ok: false, cancelled: true };
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    let succeeded = 0;
    const errors = [];
    for (const id of ids) {
      try {
        await api.deleteAccountingEntry(selectedCompanyId, id);
        succeeded += 1;
      } catch (err) {
        errors.push({ id, message: err?.message || "erro" });
      }
    }
    await loadAccountingEntries(selectedCompanyId);
    setSavingEntry(false);
    if (succeeded > 0 && errors.length === 0) {
      setEntriesMessage(`${succeeded} lançamento${succeeded !== 1 ? "s" : ""} excluído${succeeded !== 1 ? "s" : ""}.`);
    } else if (succeeded > 0 && errors.length > 0) {
      setEntriesMessage(`${succeeded} excluído${succeeded !== 1 ? "s" : ""}; ${errors.length} falharam.`);
      setEntriesError(`Algumas exclusões falharam (provavelmente lançamentos já exportados).`);
    } else {
      setEntriesError(`Nenhum lançamento foi excluído. ${errors[0]?.message || ""}`);
    }
    return { ok: errors.length === 0, succeeded, failed: errors.length };
  }

  async function handlePreviewOFX(file) {
    return api.previewOFX(selectedCompanyId, file);
  }

  async function handleImportOFX(transactions) {
    if (!selectedCompanyId) return null;
    const result = await api.importOFX(selectedCompanyId, { transactions });
    await loadAccountingEntries(selectedCompanyId);
    return result;
  }

  async function handlePreviewExcel(file) {
    if (!selectedCompanyId) return null;
    return api.previewExcelImport(selectedCompanyId, file);
  }

  async function handleImportExcel(transactions) {
    if (!selectedCompanyId) return null;
    const result = await api.commitExcelImport(selectedCompanyId, transactions);
    await loadAccountingEntries(selectedCompanyId);
    return result;
  }

  // F3: Cria N parcelas de um parcelamento Simples Nacional em transação no backend.
  async function handleCreateParcelamento(payload) {
    if (!selectedCompanyId) return null;
    const result = await api.createParcelamentoSimples(selectedCompanyId, payload);
    await loadAccountingEntries(selectedCompanyId);
    return result;
  }

  async function handleCreateAccount(input) {
    if (!selectedCompanyId) return;
    const result = await api.createChartOfAccount(selectedCompanyId, input);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleUpdateAccount(codigo, input) {
    if (!selectedCompanyId) return;
    const result = await api.updateChartOfAccount(selectedCompanyId, codigo, input);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleDeleteAccount(codigo) {
    if (!selectedCompanyId) return;
    const result = await api.deleteChartOfAccount(selectedCompanyId, codigo);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleImportAccountsFile(file) {
    if (!selectedCompanyId) return;
    const result = await api.importChartOfAccountsFile(selectedCompanyId, file);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleExportEntriesCsv(rangeOptions = null) {
    if (!selectedCompanyId) return;
    // rangeOptions: { competenciaInicio, competenciaFim } | { competencia } | null (usa filtro atual)
    const params = rangeOptions || { competencia: accountingEntriesState.filters.competencia };
    try {
      const url = api.getEntriesExportCsvUrl(selectedCompanyId, params);
      if (!url || url.startsWith("#")) {
        setEntriesError("Exportação CSV não disponível no modo mock.");
        return;
      }
      const token = api.getAccessToken();
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Falha na exportação: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      const suffix =
        params.competenciaInicio && params.competenciaFim
          ? `${params.competenciaInicio}_a_${params.competenciaFim}`
          : params.competencia || "todos";
      link.download = `lancamentos-${suffix}.csv`;
      document.body.appendChild(link);
      link.click();
      // ⚠ A MARCA VEM DEPOIS DO DOWNLOAD, e só se ele deu certo.
      // Marcar antes (ou dentro do GET) diria "exportado" para um arquivo que a rede derrubou.
      // Best-effort: se a marcação falhar, o arquivo JÁ está na mão do contador — derrubar a
      // exportação por causa dela seria trocar um aviso perdido por um trabalho perdido.
      if (api.confirmarExportacao && (params.competenciaInicio || params.competencia)) {
        const ini = params.competenciaInicio || params.competencia;
        const fim = params.competenciaFim || params.competencia;
        try {
          const r = await api.confirmarExportacao(selectedCompanyId, { competenciaInicio: ini, competenciaFim: fim });
          await loadAccountingEntries(selectedCompanyId);
          setEntriesMessage(
            r?.marcados
              ? `Exportado. ${r.marcados} lançamento${r.marcados > 1 ? "s" : ""} marcado${r.marcados > 1 ? "s" : ""} como exportado${r.marcados > 1 ? "s" : ""}.`
              : "Exportado.",
          );
        } catch { setEntriesMessage("Exportado (não foi possível marcar os lançamentos)."); }
      }
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setEntriesError(err?.message || "Falha ao exportar CSV.");
    }
  }

  function handleCircularYearChange(year) {
    setCircularYear(year);
    loadCircular(year);
  }

  function resetWorkspace() {
    setEntriesMessage("");
    setEntriesError("");
    accountingEntriesState.setEntries([]);
    accountingEntriesState.setTotal(0);
    chartOfAccountsState.setAccounts([]);
    setCircularData(null);
  }

  async function loadFiscalExecutions(companyId = selectedCompanyId, competencia = circularCompetencia) {
    if (!companyId || !api.getFiscalExecutions) return;
    setLoadingFiscalExecutions(true);
    try {
      const data = await api.getFiscalExecutions(companyId, { competencia, limit: 20 });
      setFiscalExecutions(Array.isArray(data) ? data : []);
    } catch {
      setFiscalExecutions([]);
    } finally {
      setLoadingFiscalExecutions(false);
    }
  }

  // Fiscal action handlers
  async function handleRunFiscalAction(action, competencia = circularCompetencia) {
    if (!selectedCompanyId) return;
    if (runningFiscalAction) return; // Prevent concurrent executions

    setRunningFiscalAction(action);
    setEntriesError("");
    setEntriesMessage("");

    try {
      const result = await api.runCompanyFiscalAction(selectedCompanyId, {
        action,
        competencia,
      });

      setLastFiscalResult(result);

      if (result?.result?.status === "completed") {
        setEntriesMessage(`${action.replace("_", " ")}: operação concluída com sucesso.`);
        // Reload circular after successful action
        if (["search_guides", "sync_inss"].includes(action)) {
          await loadCircular(circularYear, competencia);
        }
      } else if (result?.result?.status === "skipped") {
        setEntriesMessage(`${action.replace("_", " ")}: operação ignorada. ${result?.result?.reason || ""}`);
      }

      // Refresh execution history after any action
      await loadFiscalExecutions(selectedCompanyId, competencia);
    } catch (err) {
      setEntriesError(err?.message || `Falha ao executar ${action}`);
      setLastFiscalResult(null);
      // Refresh history even on failure (backend logs the failed attempt)
      await loadFiscalExecutions(selectedCompanyId, competencia);
    } finally {
      setRunningFiscalAction(null);
    }
  }

  async function handleSearchGuides(competencia = circularCompetencia) {
    return handleRunFiscalAction("search_guides", competencia);
  }

  async function handleCheckPayments(competencia = circularCompetencia) {
    return handleRunFiscalAction("check_payments", competencia);
  }

  async function handleSyncInss(competencia = circularCompetencia) {
    return handleRunFiscalAction("sync_inss", competencia);
  }

  useEffect(() => {
    if (page === "companyDetail" && selectedCompanyId) {
      setEntriesMessage("");
      setEntriesError("");
      accountingEntriesState.setEntries([]);
      chartOfAccountsState.setAccounts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, selectedCompanyId]);

  // Load fiscal execution history when company or competencia changes
  useEffect(() => {
    if (selectedCompanyId && companyDetailTab === "circular") {
      loadFiscalExecutions(selectedCompanyId, circularCompetencia);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, circularCompetencia, companyDetailTab]);

  // Q18: carrega lançamentos + plano de contas ao abrir a aba Lançamentos e
  // recarrega quando os filtros mudam (competência/tipo/origem/status). Antes a carga
  // dependia do botão "Atualizar" — com Lançamentos virando aba inicial, a lista
  // aparecia vazia.
  useEffect(() => {
    if (page === "companyDetail" && selectedCompanyId && companyDetailTab === "lancamentos") {
      loadAccountingEntries(selectedCompanyId);
      loadChartOfAccounts(selectedCompanyId);
    }
    // `page` está nas deps de propósito: na navegação SPA, selectedCompanyId/tab
    // ficam prontos ANTES de page virar "companyDetail", e o efeito de limpeza acima
    // (que zera os lançamentos quando page muda) rodaria DEPOIS da carga, apagando a
    // lista. Reagir a `page` garante a recarga após a limpeza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, selectedCompanyId, companyDetailTab, accountingEntriesState.filters]);

  return {
    accountingEntriesState,
    chartOfAccountsState,
    savingEntry,
    savingBaixa,
    circularData,
    loadingCircular,
    circularYear,
    circularCompetencia,
    savingCircular,
    approvingCircularEntryId,
    entriesMessage,
    entriesError,
    runningFiscalAction,
    lastFiscalResult,
    fiscalExecutions,
    loadingFiscalExecutions,
    loadFiscalExecutions,
    loadChartOfAccounts,
    loadAccountingEntries,
    loadCircular,
    handleCreateBaixa,
    handleDeleteEntryNoConfirm,
    searchHistoricos,
    getHistoricosByCode,
    loadAllHistoricos,
    handleUpdateHistorico,
    handleDeleteHistorico,
    handleCreateEntry,
    handleCreateFolha,
    handleLoadPayrollTemplate,
    handleLoadBaixaTemplate,
    handleUpdateEntry,
    handleDeleteEntry,
    handleBulkDeleteEntries,
    handlePreviewOFX,
    handleImportOFX,
    handlePreviewExcel,
    handleImportExcel,
    handleCreateParcelamento,
    handleCreateAccount,
    handleUpdateAccount,
    handleDeleteAccount,
    handleImportAccountsFile,
    handleExportEntriesCsv,
    handleCircularYearChange,
    setCircularCompetencia,
    handleSaveCircular,
    handleApproveCircularEntry,
    handleRunFiscalAction,
    handleSearchGuides,
    handleCheckPayments,
    handleSyncInss,
    resetWorkspace,
  };
}
