// Sonda o PAGTOWEB (comprovante de arrecadação) e imprime a resposta CRUA do SERPRO.
//
// ✅ PAYLOAD VALIDADO (27/07/2026): {"numeroDocumento":"<só dígitos>"} → 200 + { pdf }.
// Com máscara (07.16.26194.4441233-6) dá 500/Erro-PAGTOWEB-00099; com o campo
// `numeroDocumentoArrecadacao` dá 400. O serviço devolve SÓ o PDF — não há data/valor
// estruturados, então a baixa automática depende de ler o comprovante (use --texto).
//
//   node scripts/probe-pagtoweb.mjs --guia=<guideId>
//   node scripts/probe-pagtoweb.mjs --cnpj=<cnpj> --documento=<numeroDocumento>
//   node scripts/probe-pagtoweb.mjs --cnpj=<cnpj> --listar     → mostra guias com numeroDocumento
//
// Ajuste do payload (mantidos para investigar outros serviços/variações):
//   --digitos                 → manda o documento só com dígitos (tira pontos e traço)
//   --campo=<nome>            → troca o nome do campo (default numeroDocumento)
//   --dados='{"x":"y"}'       → manda um `dados` inteiro, cru (vence tudo)
//   --texto                   → extrai o TEXTO do PDF do comprovante (data/valor do pagamento)
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

  // O formato exato de `dados` ainda não é conhecido (o SERPRO devolveu Erro-PAGTOWEB-00099,
  // erro interno genérico, com o documento formatado). Estas flags permitem testar variações
  // sem novo deploy — cada tentativa é UMA chamada paga.
  const dadosCru = arg("dados");
  const campo = arg("campo") || "numeroDocumento";
  const docEnviado = temFlag("digitos") ? onlyDigits(numeroDocumento) : numeroDocumento;
  const dadosPayload = dadosCru || JSON.stringify({ [campo]: docEnviado });
  console.log(`dados ......: ${dadosPayload}
`);

  const client = new SerproHttpClient();
  const resp = await client.post("/Emitir", {
    contratante: { numero: contratante, tipo: 2 },
    autorPedidoDados: { numero: contratante, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: 2 },
    pedidoDados: {
      idSistema: SERPRO_PAGTOWEB_SYSTEM,
      idServico: SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
      versaoSistema: "1.0",
      dados: dadosPayload,
    },
  }, { raw: true, validateStatus: () => true });

  console.log(`=== HTTP ${resp.status} ===`);
  const data = resp.data;
  // O PDF (base64) pode ser enorme: mostra só o tamanho, não o conteúdo.
  const encurtar = (obj) => JSON.parse(JSON.stringify(obj ?? null, (k, v) =>
    (typeof v === "string" && v.length > 300 ? `«${v.length} chars — provável base64/PDF»` : v)));
  console.log("\n=== ENVELOPE (strings longas resumidas) ===");
  console.log(JSON.stringify(encurtar(data), null, 2).slice(0, 4000));

  // `dados` e string JSON escapada — e AQUI que mora o comprovante e, se existirem, a DATA e o
  // VALOR do pagamento. Abre e mostra a ESTRUTURA (chaves + valores curtos); o PDF vira o tamanho.
  const dadosRaw = data?.dados ?? data?.Dados ?? null;
  if (dadosRaw != null) {
    let parsed = dadosRaw;
    if (typeof dadosRaw === "string") { try { parsed = JSON.parse(dadosRaw); } catch { parsed = null; } }
    console.log("\n=== DADOS (conteúdo do comprovante) ===");
    if (parsed && typeof parsed === "object") {
      console.log(JSON.stringify(encurtar(parsed), null, 2).slice(0, 6000));
      const achatar = (o, pre = "") => Object.entries(o).flatMap(([k, v]) =>
        (v && typeof v === "object" && !Array.isArray(v) ? achatar(v, `${pre}${k}.`) : [`${pre}${k}`]));
      console.log("\nCampos disponíveis: " + achatar(parsed).join(", "));
    } else if (typeof dadosRaw === "string") {
      console.log(`(nao e JSON — string de ${dadosRaw.length} chars; provavelmente o PDF em base64 direto)`);
      console.log(`inicio: ${dadosRaw.slice(0, 80)}...`);
    }

    // O comprovante vem SÓ como PDF (dados = { pdf }), sem data/valor estruturados. Para dar baixa
    // com os dados reais é preciso ler o PDF — e o texto tem que ser visto ANTES de escrever
    // qualquer parser (a lição do SITFIS: parser escrito no escuro inventa número).
    const pdfB64 = parsed && typeof parsed === "object" ? (parsed.pdf || parsed.PDF || parsed.arquivo) : null;
    if (temFlag("texto") && pdfB64) {
      const buf = Buffer.from(String(pdfB64), "base64");
      const pdfParse = (await import("pdf-parse")).default;
      const out = await pdfParse(buf);
      console.log(`\n=== TEXTO DO COMPROVANTE (${String(out?.text || "").length} chars) ===\n`);
      console.log(out?.text || "(vazio)");
    } else if (pdfB64) {
      console.log("\n(rode com --texto para extrair o texto do PDF e ver data/valor do pagamento)");
    }
  }

  console.log("\n=== O QUE OLHAR ===");
  console.log("• Em 'Campos disponíveis', procure a DATA e o VALOR do pagamento — é o que permite");
  console.log("  dar baixa com os dados reais em vez de 'hoje' + valor da guia.");
  console.log("• ✅ Payload já validado: {\"numeroDocumento\":\"<só dígitos>\"} → 200 + comprovante.");
  console.log("• Erro-PAGTOWEB-00099 = erro INTERNO do PAGTOWEB: o serviço existe e recebeu a chamada,");
  console.log("  mas não gostou do `dados`. Tente: --digitos, --campo=<outro nome>, --dados='{...}'.");
  console.log("• O 'Protocolo de erro' da mensagem identifica a falha no suporte do SERPRO.");
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
