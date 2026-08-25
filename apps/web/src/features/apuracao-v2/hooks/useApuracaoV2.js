// Q14.2.e — hook de state pra Apuração V2 dentro de uma empresa
// (cadastro fiscal + produtos/serviços + pendências).
import { useCallback, useEffect, useState } from "react";
import { fraseDaClassificacao } from "../lib/fraseDaClassificacao";

export function useApuracaoV2({ api, companyId, feedback }) {
  const [cadastro, setCadastro] = useState(null);
  const [cnaePrincipalRef, setCnaePrincipalRef] = useState(null);
  const [perfil, setPerfil] = useState(null); // Aba Fiscal / Bloco A
  const [produtos, setProdutos] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [pendenciasCounts, setPendenciasCounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    if (!api || !companyId) return;
    setLoading(true);
    try {
      const [cad, perf, prods, pends] = await Promise.all([
        api.getCadastroFiscal(companyId).catch(() => ({ cadastro: null })),
        api.getPerfilFiscal?.(companyId).catch(() => null) ?? null,
        api.listProdutosServicos(companyId).catch(() => ({ items: [] })),
        api.listPendencias(companyId, { resolvida: false }).catch(() => ({ items: [], counts: [] })),
      ]);
      setCadastro(cad?.cadastro || null);
      setCnaePrincipalRef(cad?.cnaePrincipalRef || null);
      setPerfil(perf?.ok ? perf : null);
      setProdutos(prods?.items || []);
      setPendencias(pends?.items || []);
      setPendenciasCounts(pends?.counts || []);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao carregar apuração v2");
    } finally {
      setLoading(false);
    }
  }, [api, companyId, feedback]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveCadastro(payload) {
    setSaving(true);
    try {
      const out = await api.saveCadastroFiscal(companyId, payload);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.("Cadastro fiscal salvo.");
      setCadastro(out.cadastro);
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao salvar");
      throw err;
    } finally { setSaving(false); }
  }

  async function savePerfil(perfilAtividades) {
    setSaving(true);
    try {
      const out = await api.savePerfilFiscal(companyId, perfilAtividades);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.("Perfil fiscal salvo.");
      setPerfil(out);
      return out;
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao salvar perfil");
      throw err;
    } finally { setSaving(false); }
  }

  async function getSugestao(competencia) {
    return api.getSugestaoAnexo(companyId, competencia);
  }

  async function createProduto(payload) {
    try {
      const out = await api.createProdutoServico(companyId, payload);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.(`Produto "${out.produto?.nome}" criado.`);
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function updateProduto(produtoId, payload) {
    try {
      const out = await api.updateProdutoServico(companyId, produtoId, payload);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function deleteProduto(produtoId) {
    try {
      const out = await api.deleteProdutoServico(companyId, produtoId);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function resolverPendencia(pendenciaId, payload) {
    try {
      const out = await api.resolverPendencia(companyId, pendenciaId, payload);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      const r = out.result || {};
      const reclass = r.reclassificacao;
      feedback?.notifySuccess?.(
        reclass
          ? `Pendência resolvida. ${reclass.classified || 0} itens reclassificados em batch.`
          : `Pendência resolvida.`
      );
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function classificarV2(opts = {}) {
    setSaving(true);
    try {
      const out = await api.classificarV2(companyId, opts);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      const r = out.result || {};
      // ⚠ A frase mora em `lib/fraseDaClassificacao.js`, com teste. Ela diz o ESCOPO (o mês ou a
      // empresa inteira) e distingue "nada a classificar" de "0 de 0" — o texto anterior era
      // `Classificou 0/0. Pendências: 0.`, que se lê como falha tanto quanto como trabalho feito.
      const frase = fraseDaClassificacao(r);
      feedback?.notifySuccess?.(frase.texto);
      // ⚠⚠ O QUE FICOU DE FORA NÃO PODE SER ENGOLIDO PELA MENSAGEM DE SUCESSO. Nota sem competência
      // gravada não entra em recorte por mês nenhum (em SQL, intervalo não casa com NULL) e ficaria
      // invisível para sempre — é o defeito que a auditoria de notas já pagou nesta base.
      if (frase.alerta) feedback?.notifyInfo?.(frase.alerta);
      await loadAll();
      return r;
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    } finally { setSaving(false); }
  }

  async function apurarV2(competencia, opts = {}) {
    setSaving(true);
    try {
      const out = await api.apurarV2(companyId, competencia, opts);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      const r = out.result || {};
      if (r.ok) {
        feedback?.notifySuccess?.(`DAS calculado: R$ ${(r.dasCalculadoLocal || 0).toFixed(2)} · RBT12 ${(r.rbt12 || 0).toFixed(2)}`);
      } else {
        feedback?.notifyError?.(`Apuração bloqueada: ${r.blockers?.[0]?.mensagem || "verifique pendências"}`);
      }
      await loadAll();
      return r;
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    } finally { setSaving(false); }
  }

  return {
    cadastro, cnaePrincipalRef,
    perfil, savePerfil,
    getSugestao,
    produtos,
    pendencias, pendenciasCounts,
    loading, saving,
    reload: loadAll,
    saveCadastro,
    createProduto, updateProduto, deleteProduto,
    resolverPendencia,
    classificarV2,
    apurarV2,
  };
}
