// Q52: inspeção de PFX no UPLOAD do certificado A1 da empresa.
// Abre o arquivo com a senha informada (senha errada → erro claro, em vez do
// silent-null do parsePfxExpiry legado) e extrai validade + CNPJ do subject,
// permitindo validar que o certificado pertence à empresa ANTES de salvar.
// Extração do CNPJ: mesma heurística do parsePfxDocument (SerproRuntimeSettings) —
// serialNumber/OID 2.5.4.5, depois CN (padrão ICP-Brasil "RAZAO SOCIAL:CNPJ"), depois OU.

import forge from "node-forge";

export class PfxInspectError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {Buffer} pfxBuffer conteúdo do arquivo .pfx/.p12
 * @param {string} password senha informada no upload
 * @returns {{ notAfter: Date|null, cnpj: string|null }}
 * @throws {PfxInspectError} code "CERT_SENHA_INVALIDA" quando o PFX não abre com a senha.
 */
export function inspectPfx(pfxBuffer, password) {
  if (!pfxBuffer || !Buffer.isBuffer(pfxBuffer) || pfxBuffer.length === 0) {
    throw new PfxInspectError("CERT_ARQUIVO_INVALIDO", "Arquivo de certificado vazio ou inválido.");
  }
  let p12;
  try {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString("binary"));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, String(password ?? ""));
  } catch {
    throw new PfxInspectError(
      "CERT_SENHA_INVALIDA",
      "Não foi possível abrir o certificado — verifique a senha do arquivo .pfx.",
    );
  }

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag]?.[0];
  const cert = certBag?.cert;
  if (!cert) {
    throw new PfxInspectError(
      "CERT_ARQUIVO_INVALIDO",
      "O arquivo não contém um certificado válido (PFX corrompido?).",
    );
  }

  const notAfter = cert.validity?.notAfter || null;

  const attributes = Array.isArray(cert.subject?.attributes) ? cert.subject.attributes : [];
  const candidates = [
    ...attributes
      .filter((item) => item?.name === "serialNumber" || item?.type === "2.5.4.5")
      .map((item) => item?.value),
    ...attributes
      .filter((item) => item?.name === "commonName" || item?.shortName === "CN")
      .map((item) => item?.value),
    ...attributes
      .filter((item) => item?.name === "organizationalUnitName" || item?.shortName === "OU")
      .map((item) => item?.value),
  ];
  let cnpj = null;
  for (const candidate of candidates) {
    const matches = String(candidate || "").match(/\d{14}/g);
    const raw = matches?.[matches.length - 1] || "";
    if (raw.length === 14) { cnpj = raw; break; }
  }

  return { notAfter, cnpj };
}

export function formatCnpj(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length !== 14) return String(digits || "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
