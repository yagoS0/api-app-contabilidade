// SOMENTE LEITURA. "Quais campos do prestador/tomador o XML da NFS-e REALMENTE traz?"
//
// O dono apontou que o DANFSe do portal oficial mostra endereço E E-MAIL do prestador. O art. 13
// da Res. CGNFS-e nº 3 só proíbe imprimir o que NÃO consta do arquivo — então a pergunta certa é
// factual: está no XML ou não está?
//
// ⚠ NÃO IMPRIME VALOR NENHUM — só o caminho da tag e em quantas notas ela vem PREENCHIDA.
// São notas fiscais reais, com CNPJ, endereço, telefone e e-mail de prestador E de tomador.
//
// Varre as DUAS fontes: `PortalInvoice.xmlRaw` (as capturadas do ADN — onde está a nota do portal
// que o dono citou) e `ServiceInvoice.xml` (as que NÓS emitimos).

import { PrismaClient } from "@prisma/client";
import { lerEnvelopeXml } from "../src/application/nfse/lerEnvelopeXml.js";

const prisma = new PrismaClient();
const ABRE = String.fromCharCode(60);
const AMOSTRA = Number(process.argv[2] || 400);

/** Caminhos das folhas, com "tem conteúdo?" — sem o conteúdo. */
function caminhosPreenchidos(xml) {
  const achados = new Set();
  const pilha = [];
  const re = new RegExp(`${ABRE}(\\/?)([A-Za-z_][\\w.:-]*)([^>]*?)(\\/?)>([^${ABRE}]*)`, "g");
  let m;
  while ((m = re.exec(xml))) {
    const [, fecha, tagBruta, , autoFecha, texto] = m;
    const tag = tagBruta.includes(":") ? tagBruta.split(":").pop() : tagBruta;
    if (fecha) { pilha.pop(); continue; }
    if (autoFecha) continue;
    pilha.push(tag);
    if (String(texto || "").trim()) achados.add(pilha.join("/"));
  }
  return achados;
}

// Os grupos que o DANFSe imprime — é sobre eles que a pergunta é feita.
const INTERESSA = /\/(emit|prest|toma|interm)(\/|$)/;

async function varrer(rotulo, linhas, leitorDoXml) {
  const contagem = new Map();
  let lidas = 0, ilegiveis = 0;

  for (const linha of linhas) {
    const { xml } = lerEnvelopeXml(leitorDoXml(linha));
    if (!xml) { ilegiveis++; continue; }
    lidas++;
    for (const caminho of caminhosPreenchidos(xml)) {
      if (!INTERESSA.test(caminho)) continue;
      // normaliza o prefixo: `NFSe/infNFSe/DPS/infDPS/prest/...` -> `prest/...`
      const curto = caminho.replace(/^.*?\/((?:emit|prest|toma|interm)(?:\/|$).*)$/, "$1");
      contagem.set(curto, (contagem.get(curto) || 0) + 1);
    }
  }

  console.log(`\n${"=".repeat(84)}`);
  console.log(`${rotulo} — ${lidas} XML lido(s), ${ilegiveis} ilegível(is)`);
  console.log("=".repeat(84));
  console.log("  preenchida em     caminho");
  for (const [caminho, n] of [...contagem.entries()].sort()) {
    const pct = lidas ? ((n / lidas) * 100).toFixed(1) : "0.0";
    console.log(`  ${String(n).padStart(6)} (${pct.padStart(5)}%)  ${caminho}`);
  }
  if (!contagem.size) console.log("  (nenhum campo desses grupos veio preenchido)");
  return contagem;
}

// ── 1. as CAPTURADAS do ADN (onde está a nota do portal citada pelo dono) ──────────────────────
const capturadas = await prisma.portalInvoice.findMany({
  where: { type: "NFSE", papel: "EMIT", xmlRaw: { not: null } },
  select: { xmlRaw: true },
  orderBy: { createdAt: "desc" },
  take: AMOSTRA,
});
const adn = await varrer(`CAPTURADAS DO ADN (amostra das ${AMOSTRA} mais recentes)`, capturadas, (l) => l.xmlRaw);

// ── 2. as que NÓS emitimos ─────────────────────────────────────────────────────────────────────
const nossas = await prisma.serviceInvoice.findMany({
  where: { status: { in: ["issued", "cancelled"] } },
  select: { xml: true },
});
await varrer("EMITIDAS POR NÓS (ServiceInvoice)", nossas, (l) => l.xml);

// ── 3. a resposta direta ───────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(84)}`);
console.log("A PERGUNTA DO DONO — o e-mail e o endereço do prestador estão no XML?");
console.log("=".repeat(84));
const total = capturadas.length;
const conta = (c) => adn.get(c) || 0;
const linha = (rotulo, caminho) => {
  const n = conta(caminho);
  const pct = total ? ((n / total) * 100).toFixed(1) : "0.0";
  console.log(`  ${rotulo.padEnd(34)} ${String(n).padStart(5)} de ${total}  (${pct}%)  ${caminho}`);
};
linha("nome do prestador (emit)", "emit/xNome");
linha("endereço do prestador (emit)", "emit/enderNac/xLgr");
linha("telefone do prestador (emit)", "emit/fone");
linha("E-MAIL do prestador (emit)", "emit/email");
linha("insc. municipal do prestador (emit)", "emit/IM");
console.log("");
linha("nome do prestador (prest, da DPS)", "prest/xNome");
linha("endereço do prestador (prest)", "prest/end/xLgr");
linha("E-MAIL do prestador (prest)", "prest/email");
linha("insc. municipal (prest)", "prest/IM");
console.log("");
linha("e-mail do tomador", "toma/email");
linha("telefone do tomador", "toma/fone");
linha("insc. municipal do tomador", "toma/IM");
console.log(`${"=".repeat(84)}\n`);

await prisma.$disconnect();
