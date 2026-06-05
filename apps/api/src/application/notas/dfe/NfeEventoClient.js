// Q12.B+++.8.c: cliente SOAP nfeRecepcaoEvento (NF-e Eventos).
//
// Endpoint nacional (eventos vão pro AN, não por UF):
//   PROD: https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx
//   HOM:  https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx
//
// Aceita lote de até 20 eventos (NT 2012.002 §5.1). Cada evento JÁ deve estar
// assinado individualmente (XmlSigner). Não assinamos o envelope nem o envEvento.
//
// cStat principais:
//   128 = Lote processado com sucesso (sucesso parcial possível — olhar retEvento)
//   135 = Evento registrado e vinculado a NF-e (sucesso por evento)
//   573 = Duplicidade de evento (já foi enviado antes — tratar como OK)
//   656 = Consumo indevido (rate limit; aguardar 1h)
//   209/215 = Falha schema (problema na geração do XML)

import https from "node:https";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { extractTlsMaterialFromPfx } from "../pfxToTls.js";

const ENDPOINTS = {
  prod: "https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  hom:  "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
};
const SOAP_ACTION = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF";
const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,   // chave NF-e (44d), nSeqEvento, etc — sem conversão pra number
  trimValues: true,
  removeNSPrefix: true,
});

export class NfeEventoClientError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function buildHttpsAgent({ pfxBuffer, password }) {
  // Mesma estratégia do DfeClient (forge pra evitar OpenSSL 3 strict)
  const tls = extractTlsMaterialFromPfx(pfxBuffer, password);
  return new https.Agent({
    cert: tls.cert,
    key: tls.key,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    keepAlive: true,
  });
}

/**
 * Monta o envelope SOAP com 1 ou mais eventos.
 *
 * @param {string[]} eventosSignedXml — XMLs dos eventos JÁ assinados (cada um é <evento>...</evento>)
 * @param {string} idLote — qualquer string única (geralmente timestamp)
 * @param {"prod"|"hom"} env
 */
function buildSoapEnvelope({ eventosSignedXml, idLote, env }) {
  const tpAmb = env === "prod" ? 1 : 2;
  // Nota: SEFAZ aceita o envEvento contendo só <evento> (cada um traz seu envelope namespace).
  // Versão 1.00 do envEvento conforme PL_005c.
  const envEvento =
    `<envEvento xmlns="${NS_NFE}" versao="1.00">` +
    `<idLote>${idLote}</idLote>` +
    eventosSignedXml.join("") +
    `</envEvento>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeRecepcaoEventoNF xmlns="${NS_WSDL}">
      <nfeDadosMsg>${envEvento}</nfeDadosMsg>
    </nfeRecepcaoEventoNF>
  </soap:Body>
</soap:Envelope>`;
}

/**
 * Envia lote de eventos assinados à SEFAZ.
 *
 * @param {Object} opts
 * @param {string[]} opts.eventosSignedXml
 * @param {Buffer}   opts.pfxBuffer  cert empresa (mTLS)
 * @param {string}   opts.password
 * @param {"prod"|"hom"} [opts.env="prod"]
 * @returns {Promise<{cStat, xMotivo, retEventos: Array<{chNFe, cStat, xMotivo, nProt, tpEvento, nSeqEvento}>}>}
 */
export async function sendEventos({ eventosSignedXml, pfxBuffer, password, env = "prod", timeoutMs = 30000 }) {
  if (!Array.isArray(eventosSignedXml) || eventosSignedXml.length === 0) {
    throw new NfeEventoClientError("EMPTY_BATCH", "Lote vazio");
  }
  if (eventosSignedXml.length > 20) {
    throw new NfeEventoClientError("BATCH_TOO_LARGE", "Lote máximo 20 eventos (NT 2012.002 §5.1)");
  }

  const endpoint = ENDPOINTS[env];
  const idLote = String(Date.now());
  const envelope = buildSoapEnvelope({ eventosSignedXml, idLote, env });
  const agent = buildHttpsAgent({ pfxBuffer, password });

  let res;
  try {
    res = await axios.post(endpoint, envelope, {
      httpsAgent: agent,
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        "SOAPAction": `"${SOAP_ACTION}"`,
        "Accept": "application/soap+xml, text/xml, */*",
      },
      validateStatus: () => true,
      responseType: "text",
      transformResponse: [(d) => d],
      maxContentLength: 50 * 1024 * 1024,
    });
  } catch (err) {
    const code =
      err?.code === "ECONNABORTED" ? "TIMEOUT" :
      err?.code === "ECONNREFUSED" ? "CONNECTION_REFUSED" :
      "NETWORK_ERROR";
    throw new NfeEventoClientError(code, `Falha de rede: ${err?.message}`, { cause: err });
  }

  if (res.status >= 500 && !res.data) {
    throw new NfeEventoClientError(`HTTP_${res.status}`, `SEFAZ ${res.status}`, { status: res.status });
  }

  return parseRetEnvEventos(res.data, { httpStatus: res.status });
}

function parseRetEnvEventos(soapXml, { httpStatus }) {
  if (!soapXml) throw new NfeEventoClientError("EMPTY_RESPONSE", "Resposta vazia");
  let parsed;
  try { parsed = parser.parse(soapXml); }
  catch (err) {
    throw new NfeEventoClientError("PARSE_FAILED", `Parser XML falhou: ${err?.message}`,
      { bodyPreview: String(soapXml).slice(0, 300) });
  }

  const body = parsed?.Envelope?.Body;
  if (!body) throw new NfeEventoClientError("INVALID_SOAP", "SOAP sem Body");
  if (body.Fault) {
    const faultStr = body.Fault.faultstring || body.Fault.Reason?.Text || "soap_fault";
    throw new NfeEventoClientError("SOAP_FAULT", `SOAP Fault: ${faultStr}`, { fault: body.Fault });
  }

  const ret = body.nfeRecepcaoEventoNFResponse?.nfeResultMsg?.retEnvEvento
            || body.nfeRecepcaoEventoResponse?.nfeResultMsg?.retEnvEvento
            || body.retEnvEvento;
  if (!ret) {
    throw new NfeEventoClientError("NO_RET_ENV_EVENTO", "Resposta sem retEnvEvento",
      { httpStatus, bodyPreview: String(soapXml).slice(0, 500) });
  }

  const cStat = String(ret.cStat || "");
  const xMotivo = String(ret.xMotivo || "");

  let retEventos = [];
  if (ret.retEvento) {
    const items = Array.isArray(ret.retEvento) ? ret.retEvento : [ret.retEvento];
    retEventos = items.map((re) => {
      const inf = re.infEvento || re;
      return {
        chNFe: String(inf.chNFe || ""),
        cStat: String(inf.cStat || ""),
        xMotivo: String(inf.xMotivo || ""),
        nProt: inf.nProt ? String(inf.nProt) : null,
        tpEvento: String(inf.tpEvento || ""),
        nSeqEvento: Number(inf.nSeqEvento) || 1,
        dhRegEvento: inf.dhRegEvento || null,
      };
    });
  }

  return { cStat, xMotivo, retEventos, raw: ret };
}

export const _internal = { ENDPOINTS, buildSoapEnvelope };
