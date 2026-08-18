// Tradução de código de erro da API para frase que um CLIENTE entende.
//
// ⚠ Regra da tela: o usuário nunca lê "erro 401". Um código cru numa tela de
// cliente não diz o que fazer — e a diferença entre "sua senha está errada" e
// "sua sessão expirou" é justamente a ação seguinte.
//
// Os códigos vêm do backend (`apps/api/src/routes/auth.js`,
// `middlewares/require*.js`) e de dois códigos nossos: `not_a_client` (trava de
// tipo de conta) e `session_expired` (refresh falhou).

const MENSAGENS = {
  // --- Login ---
  invalid_credentials: "E-mail ou senha incorretos.",
  username_password_required: "Informe o e-mail e a senha.",
  user_not_active: "Seu acesso ainda não foi liberado. Fale com o seu contador.",
  account_locked: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
  too_many_requests: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
  auth_not_configured: "O sistema de acesso está indisponível no momento. Tente mais tarde.",

  // --- Trava de produto: este portal é do CLIENTE ---
  not_a_client:
    "Esta conta é do escritório de contabilidade, não de um cliente. Use o portal do escritório.",
  forbidden_account_type:
    "Esta conta é do escritório de contabilidade, não de um cliente. Use o portal do escritório.",

  // --- Sessão ---
  session_expired: "Sua sessão expirou. Entre novamente para continuar.",
  unauthorized: "Sua sessão expirou. Entre novamente para continuar.",
  invalid_token: "Sua sessão expirou. Entre novamente para continuar.",
  invalid_refresh_token: "Sua sessão expirou. Entre novamente para continuar.",

  // --- Acesso a empresa ---
  forbidden: "Você não tem acesso a esta empresa.",
  insufficient_role: "Seu perfil nesta empresa não permite ver esta informação.",
  company_id_required: "Selecione uma empresa antes de continuar.",
  not_found: "Não encontramos este registro.",
  file_not_available: "O arquivo ainda não está disponível.",

  // --- Servidor / rede ---
  internal_error: "Algo deu errado do nosso lado. Tente de novo em instantes.",
  not_implemented_yet: "Esta funcionalidade ainda não está disponível.",
  network_error: "Não conseguimos falar com o servidor. Verifique sua conexão.",
};

/** Frase legível para um erro. Nunca devolve código cru nem "HTTP 500". */
export function mensagemDeErro(err, padrao = "Não foi possível concluir. Tente de novo.") {
  if (!err) return padrao;
  const code = err.code ? String(err.code) : null;
  if (code && MENSAGENS[code]) return MENSAGENS[code];

  // Sem código conhecido: cai no status, que ainda é mais informativo que o
  // texto técnico que o servidor eventualmente mande.
  const status = Number(err.status);
  if (status === 401 || status === 403) return MENSAGENS.session_expired;
  if (status === 404) return MENSAGENS.not_found;
  if (status === 429) return MENSAGENS.too_many_requests;
  if (status >= 500) return MENSAGENS.internal_error;
  if (status === 0) return MENSAGENS.network_error;
  return padrao;
}

/** true quando o erro significa "a sessão acabou" — a casca volta ao login. */
export function ehSessaoExpirada(err) {
  if (!err) return false;
  const code = String(err.code || "");
  return (
    code === "session_expired" ||
    code === "unauthorized" ||
    code === "invalid_token" ||
    code === "invalid_refresh_token"
  );
}
