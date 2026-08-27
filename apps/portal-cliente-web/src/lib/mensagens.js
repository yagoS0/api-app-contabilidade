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

  // --- Recuperação de senha ---
  //
  // ⚠ `invalid_reset_token` cobre QUATRO casos por dentro — link inexistente, adulterado, vencido
  // e já usado — e o servidor não diz qual, de propósito: "este link já foi usado" confirmaria a
  // quem chutou o código que ele existiu, e portanto que a conta existe. A frase abaixo não tenta
  // adivinhar o motivo; ela dá o CONSERTO, que é o mesmo nos quatro casos.
  //
  // ⚠ E é um código PRÓPRIO, não o `invalid_token` logo abaixo: aquele significa "sua sessão
  // expirou", e reusá-lo mandaria um usuário deslogado "entrar novamente" numa tela cujo problema
  // é o link do e-mail.
  invalid_reset_token:
    "Este link de redefinição não é mais válido. Peça um novo — os links valem por 60 minutos e só podem ser usados uma vez.",
  email_required: "Informe o e-mail da sua conta.",
  token_password_required: "Informe a nova senha.",
  // O servidor manda a lista do que falta em `message`; esta é a frase de reserva.
  weak_password:
    "A senha precisa ter pelo menos 8 caracteres, com maiúscula, minúscula, número e um caractere especial.",
  // ⚠ Ausência de configuração NÃO responde "enviamos" — senão o cliente esperaria para sempre.
  mail_not_configured:
    "Não conseguimos enviar e-mails neste momento. Fale com o seu contador para redefinir sua senha.",

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

  // --- Emissão de NFS-e: recusas do VALIDADOR (campo do formulário) --------
  //
  // ⚠ Códigos de `apps/api/src/application/validators/nfsePayload.js`, copiados literalmente. São
  // recusas de PEDIDO: nada saiu da máquina e nenhum número foi consumido — a frase precisa dizer
  // o que corrigir, não pedir para "tentar de novo".
  payload_invalido: "Não conseguimos ler os dados da nota. Recarregue a página e preencha de novo.",
  tomador_documento_invalido:
    "O CNPJ ou CPF do tomador precisa ter 14 dígitos (CNPJ) ou 11 dígitos (CPF).",
  // ⚠ DISTINTO do de cima, de propósito: aqui o campo está preenchido e o NÚMERO é que está
  // errado. Emitir contra um CPF com um dígito trocado é emitir contra outra pessoa, e a NFS-e
  // não tem inutilização — o conserto seria cancelar a nota.
  tomador_cpf_digito_invalido:
    "Este CPF não é válido: confira os números digitados. (A verificação é feita aqui mesmo, sem consultar nenhuma base.)",
  tomador_nome_obrigatorio: "Informe o nome ou a razão social do tomador.",
  tomador_email_invalido: "O e-mail do tomador não parece válido.",
  servico_descricao_obrigatoria: "Descreva o serviço prestado.",
  servico_valor_invalido: "Informe o valor do serviço — precisa ser maior que zero.",
  servico_local_prestacao_invalido:
    "O código do município de prestação precisa ter 7 dígitos (código IBGE).",
  servico_codigo_nacional_invalido: "O código de serviço informado não tem os 6 dígitos exigidos.",
  p_tot_trib_sn_invalido: "A alíquota efetiva do Simples Nacional precisa estar entre 0 e 100.",

  // --- Emissão de NFS-e: impedimentos do CADASTRO da empresa ---------------
  //
  // ⚠ Nenhum destes o cliente resolve sozinho — todos terminam no contador. Frases genéricas aqui
  // ("erro ao emitir") mandariam o cliente tentar de novo para sempre.
  company_not_found: "Não encontramos o cadastro desta empresa. Fale com o seu contador.",
  company_missing_fields:
    "O cadastro fiscal da empresa está incompleto e a nota não pode ser emitida. Fale com o seu contador.",
  nfse_not_configured:
    "A emissão de NFS-e ainda não está configurada para esta empresa. Fale com o seu contador.",
  nfse_ultima_nota_ilegivel:
    "Não foi possível ler a numeração da última nota desta empresa. Fale com o seu contador antes de emitir.",
  nfse_leitura_numeracao_indisponivel:
    "Não conseguimos consultar a numeração das notas agora. Tente de novo em alguns minutos.",
  nfse_retry_invoice_not_found:
    "Não encontramos a tentativa anterior desta nota. Recarregue a página e preencha de novo.",

  // --- Emissão de NFS-e: o portão (quem pode emitir) -----------------------
  emissao_cliente_nao_liberada:
    "A emissão de notas ainda não foi liberada para esta empresa. Peça ao seu contador.",
  emissao_cliente_papel_insuficiente:
    "Seu perfil nesta empresa não permite emitir notas. Peça ao responsável da empresa.",

  // --- Servidor / rede ---
  internal_error: "Algo deu errado do nosso lado. Tente de novo em instantes.",
  not_implemented_yet: "Esta funcionalidade ainda não está disponível.",
  network_error: "Não conseguimos falar com o servidor. Verifique sua conexão.",

  // ⚠⚠ O EXTRATO BANCÁRIO. Estes dois códigos são de 26/08/2026, e sem eles a recusa cairia no
  // `padrao` — o servidor manda o conserto ("baixe em períodos menores") e `mensagemDeErro` NÃO lê
  // `err.message`, de propósito (ela nunca devolve texto cru do servidor). Sem a entrada aqui, o
  // conserto que o backend escreveu não chega ao olho de quem precisa dele.
  arquivo_grande_demais:
    "O extrato passa de 10 MB. Baixe o arquivo do banco em períodos menores e envie um de cada vez.",
  arquivo_invalido: "Não conseguimos ler este arquivo. Confira se ele é o .OFX que o banco gerou.",
  // ⚠ As recusas do PRÓPRIO serviço de import. Os códigos foram LIDOS de `RECUSA_DO_IMPORT`
  // (`apps/api/src/application/declarados/ImportOfxService.js`), não deduzidos — uma primeira versão
  // deste bloco inventou três nomes com prefixo `ofx_` que não existem em lugar nenhum, e frases
  // penduradas em código errado nunca aparecem.
  arquivo_vazio: "O arquivo enviado está vazio. Baixe o extrato de novo no site do banco.",
  nenhuma_transacao:
    "Não conseguimos ler nenhuma transação neste arquivo. Confira se ele é o extrato em formato OFX "
    + "que o seu banco disponibiliza.",
  extrato_grande_demais: "Este extrato tem transações demais para um envio só. Divida o período e envie em partes.",
  ofx_import_falhou: "Não foi possível importar o extrato. Tente de novo em instantes.",
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
