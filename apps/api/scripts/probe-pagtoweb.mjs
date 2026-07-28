// Sonda o PAGTOWEB (comprovante de arrecadação) e imprime a resposta CRUA do SERPRO.
//
// OBJETIVO: validar o idServiço/payload antes de ligar INTEGRACAO_SERPRO_PAGTOWEB. Hoje a flag
// está OFF porque `COMPARRECADACAO72` e o formato de `dados` são o PALPITE da spec
// (verificadoTrial:false) — decisão do projeto de nunca reportar pagamento por suposição.
// É isso que permitiria dar baixa com a DATA e o VALOR reais do pagamento (o que hoje se faz
// olhando o e-CAC na mão).
//
//   node scripts/probe-pagtoweb.mjs --guia=<guideId>
//   node scripts/probe-pagtoweb.mjs --cnpj=<cnpj> --documento=<numeroDocumento>
//   node scripts/probe-pagtoweb.mjs --cnpj=<cnpj> --listar     → mostra guias com numeroDocumento
//
// Roda MESMO com a flag OFF (o ponto é validar antes de ligar). Não grava nada: só lê e imprime.
// ⚠ Consome uma chamada paga ao SERPRO. Rode em UMA guia.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "../src/application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproHttpClient } from "../src/application/fiscal/serpro/SerproHttpClient.js";
import {
  INTEGRACAO_SERPRO_PAGTOWEB,
  SERPRO_PAGTOWEB_SYSTEM,
  SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
} from "../src/config.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const temFlag = (n) => process.argv.includes(`--${n}`);
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");

// O numeroDocumento é gravado em guide.extracted no momento da emissão (DAS/DARF/INSS).
function docDaGuia(guide) {
  const e = guide?.extracted;
  if (!e || typeof e !== "object") return null;
  return String(e.numeroDocumento || e.numeroDoc || e.documento || "").trim() || null;
}

try {
  console.log(`INTEGRACAO_SERPRO_PAGTOWEB = ${INTEGRACAO_SERPRO_PAGTOWEB ? "ON" : "OFF (o probe roda mesmo assim)"}`);
  console.log(`Serviço ....: ${SERPRO_PAGTOWEB_SYSTEM}/${SERPRO_PAGTOWEB_SERVICE_COMPROVANTE} v1.0`);
  console.log("⚠ idServiço e formato de `dados` NÃO validados — é isto que estamos conferindo.\n");

  const guiaId = arg("guia");
  const cnpjArg = arg("cnpj");
  let contribuinte = onlyDigits(cnpjArg);
  let numeroDocumento = arg("documento");
  let guiaInfo = null;

  if (guiaId) {
    const g = await prisma.guide.findUnique({
      where: { id: String(guiaId) },
      select: { id: true, tipo: true, competencia: true, valor: true, cnpj: true, extracted: true, paymentStatus: true },
    });
    if (!g) { console.error("Guia não encontrada."); process.exit(1); }
    guiaInfo = g;
    contribuinte = onlyDigits(g.cnpj);
    numeroDocumento = docDaGuia(g);
    if (!numeroDocumento) {
      console.error(`A guia ${g.tipo} ${g.competencia} não tem numeroDocumento em extracted — sem ele o PAGTOWEB não tem o que consultar.`);
      process.exit(1);
    }
  }

  // Modo listagem: ajuda a escolher uma guia que tenha numeroDocumento.
  if (temFlag("listar")) {
    const guias = await prisma.guide.findMany({
      where: contribuinte ? { cnpj: { in: [cnpjArg, contribuinte] } } : {},
      select: { id: true, tipo: true, competencia: true, valor: true, cnpj: true, extracted: true, paymentStatus: true },
      orderBy: { competencia: "desc" },
      take: 30,
    });
    const comDoc = guias.filter(docDaGuia);
    console.log(`${guias.length} guia(s) · ${comDoc.length} com numeroDocumento (consultáveis):\n`);
    for (const g of comDoc) {
      console.log(`  ${g.id}  ${String(g.tipo).padEnd(8)} ${g.competencia}  R$ ${Number(g.valor || 0).toFixed(2).padStart(10)}  doc=${docDaGuia(g)}  ${g.paymentStatus || ""}`);
    }
    if (!comDoc.length) console.log("  (nenhuma — o numeroDocumento vem da emissão via SERPRO)");
    process.exit(0);
  }

  if (!contribuinte || !numeroDocumento) {
    console.error("Uso: --guia=<id>  |  --cnpj=<cnpj> --documento=<numeroDocumento>  |  --cnpj=<cnpj> --listar");
    process.exit(2);
  }

  const runtime = await getResolvedSerproCredentials();
  const contratante = onlyDigits(runtime.certificate?.document);
  if (guiaInfo) console.log(`Guia .......: ${guiaInfo.tipo} ${guiaInfo.competencia} · R$ ${Number(guiaInfo.valor || 0).toFixed(2)} · status atual: ${guiaInfo.paymentStatus || "—"}`);
  console.log(`Contribuinte: ${contribuinte}`);
  console.log(`Contratante : ${contratante || "(não configurado)"}`);
  console.log(`Documento ..: ${numeroDocumento}\n`);

  const client = new SerproHttpClient();
  const resp = await client.post("/Emitir", {
    contratante: { numero: contratante, tipo: 2 },
    autorPedidoDados: { numero: contratante, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: 2 },
    pedidoDados: {
      idSistema: SERPRO_PAGTOWEB_SYSTEM,
      idServico: SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
      versaoSistema: "1.0",
      dados: JSON.stringify({ numeroDocumento }),
    },
  }, { raw: true, validateStatus: () => true });

  console.log(`=== HTTP ${resp.status} ===`);
  const data = resp.data;
  // O PDF (base64) pode ser enorme: mostra só o tamanho, não o conteúdo.
  const resumido = JSON.parse(JSON.stringify(data ?? null, (k, v) =>
    (typeof v === "string" && v.length > 300 ? `«${v.length} chars — provável base64/PDF»` : v)));
  console.log("\n=== CORPO (strings longas resumidas) ===");
  console.log(JSON.stringify(resumido, null, 2).slice(0, 6000));

  console.log("\n=== O QUE OLHAR ===");
  console.log("• mensagens[]: código/texto dizem se o idServiço existe e se o payload foi aceito.");
  console.log("• dados: deve trazer o comprovante (PDF base64) e/ou data/valor do pagamento.");
  console.log("• Se vier 'serviço não encontrado'/'inválido', o idServiço COMPARRECADACAO72 está errado.");
} catch (err) {
  console.error("\nErro:", err?.message || err);
  if (err?.response) {
    console.error("HTTP:", err.response.status);
    console.error("Corpo:", JSON.stringify(err.response.data).slice(0, 3000));
  }
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
