// Mede em QUANTAS guias reais conseguimos LER a linha digitável do documento — e por que falha nas
// outras. NÃO faz nenhuma chamada ao SERPRO, NÃO escreve nada no banco: só lê `Guide.pdfBytes`
// (e, na ausência dele, o PDF em base64 que já ficou salvo em `extracted.rawPayload`).
//
//   node scripts/diag-linha-digitavel.mjs
//   node scripts/diag-linha-digitavel.mjs --competencia=2026-07
//   node scripts/diag-linha-digitavel.mjs --tipo=SIMPLES --limite=200
//   node scripts/diag-linha-digitavel.mjs --guia=<guideId> --dump   (mostra o texto do PDF)
//
// Cobertura baixa é RESULTADO, não fracasso: o número que sai daqui é o que se pode prometer na
// tela do cliente. O que não passa nos cinco dígitos verificadores + na conferência de valor não
// vira meio de pagamento — fica ausente, com motivo.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  extrairLinhaDigitavelDoTexto,
  conferirContraDocumento,
  formatarLinhaDigitavel,
} from "../src/application/guides/linhaDigitavelArrecadacao.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const tem = (name) => process.argv.includes(`--${name}`);

// PDF do payload do SERPRO já salvo: `dados` é JSON EM STRING; o item traz `pdf` em base64.
function pdfDoRawPayload(extracted) {
  const raw = extracted && extracted.rawPayload;
  if (!raw) return null;
  let dados = raw.dados ?? raw.Dados;
  if (typeof dados === "string") {
    try { dados = JSON.parse(dados); } catch { return null; }
  }
  const itens = Array.isArray(dados) ? dados : dados ? [dados] : [];
  for (const item of itens) {
    const b64 = item && (item.pdf || item.docArrecadacaoPdfB64 || item.pdfBase64);
    if (typeof b64 === "string" && b64.length > 100) {
      try {
        const buf = Buffer.from(b64, "base64");
        if (buf.slice(0, 4).toString("latin1") === "%PDF") return buf;
      } catch { /* base64 ilegível */ }
    }
  }
  return null;
}

// A conferência tem de ser contra o DOCUMENTO OFICIAL, não contra o que nós digitamos. Quando a
// guia veio do SERPRO, `detalhamentoDas.valores.total` e `dataVencimento` estão no payload salvo —
// essa é a fonte. Só na ausência dela cai para `Guide.valor`/`Guide.vencimento` (que, no caso de
// guia registrada à mão, é um número digitado por alguém).
function referenciaOficial(extracted) {
  const raw = extracted && extracted.rawPayload;
  if (!raw) return null;
  let dados = raw.dados ?? raw.Dados;
  if (typeof dados === "string") {
    try { dados = JSON.parse(dados); } catch { return null; }
  }
  const item = Array.isArray(dados) ? dados[0] : dados;
  const det = item && item.detalhamentoDas;
  if (!det) return null;
  const total = det.valores && det.valores.total;
  if (total == null) return null;
  return { valorTotal: Number(total), vencimento: det.dataVencimento != null ? String(det.dataVencimento) : null };
}

// PIX: o "copia e cola" é um BR Code EMV — começa em "000201" e traz o domínio do arranjo.
function procurarPix(texto) {
  const t = String(texto || "");
  const temMencao = /\bPIX\b/i.test(t);
  const m = t.match(/000201[0-9A-Za-z.$*+\-/: ]{20,}/);
  const temDominio = /br\.gov\.bcb\.pix/i.test(t);
  return { temMencao, temDominio, emv: temDominio && m ? m[0].slice(0, 60) : null };
}

async function main() {
  const where = {};
  const competencia = arg("competencia");
  const tipo = arg("tipo");
  const guia = arg("guia");
  if (competencia) where.competencia = competencia;
  if (tipo) where.tipo = tipo.toUpperCase();
  if (guia) where.id = guia;

  const limite = Number(arg("limite") || 500);
  const guias = await prisma.guide.findMany({
    where,
    select: {
      id: true, tipo: true, competencia: true, cnpj: true, source: true, status: true,
      valor: true, vencimento: true, pdfBytes: true, extracted: true, serproService: true,
      sourcePath: true,
    },
    orderBy: [{ competencia: "desc" }, { createdAt: "desc" }],
    take: limite,
  });

  const pdfParse = (await import("pdf-parse")).default;

  const resumo = {
    total: guias.length,
    semPdf: 0,
    pdfDoRawPayload: 0,
    textoIlegivel: 0,
    lidaEConferida: 0,
    recusas: new Map(),
    pixMencionado: 0,
    pixCopiaECola: 0,
    conferidoContraPayload: 0,
  };
  const porTipo = new Map();
  const amostras = [];
  const naoSairam = [];

  for (const g of guias) {
    const chaveTipo = `${g.tipo}/${g.source || "?"}`;
    if (!porTipo.has(chaveTipo)) porTipo.set(chaveTipo, { total: 0, ok: 0 });
    porTipo.get(chaveTipo).total += 1;

    const conta = (motivo) => resumo.recusas.set(motivo, (resumo.recusas.get(motivo) || 0) + 1);

    let buffer = g.pdfBytes && g.pdfBytes.length ? Buffer.from(g.pdfBytes) : null;
    if (!buffer) {
      buffer = pdfDoRawPayload(g.extracted);
      if (buffer) resumo.pdfDoRawPayload += 1;
    }
    if (!buffer) { resumo.semPdf += 1; conta("sem_pdf_guardado"); continue; }

    let texto = "";
    try {
      texto = String((await pdfParse(buffer))?.text || "");
    } catch (e) {
      resumo.textoIlegivel += 1; conta(`pdf_ilegivel:${e.code || e.message}`); continue;
    }
    if (tem("dump")) console.log(`\n===== ${g.id} =====\n${texto}\n=====`);

    const pix = procurarPix(texto);
    if (pix.temMencao) resumo.pixMencionado += 1;
    if (pix.emv) resumo.pixCopiaECola += 1;

    const oficial = referenciaOficial(g.extracted);
    if (oficial) resumo.conferidoContraPayload += 1;
    const lida = extrairLinhaDigitavelDoTexto(texto);
    const conferida = conferirContraDocumento(lida, oficial || {
      valorTotal: g.valor != null ? Number(g.valor) : null,
      vencimento: g.vencimento || null,
    });

    if (conferida.ok) {
      resumo.lidaEConferida += 1;
      porTipo.get(chaveTipo).ok += 1;
      if (amostras.length < 8) {
        amostras.push({
          tipo: g.tipo, competencia: g.competencia, valor: String(g.valor),
          linha: formatarLinhaDigitavel(conferida.linhaDigitavel),
          venc_na_linha: conferida.vencimentoCodificado || "(não codificado)",
          segmento: conferida.segmento, orgao: conferida.identificacaoOrgao,
        });
      }
    } else {
      conta(conferida.motivo);
      naoSairam.push({
        id: g.id, tipo: g.tipo, origem: g.source, comp: g.competencia,
        arquivo: (g.sourcePath || "").slice(0, 40),
        motivo: conferida.motivo,
        detalhe: conferida.detalhe ? JSON.stringify(conferida.detalhe) : "",
        fonte_conferencia: oficial ? "payload SERPRO" : "Guide.valor",
      });
    }
  }

  console.log("\n== COBERTURA ==");
  console.log(`guias analisadas .............. ${resumo.total}`);
  console.log(`PDF veio do rawPayload ........ ${resumo.pdfDoRawPayload}`);
  console.log(`linha LIDA e CONFERIDA ........ ${resumo.lidaEConferida}` +
    (resumo.total ? `  (${Math.round((resumo.lidaEConferida / resumo.total) * 100)}%)` : ""));

  console.log("\n== POR TIPO/ORIGEM ==");
  console.table([...porTipo.entries()].map(([k, v]) => ({ tipo_origem: k, total: v.total, com_linha: v.ok })));

  console.log(`conferido contra o payload do SERPRO .. ${resumo.conferidoContraPayload}` +
    " (nas demais, a referência é o Guide.valor — número digitado por alguém)");

  if (resumo.recusas.size) {
    console.log("\n== POR QUE NÃO SAIU (nenhuma delas vira número na tela) ==");
    console.table([...resumo.recusas.entries()].sort((a, b) => b[1] - a[1]).map(([motivo, n]) => ({ motivo, n })));
    const comPdf = naoSairam.filter((r) => r.motivo !== "sem_pdf_guardado");
    if (comPdf.length) {
      console.log("-- caso a caso (tinha PDF e mesmo assim não saiu) --");
      console.table(comPdf.slice(0, 30));
    }
  }

  console.log("== PIX ==");
  console.log(`documentos que MENCIONAM PIX .. ${resumo.pixMencionado}`);
  console.log(`com copia-e-cola no texto ..... ${resumo.pixCopiaECola}`);

  if (amostras.length) {
    console.log("\n== AMOSTRAS (só leitura) ==");
    console.table(amostras);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
