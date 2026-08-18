// A RECUSA DA EMISSÃO — o que aconteceu, o que fazer, e em QUE CAMPO.
//
// ⚠ O SERVIDOR JÁ MANDAVA "O QUE FAZER" E NINGUÉM LIA.
// `routes/nfse.js` responde com `{ error, camada, codigo, message, correcao, numeroReutilizavel }`
// desde que as três camadas foram separadas — e o assistente exibia só `e.message`. O campo
// `correcao` é escrito pelo backend olhando o caso concreto (o código do provedor, a numeração, o
// desfecho do transporte); ele **vence** qualquer texto daqui. O que este módulo acrescenta é o
// que o backend não tem como saber: em qual CAMPO DESTA TELA se resolve.
//
// ⚠ O ERRO CHEGA DE DOIS JEITOS, E OS DOIS SÃO LIDOS.
// No real, `request()` (em `api/real/realApi.js`) carimba `err.code` (= `payload.error`) e
// `err.payload` (o corpo inteiro). No mock, `emitirNfse` lança `new Error("codigo_da_recusa")` —
// a mensagem É o código. Ler só um dos dois deixaria metade dos caminhos sem tratamento.
//
// ⚠⚠ A RECUSA MAIS PERIGOSA NÃO É A QUE DIZ "NÃO" — É A QUE NÃO SABE.
// Falha de TRANSPORTE (502) e número em estado indeterminado (409) querem dizer que **o desfecho
// da emissão é desconhecido**: a nota pode ter sido autorizada do outro lado. Clicar "Emitir" de
// novo nesse estado é como se duplica nota fiscal — e a tela deixava o botão exatamente como
// estava. Por isso `podeTentarDeNovo: false` nesses casos, com o motivo na tela.

/** Os campos do assistente, por id. É a mesma constante que o formulário usa no `id` do input. */
export const CAMPO = {
  DOC: "nfse-doc",
  NOME: "nfse-nome",
  EMAIL: "nfse-email",
  CMUN: "nfse-cmun",
  CEP: "nfse-cep",
  LOGRADOURO: "nfse-xlgr",
  NUMERO: "nfse-nro",
  BAIRRO: "nfse-xbairro",
  DESCRICAO: "nfse-descricao",
  COMPETENCIA: "nfse-competencia",
  REFERENCIA: "nfse-referencia",
  VALOR: "nfse-valor",
  ALIQUOTA: "nfse-aliquota",
  ISS_RETIDO: "nfse-iss-retido",
  P_TOT_TRIB_SN: "nfse-ptottribsn",
};

export const ROTULO_DO_CAMPO = {
  [CAMPO.DOC]: "CNPJ ou CPF do tomador",
  [CAMPO.NOME]: "Nome ou razão social",
  [CAMPO.EMAIL]: "E-mail do tomador",
  [CAMPO.CMUN]: "Município do tomador",
  [CAMPO.CEP]: "CEP do tomador",
  [CAMPO.LOGRADOURO]: "Logradouro do tomador",
  [CAMPO.NUMERO]: "Número do endereço",
  [CAMPO.BAIRRO]: "Bairro do tomador",
  [CAMPO.DESCRICAO]: "Descrição do serviço",
  [CAMPO.COMPETENCIA]: "Competência",
  [CAMPO.REFERENCIA]: "Referência interna",
  [CAMPO.VALOR]: "Valor dos serviços",
  [CAMPO.ALIQUOTA]: "Alíquota de ISS",
  [CAMPO.ISS_RETIDO]: "ISS retido pelo tomador",
  [CAMPO.P_TOT_TRIB_SN]: "Total de tributos do Simples Nacional",
};

// O que a tela sabe fazer com cada recusa conhecida. `campo` ausente = não se resolve aqui.
// ⚠ Nenhuma entrada aqui inventa procedimento: ou é o campo que o próprio validador do backend
// nomeia, ou é o cadastro que `buildMissingFields` exige, ou é o aviso de desfecho desconhecido.
const CONHECIDAS = {
  // ── Validador (`application/validators/nfsePayload.js`) ──────────────────
  tomador_documento_invalido: {
    oQueFazer: "O documento do tomador precisa ter 11 dígitos (CPF) ou 14 (CNPJ).",
    campo: CAMPO.DOC,
  },
  tomador_nome_obrigatorio: {
    oQueFazer: "Informe o nome ou a razão social do tomador.",
    campo: CAMPO.NOME,
  },
  tomador_email_invalido: {
    oQueFazer: "Corrija o e-mail do tomador, ou deixe o campo vazio — ele é opcional.",
    campo: CAMPO.EMAIL,
  },
  servico_descricao_obrigatoria: {
    oQueFazer: "Descreva o serviço prestado.",
    campo: CAMPO.DESCRICAO,
  },
  servico_valor_invalido: {
    oQueFazer: "O valor do serviço precisa ser maior que zero.",
    campo: CAMPO.VALOR,
  },
  p_tot_trib_sn_invalido: {
    oQueFazer:
      "O total de tributos é um PERCENTUAL (0 a 100), não o valor em reais. Confira o número no "
      + "extrato do PGDAS-D.",
    campo: CAMPO.P_TOT_TRIB_SN,
  },
  missing_p_tot_trib_sn: {
    oQueFazer:
      "A nota é declarada como Simples Nacional e o Padrão Nacional exige o percentual total de "
      + "tributos. Informe-o.",
    campo: CAMPO.P_TOT_TRIB_SN,
  },
  nfse_iss_retido_sem_aliquota: {
    oQueFazer:
      "Com ISS retido é obrigatório informar a alíquota maior que zero. Informe a alíquota, ou "
      + "desmarque a retenção.",
    campo: CAMPO.ALIQUOTA,
  },

  // ── Cadastro da EMPRESA — não se resolve nesta tela ──────────────────────
  // ⚠ A CARGA TRIBUTÁRIA APROXIMADA do NÃO OPTANTE. No real a `correcao` do servidor chega junto e
  // VENCE este texto (ela nomeia os percentuais que faltam); esta entrada existe para o mock, que
  // lança só o código — sem ela, o caminho offline do Lucro Presumido cairia em "a tela não conhece
  // esta recusa". O lugar é o MESMO que a `correcao` do servidor nomeia.
  missing_tot_trib_nao_simples: {
    oQueFazer:
      "A empresa não é optante do Simples: a nota declara a carga tributária aproximada (Lei "
      + "12.741/2012), e os TRÊS percentuais são exigidos, inclusive quando algum é 0,00. Cadastre-os "
      + "em Editar cadastro → Emissão de NFS-e → Carga tributária aproximada.",
    ondeSeResolve: "no cadastro da empresa",
  },
  invalid_tot_trib_nao_simples: {
    oQueFazer:
      "Um dos percentuais da carga tributária aproximada está fora de 0 a 100 — é um PERCENTUAL, "
      + "não o valor dos tributos em reais. Corrija em Editar cadastro → Emissão de NFS-e → Carga "
      + "tributária aproximada.",
    ondeSeResolve: "no cadastro da empresa",
  },
  company_missing_fields: {
    oQueFazer:
      "Faltam campos no cadastro da empresa. Preencha em Editar cadastro → Inscrições e → Emissão "
      + "de NFS-e, e emita de novo.",
    ondeSeResolve: "no cadastro da empresa",
  },
  nfse_municipio_nao_configurado: {
    oQueFazer:
      "A empresa não tem município emissor cadastrado. Escolha-o em Editar cadastro → Inscrições.",
    ondeSeResolve: "no cadastro da empresa",
  },
  nfse_not_configured: {
    oQueFazer:
      "A integração de emissão não está configurada neste ambiente (certificado/endpoint). Nada "
      + "foi enviado à prefeitura.",
    ondeSeResolve: "na configuração do ambiente",
  },
  company_not_found: {
    oQueFazer: "O servidor não encontrou esta empresa. Recarregue a página e tente de novo.",
  },

  // ── Numeração ────────────────────────────────────────────────────────────
  nfse_ultima_nota_ilegivel: {
    oQueFazer:
      "A série e o número da próxima nota são lidos da última nota emitida, e ela não pôde ser "
      + "lida. A emissão foi recusada em vez de chutar o próximo número.",
  },
  nfse_leitura_numeracao_indisponivel: {
    oQueFazer:
      "A leitura da numeração não respondeu. É transitório: aguarde um instante e tente de novo. "
      + "Nada foi enviado à prefeitura.",
  },

  // ── Desfecho DESCONHECIDO — não reemitir sem consultar ───────────────────
  nfse_falha_transporte: {
    oQueFazer:
      "A comunicação com o sistema nacional falhou DEPOIS do envio: não se sabe se a nota foi "
      + "autorizada. Antes de emitir de novo, consulte com “🔄 Buscar NFS-e” na aba de notas.",
    desfechoDesconhecido: true,
  },
  nfse_numero_em_estado_indeterminado: {
    oQueFazer:
      "Existe um número de nota cujo desfecho é desconhecido. Consulte antes de emitir — reemitir "
      + "agora pode duplicar a nota (E0014) ou abrir um buraco permanente na numeração.",
    desfechoDesconhecido: true,
  },
};

function normalizarCodigo(valor) {
  return String(valor || "").trim().toLowerCase();
}

function textoOuNulo(valor) {
  const t = String(valor ?? "").trim();
  return t || null;
}

/**
 * Lê o erro lançado por `onEmitir` e devolve o que a tela precisa mostrar.
 *
 * @returns {{
 *   mensagem: string, oQueFazer: string|null, campo: string|null, rotuloDoCampo: string|null,
 *   camada: string|null, codigoDoProvedor: string|null, camposDoCadastro: string[],
 *   podeTentarDeNovo: boolean, desfechoDesconhecido: boolean, reconhecida: boolean
 * }}
 */
export function lerRejeicao(erro) {
  const payload = erro?.payload || {};
  // No real o código vem carimbado; no mock ele é a própria mensagem.
  const codigo = normalizarCodigo(erro?.code || payload.error || erro?.message);
  const conhecida = CONHECIDAS[codigo] || null;

  const camada = textoOuNulo(payload.camada);
  // `nfse_rejected` é recusa FISCAL: quem sabe o motivo é o provedor, e ele vem em `message` +
  // `correcao`. Não há texto local que acrescente algo — inventar um seria adivinhar a regra da
  // prefeitura.
  const recusaFiscal = codigo === "nfse_rejected" || camada === "RECEITA";
  const transporte = camada === "TRANSPORTE" || Boolean(conhecida?.desfechoDesconhecido);

  const mensagem =
    textoOuNulo(payload.message)
    || textoOuNulo(erro?.message)
    || "Não foi possível emitir a nota.";

  // ⚠ A `correcao` DO SERVIDOR VENCE. Ela é escrita olhando o caso concreto; o texto local é o
  // genérico do código.
  const oQueFazer = textoOuNulo(payload.correcao) || conhecida?.oQueFazer || null;

  const campo = conhecida?.campo || null;
  const camposDoCadastro = Array.isArray(payload.missing)
    ? payload.missing.map((c) => String(c)).filter(Boolean)
    : Array.isArray(erro?.missing)
      ? erro.missing.map((c) => String(c)).filter(Boolean)
      : [];

  return {
    mensagem,
    oQueFazer,
    campo,
    rotuloDoCampo: campo ? ROTULO_DO_CAMPO[campo] || null : null,
    camada,
    codigoDoProvedor: textoOuNulo(payload.codigo),
    camposDoCadastro,
    // Corrigir e tentar de novo é o caminho normal — EXCETO quando ninguém sabe o que aconteceu.
    podeTentarDeNovo: !transporte,
    desfechoDesconhecido: transporte,
    // "Reconhecida" quer dizer que a tela tem o que dizer além de repetir o servidor. Recusa fiscal
    // com `correcao` conta; código nunca visto, não — e aí a tela DIZ que não sabe, em vez de
    // sugerir um procedimento qualquer.
    reconhecida: Boolean(conhecida || oQueFazer || recusaFiscal),
  };
}
