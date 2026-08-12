// Estado da aba "Senhas e informações" da empresa.
//
// Duas naturezas no mesmo hook porque ocupam a mesma tela — mas em DOIS estados separados, com
// duas chamadas separadas, batendo em duas rotas com gates de papel diferentes. Juntar as listas
// num array só com um `secreto: boolean` faria a tela ter de lembrar qual é qual a cada render;
// aqui a separação é estrutural e não tem como escorregar.

import { useCallback, useEffect, useRef, useState } from "react";

// `feedback` chega como objeto literal novo a cada render do App. Entrando nas dependências dos
// callbacks, `carregar` muda de identidade em todo render, o efeito redispara e vira LAÇO INFINITO
// de requisições — o mesmo defeito que já apareceu na aba de Documentos. Ref: sempre atual quando
// chamado, sem participar das dependências.
function useFeedbackRef(feedback) {
  const ref = useRef(feedback);
  ref.current = feedback;
  return ref;
}

export function useCompanyCredentials({ api, companyId, feedback }) {
  const feedbackRef = useFeedbackRef(feedback);

  const [credenciais, setCredenciais] = useState([]);
  const [cofre, setCofre] = useState(null);
  const [podeRevelar, setPodeRevelar] = useState(false);
  const [papelMinimoRevelar, setPapelMinimoRevelar] = useState("");
  const [carregando, setCarregando] = useState(false);

  // ⚠ O ERRO DE CARGA FICA NO ESTADO, não só no `feedback`. A barra de feedback some, e o que fica
  // na tela é uma lista vazia — indistinguível de "esta empresa não tem credencial nenhuma". São
  // três situações com reações opostas (ver `estadoDaCarga`), e ausência não pode responder por
  // nenhuma delas. Guardamos `status` porque é ele que separa "o servidor disse não" de "não houve
  // resposta"; a senha nunca passa por aqui — só mensagem e código escritos pelo servidor.
  const [erro, setErro] = useState(null);

  const [informacoes, setInformacoes] = useState([]);
  const [carregandoInfos, setCarregandoInfos] = useState(false);
  const [erroInfos, setErroInfos] = useState(null);

  // ⚠ AS SENHAS REVELADAS VIVEM SÓ AQUI, EM MEMÓRIA, e somem quando o componente desmonta.
  // Nada de `localStorage`/`sessionStorage`: o que se grava lá sobrevive ao logout, ao fechar a
  // aba e à troca de usuário na mesma máquina — e passaria a existir em claro num lugar que
  // nenhuma das travas do servidor alcança.
  const [reveladas, setReveladas] = useState(() => new Map());

  const carregar = useCallback(async () => {
    if (!api || !companyId) return;
    setCarregando(true);
    try {
      const r = await api.listCompanyCredentials(companyId);
      setCredenciais(r?.credenciais || []);
      setCofre(r?.cofre || null);
      setPodeRevelar(Boolean(r?.podeRevelar));
      setPapelMinimoRevelar(r?.papelMinimoRevelar || "");
      setErro(null);
      // Recarregou = o conjunto pode ter mudado. Esconde tudo de novo em vez de tentar casar ids:
      // manter uma senha na tela depois de a credencial ter sido editada por outra pessoa
      // mostraria um valor que já não é o que está gravado.
      setReveladas(new Map());
    } catch (err) {
      // ⚠ A LISTA NÃO É ZERADA NO ERRO. Trocar o que já está na tela por vazio ao falhar uma
      // recarga apaga informação verdadeira por causa de uma chamada que não voltou. O estado de
      // erro fica ao lado do que sobrou, dizendo que a lista pode estar desatualizada.
      setErro({ mensagem: err?.message || "", status: err?.status || null, code: err?.code || null });
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar as credenciais.");
    } finally {
      setCarregando(false);
    }
  }, [api, companyId]);

  const carregarInfos = useCallback(async () => {
    if (!api || !companyId) return;
    setCarregandoInfos(true);
    try {
      const r = await api.listCompanyInfos(companyId);
      setInformacoes(r?.informacoes || []);
      setErroInfos(null);
    } catch (err) {
      setErroInfos({ mensagem: err?.message || "", status: err?.status || null, code: err?.code || null });
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar as informações.");
    } finally {
      setCarregandoInfos(false);
    }
  }, [api, companyId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarInfos(); }, [carregarInfos]);

  const criar = useCallback(async (input) => {
    if (!api || !companyId) return false;
    try {
      await api.createCompanyCredential(companyId, input);
      feedbackRef.current?.notifySuccess?.("Credencial guardada. A senha foi cifrada antes de sair desta tela.");
      await carregar();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao guardar a credencial.");
      return false;
    }
  }, [api, companyId, carregar]);

  const atualizar = useCallback(async (credentialId, patch) => {
    if (!api || !companyId) return false;
    try {
      await api.updateCompanyCredential(companyId, credentialId, patch);
      await carregar();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao atualizar a credencial.");
      return false;
    }
  }, [api, companyId, carregar]);

  const excluir = useCallback(async (credentialId) => {
    if (!api || !companyId) return false;
    try {
      await api.deleteCompanyCredential(companyId, credentialId);
      await carregar();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao excluir a credencial.");
      return false;
    }
  }, [api, companyId, carregar]);

  /**
   * ⚠ Revelar é ATO DE CONSEQUÊNCIA, e o hook não o dispara sozinho.
   * `confirmado: true` viaja explícito até o servidor, que recusa sem ele. Quem chama já passou
   * pela confirmação da tela — o duplo cinto é de propósito: um dos dois lados sozinho já foi
   * contornado antes neste projeto (o gate que vivia só no upload do certificado).
   */
  const revelar = useCallback(async (credentialId, motivo) => {
    if (!api || !companyId) return null;
    try {
      const r = await api.revealCompanyCredential(companyId, credentialId, { confirmado: true, motivo });
      setReveladas((atual) => new Map(atual).set(credentialId, r?.senha ?? ""));
      // Sobe o contador de leituras sem recarregar a lista (recarregar apagaria o que acabou de
      // ser revelado — ver o `setReveladas(new Map())` de `carregar`).
      setCredenciais((atual) => atual.map((c) => (
        c.id === credentialId ? { ...c, vezesRevelada: (c.vezesRevelada || 0) + 1 } : c
      )));
      return r?.senha ?? "";
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao revelar a senha.");
      return null;
    }
  }, [api, companyId]);

  const esconder = useCallback((credentialId) => {
    setReveladas((atual) => {
      const novo = new Map(atual);
      novo.delete(credentialId);
      return novo;
    });
  }, []);

  const criarInfo = useCallback(async (input) => {
    if (!api || !companyId) return false;
    try {
      await api.createCompanyInfo(companyId, input);
      await carregarInfos();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao guardar a informação.");
      return false;
    }
  }, [api, companyId, carregarInfos]);

  const excluirInfo = useCallback(async (infoId) => {
    if (!api || !companyId) return false;
    try {
      await api.deleteCompanyInfo(companyId, infoId);
      await carregarInfos();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao excluir a informação.");
      return false;
    }
  }, [api, companyId, carregarInfos]);

  return {
    credenciais, cofre, podeRevelar, papelMinimoRevelar, carregando, erro,
    informacoes, carregandoInfos, erroInfos,
    reveladas, revelar, esconder,
    criar, atualizar, excluir,
    criarInfo, excluirInfo,
    recarregar: carregar,
    recarregarInfos: carregarInfos,
  };
}
