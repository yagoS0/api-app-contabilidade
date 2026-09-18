// Q14.2.e — hook de state pra Apuração V2 dentro de uma empresa
// (cadastro fiscal + produtos/serviços + pendências).
import { useCallback, useEffect, useRef, useState } from "react";
import { fraseDaClassificacao } from "../lib/fraseDaClassificacao";

export function useApuracaoV2({ api, companyId, competencia, feedback }) {
  const contexto = String(companyId || '') + ':' + String(competencia || '');
  const contextoAtual = useRef(contexto); contextoAtual.current = contexto;
  const pedidoAtual = useRef(0);
  const [contextoCarregado, setContextoCarregado] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [cadastro, setCadastro] = useState(null);
  // ⚠⚠ `prefill: true` quer dizer que o cadastro NÃO existe no banco — ele foi montado a partir
  // da `Company`, com o regime possivelmente vindo de um default. O backend devolve isso desde
  // sempre e NINGUÉM no front lia; era o que fazia a tela mostrar um regime não conferido como
  // se fosse cadastro.
  const [cadastroPrefill, setCadastroPrefill] = useState(false);
  const [cnaePrincipalRef, setCnaePrincipalRef] = useState(null);
  const [perfil, setPerfil] = useState(null); // Aba Fiscal / Bloco A
  const [produtos, setProdutos] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [pendenciasCounts, setPendenciasCounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [perfilError, setPerfilError] = useState(null);

  const loadAll = useCallback(async () => {
    if (!api || !companyId || contextoAtual.current !== contexto) return;
    const pedido = ++pedidoAtual.current;
    const vigente = () => contextoAtual.current === contexto && pedidoAtual.current === pedido;
    setLoadError(null);
    setLoading(true);
    setPerfilError(null);
    try {
      const [cad, perf, prods, pends] = await Promise.all([
        api.getCadastroFiscal(companyId),
        api.getPerfilFiscal?.(companyId) ?? null,
        api.listProdutosServicos(companyId),
        api.listPendencias(companyId, { resolvida: false, ...(competencia ? { competencia } : {}) }),
      ]);
      if (!vigente()) return;
      setContextoCarregado(contexto);
      setCadastro(cad?.cadastro || null);
      setCadastroPrefill(cad?.prefill === true);
      setCnaePrincipalRef(cad?.cnaePrincipalRef || null);
      setPerfil(perf?.ok ? perf : null);
      setProdutos(prods?.items || []);
      setPendencias(pends?.items || []);
      setPendenciasCounts(pends?.counts || []);
    } catch (err) {
      if (!vigente()) return;
      setContextoCarregado(null);
      setLoadError(err?.message || "Falha ao carregar dados fiscais.");
      feedback?.notifyError?.(err?.message || "Falha ao carregar apuração v2");
    } finally {
      if (vigente()) setLoading(false);
    }
  }, [api, companyId, competencia, contexto, feedback]);

  useEffect(() => { setSaving(false); loadAll(); return () => { pedidoAtual.current += 1; }; }, [loadAll]);

  async function saveCadastro(payload) {
    setSaving(true);
    try {
      const out = await api.saveCadastroFiscal(companyId, payload);
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.("Cadastro fiscal salvo.");
      setCadastro(out.cadastro);
      await loadAll();
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro ao salvar");
      throw err;
    } finally { if (contextoAtual.current === contexto) setSaving(false); }
  }

  async function savePerfil(perfilAtividades) {
    setSaving(true);
    try {
      const out = await api.savePerfilFiscal(companyId, perfilAtividades);
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.("Perfil fiscal salvo.");
      setPerfil(out);
      return out;
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro ao salvar perfil");
      throw err;
    } finally { if (contextoAtual.current === contexto) setSaving(false); }
  }

  async function getSugestao(competencia) {
    return api.getSugestaoAnexo(companyId, competencia);
  }

  async function createProduto(payload) {
    try {
      const out = await api.createProdutoServico(companyId, payload);
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.(`Produto "${out.produto?.nome}" criado.`);
      await loadAll();
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function updateProduto(produtoId, payload) {
    try {
      const out = await api.updateProdutoServico(companyId, produtoId, payload);
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || "Falha");
      await loadAll();
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function deleteProduto(produtoId) {
    try {
      const out = await api.deleteProdutoServico(companyId, produtoId);
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || "Falha");
      await loadAll();
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function resolverPendencia(pendenciaId, payload) {
    try {
      const out = await api.resolverPendencia(companyId, pendenciaId, payload);
      if (contextoAtual.current !== contexto) return;
      if (!out?.ok) throw new Error(out?.message || "Falha");
      const r = out.result || {};
      const reclass = r.reclassificacao;
      // ⚠ Com escopo GLOBAL a reclassificação vira LISTA (uma por empresa afetada) — somar é o que
      // faz a frase continuar verdadeira nos dois casos.
      const classificados = Array.isArray(reclass)
        ? reclass.reduce((soma, x) => soma + Number(x?.resultado?.classified || 0), 0)
        : Number(reclass?.classified || 0);
      // ⚠⚠ O GANHO DO ESCOPO GLOBAL PRECISA SER DITO. Ele é o motivo de a escolha existir: sem a
      // frase, o contador acabou de poupar N decisões futuras e a tela diz exatamente o mesmo que
      // diria se ele tivesse resolvido só para esta empresa.
      const fechadas = Number(r?.irmas?.fechadas || 0);
      const ganho = r?.escopo === "GLOBAL" && fechadas > 0
        ? ` A regra vale para toda a carteira e fechou a pendência de ${fechadas} outra${fechadas > 1 ? "s" : ""} empresa${fechadas > 1 ? "s" : ""}.`
        : r?.escopo === "GLOBAL"
          ? " A regra vale para toda a carteira."
          : "";
      feedback?.notifySuccess?.(
        reclass
          ? `Pendência resolvida. ${classificados} itens reclassificados em batch.${ganho}`
          : `Pendência resolvida.${ganho}`
      );
      await loadAll();
    } catch (err) {
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    }
  }

  async function classificarV2(opts = {}) {
    setSaving(true);
    try {
      const out = await api.classificarV2(companyId, opts);
      if (contextoAtual.current !== contexto) return;
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
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    } finally { if (contextoAtual.current === contexto) setSaving(false); }
  }

  async function apurarV2(competencia, opts = {}) {
    setSaving(true);
    try {
      const out = await api.apurarV2(companyId, competencia, opts);
      if (contextoAtual.current !== contexto) return;
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
      if (contextoAtual.current !== contexto) return;
      feedback?.notifyError?.(err?.message || "Erro");
      throw err;
    } finally { if (contextoAtual.current === contexto) setSaving(false); }
  }

  return {
    cadastro: contextoCarregado === contexto ? cadastro : null, cadastroPrefill: contextoCarregado === contexto && cadastroPrefill, cnaePrincipalRef: contextoCarregado === contexto ? cnaePrincipalRef : null,
    perfil: contextoCarregado === contexto ? perfil : null, savePerfil,
    getSugestao,
    produtos: contextoCarregado === contexto ? produtos : [],
    pendencias: contextoCarregado === contexto ? pendencias : [], pendenciasCounts: contextoCarregado === contexto ? pendenciasCounts : [],
    loading: loading || (!loadError && contextoCarregado !== contexto), saving, perfilError: perfilError || loadError, loadError,
    reload: loadAll,
    saveCadastro,
    createProduto, updateProduto, deleteProduto,
    resolverPendencia,
    classificarV2,
    apurarV2,
  };
}
