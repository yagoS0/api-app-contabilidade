// SOMENTE LEITURA. "Por que o DANFSe sai sem o endereço do prestador?"
//
// O gerador lê POR CAMINHO (NT 008 §2.4.5), e para NOME/ENDEREÇO do prestador a NT aponta
// `DPS/infDPS/prest/`. Este script confere, no XML REAL que o sistema nacional devolveu, onde
// aqueles dados de fato estão.
//
// ⚠ NÃO IMPRIME VALOR NENHUM — só o caminho da tag e se ela tem conteúdo. O XML é nota fiscal real,
// com CNPJ, endereço, telefone e e-mail de prestador E de tomador.

import { PrismaClient } from "@prisma/client";
import { lerEnvelopeXml, raizDoXml } from "../src/application/nfse/lerEnvelopeXml.js";

const prisma = new PrismaClient();
const ABRE = String.fromCharCode(60);

/** Caminhos das folhas do XML, com "tem conteúdo?" — sem o conteúdo. */
function caminhos(xml) {
  const achados = new Map();
  const pilha = [];
  const re = new RegExp(`${ABRE}(\\/?)([A-Za-z_][\\w.:-]*)([^>]*?)(\\/?)>([^${ABRE}]*)`, "g");
  let m;
  while ((m = re.exec(xml))) {
    const [, fecha, tagBruta, , autoFecha, texto] = m;
    const tag = tagBruta.includes(":") ? tagBruta.split(":").pop() : tagBruta;
    if (fecha) { pilha.pop(); continue; }
    const caminho = [...pilha, tag].join("/");
    if (autoFecha) {
      achados.set(caminho, achados.get(caminho) || false);
      continue;
    }
    pilha.push(tag);
    const conteudo = String(texto || "").trim();
    if (conteudo) achados.set(caminho, true);
    else if (!achados.has(caminho)) achados.set(caminho, false);
  }
  return achados;
}

const notas = await prisma.serviceInvoice.findMany({
  where: { status: { in: ["issued", "cancelled"] } },
  select: { id: true, status: true, xml: true, createdAt: true },
  orderBy: { createdAt: "desc" },
});

console.log(`\nNotas emitidas com XML da NFS-e: ${notas.length}\n`);

// Os caminhos que o DANFSe precisa para o bloco do PRESTADOR (NT 008 §2.4.5).
const INTERESSA = /(^|\/)(prest|emit|toma|infNFSe|infDPS)(\/|$)/;

for (const [i, n] of notas.entries()) {
  const { forma, xml } = lerEnvelopeXml(n.xml);
  if (!xml) { console.log(`nota ${i + 1} (${n.status}): envelope ${forma}, sem XML legível`); continue; }

  const c = caminhos(xml);
  console.log(`${"=".repeat(88)}`);
  console.log(`nota ${i + 1} · ${n.status} · envelope ${forma} · raiz ${raizDoXml(xml)}`);
  console.log(`${"=".repeat(88)}`);

  const relevantes = [...c.entries()].filter(([k]) => INTERESSA.test(k)).sort();
  for (const [caminho, temConteudo] of relevantes) {
    console.log(`  ${temConteudo ? "PREENCHIDO" : "  vazio   "}  ${caminho}`);
  }

  // A pergunta direta, do jeito que o gerador a faz.
  const tem = (p) => c.get(p) === true;
  const qualquer = (pre) => [...c.entries()].some(([k, v]) => k.startsWith(pre) && v);
  console.log("");
  console.log("  --- o que o DANFSe procura x onde o dado está");
  console.log(`  NFSe/DPS/infDPS/prest/xNome ....... ${tem("NFSe/DPS/infDPS/prest/xNome") ? "PREENCHIDO" : "AUSENTE/vazio"}`);
  console.log(`  NFSe/DPS/infDPS/prest/end/* ....... ${qualquer("NFSe/DPS/infDPS/prest/end") ? "PREENCHIDO" : "AUSENTE/vazio"}`);
  console.log(`  NFSe/infNFSe/emit/xNome ........... ${tem("NFSe/infNFSe/emit/xNome") ? "PREENCHIDO" : "AUSENTE/vazio"}`);
  console.log(`  NFSe/infNFSe/emit/enderNac/* ...... ${qualquer("NFSe/infNFSe/emit/enderNac") ? "PREENCHIDO" : "AUSENTE/vazio"}`);
  console.log(`  NFSe/infNFSe/emit/end/* ........... ${qualquer("NFSe/infNFSe/emit/end") ? "PREENCHIDO" : "AUSENTE/vazio"}`);
  console.log("");
}

await prisma.$disconnect();
