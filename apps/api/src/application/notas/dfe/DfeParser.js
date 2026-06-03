// Q12.B.3: parser do retorno NFeDistribuicaoDFe.
//
// Estrutura da resposta SOAP (envelope-body-nfeDistDFeInteresseResponse-nfeDistDFeInteresseResult-retDistDFeInt):
//   retDistDFeInt
//     ├── cStat       (status — 138 = "Documento(s) localizado(s)"; 137 = "Nenhum documento")
//     ├── xMotivo
//     ├── dhResp
//     ├── ultNSU      (último NSU disponível na consulta — não necessariamente o máximo geral)
//     ├── maxNSU      (máximo NSU absoluto na SEFAZ pra esse CNPJ)
//     └── loteDistDFeInt
//          └── docZip[]  ← cada um é base64 de um GZIP de um XML
//
// Tipos de docZip (atributo schema):
//   resNFe        → resumo (nota não baixada — só info)
//   procNFe       → XML completo da NF-e autorizada
//   resEvento     → resumo de evento
//   procEventoNFe → XML completo de evento (cancelamento, CC-e, manifestação)
//
// Importante:
//   - cStat 138 → tem 1+ docs; cStat 137 → sem nada novo (atualiza cursor mesmo assim)
//   - "papel" da empresa em relação à nota: EMIT (empresa emitiu) | DEST (empresa é destinatária)
//   - resNFe não tem itens detalhados (só info do cabeçalho)
//   - procNFe tem tudo, inclusive itens/det

import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true, // crítico pra ignorar prefixos como soap:/nfe:
});

/**
 * Extrai retDistDFeInt do envelope SOAP cru.
 * Retorna { cStat, xMotivo, dhResp, ultNSU, maxNSU, docs[] }
 * Onde docs[] são pares { schema, xml } já descomprimidos.
 */
export function parseDistDFeResponse(xmlEnvelope) {
  if (!xmlEnvelope || typeof xmlEnvelope !== "string") {
    throw new ParseError("EMPTY_RESPONSE", "Resposta vazia do NFeDistribuicaoDFe");
  }
  const parsed = xmlParser.parse(xmlEnvelope);
  const body = parsed?.Envelope?.Body;
  if (!body) throw new ParseError("INVALID_SOAP", "Envelope SOAP inválido (sem Body)");

  // Pode vir como SOAP Fault em caso de erro
  if (body.Fault) {
    const faultStr = body.Fault.faultstring || body.Fault.Reason?.Text || "soap_fault";
    throw new ParseError("SOAP_FAULT", `SOAP Fault: ${faultStr}`, { fault: body.Fault });
  }

  const result = body.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult;
  if (!result) throw new ParseError("NO_RESULT", "Resposta sem nfeDistDFeInteresseResult");

  const ret = result.retDistDFeInt;
  if (!ret) throw new ParseError("NO_RET_DIST", "Resposta sem retDistDFeInt");

  const cStat = String(ret.cStat || "");
  const xMotivo = String(ret.xMotivo || "");
  const dhResp = ret.dhResp || null;
  const ultNSU = BigInt(String(ret.ultNSU || "0"));
  const maxNSU = BigInt(String(ret.maxNSU || "0"));

  // Erros conhecidos antes de iterar docs
  // cStat 137 = nenhum doc novo; cStat 138 = tem docs; outros = erro
  // Lista completa em Anexo I do Manual NFe.
  const knownOk = cStat === "137" || cStat === "138";
  if (!knownOk) {
    return { cStat, xMotivo, dhResp, ultNSU, maxNSU, docs: [], error: true };
  }

  let docs = [];
  const lote = ret.loteDistDFeInt;
  if (lote && lote.docZip) {
    const items = Array.isArray(lote.docZip) ? lote.docZip : [lote.docZip];
    docs = items.map((item) => {
      const schema = item["@_schema"] || item.schema || "unknown";
      const b64 = typeof item === "string" ? item : item["#text"] || "";
      let xml = "";
      try {
        const raw = Buffer.from(b64, "base64");
        xml = gunzipSync(raw).toString("utf-8");
      } catch (err) {
        return { schema, xml: "", error: `gunzip_failed: ${err?.message}` };
      }
      return { schema, xml };
    });
  }

  return { cStat, xMotivo, dhResp, ultNSU, maxNSU, docs, error: false };
}

/**
 * Parser de um docZip individual — retorna um objeto normalizado pra persistência.
 * Retorna { type, chaveAcesso, papel, parsed: {...campos pra PortalInvoice + items} }
 *
 * Tipos retornados:
 *   "nfe_summary" → veio resNFe (sem XML completo)
 *   "nfe_full"    → veio procNFe (XML completo)
 *   "event"       → veio procEventoNFe ou resEvento
 *   "unknown"     → schema desconhecido — devolve pra log
 */
export function parseDocZip({ schema, xml, error }, { companyCnpj }) {
  if (error) return { type: "error", error };

  const cleanCompanyCnpj = String(companyCnpj || "").replace(/\D+/g, "");
  const lowerSchema = String(schema || "").toLowerCase();

  let doc;
  try {
    doc = xmlParser.parse(xml);
  } catch (err) {
    return { type: "error", error: `xml_parse_failed: ${err?.message}` };
  }

  // ─── resNFe (resumo) ──────────────────────────────────────────────────────
  // <resNFe>
  //   <chNFe>...</chNFe>      ← chave 44 dígitos
  //   <CNPJ>...</CNPJ>        ← emitente (pode ser PF=CPF)
  //   <xNome>...</xNome>      ← emitente
  //   <IE>...</IE>
  //   <dhEmi>...</dhEmi>
  //   <tpNF>0|1</tpNF>        ← 0=entrada, 1=saída (do EMITENTE)
  //   <vNF>...</vNF>          ← valor total
  //   <digVal>...</digVal>
  //   <dhRecbto>...</dhRecbto>
  //   <nSit>...</nSit>        ← situação
  //   <schema>resNFe_v...</schema>
  // </resNFe>
  if (lowerSchema.startsWith("resnfe") || doc.resNFe) {
    const r = doc.resNFe || doc;
    const chave = String(r.chNFe || "");
    const emitDoc = String(r.CNPJ || r.CPF || "");
    // EMIT se eu sou o emitente; DEST se sou o destinatário (mas resNFe não traz o destinatário)
    // resNFe vem quando sou DEST (a SEFAZ encaminha pra eu manifestar). Default DEST.
    const papel = cleanCompanyCnpj && emitDoc.replace(/\D+/g, "") === cleanCompanyCnpj ? "EMIT" : "DEST";
    const total = parseDecimal(r.vNF);
    const dhEmi = r.dhEmi || null;
    return {
      type: "nfe_summary",
      chaveAcesso: chave,
      papel,
      parsed: {
        chaveAcesso: chave,
        type: "NFE",
        numero: chave.slice(25, 34) || null,
        serie: chave.slice(22, 25) || null,
        emitenteDoc: emitDoc,
        emitenteNome: String(r.xNome || ""),
        // resNFe não traz destinatário (somos nós); deixar tomador*=null
        issueDate: dhEmi ? new Date(dhEmi) : null,
        competencia: dhEmi ? firstOfMonth(dhEmi) : null,
        total,
        status: mapSituation(r.nSit),
        statusEfetivo: "autorizada",
        papel,
        xmlRaw: null, // resNFe não é o XML completo da nota — não persistimos
      },
      items: [], // resumo não traz itens
    };
  }

  // ─── procNFe (XML completo) ───────────────────────────────────────────────
  // <procNFe versao="...">
  //   <NFe>
  //     <infNFe Id="NFe...">
  //       <ide><cUF/><nNF/><serie/><dhEmi/><tpNF/>...</ide>
  //       <emit><CNPJ/><xNome/>...</emit>
  //       <dest><CNPJ/><xNome/>...</dest>
  //       <det nItem="1"><prod><cProd/><NCM/><CFOP/><xProd/><vProd/></prod></det>...
  //       <total><ICMSTot><vNF/></ICMSTot></total>
  //     </infNFe>
  //   </NFe>
  //   <protNFe><infProt><chNFe/><cStat/><nProt/></infProt></protNFe>
  // </procNFe>
  if (lowerSchema.startsWith("procnfe") || doc.procNFe || doc.nfeProc) {
    const proc = doc.procNFe || doc.nfeProc || doc;
    const infNFe = proc.NFe?.infNFe;
    if (!infNFe) return { type: "error", error: "procNFe_sem_infNFe" };

    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const dets = infNFe.det ? (Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det]) : [];
    const protocolo = proc.protNFe?.infProt || {};

    const chave = String(protocolo.chNFe || infNFe["@_Id"]?.replace(/^NFe/, "") || "");
    const emitDoc = String(emit.CNPJ || emit.CPF || "");
    const destDoc = String(dest.CNPJ || dest.CPF || "");
    const emitCnpjOnly = emitDoc.replace(/\D+/g, "");
    const destCnpjOnly = destDoc.replace(/\D+/g, "");
    const papel = cleanCompanyCnpj && emitCnpjOnly === cleanCompanyCnpj ? "EMIT"
                : cleanCompanyCnpj && destCnpjOnly === cleanCompanyCnpj ? "DEST"
                : "DEST";

    const dhEmi = ide.dhEmi || null;
    const total = parseDecimal(infNFe.total?.ICMSTot?.vNF);

    const items = dets.map((d) => {
      const prod = d.prod || {};
      return {
        codigoServico: null,
        ncm: String(prod.NCM || ""),
        cfop: String(prod.CFOP || ""),
        descricao: String(prod.xProd || ""),
        valor: parseDecimal(prod.vProd) || 0,
        flagExportacao: String(prod.CFOP || "").startsWith("7"), // 7xxx = exportação
      };
    });

    return {
      type: "nfe_full",
      chaveAcesso: chave,
      papel,
      parsed: {
        chaveAcesso: chave,
        type: "NFE",
        numero: String(ide.nNF || ""),
        serie: String(ide.serie || ""),
        emitenteDoc: emitDoc,
        emitenteNome: String(emit.xNome || ""),
        tomadorDoc: destDoc,
        tomadorNome: String(dest.xNome || ""),
        issueDate: dhEmi ? new Date(dhEmi) : null,
        competencia: dhEmi ? firstOfMonth(dhEmi) : null,
        total,
        status: String(protocolo.cStat) === "100" ? "EMITIDA" : "PENDENTE",
        statusEfetivo: "autorizada",
        papel,
        xmlRaw: xml,
      },
      items,
    };
  }

  // ─── procEventoNFe / resEvento ────────────────────────────────────────────
  if (lowerSchema.startsWith("procevento") || doc.procEventoNFe || doc.resEvento) {
    const ev = doc.procEventoNFe?.evento?.infEvento
            || doc.resEvento
            || {};
    const tpEvento = String(ev.tpEvento || ev.tpEv || "");
    // tpEvento: 110111 = cancelamento, 110110 = CC-e, 210200/210210/210220/210240 = manifestação
    const action =
      tpEvento === "110111" ? "CANCELAMENTO" :
      tpEvento === "110110" ? "CCE" :
      tpEvento.startsWith("2102") ? "MANIFESTACAO" : "OUTRO";
    const chave = String(ev.chNFe || "");
    return {
      type: "event",
      chaveAcesso: chave,
      action,
      tpEvento,
      raw: xml,
    };
  }

  return { type: "unknown", schema, raw: xml.slice(0, 200) };
}

// ─── utils ─────────────────────────────────────────────────────────────────

function parseDecimal(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function firstOfMonth(isoStr) {
  try {
    const d = new Date(isoStr);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  } catch { return null; }
}

function mapSituation(nSit) {
  // resNFe.nSit: 0=autorizada, 1=cancelada, ...
  const n = Number(nSit);
  if (n === 1) return "CANCELADA";
  return "EMITIDA";
}

export class ParseError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}
