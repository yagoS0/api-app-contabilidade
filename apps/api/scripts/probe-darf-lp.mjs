// Probe do DARF do Lucro Presumido (DCTFWeb /Emitir) — RODE NO AMBIENTE DE DEMONSTRAÇÃO SERPRO.
// Objetivo: descobrir qual `dados` (categoria e/ou seletor de vencimento/quota) faz o /Emitir devolver
// DARFs INDIVIDUAIS por vencimento/quota (IRPJ/CSLL em quotas saem obrigatoriamente separados) vs 1
// consolidado. É read-only: NÃO cria guia, NÃO salva PDF, NÃO transmite (usa probeEmitirDarfDctfweb).
//
// Uso:
//   node scripts/probe-darf-lp.mjs --cnpj=00000000000191 --competencia=2026-03 [--candidatos=cands.json]
//
// `cands.json` = array de objetos `dados` a enviar no /Emitir. Ex. (edite com o param que você quer testar):
//   [
//     { "categoria": "GERAL_MENSAL", "anoPA": "2026", "mesPA": "03" },
//     { "categoria": "GERAL_MENSAL", "anoPA": "2026", "mesPA": "03", "vencimento": "2026-04-30" },
//     { "categoria": "QUOTA", "anoPA": "2026", "mesPA": "03", "numeroQuota": 1 }
//   ]
// Sem --candidatos, roda só o baseline (categoria GERAL_MENSAL). Cada resposta loga httpStatus, se veio
// PDF (e o tamanho), valor/vencimento/nº documento parseados, mensagens do envelope e um trecho do texto.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import fs from "node:fs";
import { probeEmitirDarfDctfweb } from "../src/application/fiscal/serpro/SerproDctfwebService.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const cnpj = String(arg("cnpj") || "").replace(/\D+/g, "");
const competencia = arg("competencia");
const candidatosPath = arg("candidatos");

if (cnpj.length !== 14 || !/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
  console.error("Uso: node scripts/probe-darf-lp.mjs --cnpj=<14 dígitos> --competencia=YYYY-MM [--candidatos=cands.json]");
  process.exit(2);
}

const [ano, mes] = competencia.split("-");
let candidatos = [{ categoria: "GERAL_MENSAL", anoPA: ano, mesPA: mes }];
if (candidatosPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(candidatosPath, "utf8"));
    if (Array.isArray(parsed) && parsed.length) candidatos = parsed;
  } catch (e) {
    console.error(`Falha lendo ${candidatosPath}: ${e?.message}`);
    process.exit(2);
  }
}

console.log(`Probe DARF LP — CNPJ ${cnpj} · competência ${competencia} · ${candidatos.length} candidato(s)\n`);

let ok = true;
for (let i = 0; i < candidatos.length; i++) {
  const dados = candidatos[i];
  console.log(`── Candidato ${i + 1}/${candidatos.length} — dados: ${JSON.stringify(dados)}`);
  try {
    // eslint-disable-next-line no-await-in-loop
    const r = await probeEmitirDarfDctfweb({ contribuinteCnpj: cnpj, competencia, dadosOverride: dados });
    console.log(`   httpStatus=${r.httpStatus}  temPdf=${r.temPdf}  pdfLength=${r.pdfLength}`);
    console.log(`   parsed=${JSON.stringify(r.parsed)}`);
    if (r.composicao) console.log(`   composicao=${JSON.stringify(r.composicao)}`); // códigos/valores DENTRO deste DARF
    if (r.mensagens) console.log(`   mensagens=${JSON.stringify(r.mensagens)}`);
    if (r.envelopeKeys?.length) console.log(`   envelopeKeys=${JSON.stringify(r.envelopeKeys)}`);
    if (r.pdfTexto) console.log(`   pdfTexto[0..900]=${r.pdfTexto.slice(0, 900).replace(/\s+/g, " ")}`);
    if (r.pdfTextoErro) console.log(`   pdfTextoErro=${r.pdfTextoErro}`);
  } catch (e) {
    ok = false;
    console.log(`   ERRO: ${e?.code || ""} ${e?.message || e}`);
  }
  console.log("");
}

console.log(
  "Leitura: se algum candidato devolver PDFs SEPARADOS por vencimento/quota (rodando o mesmo dados com " +
  "numeroQuota/vencimento diferentes e voltando documentos distintos), esse é o parâmetro certo. Me diga " +
  "quantos PDFs vieram por candidato e qual `dados` os separou, que eu ligo a emissão de N guias (1 por DARF).",
);

await prisma.$disconnect();
process.exit(ok ? 0 : 1);
