// SOMENTE LEITURA. "Dá para gerar o DANFSe no instante da emissão, sem esperar o ADN?"
//
// A resposta depende de UMA coisa: o que `ServiceInvoice.xml` guarda de verdade.
// `NfseService.js:1775` grava `response.nfseXmlGZipB64 || rawXml || null` — ou seja, ou o XML da
// NFS-e AUTORIZADA (gzip+base64, que serve), ou, no fallback, o DPS que NÓS assinamos e enviamos
// (plano, que NÃO serve: não tem nNFSe, não tem chave, não tem infNFSe).
//
// Nada aqui escreve e nada aqui chama o sistema nacional.

import { PrismaClient } from "@prisma/client";
import { gunzipSync } from "node:zlib";

const prisma = new PrismaClient();
const ABRE = String.fromCharCode(60); // "<" — evita o redirecionamento do shell ao colar comandos
const RAIZ = new RegExp(`${ABRE}\\s*(?:[A-Za-z_][\\w.-]*:)?([A-Za-z_][\\w.-]*)`);

/** Lê o envelope do jeito que os quatro caminhos de captura já leem: gzip+b64, b64 puro, ou plano. */
function lerXml(valor) {
  const t = String(valor || "").trim();
  if (!t) return { forma: "AUSENTE", xml: "" };
  if (t.startsWith(ABRE)) return { forma: "PLANO", xml: t };
  let bruto;
  try {
    bruto = Buffer.from(t, "base64");
  } catch {
    return { forma: "ILEGIVEL", xml: "" };
  }
  try {
    return { forma: "GZIP_B64", xml: gunzipSync(bruto).toString("utf-8") };
  } catch {
    const texto = bruto.toString("utf-8").trim();
    return texto.startsWith(ABRE)
      ? { forma: "B64", xml: texto }
      : { forma: "ILEGIVEL", xml: "" };
  }
}

const raizDe = (xml) => (xml.match(RAIZ) || [])[1] || "?";
const tem = (xml, tag) => new RegExp(`${ABRE}\\s*(?:\\w+:)?${tag}[\\s>/]`).test(xml);

const notas = await prisma.serviceInvoice.findMany({
  select: {
    id: true, status: true, numeroNfse: true, chaveAcesso: true, idDps: true,
    rpsSerie: true, rpsNumero: true, xml: true, createdAt: true, companyId: true,
  },
  orderBy: { createdAt: "desc" },
});

console.log(`\n${"=".repeat(100)}`);
console.log(`ServiceInvoice na base: ${notas.length}`);

const porStatus = new Map();
for (const n of notas) porStatus.set(n.status, (porStatus.get(n.status) || 0) + 1);
console.log("por status: " + [...porStatus.entries()].map(([k, v]) => `${k}=${v}`).join("  "));

console.log(`\n${"-".repeat(100)}`);
console.log("status     chave  nNFSe   forma do xml   raiz            infNFSe?  serve p/ DANFSe?");
console.log("-".repeat(100));

let servem = 0, naoServem = 0;
const motivos = new Map();

for (const n of notas) {
  const { forma, xml } = lerXml(n.xml);
  const raiz = xml ? raizDe(xml) : "-";
  // O DANFSe precisa do documento da NFS-e: `infNFSe` é onde moram nNFSe, chave e a data de
  // processamento. O DPS assinado NÃO os tem — ele é o pedido, não o documento.
  const temInfNfse = xml ? tem(xml, "infNFSe") : false;
  const serve = Boolean(temInfNfse && n.chaveAcesso);

  if (n.status === "issued") {
    if (serve) servem++;
    else {
      naoServem++;
      const motivo = !xml ? "sem xml" : !temInfNfse ? `xml é ${raiz} (o DPS, não a NFS-e)` : "sem chave";
      motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
    }
  }

  console.log(
    `  ${String(n.status).padEnd(10)} ${(n.chaveAcesso ? "sim" : "NAO").padEnd(6)} ` +
    `${String(n.numeroNfse || "-").padEnd(7)} ${forma.padEnd(14)} ${raiz.padEnd(15)} ` +
    `${(temInfNfse ? "sim" : "NAO").padEnd(9)} ${serve ? "SIM" : "nao"}`
  );
}

console.log("-".repeat(100));
console.log(`\nDas emitidas ("issued"): ${servem} servem para gerar o DANFSe na hora; ${naoServem} não.`);
for (const [m, n] of motivos) console.log(`   · ${n}× ${m}`);

// ⚠ O outro lado: a nota que o ADN JÁ confirmou tem o XML em `PortalInvoice.xmlRaw` e o DANFSe já
// funciona por ela. O que se mede aqui é só a janela entre emitir e a captura.
const comXmlRaw = await prisma.portalInvoice.count({ where: { papel: "EMIT", xmlRaw: { not: null } } });
const emit = await prisma.portalInvoice.count({ where: { papel: "EMIT" } });
console.log(`\nPara comparar — PortalInvoice EMIT: ${emit}, com xmlRaw: ${comXmlRaw} (o caminho que já funciona).`);
console.log(`${"=".repeat(100)}\n`);

await prisma.$disconnect();
