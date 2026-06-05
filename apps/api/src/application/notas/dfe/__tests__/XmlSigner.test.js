// Q12.B+++.8.b: testes do XmlSigner.
// Gera cert + chave self-signed em memória pra não precisar de PFX real.

import forge from "node-forge";
import { signEvento, XmlSignerError } from "../XmlSigner.js";

function buildTestPfx() {
  // Gera RSA 2048 e cert self-signed
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);
  const attrs = [{ name: "commonName", value: "TEST" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Empacota em PKCS#12 com senha
  const password = "test123";
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: "3des",
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const pfxBuffer = Buffer.from(p12Der, "binary");
  return { pfxBuffer, password, cert, keys };
}

describe("XmlSigner.signEvento", () => {
  let pfx;
  beforeAll(() => { pfx = buildTestPfx(); });

  function buildSampleEvento(referenceId) {
    return (
      `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
      `<infEvento Id="${referenceId}">` +
      `<cOrgao>91</cOrgao><tpAmb>1</tpAmb>` +
      `<CNPJ>12345678000195</CNPJ>` +
      `<chNFe>33260612345678000195550010000123451234567890</chNFe>` +
      `<dhEvento>2026-06-04T10:00:00-03:00</dhEvento>` +
      `<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>` +
      `</infEvento></evento>`
    );
  }

  it("injeta Signature dentro do <evento> após </infEvento>", () => {
    const referenceId = "ID21021033260612345678000195550010000123451234567890" + "01";
    const eventoXml = buildSampleEvento(referenceId);
    const signed = signEvento({
      eventoXml, referenceId, pfxBuffer: pfx.pfxBuffer, password: pfx.password,
    });

    expect(signed).toMatch(/<\/infEvento><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
    expect(signed).toMatch(/<SignedInfo /);
    expect(signed).toMatch(/<DigestValue>[A-Za-z0-9+/=]+<\/DigestValue>/);
    expect(signed).toMatch(/<SignatureValue>[A-Za-z0-9+/=]+<\/SignatureValue>/);
    expect(signed).toMatch(/<X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate>/);
    // Reference URI bate com Id
    expect(signed).toContain(`<Reference URI="#${referenceId}">`);
    // Algoritmos exigidos pela SEFAZ
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(signed).toContain('Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"');
  });

  it("throw quando eventoXml não tem <infEvento>", () => {
    expect(() => signEvento({
      eventoXml: "<foo/>", referenceId: "ID", pfxBuffer: pfx.pfxBuffer, password: pfx.password,
    })).toThrow(XmlSignerError);
  });

  it("throw quando faltam parâmetros", () => {
    expect(() => signEvento({ eventoXml: "", referenceId: "ID" }))
      .toThrow(/eventoXml e referenceId/);
  });

  it("DigestValue muda quando infEvento muda (sanity check do digest)", () => {
    const id = "ID01";
    const xml1 = `<evento><infEvento Id="${id}"><a>1</a></infEvento></evento>`;
    const xml2 = `<evento><infEvento Id="${id}"><a>2</a></infEvento></evento>`;
    const s1 = signEvento({ eventoXml: xml1, referenceId: id, pfxBuffer: pfx.pfxBuffer, password: pfx.password });
    const s2 = signEvento({ eventoXml: xml2, referenceId: id, pfxBuffer: pfx.pfxBuffer, password: pfx.password });
    const dig1 = s1.match(/<DigestValue>([^<]+)<\/DigestValue>/)[1];
    const dig2 = s2.match(/<DigestValue>([^<]+)<\/DigestValue>/)[1];
    expect(dig1).not.toBe(dig2);
  });

  it("SignatureValue é base64 válido", () => {
    const referenceId = "ID01";
    const xml = `<evento><infEvento Id="${referenceId}"><cOrgao>91</cOrgao></infEvento></evento>`;
    const signed = signEvento({ eventoXml: xml, referenceId, pfxBuffer: pfx.pfxBuffer, password: pfx.password });
    const sigValue = signed.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)[1];
    // base64 RSA-SHA1 com chave 2048: 256 bytes = 344 chars base64
    expect(sigValue.length).toBeGreaterThan(340);
    expect(sigValue.length).toBeLessThan(350);
    expect(sigValue).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
