import { useCallback, useEffect, useState } from "react";
import { lerFalhaDeCarga } from "../../../../lib/falhaDeCarga";

/**
 * ⚠ O ERRO SEMPRE FOI GRAVADO AQUI — E NINGUÉM O LIA.
 *
 * `error` existia desde o começo; nenhuma tela o consumia. Com o `catch {}` mudo do
 * `renderAccountingEntriesTab`, excluir e duplicar uma Função de Lançamento falhavam com a lista
 * igual e sem mensagem: indistinguível de "o botão não fez nada".
 *
 * `falha` é a mesma informação na forma que a tela desenha (`lib/falhaDeCarga.js`), com o VERBO da
 * operação — "Não foi possível excluir a função" não pode sair como "não foi possível carregar".
 * `error` continua sendo a string de antes, para não mudar o formato de quem já o lê.
 */
export function useAccountingFunctions({ api, companyId }) {
  const [functions, setFunctions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [falha, setFalha] = useState(null);
  const [saving, setSaving] = useState(false);

  /**
   * Um só lugar para registrar a falha — nas duas formas, sempre juntas.
   * ⚠ O objeto do erro é preferido à string: é ele que carrega `status`/`code`, e é o `status 403`
   * que separa "não carregou" de "você não tem acesso".
   */
  function registrarFalha(err, padrao, opcoes) {
    const temSinal = Boolean(err && (err.message || err.status || err.code));
    setError(err?.message || padrao);
    setFalha(lerFalhaDeCarga(temSinal ? err : padrao, opcoes));
  }
  function limparFalha() {
    setError(null);
    setFalha(null);
  }

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    setFalha(null);
    try {
      const data = await api.listAccountingFunctions(companyId);
      setFunctions(Array.isArray(data) ? data : []);
    } catch (err) {
      // Inline (e não `registrarFalha`) porque `load` é `useCallback`: chamar dali uma função
      // recriada a cada render entraria nas dependências do hook.
      const temSinal = Boolean(err && (err.message || err.status || err.code));
      setError(err?.message || "Falha ao listar funções.");
      setFalha(lerFalhaDeCarga(temSinal ? err : "Falha ao listar funções.", { assunto: "as funções" }));
      // ⚠ A lista antiga sai: lista de antes sob um estado não confirmado é pior que lista nenhuma.
      setFunctions([]);
    } finally {
      setLoading(false);
    }
  }, [api, companyId]);

  useEffect(() => { load(); }, [load]);

  async function create(body) {
    setSaving(true); limparFalha();
    try {
      const res = await api.createAccountingFunction(companyId, body);
      await load();
      return res;
    } catch (err) {
      registrarFalha(err, "Falha ao criar função.", { verbo: "criar", assunto: "a função" });
      throw err;
    } finally { setSaving(false); }
  }

  async function update(functionId, body) {
    setSaving(true); limparFalha();
    try {
      const res = await api.updateAccountingFunction(companyId, functionId, body);
      await load();
      return res;
    } catch (err) {
      registrarFalha(err, "Falha ao atualizar função.", { verbo: "salvar", assunto: "a função" });
      throw err;
    } finally { setSaving(false); }
  }

  async function remove(functionId) {
    setSaving(true); limparFalha();
    try {
      const res = await api.deleteAccountingFunction(companyId, functionId);
      await load();
      return res;
    } catch (err) {
      registrarFalha(err, "Falha ao excluir função.", { verbo: "excluir", assunto: "a função" });
      throw err;
    } finally { setSaving(false); }
  }

  async function apply(functionId, { competencia, entryValores }) {
    setSaving(true); limparFalha();
    try {
      const res = await api.applyAccountingFunction(companyId, functionId, { competencia, entryValores });
      return res;
    } catch (err) {
      registrarFalha(err, "Falha ao aplicar função.", { verbo: "aplicar", assunto: "a função" });
      throw err;
    } finally { setSaving(false); }
  }

  return { functions, loading, error, falha, saving, load, create, update, remove, apply };
}
