// Q12.B fix: extrai cert + privateKey de um PFX via node-forge.
// Resolve ERR_CRYPTO_UNSUPPORTED_OPERATION em Node 22 + OpenSSL 3 com
// PFX brasileiros (que usam 3DES/SHA1). Em vez de passar `{ pfx, passphrase }`
// no https.Agent (que falha no OpenSSL 3 strict), passamos `{ cert, key }`
// já extraídos via JS puro pelo node-forge.
//
// Mesma estratégia do SerproAuthService.

import forge from "node-forge";

export class PfxExtractError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Recebe buffer PFX + senha. Retorna { cert: <PEM>, key: <PEM> } pronto pra
 * passar como `cert` e `key` em new https.Agent({...}).
 */
export function extractTlsMaterialFromPfx(pfxBuffer, password) {
  if (!pfxBuffer || !Buffer.isBuffer(pfxBuffer) || pfxBuffer.length === 0) {
    throw new PfxExtractError("PFX_REQUIRED", "PFX buffer obrigatório");
  }
  let p12Asn1;
  let p12;
  try {
    p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString("binary"));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || "");
  } catch (err) {
    throw new PfxExtractError("PFX_PARSE_FAILED",
      `Falha ao ler PFX (senha incorreta?): ${err?.message || err}`);
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag] || [];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })?.[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })?.[forge.pki.oids.keyBag]?.[0];

  if (!certBags.length || !keyBag?.key) {
    throw new PfxExtractError("PFX_NO_CERT_OR_KEY",
      "PFX não contém cert ou chave privada (PFX corrompido ou senha errada).");
  }

  return {
    cert: certBags.map((bag) => forge.pki.certificateToPem(bag.cert)).join("\n"),
    key: forge.pki.privateKeyToPem(keyBag.key),
  };
}
