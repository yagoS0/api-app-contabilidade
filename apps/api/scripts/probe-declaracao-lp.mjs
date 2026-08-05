// SPIKE do Lucro Presumido — a Declaração Completa da DCTFWeb (CONSDECCOMPLETA33).
//
// PARA QUE SERVE
// A flag `INTEGRACAO_SERPRO_DCTFWEB_LP` está OFF porque o contrato deste serviço é
// `verificadoTrial: false` — veio da especificação e nunca foi exercido contra empresa real. Ligar
// sem validar promove uma suposição a ferramenta diária que GRAVA provisão contábil.
//
// Este script é o passo que falta antes de ligar. Ele faz três coisas, nesta ordem:
//   1. chama o /Consultar (leitura, SEM ato fiscal — não transmite, não emite, não persiste NADA);
//   2. mostra se os débitos vieram estruturados ou só dentro de um PDF;
//   3. roda o NOSSO parser no texto do PDF e imprime os débitos como o sistema os entenderia.
//
// ⚠ O PASSO 3 É O QUE IMPORTA. "A chamada respondeu 200" não valida nada: o parse dos débitos sai
// de regex sobre texto de PDF, e é ali que o erro se esconde. Compare a tabela impressa com a tela
// oficial da DCTFWeb — código a código, valor a valor. Foi exatamente uma divergência dessas que
// fez o IRRF (3208) virar "outros tributos" e sair debitando INSS.
//
// ⚠ CHAMADA PAGA. Uma por execução, registrada e contada pela guarda de custo do SERPRO. Por isso
// só roda com `--confirmo`.
//
// Uso:
//   node scripts/probe-declaracao-lp.mjs --cnpj=00000000000191 --competencia=2026-05
//   node scripts/probe-declaracao-lp.mjs --cnpj=... --competencia=... --confirmo
//   ... [--categoria=GERAL_MENSAL] [--idServico=CONSDECCOMPLETA33]

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { probeConsultarDeclaracaoCompleta } from "../src/application/fiscal/serpro/SerproDctfwebService.js";
import { parseDctfwebDeclaracao } from "../src/application/fiscal/serpro/parseDctfwebDeclaracao.js";
import { comContextoSerpro } from "../src/application/fiscal/serpro/serproCallContext.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const cnpjArg = String(arg("cnpj") || "").replace(/\D/g, "");
const competencia = arg("competencia");
const categoria = arg("categoria") || undefined;
const idServico = arg("idServico") || undefined;
const confirmo = process.argv.includes("--confirmo");

if (!cnpjArg || !competencia) {
  console.error("Uso: node scripts/probe-declaracao-lp.mjs --cnpj=<14 dígitos> --competencia=YYYY-MM [--confirmo]");
  process.exit(2);
}

// Consulta só INFORMATIVA (nome e regime). Best-effort de propósito: um tropeço aqui não pode
// impedir o aviso de custo de aparecer — quem precisa mesmo do banco é a credencial do SERPRO,
// bem depois.
const empresa = await prisma.portalClient.findFirst({
  where: { cnpj: cnpjArg },
  select: { id: true, razao: true, cnpj: true, companyId: true },
}).catch(() => null);
if (empresa) {
  const legacy = empresa.companyId
    ? await prisma.company.findUnique({ where: { id: empresa.companyId }, select: { regimeTributario: true } })
    : null;
  console.log(`EMPRESA: ${empresa.razao} (${empresa.cnpj}) · regime ${legacy?.regimeTributario || "?"}`);
  if (legacy?.regimeTributario && !["LUCRO_PRESUMIDO", "LUCRO_REAL"].includes(legacy.regimeTributario)) {
    console.log("⚠ Esta empresa NÃO é Presumido/Real — a DCTFWeb completa provavelmente não tem o que devolver.");
  }
} else {
  console.log(`⚠ CNPJ ${cnpjArg} não está na carteira. O SERPRO será consultado assim mesmo (a procuração é que manda).`);
}

if (!confirmo) {
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("Isto faria UMA consulta PAGA ao SERPRO (CONSDECCOMPLETA33).");
  console.log("É leitura: não transmite, não emite guia, não grava lançamento.");
  console.log("Para executar de verdade, repita o comando com --confirmo");
  console.log("───────────────────────────────────────────────────────────────");
  await prisma.$disconnect();
  process.exit(0);
}

const out = await comContextoSerpro(
  { origem: "spike:declaracao-lp", userId: null, forcar: false },
  () => probeConsultarDeclaracaoCompleta({ contribuinteCnpj: cnpjArg, competencia, categoria, idServico }),
).catch((e) => ({ erro: e?.code || "FALHA", message: e?.message }));

if (out.erro) {
  console.error(`\n✕ ${out.erro}: ${out.message}`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log("\n═══ RESPOSTA DO SERPRO ═══");
console.log(`idServico ......... ${out.idServico}`);
console.log(`HTTP .............. ${out.httpStatus}`);
console.log(`enviado (dados) ... ${JSON.stringify(out.enviado?.dados)}`);
console.log(`veio PDF? ......... ${out.temPdf ? `sim (${out.pdfLength} chars base64)` : "NÃO"}`);
console.log(`dados estruturados? ${out.temDadosEstruturados ? `sim — chaves: ${out.nonPdfKeys.join(", ")}` : "não (só PDF)"}`);
if (out.mensagens) console.log(`mensagens ......... ${JSON.stringify(out.mensagens)}`);
if (out.pdfTextoErro) console.log(`⚠ texto do PDF .... ${out.pdfTextoErro}`);

// ─── O TESTE DE VERDADE ────────────────────────────────────────────────────────────────────────
// Sem PDF não há o que validar: a declaração provavelmente não foi transmitida para essa
// competência. Isso é um estado NORMAL, não uma falha do contrato.
if (!out.pdfTexto) {
  console.log("\nSem texto de PDF para parsear.");
  console.log("Se `veio PDF? NÃO`, o mais provável é que a declaração desta competência ainda não");
  console.log("tenha sido transmitida — tente uma competência que você sabe que está declarada.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n═══ COMO O SISTEMA ENTENDERIA ═══");
let parsed = null;
try {
  parsed = parseDctfwebDeclaracao(out.pdfTexto);
} catch (e) {
  console.error(`✕ o parser QUEBROU: ${e?.message}`);
}

if (parsed) {
  const c = parsed.cabecalho || {};
  console.log(`CNPJ ${c.cnpj || "?"} · PA ${c.competencia || "?"} · recibo ${c.numeroRecibo || "?"}`);
  console.log(`forma de tributação: ${c.formaTributacao || "?"} · regime PIS/COFINS: ${c.regimePisCofins || "?"}`);

  const debitos = parsed.debitos || [];
  if (!debitos.length) {
    console.log("\n⚠ NENHUM DÉBITO PARSEADO — e veio PDF. É o pior desfecho possível: o serviço");
    console.log("responde, mas o nosso parser não enxerga os débitos. NÃO ligue a flag assim.");
  } else {
    console.table(debitos.map((d) => ({
      codigo: d.codigoReceita,
      tributo: d.tributo || "⚠ NÃO IDENTIFICADO",
      descricao: String(d.descricao || "").slice(0, 42),
      debito: d.debitoApurado,
      saldo: d.saldoAPagar,
    })));
    console.log(`total apurado: ${parsed.totais?.debitoApurado} · saldo: ${parsed.totais?.saldoAPagar}`);

    const semTributo = debitos.filter((d) => !d.tributo);
    if (semTributo.length) {
      console.log(`\n⚠ ${semTributo.length} débito(s) sem tributo identificado — cairiam em OUTROS_TRIBUTOS:`);
      for (const d of semTributo) console.log(`   ${d.codigoReceita} · ${d.descricao}`);
      console.log("   Se algum deles tem tributo próprio na tela oficial, o mapa de códigos está");
      console.log("   incompleto — me diga o código e a descrição ANTES de ligar a flag.");
    }
  }
}

console.log("\n───────────────────────────────────────────────────────────────");
console.log("AGORA COMPARE, linha a linha, com a tela oficial da DCTFWeb:");
console.log("  · cada CÓDIGO apareceu?");
console.log("  · o TRIBUTO de cada um bate com o nome que a Receita mostra?");
console.log("  · os VALORES conferem?");
console.log("Batendo tudo: ligue INTEGRACAO_SERPRO_DCTFWEB_LP=1.");
console.log("Divergindo qualquer coisa: NÃO ligue — o botão grava provisão contábil a partir disto.");
console.log("───────────────────────────────────────────────────────────────");

await prisma.$disconnect();
