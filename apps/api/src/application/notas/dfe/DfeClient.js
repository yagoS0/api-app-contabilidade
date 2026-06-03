// Q12.B.2: client SOAP do serviço NFeDistribuicaoDFe (SEFAZ/RFB).
//
// IMPORTANTE: este WS NÃO exige assinatura XML no envelope — só autenticação mTLS
// via certificado A1 (PFX). A SEFAZ identifica o autor pelo certificado.
//
// Endpoint nacional (não estadual — esse WS é centralizado):
//   PROD: https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
//   HOM:  https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
//
// Operações usadas:
//   distNSU      — busca incremental por NSU (cursor)
//   consNSU      — consulta um NSU específico (não usado nesta versão)
//   consChNFe    — consulta por chave de acesso (não usado nesta versão)
//
// Retorno: XML com 0..N loteDistDFeInt/docZip — cada docZip é base64 de um GZIP
// de um XML (resNFe, procNFe, resEvento ou procEventoNFe). Parseamento fica no DfeParser.

import https from "node:https";
import axios from "axios";

const ENDPOINTS = {
  prod: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  hom:  "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
};

const SOAP_ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const NS_DIST = "http://www.portalfiscal.inf.br/nfe";
const NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";

// Códigos cUF do IBGE — versão completa, usado pra preencher tag cUFAutor.
// Default RJ (33) se não conseguirmos detectar pelo CNPJ/empresa.
const CUF_BY_UF = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17,
};

function buildSoapEnvelope({ cnpj, ultNSU, tpAmb, cUF }) {
  const ultNSUStr = String(ultNSU).padStart(15, "0");
  // distDFeInt é o "interesse" — passamos só distNSU (cursor incremental).
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeDistDFeInteresse xmlns="${NS_WSDL}">
      <nfeDadosMsg>
        <distDFeInt xmlns="${NS_DIST}" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUF}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSUStr}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap:Body>
</soap:Envelope>`;
}

function buildHttpsAgent({ pfxBuffer, password }) {
  return new https.Agent({
    pfx: pfxBuffer,
    passphrase: password || undefined,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    keepAlive: true,
  });
}

export class DfeClientError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Envia uma chamada distNSU. Retorna SEMPRE o XML cru da resposta SOAP
 * (Parser decide o que fazer com cStat, dhResp, loteDistDFeInt etc).
 *
 * @param {Object} opts
 * @param {string} opts.cnpj       CNPJ da empresa (só dígitos, 14)
 * @param {number|bigint} opts.ultNSU  Cursor — 0 na 1ª vez, último NSU recebido depois
 * @param {Buffer} opts.pfxBuffer
 * @param {string} opts.password
 * @param {"prod"|"hom"} [opts.env="prod"]
 * @param {string} [opts.uf="RJ"]  UF do autor (cUFAutor); RJ default
 * @param {number} [opts.timeoutMs=20000]
 * @returns {Promise<{status: number, xml: string}>}
 */
export async function fetchDistNSU({ cnpj, ultNSU, pfxBuffer, password, env = "prod", uf = "RJ", timeoutMs = 20000 }) {
  const cleanCnpj = String(cnpj || "").replace(/\D+/g, "");
  if (cleanCnpj.length !== 14) {
    throw new DfeClientError("INVALID_CNPJ", `CNPJ inválido: ${cnpj}`);
  }
  if (!pfxBuffer || !Buffer.isBuffer(pfxBuffer)) {
    throw new DfeClientError("PFX_REQUIRED", "PFX (A1) é obrigatório pra acessar NFeDistribuicaoDFe");
  }
  const endpoint = ENDPOINTS[env];
  if (!endpoint) throw new DfeClientError("INVALID_ENV", `env deve ser "prod" ou "hom" (recebido: ${env})`);

  const cUF = CUF_BY_UF[String(uf).toUpperCase()] || 33;
  const tpAmb = env === "prod" ? 1 : 2;
  const envelope = buildSoapEnvelope({ cnpj: cleanCnpj, ultNSU, tpAmb, cUF });

  const agent = buildHttpsAgent({ pfxBuffer, password });

  try {
    const res = await axios.post(endpoint, envelope, {
      httpsAgent: agent,
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        "SOAPAction": `"${SOAP_ACTION}"`,
        "Accept": "application/soap+xml, text/xml, */*",
      },
      // Importante: SEFAZ pode retornar status 500 com SOAP Fault no body;
      // queremos sempre ler o body, não jogar exceção por status.
      validateStatus: () => true,
      // Resposta pode ser binária se vier comprimida — peço como buffer pra preservar.
      responseType: "text",
      transformResponse: [(data) => data],
      maxContentLength: 50 * 1024 * 1024,
    });

    return { status: res.status, xml: String(res.data || "") };
  } catch (err) {
    // erro de rede / TLS / timeout
    const code =
      err?.code === "ECONNABORTED" ? "TIMEOUT"
      : err?.code === "ECONNREFUSED" ? "CONNECTION_REFUSED"
      : err?.code === "CERT_HAS_EXPIRED" ? "CERT_EXPIRED"
      : "NETWORK_ERROR";
    throw new DfeClientError(code, `Falha de rede ao chamar NFeDistribuicaoDFe: ${err?.message || err}`, {
      cause: err, endpoint, cnpj: cleanCnpj,
    });
  }
}

// Exportado pra testes
export const _internal = { ENDPOINTS, CUF_BY_UF, buildSoapEnvelope };
