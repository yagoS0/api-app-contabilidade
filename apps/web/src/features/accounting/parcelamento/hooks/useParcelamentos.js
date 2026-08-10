import { useCallback, useEffect, useState } from "react";

export function useParcelamentos({ api, companyId, status = null }) {
  const [parcelamentos, setParcelamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError(null);
    try {
      const data = await api.listParcelamentos(companyId, status ? { status } : {});
      setParcelamentos(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Falha ao listar parcelamentos.");
      setParcelamentos([]);
    } finally {
      setLoading(false);
    }
  }, [api, companyId, status]);

  useEffect(() => { load(); }, [load]);

  async function create(body) {
    setSaving(true); setError(null);
    try {
      const res = await api.createParcelamento(companyId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao criar parcelamento.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q21/Q23: sobe guia manual como 1ª parcela → cria/anexa parcelamento + provisão (≥3 linhas).
  async function ingest(body) {
    setSaving(true); setError(null);
    try {
      const res = await api.ingestParcelamento(companyId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao registrar parcela.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q28 Fase 1: consulta um parcelamento no SERPRO por código (pré-preenche o modal de entrada).
  async function consultarSerpro({ tipo, numeroParcelamento }) {
    const res = await api.consultarParcelamentoSerpro(companyId, { tipo, numeroParcelamento });
    return res?.parcelamento || null;
  }

  // Q23: contas memorizadas das linhas-padrão da provisão (pré-preenche o modal).
  async function getContasProvisao(tipo) {
    try {
      const res = await api.getContasProvisao(companyId, tipo);
      return res?.contas || {};
    } catch {
      return {};
    }
  }

  // Q28 Fase 2: ver/editar config de lançamento do parcelamento.
  async function getConfig(parcId) {
    const res = await api.getParcelamentoConfig(companyId, parcId);
    return res?.parcelamento || null;
  }
  async function saveConfig(parcId, body) {
    setSaving(true); setError(null);
    try {
      const res = await api.saveParcelamentoConfig(companyId, parcId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao salvar config do parcelamento.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q28 Fase 3: fila de conferência de parcelas.
  //
  // ⚠ O `catch { return []; }` SAIU DAQUI. Ele transformava falha de rede em "fila vazia", e o
  // painel — que escondia a si mesmo quando a lista era vazia — produzia o MESMO pixel para
  // "não há nada a conferir" e "não consegui perguntar". A recusa agora sobe, e
  // `ConferenciaParcelasPanel` a mostra com o motivo e o "Tentar de novo".
  async function listConferencia() {
    const res = await api.getConferenciaParcelas(companyId);
    return Array.isArray(res?.items) ? res.items : [];
  }
  async function aprovarConferencia(guideIds) {
    setSaving(true); setError(null);
    try {
      const res = await api.aprovarConferenciaParcelas(companyId, guideIds);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao aprovar conferência.");
      throw err;
    } finally { setSaving(false); }
  }

  // ⚠ `linkGuide` E `payParcela` FORAM REMOVIDAS (F2.3), com as rotas que serviam:
  //   · `POST /parcelamentos/:parcId/link-guide`
  //   · `POST /parcelamentos/:parcId/parcelas/:num/pagar`
  // As duas operavam sobre as linhas leves `tipo="PARCELA"` que só o V1 cria; produção não tem um
  // parcelamento V1 e nenhuma tela as chamava. Hoje a guia se ANEXA pelo "+ Subir Guia →
  // PARCELAMENTO" (que é `POST /parcelamentos/ingestao`, o mesmo `ingest` acima) e a baixa é uma
  // só: `POST /parcelamentos/parcelas/:guideId/baixa`, na aba Parcelamento.

  async function rescindir(parcId, body = {}) {
    setSaving(true); setError(null);
    try {
      const res = await api.rescindirParcelamento(companyId, parcId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao rescindir.");
      throw err;
    } finally { setSaving(false); }
  }

  // ── OS ATOS DO CONTRATO: excluir, e desfazer a rescisão ─────────────────────────────────────
  //
  // ⚠ OS PREVIEWS NÃO PASSAM PELO `setSaving`/`setError` do hook, de propósito. Eles são LEITURA e
  // acontecem DENTRO do modal, que já tem o próprio estado de carregando/erro — mexer no estado da
  // página faria a lista inteira piscar "Carregando…" só por alguém ter aberto uma confirmação, e o
  // erro da prévia (que pertence ao modal) apagaria a faixa de erro da listagem.
  //
  // ⚠ E ELES DEIXAM O ERRO SUBIR. `catch` que devolve `null` aqui transformaria "não consegui
  // perguntar" em "não há nada a excluir" — a mesma confusão entre falha e vazio que este módulo já
  // corrigiu em três painéis.
  async function previewExclusao(parcId) {
    if (!api.previewExclusaoParcelamento) {
      const err = new Error("A exclusão de parcelamento não está disponível neste modo de API.");
      err.code = "EXCLUSAO_INDISPONIVEL";
      throw err;
    }
    return api.previewExclusaoParcelamento(companyId, parcId);
  }

  async function excluir(parcId, body = {}) {
    setSaving(true); setError(null);
    try {
      const res = await api.excluirParcelamento(companyId, parcId, body);
      await load();
      return res;
    } catch (err) {
      // ⚠ O erro NÃO é engolido: ele volta para o modal (que o mostra ao lado do campo de motivo) E
      // fica na faixa da página. Duas exibições porque são duas perguntas — "por que não excluiu?" e
      // "esta lista está confiável?".
      setError(err?.message || "Falha ao excluir o parcelamento.");
      throw err;
    } finally { setSaving(false); }
  }

  async function previewDesfazerRescisao(parcId) {
    if (!api.previewDesfazerRescisao) {
      const err = new Error("Desfazer rescisão não está disponível neste modo de API.");
      err.code = "DESFAZER_INDISPONIVEL";
      throw err;
    }
    return api.previewDesfazerRescisao(companyId, parcId);
  }

  async function desfazerRescisao(parcId, body = {}) {
    setSaving(true); setError(null);
    try {
      const res = await api.desfazerRescisaoParcelamento(companyId, parcId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao desfazer a rescisão.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q31 Parte D: vincula/desvincula uma provisão (competência aberta) a um parcelamento (só marca).
  async function vincularEntry(entryId, parcelamentoId) {
    const res = await api.vincularEntryParcelamento(companyId, entryId, parcelamentoId || null);
    await load();
    return res;
  }

  // ⚠ `listConferencia`/`aprovarConferencia` FALTAVAM neste retorno, e as duas existem desde a
  // Q28 Fase 3. O efeito era o painel "Conferência de parcelas" QUEBRAR ao montar:
  // `ConferenciaParcelasPanel` faz `await listConferencia()` sem catch, então recebia `undefined`
  // e estourava `TypeError: listConferencia is not a function` — a fila de conferência nunca
  // apareceu na aba Parcelamento. Rotas e mock sempre estiveram de pé; era só o repasse.
  return {
    parcelamentos, loading, error, saving, load, create, ingest, getContasProvisao, consultarSerpro,
    getConfig, saveConfig, rescindir, vincularEntry,
    listConferencia, aprovarConferencia,
    // Os atos do contrato. ⚠ Repassados AQUI — foi esquecer este retorno que deixou a fila de
    // conferência quebrada por uma fase inteira (`listConferencia is not a function`), com rota e
    // mock de pé o tempo todo.
    previewExclusao, excluir, previewDesfazerRescisao, desfazerRescisao,
  };
}
