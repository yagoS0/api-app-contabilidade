// A LEITURA DE UMA FALHA DE CARGA — uma só, para as telas que desenhavam falha como zero.
//
// ⚠ O DEFEITO QUE ISTO EXISTE PARA IMPEDIR: cinco telas engoliam o erro do servidor e afirmavam,
// em corpo grande, um estado que não conheciam — "0 pendentes · 0 vencendo · 0 vencidas",
// "0 empresas serão incluídas", "Nenhum download ainda.". O contador lê o número, conclui que está
// tudo em dia e fecha a página. Ausência nunca é resposta: a tela precisa distinguir TRÊS coisas
// que viravam uma só —
//
//   NÃO HÁ            (o servidor respondeu, e a resposta é vazia)
//   NÃO CARREGOU      (o servidor não respondeu, ou recusou)
//   VOCÊ NÃO TEM ACESSO (o servidor respondeu 403 — a lista existe, você é que não a vê)
//
// A forma é a mesma de `obrigatoriedadeDefis.js` (que tem `indefinida` ao lado de `obrigada` e
// `dispensada`): a terceira resposta é resposta, não um vazio bem-educado.
//
// ⚠ E o peso visual é o de `CardRegime.jsx`: quem consome isto põe a recusa NO LUGAR do número,
// no mesmo tamanho. Número ausente diagramado em cinza pequeno vira ausência de dúvida.

/** O que ocupa o lugar do número quando não há resposta. Um só glifo em todas as telas. */
export const SEM_RESPOSTA = "—";

/** Mensagem sem espaço em branco É o código do erro (precedente: `parcelaBusca.motivoDaFalha`). */
function pareceCodigo(mensagem) {
  return Boolean(mensagem) && !/\s/.test(mensagem);
}

function textoBruto(erro) {
  if (typeof erro === "string") return erro.trim();
  return String(erro?.message || "").trim();
}

/**
 * `realApi.request` acrescenta `code` (= `payload.error`) e `status` ao Error; as respostas em
 * corpo (`{ ok: false, error, message }`) trazem `error`. Os dois caminhos caem aqui.
 */
function codigoDe(erro) {
  if (!erro || typeof erro === "string") return null;
  return String(erro.code || erro.error || "").trim().toUpperCase() || null;
}

// ⚠ NÃO SÃO CÓDIGOS CHUTADOS: são os que os middlewares devolvem junto do 403
// (`apps/api/src/middlewares/requireFirmCompanyAccess.js` e `requireClientCompanyAccess.js`).
// Nenhum outro nome entra aqui sem estar no código do backend.
const CODIGOS_SEM_ACESSO = new Set(["FORBIDDEN", "INSUFFICIENT_ROLE", "SCOPE_REQUIRED"]);

/**
 * Lê uma falha de carga. Devolve `null` quando NÃO houve falha — para o chamador poder escrever
 * `const falha = lerFalhaDeCarga(erro)` e usar a presença como o próprio sinal.
 *
 * @param {unknown} erro   Error do `realApi`, corpo `{ ok:false, … }`, string ou nada.
 * @param {{assunto?: string, verbo?: string}} opcoes
 *   `assunto` é o complemento do título ("as obrigações") e `verbo` o que não deu certo
 *   ("carregar", "excluir"). ⚠ O verbo existe porque a MESMA leitura serve a falha de carga e a
 *   falha de ação: "Não foi possível carregar" sobre um clique em Excluir seria a tela mentindo
 *   sobre o que ela tentou fazer. Os dois só valem quando o acesso não é o problema.
 * @returns {{semAcesso: boolean, titulo: string, motivo: string, code: string|null}|null}
 */
export function lerFalhaDeCarga(erro, { assunto, verbo = "carregar" } = {}) {
  if (!erro) return null;

  const code = codigoDe(erro);
  const status = Number(erro?.status) || null;
  const semAcesso = status === 403 || status === 401 || (code ? CODIGOS_SEM_ACESSO.has(code) : false);

  const bruta = textoBruto(erro);
  // Código cru vira contexto, não explicação — mas não se perde: é ele que identifica a recusa
  // num chamado de suporte.
  const motivo = pareceCodigo(bruta)
    ? `O servidor recusou com o código ${bruta} e sem explicação.`
    : bruta || "O servidor não respondeu e não disse por quê.";

  if (semAcesso) {
    return {
      semAcesso: true,
      titulo: "Você não tem acesso a estes dados",
      // ⚠ "Sem acesso" NÃO é "não há": a diferença é a razão de este ramo existir.
      motivo: pareceCodigo(bruta) || !bruta
        ? "O servidor recusou o acesso. Peça a liberação a um administrador do escritório."
        : bruta,
      code,
    };
  }

  return {
    semAcesso: false,
    titulo: assunto ? `Não foi possível ${verbo} ${assunto}` : `Não foi possível ${verbo}`,
    motivo,
    code,
  };
}
