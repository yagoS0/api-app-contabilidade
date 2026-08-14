// REJEIÇÃO FISCAL E QUEDA DE REDE NÃO SÃO O MESMO FATO.
//
// ─── O QUE HAVIA ────────────────────────────────────────────────────────────────────────────
//
// Timeout, DNS, 500 do provedor e recusa da Receita caíam TODOS no mesmo `status:"rejected"`, e
// `ServiceInvoice` **não tinha coluna de motivo** — a razão existia só no `log.error`
// (`NfseService.js:1148-1165`), que envelhece e some. A tela dizia "rejeitada" e o contador não
// tinha como saber se corrigia a nota ou se tentava de novo.
//
// Pior: `buildDpsXml` lança as validações NOSSAS (`MISSING_P_TOT_TRIB_SN`,
// `MISSING_TOMADOR_ADDRESS`, `INVALID_PIS_COFINS_RET_BASE`) de DENTRO do `try` do `issue`. Elas
// caíam no mesmo `catch`, viravam `status:"rejected"` e ficavam **indistinguíveis de uma recusa da
// Receita** — uma nota que nunca saiu da nossa máquina era gravada como recusada por ela.
//
// ─── AS TRÊS CAMADAS ────────────────────────────────────────────────────────────────────────
//
// | camada | o que aconteceu | a DPS chegou ao sistema nacional? | o NÚMERO pode ser reusado? |
// |---|---|---|---|
// | `NOSSA`      | recusamos antes de enviar (validação, sem cert, sem município, série fora da faixa) | **não** | **sim** |
// | `TRANSPORTE` | o pedido saiu e o desfecho é desconhecido (timeout, DNS, 5xx, TLS) | **não se sabe** | **não** — consultar antes |
// | `RECEITA`    | o sistema nacional respondeu recusando (código `E####`) | **sim, e recusou** | **sim** |
//
// ⚠ A LINHA DO MEIO É A RAZÃO DE O CAMPO NÃO SER UM SÓ. Sem ela, "não sei se emitiu" seria
// arquivado ou como erro nosso (e o número seria reusado, arriscando E0014) ou como recusa da
// Receita (e o número seria reusado do mesmo jeito). Como **não existe inutilização na NFS-e**,
// pular o número é buraco permanente e reusar às cegas é risco de duplicidade: as duas saídas são
// ruins, e a única resposta honesta é reter o número e consultar o `Id` da DPS.
//
// ⚠ A pesquisa de mercado foi unânime em que modelar as duas como um campo só é dívida garantida.
// O formato `{codigo, mensagem, correcao}` segue o único fornecedor que estrutura bem isso
// (Focus) — `correcao` é o que separa "deu erro" de "faça isto".

export const CAMADA = Object.freeze({
  NOSSA: "NOSSA",
  TRANSPORTE: "TRANSPORTE",
  RECEITA: "RECEITA",
});

/** Status de ciclo de vida da `ServiceInvoice`. `rejected` passa a significar SÓ recusa fiscal. */
export const STATUS = Object.freeze({
  PENDING: "pending",
  ISSUED: "issued",
  /** A Receita recusou. Fato fiscal, definitivo, número liberado. */
  REJECTED: "rejected",
  /** Nós recusamos, ou o transporte falhou. Não é fato fiscal. */
  FALHA_ENVIO: "falha_envio",
});

/** Códigos de erro NOSSOS — nunca saíram da máquina. Nenhum deles é um `E####`. */
const CODIGOS_NOSSOS = new Set([
  "MISSING_P_TOT_TRIB_SN",
  "MISSING_TOMADOR_ADDRESS",
  "INVALID_PIS_COFINS_RET_BASE",
  "MISSING_TOT_TRIB_NAO_SIMPLES",
  "NFSE_MUNICIPIO_NAO_CONFIGURADO",
  "NFSE_REGIME_INDEFINIDO",
  "NFSE_ISS_RETIDO_SEM_ALIQUOTA",
  "NO_COMPANY_CERT",
  "CERT_CNPJ_MISMATCH",
  "CERT_PASSWORD_DECRYPT_FAILED",
  "NFSE_CERT_PFX_ILEGIVEL",
  "SERIE_NAO_CADASTRADA",
  "SERIE_NAO_NUMERICA",
  "SERIE_FORA_DA_FAIXA",
  "NUMERO_NAO_RESERVADO",
  "NFSE_INVALID_BASE_URL",
  "NFSE_ENV_HOST_MISMATCH",
  "NFSE_NOT_CONFIGURED",
]);

/** Erros de rede/TLS do Node e do axios. Desfecho DESCONHECIDO — o pedido pode ter chegado. */
const CODIGOS_TRANSPORTE = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "ERR_BAD_RESPONSE",
  "EPROTO",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

/**
 * Acha o código `E####` do padrão nacional em qualquer canto da resposta do provedor.
 *
 * ⚠ A busca é sobre o JSON SERIALIZADO de propósito: a forma da resposta de erro do sistema
 * nacional **não está documentada neste projeto** (nenhuma emissão jamais saiu), então varrer uma
 * árvore de campos que ninguém viu seria inventar contrato. O que se sabe com certeza é o formato
 * do código — `E` seguido de 4 dígitos, como `E0014`, `E0718`, `E1200` —, e é só isso que se
 * procura. Não achando, devolve `null`: **nunca** um código fabricado.
 */
export function extrairCodigoReceita(providerData) {
  if (providerData === null || providerData === undefined) return null;
  let texto;
  try {
    texto = typeof providerData === "string" ? providerData : JSON.stringify(providerData);
  } catch {
    return null;
  }
  const m = /\bE\d{4}\b/.exec(String(texto));
  return m ? m[0] : null;
}

function primeiraMensagem(providerData, fallback) {
  const d = providerData;
  if (d && typeof d === "object") {
    const direta = d.message || d.error || d.detail || d.mensagem || d.motivo;
    if (typeof direta === "string" && direta.trim()) return direta.trim();
    const lista = d.erros || d.errors || d.mensagens;
    if (Array.isArray(lista) && lista.length) {
      const p = lista[0];
      const t = typeof p === "string" ? p : p?.mensagem || p?.message || p?.descricao;
      if (typeof t === "string" && t.trim()) return t.trim();
    }
    try {
      return JSON.stringify(d);
    } catch {
      /* segue para o fallback */
    }
  }
  if (typeof d === "string" && d.trim()) return d.trim();
  return fallback;
}

/**
 * Classifica o erro de uma tentativa de emissão nas três camadas.
 *
 * @param {Error} err erro capturado
 * @returns {{camada: string, codigo: string|null, mensagem: string, correcao: string|null,
 *            status: string, numeroReutilizavel: boolean, providerData: any}}
 */
export function classificarFalha(err) {
  const resposta = err?.response;
  const providerData = resposta?.data ?? null;
  const httpStatus = resposta?.status ?? null;

  // 1) NOSSA — erro que levantamos antes de qualquer I/O. Tem código nomeado e não tem `response`.
  if (err?.code && CODIGOS_NOSSOS.has(err.code)) {
    return {
      camada: CAMADA.NOSSA,
      codigo: err.code,
      mensagem: err.message || "Falha na preparação da DPS.",
      correcao: err.correcao || null,
      status: STATUS.FALHA_ENVIO,
      // Nada saiu da máquina: o número está intacto e a próxima tentativa reusa a mesma linha.
      numeroReutilizavel: true,
      providerData: null,
    };
  }

  // 2) RECEITA — houve resposta HTTP do sistema nacional. 4xx é recusa do documento.
  //
  // ⚠ 5xx NÃO entra aqui. Erro de servidor não é análise fiscal do documento: ele pode ocorrer
  // DEPOIS de a DPS ter sido aceita e antes de a resposta voltar. Tratá-lo como recusa liberaria
  // o número de uma nota possivelmente existente.
  if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
    return {
      camada: CAMADA.RECEITA,
      codigo: extrairCodigoReceita(providerData),
      mensagem: primeiraMensagem(providerData, err?.message || "DPS recusada pelo sistema nacional."),
      correcao: null,
      status: STATUS.REJECTED,
      // A Receita analisou e recusou: não há NFS-e com esse número, então ele volta a valer.
      numeroReutilizavel: true,
      providerData,
    };
  }

  // 3) TRANSPORTE — tudo o mais: 5xx, timeout, DNS, TLS, socket. Desfecho DESCONHECIDO.
  const codigoRede =
    (err?.code && CODIGOS_TRANSPORTE.has(err.code) && err.code) ||
    (httpStatus ? `HTTP_${httpStatus}` : err?.code || "TRANSPORTE_DESCONHECIDO");
  return {
    camada: CAMADA.TRANSPORTE,
    codigo: codigoRede,
    mensagem: primeiraMensagem(providerData, err?.message || "Falha de comunicação com o sistema nacional."),
    correcao:
      "Não se sabe se a DPS chegou a ser processada. NÃO reemita com número novo: como a NFS-e " +
      "não tem inutilização, um número pulado é buraco permanente. Consulte o Id da DPS no " +
      "sistema nacional antes de decidir.",
    status: STATUS.FALHA_ENVIO,
    // ⚠ A ÚNICA das três em que o número NÃO se libera sozinho.
    numeroReutilizavel: false,
    providerData,
  };
}

/** Campos de falha prontos para o `update` da `ServiceInvoice`. */
export function camposDeFalha(desfecho) {
  return {
    status: desfecho.status,
    falhaCamada: desfecho.camada,
    falhaCodigo: desfecho.codigo,
    falhaMensagem: desfecho.mensagem,
    falhaCorrecao: desfecho.correcao,
    falhaEm: new Date(),
  };
}

/** Campos de falha ZERADOS — para a linha que foi reaproveitada e desta vez deu certo. */
export const CAMPOS_DE_FALHA_LIMPOS = Object.freeze({
  falhaCamada: null,
  falhaCodigo: null,
  falhaMensagem: null,
  falhaCorrecao: null,
  falhaEm: null,
});
