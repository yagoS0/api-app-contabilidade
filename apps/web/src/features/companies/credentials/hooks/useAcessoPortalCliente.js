// Estado da seção "Acesso do cliente ao portal", na aba Senhas e acessos da empresa.
//
// ⚠ HOOK PRÓPRIO, e não mais um pedaço de `useCompanyCredentials`. Os dois ocupam a mesma tela,
// mas guardam coisas de naturezas opostas: lá as senhas reveladas do COFRE (recuperáveis, cifradas
// com chave nossa); aqui uma senha NOVA que o servidor acabou de gerar e nunca mais poderá dizer
// qual é. Juntá-los faria um `Map` de segredos com duas regras de descarte diferentes, e a mais
// frouxa venceria na primeira mexida.
//
// ⚠⚠ A SENHA NOVA VIVE SÓ AQUI, EM MEMÓRIA, e some quando o componente desmonta.
// Nada de `localStorage`/`sessionStorage`: o que se grava lá sobrevive ao logout, ao fechar a aba e
// à troca de usuário na mesma máquina — e passaria a existir em claro num lugar que nenhuma das
// travas do servidor alcança. É a mesma disciplina escrita em `useCompanyCredentials`, e aqui ela
// é ainda mais estrita: o cofre pode revelar de novo, este valor NÃO pode ser recuperado por
// ninguém, nunca.

import { useCallback, useEffect, useRef, useState } from "react";

// `feedback` chega como objeto literal novo a cada render do App. Entrando nas dependências dos
// callbacks, `carregar` muda de identidade em todo render, o efeito redispara e vira LAÇO INFINITO
// de requisições. Ref: sempre atual quando chamado, sem participar das dependências.
function useFeedbackRef(feedback) {
  const ref = useRef(feedback);
  ref.current = feedback;
  return ref;
}

export function useAcessoPortalCliente({ api, companyId, feedback }) {
  const feedbackRef = useFeedbackRef(feedback);

  const [usuarios, setUsuarios] = useState([]);
  const [podeDefinirSenha, setPodeDefinirSenha] = useState(false);
  const [papelMinimo, setPapelMinimo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [salvandoPara, setSalvandoPara] = useState(null);

  // O erro de carga fica no ESTADO, não só no `feedback`: a barra some, e o que fica na tela é uma
  // lista vazia — indistinguível de "esta empresa não tem usuário do portal". São duas situações
  // com consertos opostos (ver `estadoDaLista`).
  const [erro, setErro] = useState(null);

  // ⚠ A SENHA RECÉM-DEFINIDA. `{ userId, senha }` — uma só por vez, de propósito: mostrar duas
  // senhas em claro na mesma tela multiplica a janela em que elas ficam visíveis por cima do ombro
  // de quem passar. Definir a de outro usuário ESCONDE a anterior.
  const [senhaNova, setSenhaNova] = useState(null);

  const carregar = useCallback(async () => {
    if (!api || !companyId) return;
    setCarregando(true);
    try {
      const r = await api.getPortalAccessUsers(companyId);
      setUsuarios(Array.isArray(r?.usuarios) ? r.usuarios : []);
      setPodeDefinirSenha(Boolean(r?.podeDefinirSenha));
      setPapelMinimo(r?.papelMinimoDefinirSenha || "");
      setErro(null);
      // ⚠ Recarregou = esconde a senha em claro. Ela não pertence a esta lista e não sobrevive a
      // uma releitura; mantê-la na tela depois de o conjunto mudar mostraria um valor que já pode
      // não ser mais o do usuário exibido ao lado.
      setSenhaNova(null);
    } catch (err) {
      // ⚠ A LISTA NÃO É ZERADA NO ERRO — trocar o que já está na tela por vazio ao falhar uma
      // recarga apaga informação verdadeira por causa de uma chamada que não voltou.
      setErro({ mensagem: err?.message || "", status: err?.status || null, code: err?.code || null });
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar o acesso do cliente ao portal.");
    } finally {
      setCarregando(false);
    }
  }, [api, companyId]);

  useEffect(() => { carregar(); }, [carregar]);

  /**
   * ⚠ DEFINIR A SENHA É ATO DE CONSEQUÊNCIA, e o hook NÃO o dispara sozinho: `confirmado: true`
   * viaja explícito até o servidor, que recusa sem ele. Quem chama já passou pela confirmação da
   * tela — o duplo cinto é de propósito, porque um dos dois lados sozinho já foi contornado antes
   * neste projeto (o gate que vivia só no upload do certificado).
   *
   * ⚠ NÃO RECARREGA A LISTA depois de definir. Recarregar apagaria a senha que acabou de aparecer
   * (ver o `setSenhaNova(null)` de `carregar`) — e ela não tem segunda chance. O estado da linha é
   * atualizado no lugar, com o que a própria resposta devolveu.
   */
  const definirSenha = useCallback(async (userId) => {
    if (!api || !companyId || !userId) return null;
    setSalvandoPara(userId);
    try {
      const r = await api.resetPortalUserPassword(companyId, userId, { confirmado: true });
      const senha = r?.senha ?? "";
      setSenhaNova({ userId, senha });
      setUsuarios((atual) => atual.map((u) => (
        u.userId === userId ? { ...u, ultimaTroca: r?.troca || u.ultimaTroca } : u
      )));
      feedbackRef.current?.notifySuccess?.(
        "Senha definida. As sessões abertas desse usuário foram encerradas. A senha aparece uma única vez.",
      );
      return senha;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao definir a senha do cliente.");
      return null;
    } finally {
      setSalvandoPara(null);
    }
  }, [api, companyId]);

  /** Some com a senha em claro da tela. Não há como trazê-la de volta — é isso que ela promete. */
  const esconderSenha = useCallback(() => setSenhaNova(null), []);

  return {
    usuarios, podeDefinirSenha, papelMinimo, carregando, erro,
    senhaNova, salvandoPara,
    definirSenha, esconderSenha,
    recarregar: carregar,
  };
}
