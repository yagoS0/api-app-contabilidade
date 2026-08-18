// OS DESFECHOS NOMEADOS DA EMISSÃO DE NFS-e, EM HTTP — em UM lugar só.
//
// ⚠ POR QUE ISTO SAIU DE DENTRO DE `routes/nfse.js`. A emissão passou a ter **duas portas**:
// `POST /nfse/issue` (a do escritório, que existe desde sempre) e
// `POST /client/companies/:companyId/nfse` (a fachada do app do cliente). As duas delegam ao MESMO
// `NfseService.issue` e precisam devolver **os mesmos desfechos**, com os mesmos códigos e os
// mesmos status HTTP — senão o app do cliente veria "erro interno" onde o portal do contador vê
// "corrija o cadastro", para o mesmo fato.
//
// ⚠ **NÃO HÁ REGRA DE EMISSÃO AQUI.** Este módulo não valida nada, não decide nada e não fala com
// o banco: ele traduz o que `NfseService.issue` já respondeu (ou lançou) em status + corpo. Quem
// valida é `validateNfsePayload`; quem autoriza é `ensureEmissaoNfseAutorizada`; quem emite é o
// serviço. Duplicar qualquer um dos três é o defeito que este arquivo existe para impedir.
//
// A tabela das três camadas (`NOSSA` / `TRANSPORTE` / `RECEITA`) está em
// `application/nfse/desfechoEmissao.js` — aqui só se aplica o mapa para HTTP:
//
//   | camada       | status | error                     |
//   |--------------|--------|---------------------------|
//   | `NOSSA`      | 400    | `nfse_falha_local`        |
//   | `TRANSPORTE` | 502    | `nfse_falha_transporte`   |
//   | `RECEITA`    | 422    | `nfse_rejected`           |

/**
 * Traduz o RESULTADO de `NfseService.issue` (que não lançou) em resposta HTTP.
 *
 * @returns o próprio `res` já respondido — o chamador só dá `return`.
 */
export function responderResultadoEmissao(res, result) {
  // ⚠ RECUSA DA RECEITA E ERRO NOSSO NÃO TÊM A MESMA RESPOSTA. Antes tudo era `422 nfse_rejected`:
  // timeout, DNS, 500 do provedor, validação nossa e recusa fiscal. O cliente não tinha como saber
  // se corrigia a nota, tentava de novo, ou consultava antes.
  if (result.status === "rejected") {
    // Camada RECEITA: o sistema nacional analisou e recusou. Fato fiscal — corrigir a nota.
    return res.status(422).json({
      error: "nfse_rejected",
      camada: result.camada,
      codigo: result.codigo,
      message: result.message,
      correcao: result.correcao,
      numeroReutilizavel: result.numeroReutilizavel,
      providerData: result.providerData,
      nfse: result.nfse,
    });
  }
  if (result.status === "falha_envio") {
    // Camada NOSSA → 400 (o pedido é corrigível pelo chamador; nada saiu da máquina).
    // Camada TRANSPORTE → 502 (o problema é a comunicação com o sistema nacional, e o desfecho é
    // DESCONHECIDO — ver `correcao`, que manda consultar antes de reemitir).
    const statusHttp = result.camada === "TRANSPORTE" ? 502 : 400;
    return res.status(statusHttp).json({
      error: result.camada === "TRANSPORTE" ? "nfse_falha_transporte" : "nfse_falha_local",
      camada: result.camada,
      codigo: result.codigo,
      message: result.message,
      correcao: result.correcao,
      numeroReutilizavel: result.numeroReutilizavel,
      nfse: result.nfse,
    });
  }
  const statusCode = result.status === "issued" ? 201 : 202;
  return res.status(statusCode).json(result);
}

/**
 * Traduz a EXCEÇÃO de `NfseService.issue` em resposta HTTP.
 *
 * ⚠ O `500 internal_error` é o ÚLTIMO ramo, e cada código acima dele existe porque a resposta
 * genérica escondia um impedimento que o contador consegue entender e consertar.
 *
 * @returns o próprio `res` já respondido — o chamador só dá `return`.
 */
export function responderErroEmissao(res, err, { log } = {}) {
  if (err.code === "COMPANY_NOT_FOUND") {
    return res.status(404).json({ error: "company_not_found" });
  }
  if (err.code === "COMPANY_MISSING_FIELDS") {
    return res.status(400).json({
      error: "company_missing_fields",
      missing: err.missing || [],
    });
  }
  if (err.code === "NFSE_NOT_CONFIGURED") {
    return res.status(400).json({ error: "nfse_not_configured", message: err.message });
  }
  // ⚠ Reemitir com um número cujo desfecho é DESCONHECIDO não é um erro de validação: é a recusa
  // que impede tanto a duplicidade (E0014) quanto o buraco permanente de numeração.
  if (err.code === "NFSE_NUMERO_EM_ESTADO_INDETERMINADO") {
    return res.status(409).json({
      error: "nfse_numero_em_estado_indeterminado",
      message: err.message,
    });
  }
  if (err.code === "NFSE_RETRY_INVOICE_NOT_FOUND") {
    return res.status(404).json({ error: "nfse_retry_invoice_not_found" });
  }
  // ⚠ A SÉRIE É LIDA DA ÚLTIMA NOTA (decisão do dono, 16/08/2026), e a leitura pode NÃO DAR CERTO.
  // Quando isso acontece a emissão é RECUSADA em vez de chutar o próximo número — e a recusa
  // precisa chegar com NOME e MOTIVO, senão cai no `internal_error` abaixo e o contador lê "erro
  // interno" para um impedimento que ele consegue entender e conferir.
  //
  //   • `NFSE_ULTIMA_NOTA_ILEGIVEL`       → há notas e o XML delas não rendeu série/nDPS. É estado
  //     do DADO, não defeito de execução. 422.
  //   • `NFSE_LEITURA_ULTIMA_NOTA_FALHOU` → a consulta ao banco não voltou. Transitório: o verbo
  //     certo é "tente de novo". 503.
  if (err.code === "NFSE_ULTIMA_NOTA_ILEGIVEL") {
    return res.status(422).json({
      error: "nfse_ultima_nota_ilegivel",
      codigo: err.code,
      message: err.message,
      correcao: err.correcao,
      notasLidas: err.notasLidas,
    });
  }
  if (err.code === "NFSE_LEITURA_ULTIMA_NOTA_FALHOU" || err.code === "NFSE_ULTIMA_NOTA_SEM_EMPRESA") {
    return res.status(503).json({
      error: "nfse_leitura_numeracao_indisponivel",
      codigo: err.code,
      message: err.message,
    });
  }
  log?.error?.({ err }, "Falha ao registrar emissão de NFS-e");
  return res.status(500).json({ error: "internal_error" });
}
