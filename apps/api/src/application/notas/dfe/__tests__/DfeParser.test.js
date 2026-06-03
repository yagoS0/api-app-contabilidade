// Q12.B.6: testes do DfeParser com payloads SOAP montados em memória.
// Gera docZip dinamicamente (gzip + base64) pra simular o que a SEFAZ entrega.

import { gzipSync } from "node:zlib";
import { parseDistDFeResponse, parseDocZip, ParseError } from "../DfeParser.js";

function makeDocZip(schema, xml) {
  const b64 = gzipSync(Buffer.from(xml, "utf-8")).toString("base64");
  return `<docZip schema="${schema}">${b64}</docZip>`;
}

function wrapEnvelope({ cStat, xMotivo = "ok", ultNSU = "5", maxNSU = "10", docs = [] }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDistDFeInteresseResult>
        <retDistDFeInt versao="1.01" xmlns="http://www.portalfiscal.inf.br/nfe">
          <tpAmb>1</tpAmb>
          <verAplic>X</verAplic>
          <cStat>${cStat}</cStat>
          <xMotivo>${xMotivo}</xMotivo>
          <dhResp>2026-06-03T14:00:00-03:00</dhResp>
          <ultNSU>${ultNSU}</ultNSU>
          <maxNSU>${maxNSU}</maxNSU>
          ${docs.length > 0 ? `<loteDistDFeInt>${docs.join("")}</loteDistDFeInt>` : ""}
        </retDistDFeInt>
      </nfeDistDFeInteresseResult>
    </nfeDistDFeInteresseResponse>
  </soap:Body>
</soap:Envelope>`;
}

const RES_NFE_XML = `<?xml version="1.0"?>
<resNFe versao="1.01" xmlns="http://www.portalfiscal.inf.br/nfe">
  <chNFe>33260612345678000195550010000123451234567890</chNFe>
  <CNPJ>12345678000195</CNPJ>
  <xNome>Fornecedor X LTDA</xNome>
  <IE>123456789</IE>
  <dhEmi>2026-06-15T10:30:00-03:00</dhEmi>
  <tpNF>1</tpNF>
  <vNF>1500.00</vNF>
  <digVal>abc</digVal>
  <dhRecbto>2026-06-15T10:31:00-03:00</dhRecbto>
  <nSit>0</nSit>
  <schema>resNFe_v1.01.xsd</schema>
</resNFe>`;

function buildProcNFeXml({ chave, emitCnpj, destCnpj, vNF, nNF, det }) {
  return `<?xml version="1.0"?>
<procNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide>
        <cUF>33</cUF>
        <nNF>${nNF}</nNF>
        <serie>1</serie>
        <dhEmi>2026-06-20T15:00:00-03:00</dhEmi>
        <tpNF>1</tpNF>
      </ide>
      <emit>
        <CNPJ>${emitCnpj}</CNPJ>
        <xNome>EMP EMITENTE</xNome>
      </emit>
      <dest>
        <CNPJ>${destCnpj}</CNPJ>
        <xNome>EMP DESTINATARIA</xNome>
      </dest>
      ${det}
      <total><ICMSTot><vNF>${vNF}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe>
    <infProt>
      <chNFe>${chave}</chNFe>
      <cStat>100</cStat>
      <nProt>135260000001234</nProt>
    </infProt>
  </protNFe>
</procNFe>`;
}

const EVENTO_CANCEL_XML = `<?xml version="1.0"?>
<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <evento>
    <infEvento Id="ID110111...">
      <chNFe>33260612345678000195550010000123451234567890</chNFe>
      <tpEvento>110111</tpEvento>
      <xEvento>Cancelamento</xEvento>
    </infEvento>
  </evento>
</procEventoNFe>`;

describe("parseDistDFeResponse", () => {
  it("throw em envelope vazio", () => {
    expect(() => parseDistDFeResponse("")).toThrow(ParseError);
  });

  it("parseia cStat=137 (nada novo) sem docs", () => {
    const xml = wrapEnvelope({ cStat: "137", xMotivo: "Nenhum documento" });
    const r = parseDistDFeResponse(xml);
    expect(r.cStat).toBe("137");
    expect(r.docs).toEqual([]);
    expect(r.error).toBe(false);
    expect(typeof r.ultNSU).toBe("bigint");
  });

  it("parseia cStat=138 com 1 resNFe", () => {
    const xml = wrapEnvelope({
      cStat: "138", xMotivo: "Documento(s) localizado(s)",
      docs: [makeDocZip("resNFe_v1.01.xsd", RES_NFE_XML)],
    });
    const r = parseDistDFeResponse(xml);
    expect(r.cStat).toBe("138");
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0].schema).toContain("resNFe");
    expect(r.docs[0].xml).toContain("chNFe");
  });

  it("marca error=true em cStat desconhecido", () => {
    const xml = wrapEnvelope({ cStat: "999", xMotivo: "erro estranho" });
    const r = parseDistDFeResponse(xml);
    expect(r.error).toBe(true);
    expect(r.cStat).toBe("999");
  });

  it("retorna BigInt em ultNSU/maxNSU", () => {
    const xml = wrapEnvelope({ cStat: "137", ultNSU: "999999999", maxNSU: "9999999999999" });
    const r = parseDistDFeResponse(xml);
    expect(r.ultNSU).toBe(999999999n);
    expect(r.maxNSU).toBe(9999999999999n);
  });
});

describe("parseDocZip — resNFe (resumo)", () => {
  it("identifica empresa como DEST quando emitente é outro CNPJ", () => {
    const r = parseDocZip({ schema: "resNFe_v1.01.xsd", xml: RES_NFE_XML },
      { companyCnpj: "98765432000111" });
    expect(r.type).toBe("nfe_summary");
    expect(r.papel).toBe("DEST");
    expect(r.chaveAcesso).toBe("33260612345678000195550010000123451234567890");
    expect(r.parsed.emitenteDoc).toBe("12345678000195");
    expect(r.parsed.emitenteNome).toBe("Fornecedor X LTDA");
    expect(r.parsed.total).toBe(1500);
    expect(r.parsed.competencia).toEqual(new Date(Date.UTC(2026, 5, 1)));
    expect(r.parsed.statusEfetivo).toBe("autorizada");
    expect(r.items).toEqual([]);
  });

  it("identifica empresa como EMIT quando CNPJ bate", () => {
    const r = parseDocZip({ schema: "resNFe_v1.01.xsd", xml: RES_NFE_XML },
      { companyCnpj: "12345678000195" });
    expect(r.papel).toBe("EMIT");
  });
});

describe("parseDocZip — procNFe (XML completo)", () => {
  const chave = "33260612345678000195550010000999991234567890";
  const det = `
    <det nItem="1">
      <prod><cProd>P1</cProd><xProd>Produto 1</xProd><NCM>22021000</NCM><CFOP>5102</CFOP><vProd>800.00</vProd></prod>
    </det>
    <det nItem="2">
      <prod><cProd>P2</cProd><xProd>Produto Export</xProd><NCM>30049079</NCM><CFOP>7102</CFOP><vProd>200.00</vProd></prod>
    </det>`;
  const xml = buildProcNFeXml({
    chave, emitCnpj: "12345678000195", destCnpj: "98765432000111",
    vNF: "1000.00", nNF: "99999", det,
  });

  it("extrai cabeçalho + itens + status EMITIDA", () => {
    const r = parseDocZip({ schema: "procNFe_v4.00.xsd", xml }, { companyCnpj: "12345678000195" });
    expect(r.type).toBe("nfe_full");
    expect(r.papel).toBe("EMIT");
    expect(r.chaveAcesso).toBe(chave);
    expect(r.parsed.emitenteNome).toBe("EMP EMITENTE");
    expect(r.parsed.tomadorNome).toBe("EMP DESTINATARIA");
    expect(r.parsed.numero).toBe("99999");
    expect(r.parsed.serie).toBe("1");
    expect(r.parsed.total).toBe(1000);
    expect(r.parsed.status).toBe("EMITIDA");
    expect(r.parsed.xmlRaw).toContain("procNFe");
    expect(r.items).toHaveLength(2);
    expect(r.items[0].ncm).toBe("22021000");
    expect(r.items[0].cfop).toBe("5102");
    expect(r.items[0].flagExportacao).toBe(false);
    expect(r.items[1].flagExportacao).toBe(true); // CFOP 7102 → export
    expect(r.items[1].valor).toBe(200);
  });

  it("identifica papel DEST quando empresa é o destinatário", () => {
    const r = parseDocZip({ schema: "procNFe_v4.00.xsd", xml }, { companyCnpj: "98765432000111" });
    expect(r.papel).toBe("DEST");
  });

  it("DEST default quando empresa não bate nem com EMIT nem com DEST", () => {
    const r = parseDocZip({ schema: "procNFe_v4.00.xsd", xml }, { companyCnpj: "00000000000000" });
    expect(r.papel).toBe("DEST");
  });
});

describe("parseDocZip — eventos", () => {
  it("identifica cancelamento (tpEvento 110111)", () => {
    const r = parseDocZip({ schema: "procEventoNFe_v1.00.xsd", xml: EVENTO_CANCEL_XML },
      { companyCnpj: "12345678000195" });
    expect(r.type).toBe("event");
    expect(r.action).toBe("CANCELAMENTO");
    expect(r.tpEvento).toBe("110111");
    expect(r.chaveAcesso).toBe("33260612345678000195550010000123451234567890");
  });
});

describe("parseDocZip — robustez", () => {
  it("retorna error quando docZip já vem com error (gunzip falhou)", () => {
    const r = parseDocZip({ schema: "resNFe", xml: "", error: "gunzip_failed" },
      { companyCnpj: "12345678000195" });
    expect(r.type).toBe("error");
    expect(r.error).toBe("gunzip_failed");
  });

  it("retorna type=unknown pra schema não tratado", () => {
    const r = parseDocZip({ schema: "outroNamespace_v1.xsd", xml: "<foo/>" },
      { companyCnpj: "12345678000195" });
    expect(r.type).toBe("unknown");
  });
});
