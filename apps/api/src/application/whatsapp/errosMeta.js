// O ERRO DA META, TRADUZIDO PARA O CONTADOR — e o que fazer com ele.
//
// ⚠ POR QUE ISTO É METADE DA F3, E NÃO UM DETALHE
// `(#131047) Re-engagement message` não é resposta para ninguém. O contador precisa saber DUAS
// coisas: o que aconteceu e o que fazer agora — e uma terceira que o lote precisa, mas ele não:
// se adianta tentar de novo. Número sem WhatsApp não melhora com retentativa; limite de vazão sim.
// Sem essa distinção, a fila ou desiste do que ia dar certo ou martela o que nunca vai.
//
// A saída deste módulo alimenta `EnvioGuiaService.marcarFalhou({ codigo, mensagemUsuario })` —
// que já nasceu com os dois campos, e cujo comentário diz: "o erro chega aqui JÁ TRADUZIDO".
//
// ⚠ TRÊS REGRAS DURAS
// 1. **Código que não está aqui passa CRU E NOMEADO.** Nunca vira "erro desconhecido" mudo, e nunca
//    é adivinhado por semelhança de faixa (`1310xx` ≠ "algo de janela"). O número, o texto da Meta e
//    o `fbtrace_id` viajam inteiros — é com eles que se abre chamado com a Meta.
// 2. **Nenhum segredo entra na saída.** Token e app secret vivem em header; nada aqui os lê. Há
//    teste amarrando isso.
// 3. **Retentativa só é "SIM"/"NAO" quando a FONTE diz.** Quando a documentação descreve o erro mas
//    não fala em reenviar, a resposta é `NAO_DOCUMENTADA` — e `baseDaRetentativa` conta se a
//    afirmação veio de frase documentada ou foi derivada do status HTTP. Um `retryable: true`
//    chutado num lote de 30 guias é 30 mensagens repetidas no WhatsApp do cliente.
//
// ── FONTE ────────────────────────────────────────────────────────────────────────────────────────
// Cloud API — Error Codes (Meta for Developers):
//   https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
//   Consultado em 2026-08-14. De lá saem: o formato do JSON de erro, o número, o título, a descrição
//   e o status HTTP de cada código, e as frases de solução citadas em `solucaoDocumentada`.
//
// ⚠ O texto em `mensagemUsuario` é NOSSO — escrito a partir da descrição/solução documentadas em
// inglês. Não existe string oficial em português para esses códigos; o que está preso à fonte é o
// CÓDIGO, o TÍTULO e a SOLUÇÃO (citada literalmente, em inglês, ao lado de cada entrada).

/**
 * Formato do corpo de erro da Cloud API, conforme a página de Error Codes (2026-08-14):
 *
 *   { "error": { "message", "type", "code", "error_data": { "messaging_product", "details" },
 *                "error_subcode", "fbtrace_id" } }
 *
 * ⚠ `error_subcode` está documentado como DEPRECIADO — "will not appear in v16.0+ responses".
 * Ele é lido quando vem, e nada depende dele.
 */

export const RETENTATIVA = Object.freeze({
  /** A fonte diz, com todas as letras, que esperar e reenviar é o caminho. */
  SIM: "SIM",
  /** A fonte diz que reenviar não resolve (ou manda fazer outra coisa antes). */
  NAO: "NAO",
  /** ⚠ A fonte descreve o erro e NÃO fala em reenviar. Não se inventa a resposta. */
  NAO_DOCUMENTADA: "NAO_DOCUMENTADA",
});

export const BASE_DA_RETENTATIVA = Object.freeze({
  /** Há frase na documentação mandando (ou proibindo) tentar de novo. Citada em `solucaoDocumentada`. */
  DOCUMENTADA: "documentada",
  /**
   * ⚠ Não há frase sobre reenviar; a resposta saiu do STATUS HTTP documentado (503/500 = falha
   * temporária de servidor). É inferência NOSSA, e viaja marcada como tal.
   */
  DERIVADA_DO_STATUS: "derivada_do_status",
  /** Código fora da tabela: não há base nenhuma, e é isso que se diz. */
  SEM_FONTE: "sem_fonte",
});

const { SIM, NAO, NAO_DOCUMENTADA } = RETENTATIVA;
const { DOCUMENTADA, DERIVADA_DO_STATUS, SEM_FONTE } = BASE_DA_RETENTATIVA;

/**
 * ⚠ DE ONDE VEIO A LINHA. Existem DUAS fontes legítimas neste módulo — a documentação da Meta e o
 * esqueleto que o dono entregou — e misturá-las sem dizer qual é qual não é legítimo.
 */
export const PROCEDENCIA = Object.freeze({
  /** Código, título, descrição e solução conferidos na página oficial de Error Codes. */
  META: "META_DOCUMENTADO",
  /** Só o esqueleto do dono sustenta a linha; não foi possível confirmar na fonte oficial. */
  ESQUELETO_DO_DONO: "ESQUELETO_DO_DONO",
});

/**
 * Os 13 códigos que o esqueleto do dono traduz (`src/whatsapp/traduzErros.js`), com o texto DELE.
 *
 * Guardados literalmente por dois motivos: para que a conferência contra a fonte oficial seja
 * auditável sem abrir outro arquivo, e porque foi comparando os dois lados que a divergência do
 * **130472** apareceu (ver a entrada dele na tabela).
 *
 * ✔ RESULTADO DA CONFERÊNCIA (2026-08-14): os 13 existem na documentação oficial. 12 batem; 1
 * (130472) descreve outro código. Nenhuma linha desta tabela ficou apoiada só no esqueleto.
 */
export const TRADUCAO_DO_ESQUELETO_DO_DONO = Object.freeze({
  131047: "A janela de 24h expirou — envie um template para reabrir a conversa.",
  131026: "Este número não tem WhatsApp ou não pode receber mensagens.",
  131021: "Não é possível enviar mensagem para o próprio número do escritório.",
  132000: "Erro no preenchimento do template (variáveis não batem com o modelo aprovado).",
  132001: "Template não existe ou ainda não foi aprovado neste idioma.",
  132015: "Template pausado pela Meta por baixa qualidade — revise o texto.",
  131048: "Limite de envios atingido por problemas de qualidade do número. Reduza o volume hoje.",
  131056: "Muitas mensagens para este mesmo contato em pouco tempo. Aguarde alguns minutos.",
  130472: "Este contato optou por não receber mensagens comerciais.",
  100: "Requisição inválida — verifique o número informado.",
  190: "Token de acesso expirado ou inválido — avise o administrador do sistema.",
  4: "Limite de chamadas à API atingido — o envio será retomado automaticamente.",
  368: "Conta temporariamente bloqueada pela Meta por violação de política.",
});

/**
 * Onde o conserto acontece. Serve à tela: erro de CADASTRO é do contador, erro de CONTA é do
 * escritório/Meta, erro de TEMPLATE é da submissão, erro de VAZAO é da fila.
 */
export const ONDE = Object.freeze({
  CADASTRO: "CADASTRO",       // o número do cliente, no cadastro da empresa
  DESTINATARIO: "DESTINATARIO", // o cliente do outro lado (bloqueou, optou por sair, janela fechada)
  CONTA: "CONTA",             // a WABA / o número do escritório / faturamento / token
  TEMPLATE: "TEMPLATE",       // o modelo aprovado na Meta
  VAZAO: "VAZAO",             // limite de envio
  PLATAFORMA: "PLATAFORMA",   // indisponibilidade do lado da Meta
  CHAMADA: "CHAMADA",         // o payload que nós montamos
});

/**
 * A tabela. Cada linha carrega a frase da Meta que a sustenta (`solucaoDocumentada`, em inglês,
 * como está na fonte) — para que quem revisar a tradução compare com o original sem sair do arquivo.
 *
 * `procedencia` é carimbada por `normalizarTabela` logo abaixo; toda linha aqui saiu da página
 * oficial de Error Codes, então o default é `META`. Se um dia entrar uma linha que só o esqueleto
 * do dono sustente, ela declara `procedencia: PROCEDENCIA.ESQUELETO_DO_DONO` explicitamente — e
 * `traduzirErroMeta` a devolve carimbada, para a tela poder dizer de onde veio.
 */
const TABELA = {
  // ── Autenticação e permissão ──────────────────────────────────────────────────────────────────
  0: {
    titulo: "Authentication failure",
    httpStatus: 401,
    onde: ONDE.CONTA,
    solucaoDocumentada: "Get a new access token",
    mensagemUsuario:
      "A credencial do WhatsApp não vale mais (expirou ou foi revogada na Meta). Gere um novo token "
      + "permanente do Usuário do Sistema e atualize a configuração do servidor. Reenviar sem trocar "
      + "o token não adianta.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  190: {
    titulo: "Access token expired",
    httpStatus: 401,
    onde: ONDE.CONTA,
    solucaoDocumentada: "Get a new access token",
    mensagemUsuario:
      "O token do WhatsApp expirou. Gere um novo token permanente na Meta e atualize a configuração "
      + "do servidor antes de tentar de novo.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  200: {
    titulo: "No access token provided",
    httpStatus: 401,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A chamada saiu sem token do WhatsApp — a integração está sem credencial configurada no "
      + "servidor. Nenhuma mensagem sai enquanto isso não for corrigido.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  3: {
    titulo: "Capability or permissions issue",
    httpStatus: 403,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O token do WhatsApp não tem as permissões necessárias. Confira se ele foi gerado com "
      + "`whatsapp_business_messaging` e `whatsapp_business_management`.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  10: {
    titulo: "Permission denied or removed",
    httpStatus: 403,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A permissão que o envio exige foi negada ou removida na Meta. Revise os ativos atribuídos ao "
      + "Usuário do Sistema (o App e a WABA) antes de tentar de novo.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131005: {
    titulo: "Permission denied",
    httpStatus: 403,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A conta do WhatsApp não tem permissão para esta operação. Revise as permissões do token na "
      + "Meta — reenviar não muda isso.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },

  // ── A janela de 24h e o destinatário ──────────────────────────────────────────────────────────
  131047: {
    titulo: "Re-engagement message (24-hour window exceeded)",
    // ⚠ A Meta documenta este erro com status 429 — o mesmo dos limites de vazão. Não é limite:
    // esperar não reabre nada. Foi por isso que a retentativa aqui NÃO pôde sair do status HTTP.
    httpStatus: 429,
    onde: ONDE.DESTINATARIO,
    solucaoDocumentada: "Send the recipient a template message instead",
    mensagemUsuario:
      "A janela de 24 horas fechou: passou mais de um dia desde a última mensagem do cliente. Para "
      + "falar agora, envie um template aprovado (é o caso da guia) — ou espere o cliente responder, "
      + "o que reabre a janela. Reenviar o mesmo texto livre vai falhar de novo.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  131026: {
    titulo: "Message undeliverable",
    httpStatus: 400,
    onde: ONDE.CADASTRO,
    solucaoDocumentada: "ask the WhatsApp user to ... Update to the latest version of the WhatsApp client",
    mensagemUsuario:
      "A mensagem não pôde ser entregue neste número. As causas documentadas são: o número não tem "
      + "WhatsApp, o aplicativo do cliente está desatualizado, ou os termos do WhatsApp não foram "
      + "aceitos. Confira o número no cadastro da empresa e fale com o cliente — reenviar para o "
      + "mesmo número não resolve.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  131021: {
    titulo: "Recipient cannot be sender",
    httpStatus: 400,
    onde: ONDE.CADASTRO,
    solucaoDocumentada: "Send a message to a phone number different from the sender",
    mensagemUsuario:
      "O número de destino é o próprio número do escritório. Corrija o contato no cadastro da empresa.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  130403: {
    titulo: "Business has blocked the WhatsApp user",
    httpStatus: 403,
    onde: ONDE.DESTINATARIO,
    solucaoDocumentada: null,
    mensagemUsuario:
      "Este cliente foi bloqueado pelo próprio número do escritório no WhatsApp. Desbloqueie-o antes "
      + "de tentar enviar de novo.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131050: {
    titulo: "User stopped marketing messages",
    httpStatus: 400,
    onde: ONDE.DESTINATARIO,
    // Citação literal da fonte: "Unable to deliver the message. This recipient has chosen to stop
    // receiving marketing messages on WhatsApp from your business."
    solucaoDocumentada:
      "Do not retry sending messages to this user as they will not be received. "
      + "Subscribe to the user_preferences webhook for notifications.",
    mensagemUsuario:
      "O cliente pediu para parar de receber mensagens deste tipo da sua empresa no WhatsApp. A "
      + "documentação da Meta é explícita: NÃO reenviar para este número — a mensagem não será "
      + "recebida. Fale com ele por outro canal e registre um novo opt-in antes de voltar ao "
      + "WhatsApp.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
    procedencia: PROCEDENCIA.META,
  },
  130472: {
    titulo: "Message not sent as part of an experiment",
    // ⚠⚠ AQUI O ESQUELETO DO DONO E A DOCUMENTAÇÃO DA META DISCORDAM — e a divergência importa.
    //
    // O esqueleto (`src/whatsapp/traduzErros.js`) traduz 130472 como "Este contato optou por não
    // receber mensagens comerciais". Esse é, literalmente, o texto documentado do **131050**
    // ("This recipient has chosen to stop receiving marketing messages..."), não o do 130472.
    //
    // A fonte oficial, consultada em 2026-08-14, diz de 130472: details "Message was not sent as
    // part of an experiment", solution "See Marketing Message Experiment documentation."
    //
    // Seguimos a FONTE (regra 4 do projeto: fonte oficial vence memória e exemplo de terceiro). A
    // consequência de não seguir seria dupla e silenciosa: o contador leria "o cliente optou por
    // sair" — pediria novo opt-in, ou pararia de mandar guia para quem nunca pediu para sair — e o
    // 131050 de verdade, esse sim um pedido de saída, continuaria sem tratamento próprio.
    // ⚠ Se o dono tiver evidência do contrário, é ele quem decide: a divergência está aqui,
    // nomeada, em vez de resolvida em silêncio numa direção ou noutra.
    httpStatus: null, // a fonte não declara status HTTP para este código
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: "See Marketing Message Experiment documentation.",
    mensagemUsuario:
      "A Meta não enviou esta mensagem porque ela ficou de fora de um experimento de mensagens em "
      + "andamento na conta. Não é recusa do cliente nem problema do número. A documentação não diz "
      + "se reenviar resolve.",
    retentativa: NAO_DOCUMENTADA,
    baseDaRetentativa: SEM_FONTE,
    procedencia: PROCEDENCIA.META,
    divergeDoEsqueleto:
      "O esqueleto do dono traduz 130472 como \"Este contato optou por não receber mensagens "
      + "comerciais\" — que é o texto documentado do 131050, não o do 130472.",
  },

  // ── Limites de vazão (aqui a retentativa é o caminho, e a fonte diz) ───────────────────────────
  4: {
    titulo: "API rate limit reached",
    httpStatus: 429,
    onde: ONDE.VAZAO,
    solucaoDocumentada: "try again later or reduce the frequency or amount of API queries",
    mensagemUsuario:
      "O limite de chamadas do aplicativo na Meta foi atingido. O envio pode ser retomado mais tarde, "
      + "em ritmo menor — nada de errado com a guia nem com o número.",
    retentativa: SIM,
    baseDaRetentativa: DOCUMENTADA,
  },
  80007: {
    titulo: "Rate limit hit (WhatsApp Business Account)",
    httpStatus: 429,
    onde: ONDE.VAZAO,
    solucaoDocumentada: "Try again later or reduce the frequency or amount of API queries",
    mensagemUsuario:
      "A conta WhatsApp do escritório atingiu o limite de chamadas. Dá para retomar mais tarde, em "
      + "ritmo menor.",
    retentativa: SIM,
    baseDaRetentativa: DOCUMENTADA,
  },
  130429: {
    titulo: "Rate limit hit (message throughput)",
    httpStatus: 429,
    onde: ONDE.VAZAO,
    solucaoDocumentada: "Try again later or reduce the frequency with which the app sends messages",
    mensagemUsuario:
      "O limite de vazão de mensagens foi atingido — o lote está saindo rápido demais. Dá para "
      + "retomar mais tarde; as guias que faltam continuam pendentes, não perdidas.",
    retentativa: SIM,
    baseDaRetentativa: DOCUMENTADA,
  },
  131056: {
    titulo: "(Business Account, Consumer) pair rate limit hit",
    httpStatus: 429,
    onde: ONDE.VAZAO,
    solucaoDocumentada: "Wait and retry the operation, if you intend to send messages",
    mensagemUsuario:
      "Mensagens demais para este mesmo cliente em pouco tempo. Espere um pouco e tente de novo.",
    retentativa: SIM,
    baseDaRetentativa: DOCUMENTADA,
  },
  131049: {
    titulo: "Meta chose not to deliver (per-user marketing template limit)",
    httpStatus: 429,
    onde: ONDE.VAZAO,
    solucaoDocumentada: "wait at least 24 hours before resending the template message",
    mensagemUsuario:
      "A Meta limitou quantos templates deste tipo este cliente recebe por dia. A documentação manda "
      + "esperar pelo menos 24 horas antes de reenviar o mesmo template.",
    retentativa: SIM,
    baseDaRetentativa: DOCUMENTADA,
  },
  131048: {
    titulo: "Spam rate limit hit",
    httpStatus: 429,
    onde: ONDE.CONTA,
    // ⚠ A solução documentada manda CONFERIR a qualidade — não manda esperar e reenviar. Por isso
    // este 429 não vira `SIM`, mesmo parecendo com os de cima.
    solucaoDocumentada: "Check your quality status in the WhatsApp Manager",
    mensagemUsuario:
      "O número do escritório está com restrição de envio por qualidade (denúncias ou bloqueios de "
      + "destinatários). Confira o status de qualidade no WhatsApp Manager antes de continuar. A "
      + "documentação não diz se reenviar resolve — e insistir aqui piora a qualidade do número, que "
      + "é o canal de todos os clientes.",
    retentativa: NAO_DOCUMENTADA,
    baseDaRetentativa: DOCUMENTADA,
  },
  131064: {
    titulo: "Message limit reached (template classification)",
    httpStatus: 429,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O limite de mensagens da conta foi atingido por causa da classificação dos templates. A "
      + "documentação não diz se reenviar resolve — confira os limites da conta no WhatsApp Manager.",
    retentativa: NAO_DOCUMENTADA,
    baseDaRetentativa: SEM_FONTE,
  },

  // ── A conta do escritório ─────────────────────────────────────────────────────────────────────
  131031: {
    titulo: "Business Account locked (policy violation / verification)",
    httpStatus: 403,
    onde: ONDE.CONTA,
    solucaoDocumentada: "See the [Policy Enforcement] ... You can also use the [Health Status API]",
    mensagemUsuario:
      "A conta WhatsApp do escritório está bloqueada — por violação de política ou por falha na "
      + "verificação dos dados. Isso para o canal inteiro, não só esta guia. Verifique a situação na "
      + "Meta (Central de Segurança / Policy Enforcement).",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  368: {
    titulo: "Temporarily blocked for policies violations",
    httpStatus: 403,
    onde: ONDE.CONTA,
    solucaoDocumentada: "See the [Policy Enforcement] document",
    mensagemUsuario:
      "A conta do WhatsApp está restrita por violação de políticas da Meta. O canal fica parado até "
      + "isso ser resolvido na Meta.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  131042: {
    titulo: "Business eligibility payment issue",
    httpStatus: 402,
    onde: ONDE.CONTA,
    solucaoDocumentada: "verify that you have set up billing correctly",
    mensagemUsuario:
      "O faturamento do WhatsApp está com problema: confira a forma de pagamento vinculada à conta "
      + "na Meta. Enquanto isso não for resolvido, nenhum template sai.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  131045: {
    titulo: "Incorrect certificate (phone number not registered)",
    httpStatus: 400,
    onde: ONDE.CONTA,
    solucaoDocumentada: "[Register the phone number] ... before trying again",
    mensagemUsuario:
      "O número do escritório não está registrado na plataforma do WhatsApp. Registre o número na "
      + "Meta antes de tentar de novo.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  133010: {
    titulo: "Phone number not registered",
    httpStatus: 400,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O número do escritório não está registrado na plataforma do WhatsApp. Conclua o registro na "
      + "Meta antes de enviar.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  33: {
    titulo: "Business phone number deleted",
    httpStatus: 404,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O número do escritório não existe mais na conta da Meta. Confira o Phone Number ID "
      + "configurado no servidor.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131037: {
    titulo: "Display name not approved",
    httpStatus: 400,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O nome de exibição do número ainda não foi aprovado pela Meta. Acompanhe a análise no "
      + "WhatsApp Manager.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  130497: {
    titulo: "Business Account is restricted from messaging to users in certain countries",
    httpStatus: 403,
    onde: ONDE.CONTA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A conta do escritório está impedida de enviar mensagens para o país deste número. Confira o "
      + "DDI do contato no cadastro.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },

  // ── O template ────────────────────────────────────────────────────────────────────────────────
  132000: {
    titulo: "Template param count mismatch",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: "make sure the request includes values for all parameters",
    mensagemUsuario:
      "O template esperava um número de variáveis diferente do que foi enviado. É defeito do "
      + "sistema, não do cadastro: o modelo aprovado na Meta e o que o sistema preenche estão "
      + "desalinhados.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  132001: {
    titulo: "Template does not exist",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: "Make sure your template has been approved",
    mensagemUsuario:
      "O template usado no envio não existe ou ainda não foi aprovado neste idioma. Confira o nome e "
      + "o idioma exatos do modelo aprovado no WhatsApp Manager.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  132005: {
    titulo: "Template hydrated text too long",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O texto do template, já com as variáveis preenchidas, ficou maior do que o permitido. Encurte "
      + "os valores enviados ou o próprio modelo.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  132007: {
    titulo: "Template format character policy violated",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: "See our [Template review] document",
    mensagemUsuario:
      "O conteúdo do template viola a política da Meta. O modelo precisa ser reescrito e reenviado "
      + "para análise.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  132012: {
    titulo: "Template parameter format mismatch",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: "See our [Templates] ... document to learn more about template parameters",
    mensagemUsuario:
      "Uma das variáveis do template foi enviada num formato que o modelo não aceita. É defeito do "
      + "sistema no preenchimento, não do cadastro da empresa.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  132015: {
    titulo: "Template is paused",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: "[Edit the template] ... try again once it is approved",
    mensagemUsuario:
      "O template foi pausado pela Meta por baixa qualidade. Ele precisa ser editado e reaprovado — "
      + "só então volta a enviar.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  132016: {
    titulo: "Template is disabled",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: "Create a new template with different content",
    mensagemUsuario:
      "O template foi desativado em definitivo pela Meta. Não há como reativá-lo: é preciso criar um "
      + "modelo novo, com conteúdo diferente, e submeter à análise.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  132018: {
    titulo: "Flow blocked / template parameter configuration issue",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A configuração das variáveis do template está inválida. O modelo precisa ser revisto no "
      + "WhatsApp Manager.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131063: {
    titulo: "Marketing messages are disabled on Cloud API",
    httpStatus: 400,
    onde: ONDE.TEMPLATE,
    solucaoDocumentada: null,
    mensagemUsuario:
      "Este template está classificado como Marketing, e a Cloud API não envia Marketing. O envio de "
      + "guias precisa de um template de categoria Utilidade (Utility).",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },

  // ── A chamada que NÓS montamos ────────────────────────────────────────────────────────────────
  100: {
    titulo: "Invalid parameter",
    httpStatus: 400,
    onde: ONDE.CHAMADA,
    solucaoDocumentada: "See the endpoint's reference ... See [Supported Media Types] ... confirm that they are in fact supported",
    mensagemUsuario:
      "A Meta recusou um parâmetro da chamada. É defeito do sistema (ou tipo de arquivo não "
      + "suportado), não do cadastro da empresa.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  131008: {
    titulo: "Required parameter is missing",
    httpStatus: 400,
    onde: ONDE.CHAMADA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A chamada saiu sem um campo obrigatório. É defeito do sistema — reenviar igual vai falhar de "
      + "novo.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131009: {
    titulo: "Parameter value is not valid",
    httpStatus: 400,
    onde: ONDE.CHAMADA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "Um valor enviado na chamada é inválido para a Meta. É defeito do sistema — reenviar igual vai "
      + "falhar de novo.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131051: {
    titulo: "Unsupported message type",
    httpStatus: 400,
    onde: ONDE.CHAMADA,
    solucaoDocumentada: null,
    mensagemUsuario: "O tipo de mensagem enviado não é suportado pela Meta. É defeito do sistema.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131053: {
    titulo: "Media upload error",
    httpStatus: 400,
    onde: ONDE.CHAMADA,
    solucaoDocumentada: "Inspect any media files ... confirm that they are in fact supported",
    mensagemUsuario:
      "A Meta não conseguiu receber o arquivo da guia. Confira se o PDF existe e está íntegro — "
      + "reenviar o mesmo arquivo quebrado não resolve.",
    retentativa: NAO,
    baseDaRetentativa: DOCUMENTADA,
  },
  131052: {
    titulo: "Media download error",
    httpStatus: 400,
    onde: ONDE.CHAMADA,
    solucaoDocumentada: null,
    mensagemUsuario: "A Meta não conseguiu baixar o arquivo enviado pelo cliente.",
    retentativa: NAO,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  135000: {
    titulo: "Generic user error",
    httpStatus: 400,
    onde: ONDE.CHAMADA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A Meta recusou a chamada sem detalhar o motivo (erro genérico de parâmetros). O texto cru da "
      + "Meta vai junto — é por ele que se abre chamado.",
    retentativa: NAO_DOCUMENTADA,
    baseDaRetentativa: SEM_FONTE,
  },
  1: {
    titulo: "API unknown",
    httpStatus: 400,
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: null,
    // ⚠ Documentado como "400/500": pode ser requisição malformada OU problema de servidor. Como o
    // próprio status não decide, a retentativa não pode ser derivada dele.
    mensagemUsuario:
      "A Meta devolveu um erro sem classificação: pode ser requisição malformada ou problema no "
      + "servidor dela. A documentação não distingue os dois, então não dá para afirmar se reenviar "
      + "resolve.",
    retentativa: NAO_DOCUMENTADA,
    baseDaRetentativa: SEM_FONTE,
  },

  // ── Indisponibilidade do lado da Meta (aqui reenviar É o caminho) ─────────────────────────────
  2: {
    titulo: "API service",
    httpStatus: 503,
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O serviço da Meta está fora do ar ou sobrecarregado. É temporário: o envio pode ser retomado "
      + "mais tarde, sem mexer em nada.",
    retentativa: SIM,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131016: {
    titulo: "Service unavailable",
    httpStatus: 503,
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: "Check the [WhatsApp Business Platform Status] ... before trying again",
    mensagemUsuario:
      "O serviço da Meta está temporariamente indisponível. Confira a página de status da plataforma "
      + "e tente de novo depois.",
    retentativa: SIM,
    baseDaRetentativa: DOCUMENTADA,
  },
  131057: {
    titulo: "Account in maintenance mode",
    httpStatus: 503,
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A conta do WhatsApp está em manutenção do lado da Meta. É temporário: retome o envio mais "
      + "tarde.",
    retentativa: SIM,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  2494100: {
    titulo: "Account in maintenance mode",
    httpStatus: 503,
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O número do escritório está em manutenção do lado da Meta. É temporário: retome o envio mais "
      + "tarde.",
    retentativa: SIM,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  133004: {
    titulo: "Server temporarily unavailable",
    httpStatus: 503,
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "O servidor da Meta está temporariamente indisponível. Confira a página de status e tente de "
      + "novo depois.",
    retentativa: SIM,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
  131000: {
    titulo: "Something went wrong",
    httpStatus: 500,
    onde: ONDE.PLATAFORMA,
    solucaoDocumentada: null,
    mensagemUsuario:
      "A Meta falhou ao enviar a mensagem por um motivo que ela mesma não identificou (erro interno "
      + "dela). Vale tentar de novo mais tarde.",
    retentativa: SIM,
    baseDaRetentativa: DERIVADA_DO_STATUS,
  },
};

/**
 * Carimba `procedencia` (default `META`) e `noEsqueletoDoDono` em cada linha, e congela.
 *
 * ⚠ Feito por passagem, não à mão em 40 entradas: carimbo manual é onde uma linha nova entra sem
 * marca e a procedência some por esquecimento — exatamente o defeito que `dasCalculadoLocal`
 * documenta neste projeto (ausência de marca sendo lida como afirmação).
 */
function normalizarTabela(bruta) {
  const saida = {};
  for (const [codigo, linha] of Object.entries(bruta)) {
    saida[codigo] = Object.freeze({
      procedencia: PROCEDENCIA.META,
      divergeDoEsqueleto: null,
      ...linha,
      noEsqueletoDoDono: Object.prototype.hasOwnProperty.call(TRADUCAO_DO_ESQUELETO_DO_DONO, codigo),
    });
  }
  return Object.freeze(saida);
}

export const ERROS_META = normalizarTabela(TABELA);

const codigosCom = (valor) => Object.freeze(
  Object.entries(ERROS_META)
    .filter(([, linha]) => linha.retentativa === valor)
    .map(([codigo]) => Number(codigo))
    .sort((a, b) => a - b),
);

// ── AS DUAS LISTAS, E A TERCEIRA QUE É O PONTO ───────────────────────────────────────────────────
//
// ⚠ `EnvioGuiaService.marcarFalhou` recebe `proximaTentativaEm`. Quem preenche esse campo precisa
// destas listas — e precisa da TERCEIRA. Sem ela, o código não classificado cairia por default numa
// das duas: em "retentável" o sistema martela para sempre um número que não existe; em "definitivo"
// ele desiste de um limite de vazão que passaria sozinho. Nenhum dos dois é o que a fonte diz.

/** Reenviar é o caminho — a documentação (ou o status 5xx dela) sustenta isso. */
export const CODIGOS_RETENTAVEIS = codigosCom(RETENTATIVA.SIM);

/** Reenviar igual falha igual. O conserto é em outro lugar (cadastro, template, conta, cliente). */
export const CODIGOS_DEFINITIVOS = codigosCom(RETENTATIVA.NAO);

/**
 * ⚠ NEM UMA COISA NEM OUTRA — e é assim que fica.
 *
 * A Meta descreve estes erros e NÃO diz se reenviar resolve. Eles ficam fora das duas listas, com
 * nome, em vez de arbitrados. Quem decide reenviar um destes é o contador, olhando o motivo — não
 * um default escondido na fila.
 */
export const CODIGOS_SEM_CLASSIFICACAO = codigosCom(RETENTATIVA.NAO_DOCUMENTADA);

/**
 * A pergunta que a fila faz: agendo `proximaTentativaEm`?
 *
 * ⚠ Devolve `true` / `false` / **`null`** — três respostas, não duas. `null` é "a fonte não diz", e
 * quem chamar tem de tratar `null` como "não agendo sozinho", nunca como `false` disfarçado de
 * certeza nem como `true` otimista. É a mesma forma de `obrigatoriedadeEfd` (`obrigada` /
 * `dispensada` / `indefinida`) e pelo mesmo motivo: sem dado, não se afirma.
 */
export function podeTentarDeNovo(traducao) {
  if (!traducao) return null;
  if (traducao.retentativa === RETENTATIVA.SIM) return true;
  if (traducao.retentativa === RETENTATIVA.NAO) return false;
  return null;
}

/** Códigos que ESTE módulo emite (não vêm da Meta). Prefixo próprio para não colidir com os dela. */
export const CODIGOS_LOCAIS = Object.freeze({
  /** Falhou antes de chegar na Meta: DNS, TLS, timeout, conexão cortada. */
  FALHA_DE_TRANSPORTE: "WHATSAPP_FALHA_DE_TRANSPORTE",
  /** A Meta respondeu, mas o corpo não é o JSON de erro documentado. */
  RESPOSTA_NAO_RECONHECIDA: "WHATSAPP_RESPOSTA_NAO_RECONHECIDA",
  /** Integração desligada ou sem credencial. Nunca chega a sair chamada. */
  NAO_CONFIGURADO: "WHATSAPP_NAO_CONFIGURADO",
  /** Recusa nossa, antes de gastar chamada (telefone inválido, documento sem origem, etc). */
  RECUSA_LOCAL: "WHATSAPP_RECUSA_LOCAL",
});

/** `131047` → `"META_131047"`. Código sempre NOMEADO, traduzido ou não. */
export function codigoNomeado(codigoMeta) {
  return `META_${codigoMeta}`;
}

function textoCru(erro) {
  const detalhe = String(erro?.error_data?.details || "").trim();
  const mensagem = String(erro?.message || "").trim();
  // `details` costuma ser mais específico que `message` — quando existe, ele manda; quando não,
  // `message` responde. Os dois juntos, sem repetir.
  if (detalhe && mensagem && detalhe !== mensagem) return `${mensagem} — ${detalhe}`;
  return detalhe || mensagem || "";
}

/**
 * Traduz o corpo de erro da Cloud API.
 *
 * Aceita tanto o envelope (`{ error: {...} }`) quanto o objeto `error` direto — o cliente passa o
 * corpo como veio, e quem chama um dia com o objeto interno não deve receber "não reconhecido".
 *
 * @param {object|null} corpo  corpo JSON da resposta da Meta
 * @param {object} [contexto]  `{ httpStatus }`
 * @returns {{
 *   codigo: string, codigoMeta: number|null, traduzido: boolean, titulo: string|null,
 *   mensagemUsuario: string, detalheDaMeta: string, retentativa: string,
 *   baseDaRetentativa: string, onde: string|null, httpStatus: number|null,
 *   fbtraceId: string|null, solucaoDocumentada: string|null, fonte: string
 * }}
 */
export function traduzirErroMeta(corpo, contexto = {}) {
  const httpStatus = Number.isFinite(Number(contexto.httpStatus)) ? Number(contexto.httpStatus) : null;
  const erro = corpo && typeof corpo === "object" ? (corpo.error || corpo) : null;
  const codigoBruto = erro && erro.code !== undefined && erro.code !== null ? Number(erro.code) : NaN;
  const cru = textoCru(erro);
  const fbtraceId = erro?.fbtrace_id ? String(erro.fbtrace_id) : null;
  // Depreciado a partir da v16.0 (documentado). Lido quando vier; nada depende dele.
  const subcodigo = erro?.error_subcode !== undefined && erro?.error_subcode !== null
    ? Number(erro.error_subcode)
    : null;

  const base = {
    detalheDaMeta: cru,
    httpStatus,
    fbtraceId,
    subcodigoMeta: Number.isFinite(subcodigo) ? subcodigo : null,
    fonte: FONTE,
    procedencia: null,
    noEsqueletoDoDono: false,
    divergeDoEsqueleto: null,
    httpStatusDocumentado: null,
  };

  // ⚠ Resposta sem código: NÃO é "erro desconhecido" mudo. É uma resposta que não tem a forma
  // documentada, e é isso que se diz — com o corpo cru junto.
  if (!Number.isFinite(codigoBruto)) {
    return {
      ...base,
      codigo: CODIGOS_LOCAIS.RESPOSTA_NAO_RECONHECIDA,
      codigoMeta: null,
      traduzido: false,
      titulo: null,
      onde: null,
      solucaoDocumentada: null,
      mensagemUsuario:
        "O WhatsApp recusou o envio, mas a resposta não veio no formato de erro documentado pela "
        + "Meta (não havia código). Resposta recebida: "
        + (cru ? `"${cru}"` : `${httpStatus ? `HTTP ${httpStatus}, ` : ""}sem texto`)
        + ". Guarde este registro e consulte a documentação de erros da Meta antes de reenviar.",
      retentativa: RETENTATIVA.NAO_DOCUMENTADA,
      baseDaRetentativa: BASE_DA_RETENTATIVA.SEM_FONTE,
    };
  }

  const conhecido = ERROS_META[codigoBruto];

  // ⚠ AQUI ESTÁ A REGRA QUE MAIS IMPORTA: código fora da tabela passa CRU E NOMEADO.
  // Nada de adivinhar por faixa, nada de "erro desconhecido" sem o número e sem o que a Meta disse.
  if (!conhecido) {
    return {
      ...base,
      codigo: codigoNomeado(codigoBruto),
      codigoMeta: codigoBruto,
      traduzido: false,
      titulo: null,
      onde: null,
      solucaoDocumentada: null,
      mensagemUsuario:
        `O WhatsApp recusou o envio com o código ${codigoBruto}, que ainda não está traduzido neste `
        + "sistema. A Meta disse: "
        + (cru ? `"${cru}"` : "(sem texto)")
        + `.${fbtraceId ? ` Identificador da Meta para suporte: ${fbtraceId}.` : ""}`
        + " Consulte este código na documentação de erros da Meta antes de reenviar.",
      retentativa: RETENTATIVA.NAO_DOCUMENTADA,
      baseDaRetentativa: BASE_DA_RETENTATIVA.SEM_FONTE,
    };
  }

  return {
    ...base,
    codigo: codigoNomeado(codigoBruto),
    codigoMeta: codigoBruto,
    traduzido: true,
    titulo: conhecido.titulo,
    onde: conhecido.onde,
    solucaoDocumentada: conhecido.solucaoDocumentada,
    mensagemUsuario: conhecido.mensagemUsuario,
    retentativa: conhecido.retentativa,
    baseDaRetentativa: conhecido.baseDaRetentativa,
    // O status documentado para o código, que nem sempre é o que veio na resposta. Os dois viajam:
    // divergência entre eles é sinal de contrato mudando, e some se guardarmos só um.
    httpStatusDocumentado: conhecido.httpStatus,
    // De onde saiu a linha, e se o esqueleto do dono discorda dela. Sobe até a tela em vez de
    // ficar só no comentário — quem revisar a tradução vê a procedência sem abrir o código.
    procedencia: conhecido.procedencia,
    noEsqueletoDoDono: conhecido.noEsqueletoDoDono,
    divergeDoEsqueleto: conhecido.divergeDoEsqueleto,
  };
}

export const FONTE =
  "developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes (consultado em 2026-08-14)";

/**
 * Falha ANTES da resposta da Meta: DNS, TLS, timeout, conexão cortada.
 *
 * ⚠ NÃO É "NÃO ENVIADO". É "NÃO SE SABE" — a mesma distinção que a camada `TRANSPORTE` da emissão
 * de NFS-e existe para preservar. A requisição pode ter chegado e a resposta ter se perdido, e nesse
 * caso reenviar manda a guia DUAS VEZES para o cliente. Por isso a retentativa aqui não é `SIM`:
 * quem decidir reenviar precisa decidir sabendo disso.
 */
export function traduzirFalhaDeTransporte(causa, contexto = {}) {
  const motivo = String(causa?.message || causa || "").trim();
  const porTimeout = Boolean(contexto.timeout) || /abort/i.test(motivo) || causa?.name === "AbortError";
  return {
    codigo: CODIGOS_LOCAIS.FALHA_DE_TRANSPORTE,
    codigoMeta: null,
    traduzido: false,
    titulo: null,
    onde: null,
    solucaoDocumentada: null,
    detalheDaMeta: porTimeout ? "tempo de resposta esgotado" : motivo,
    mensagemUsuario:
      "Não foi possível falar com o WhatsApp"
      + (porTimeout ? " (o tempo de resposta se esgotou)" : "")
      + ". ⚠ Não dá para afirmar se a mensagem chegou ao cliente: a chamada pode ter sido recebida e "
      + "só a resposta ter se perdido. Confira antes de reenviar — reenviar às cegas pode mandar a "
      + "mesma guia duas vezes.",
    retentativa: RETENTATIVA.NAO_DOCUMENTADA,
    baseDaRetentativa: BASE_DA_RETENTATIVA.SEM_FONTE,
    httpStatus: null,
    httpStatusDocumentado: null,
    fbtraceId: null,
    subcodigoMeta: null,
    fonte: FONTE,
    procedencia: null,
    noEsqueletoDoDono: false,
    divergeDoEsqueleto: null,
  };
}
