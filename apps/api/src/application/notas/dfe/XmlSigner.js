// Q12.B+++.8.b: XMLDSIG enveloped signature pra eventos SEFAZ NF-e.
//
// A SEFAZ exige assinatura XMLDSIG no `infEvento` antes de mandar pra
// nfeRecepcaoEvento. Algoritmos REQUIRED:
//   - C14N exclusive (sem comments)         http://www.w3.org/2001/10/xml-exc-c14n#
//   - SHA1                                  http://www.w3.org/2000/09/xmldsig#sha1
//   - RSA-SHA1                              http://www.w3.org/2000/09/xmldsig#rsa-sha1
//
// Estrutura final:
//   <evento>
//     <infEvento Id="ID...">...</infEvento>
//     <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
//       <SignedInfo>...<Reference URI="#ID..."><Transforms.../>
//         <DigestMethod/><DigestValue>{base64 sha1 do infEvento canonicalizado}</DigestValue>
//       </Reference></SignedInfo>
//       <SignatureValue>{base64 RSA-SHA1 do SignedInfo canonicalizado}</SignatureValue>
//       <KeyInfo><X509Data><X509Certificate>{cert base64}</X509Certificate></X509Data></KeyInfo>
//     </Signature>
//   </evento>
//
// Notas de implementação:
// - Implementação manual via node-forge porque libs prontas (xml-crypto)
//   tem dependências pesadas (xpath, xml2js) e quirks com namespaces SEFAZ.
// - C14N exclusive simplificada: o `infEvento` da SEFAZ é canônico já
//   (sem namespaces externos, sem prefixos). Não precisamos de XPath.

import forge from "node-forge";
import { extractTlsMaterialFromPfx } from "../pfxToTls.js";

const NS_XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
const ALG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const ALG_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ALG_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

export class XmlSignerError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Extrai PEM (cert + privateKey) + objeto forge.pki da chave do PFX da empresa.
 * Reusa extractTlsMaterialFromPfx + faz parse adicional pra ter a key como objeto.
 */
function loadSigningMaterial(pfxBuffer, password) {
  const { cert, key } = extractTlsMaterialFromPfx(pfxBuffer, password);
  // O extractTlsMaterialFromPfx devolve cert+key em PEM. Pra assinar precisamos
  // do objeto forge da privateKey. Re-parse a key PEM.
  let privateKey;
  try {
    privateKey = forge.pki.privateKeyFromPem(key);
  } catch (err) {
    throw new XmlSignerError("KEY_PARSE_FAILED", `Falha ao parsear privateKey: ${err?.message}`);
  }
  // Cert em base64 sem header/footer pra ir no X509Certificate
  const certBase64 = cert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return { privateKey, certBase64, certPem: cert };
}

/**
 * SHA1 → base64. Usado pro DigestValue do <Reference>.
 */
function sha1Base64(data) {
  const md = forge.md.sha1.create();
  md.update(data, "utf8");
  return forge.util.encode64(md.digest().bytes());
}

/**
 * Assina conteúdo com RSA-SHA1 + base64. Usado pro <SignatureValue>.
 */
function rsaSha1SignBase64(privateKey, data) {
  const md = forge.md.sha1.create();
  md.update(data, "utf8");
  const signatureBytes = privateKey.sign(md);
  return forge.util.encode64(signatureBytes);
}

/**
 * Assina um XML de evento NF-e (formato `<evento>...<infEvento Id="...">...</infEvento></evento>`)
 * Retorna o XML com `<Signature>` injetado dentro do `<evento>`, após `<infEvento>`.
 *
 * @param {Object} opts
 * @param {string} opts.eventoXml  XML do <evento> SEM signature
 * @param {string} opts.referenceId  Valor exato do atributo Id do <infEvento> (sem #)
 * @param {Buffer} opts.pfxBuffer
 * @param {string} opts.password
 * @returns {string} XML assinado
 */
export function signEvento({ eventoXml, referenceId, pfxBuffer, password }) {
  if (!eventoXml || !referenceId) {
    throw new XmlSignerError("MISSING_INPUT", "eventoXml e referenceId são obrigatórios");
  }

  const { privateKey, certBase64 } = loadSigningMaterial(pfxBuffer, password);

  // 1) Canonicaliza o <infEvento> e calcula DigestValue (SHA1).
  //    SEFAZ aceita a string do infEvento "como está" no XML que produzimos —
  //    geramos sem espaços/quebras extras pra evitar diferenças de C14N.
  const infEventoMatch = eventoXml.match(/<infEvento[\s\S]*?<\/infEvento>/);
  if (!infEventoMatch) {
    throw new XmlSignerError("NO_INF_EVENTO", "eventoXml não contém <infEvento>");
  }
  const infEventoXml = infEventoMatch[0];
  const digestValue = sha1Base64(infEventoXml);

  // 2) Monta SignedInfo (sem espaços extras, formato canônico SEFAZ).
  const signedInfo =
    `<SignedInfo xmlns="${NS_XMLDSIG}">` +
    `<CanonicalizationMethod Algorithm="${ALG_C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${ALG_RSA_SHA1}"></SignatureMethod>` +
    `<Reference URI="#${referenceId}">` +
    `<Transforms>` +
    `<Transform Algorithm="${ALG_ENVELOPED}"></Transform>` +
    `<Transform Algorithm="${ALG_C14N}"></Transform>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="${ALG_SHA1}"></DigestMethod>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;

  // 3) Assina SignedInfo (RSA-SHA1 → base64).
  const signatureValue = rsaSha1SignBase64(privateKey, signedInfo);

  // 4) Monta bloco <Signature> completo.
  const signature =
    `<Signature xmlns="${NS_XMLDSIG}">` +
    signedInfo +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo>` +
    `<X509Data>` +
    `<X509Certificate>${certBase64}</X509Certificate>` +
    `</X509Data>` +
    `</KeyInfo>` +
    `</Signature>`;

  // 5) Injeta a Signature DENTRO do <evento>, logo após o </infEvento>.
  return eventoXml.replace(/<\/infEvento>/, `</infEvento>${signature}`);
}
