import { responderErroEmissao } from "./nfseEmissaoHttp.js";

export function responderErroConciliacao(res, err, { log } = {}) {
  if (["NFSE_CONCILIACAO_ESTADO_ALTERADO", "NFSE_CONCILIACAO_NAO_PERMITIDA"].includes(err?.code)) {
    return res.status(409).json({ error: err.code.toLowerCase(), codigo: err.code, message: err.message });
  }
  if (["NO_COMPANY_CERT", "CERT_CNPJ_MISMATCH", "CERT_PASSWORD_DECRYPT_FAILED", "CERT_STORAGE_UNAVAILABLE", "NFSE_CERT_PFX_ILEGIVEL"].includes(err?.code)) {
    return res.status(422).json({ error: "nfse_sem_certificado", codigo: err.code, message: err.message });
  }
  return responderErroEmissao(res, err, { log });
}
