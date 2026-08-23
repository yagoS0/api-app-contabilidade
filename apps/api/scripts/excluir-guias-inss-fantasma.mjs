// ⚠⚠ SCRIPT DESTRUTIVO — MAS SÓ COM `--executar`. SEM FLAG ELE É ENSAIO E NÃO APAGA NADA. ⚠⚠
//
// Apaga as guias `tipo:"INSS"` cujo PDF não tem NENHUMA contribuição previdenciária — o resíduo do
// defeito corrigido em `3e6acf12` (a captura de INSS rotulava como INSS o DARF de PIS/COFINS do
// Lucro Presumido, porque não olhava a composição do documento).
//
// DECISÃO DO DONO (21/08/2026): "Excluir só as duplicadas, rodar a captura nas outras 4."
// Sobre os marcadores VAZIO de PIS: "Deixar como está." — este script NUNCA toca em `status:"VAZIO"`.
//
// ============================ AS TRÊS TRAVAS =================================================
// 1. ENSAIO É O PADRÃO. Rodar sem `--executar` imprime o relatório e sai sem escrever uma linha.
// 2. ALVO POR ID EXATO. A lista abaixo é FECHADA (conferida contra `diag-inss-fantasma-alvo.mjs`).
//    Não existe filtro genérico `tipo:"INSS"` + heurística aqui: heurística é o que criou o defeito.
// 3. DESPEJO ANTES DE APAGAR. Cada guia vai INTEIRA para um JSON (todas as colunas do SELECT *,
//    com o PDF em base64) ANTES do DELETE. Se o despejo falhar, o DELETE não acontece.
//
// ============================ COMO USAR ======================================================
//   # ENSAIO (padrão — não apaga):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/excluir-guias-inss-fantasma.mjs --lote=duplicadas'
//
//   # EXECUÇÃO (apaga de verdade):
//   ... node apps/api/scripts/excluir-guias-inss-fantasma.mjs --lote=duplicadas --executar
//
//   Flags:
//     --lote=duplicadas   as que JÁ TÊM substituta hoje (SINCROSAT 2026-07, EDUCACAO 2026-05)
//     --lote=orfas        as 4 de EDUCACAO 2026-01..04 — ⚠ SÓ DEPOIS DE RODAR A CAPTURA DO LP
//     --lote=todas        os dois lotes (só faz sentido depois da captura)
//     --guia=<id>         restringe a UMA guia (execução uma a uma, recomendada)
//     --executar          sem ela, nada é apagado
//     --out=<arquivo>     caminho do JSON de despejo (padrão: ./backup-guias-inss-fantasma-<lote>-<ts>.json)
//
// ============================ COMO RESTAURAR =================================================
// O JSON tem, por guia, o objeto `guide` com TODAS as colunas (o PDF em `pdfBytes_base64`) e as
// linhas relacionadas. Para voltar uma guia: INSERT em "Guide" com as mesmas colunas, convertendo
// `pdfBytes_base64` de volta com `decode(..., 'base64')`. As linhas de `envios_guia` (cascade)
// também estão no arquivo. Nenhuma coluna é derivada — o registro volta idêntico, mesmo `id`.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseArrecadacaoComposicao, tributosSeNaoForPrevidenciario } from "../src/application/fiscal/serpro/parseArrecadacao.js";

// =============================================================================================
// ALVO — LISTA FECHADA, conferida em 22/08/2026 contra `diag-inss-fantasma-alvo.mjs`.
//
// `substitutaId`         → a substituta JÁ EXISTE e é esta (lote "duplicadas").
// `substitutaSourceFileId` → a substituta AINDA NÃO EXISTE; será criada pela captura do LP com esta
//                            chave de idempotência (lote "orfas"). Enquanto não existir, o script
//                            PULA a guia — é isto que impede apagar a órfã antes da substituta.
// =============================================================================================
const ALVO = Object.freeze([
  // ---------- LOTE "duplicadas": a substituta já existe hoje ----------
  {
    lote: "duplicadas",
    id: "43d2d0e9-dcde-464b-8538-446e4ca9e6bf",
    empresa: "SINCROSAT TELEMETRIA LTDA",
    portalClientId: "fa327dab-ac8a-4a97-8de3-8d5a9e43335c",
    competencia: "2026-07",
    valorEsperado: 1435.49,
    vencimentoEsperado: "2026-08-25",
    substitutaId: "1646b4cc-425d-4995-bf41-5c498a3d54c8",
    // A substituta é a DARF consolidada do LP (tipo OUTRA), mesmo valor e mesmo vencimento.
    exigirMesmoValorNaSubstituta: true,
    nota: "Substituta = guia LP tipo:OUTRA, sourceFileId serpro:dctfweb:lp:14043710000103:2026-07.",
  },
  {
    lote: "duplicadas",
    id: "f950e6d4-7d54-42f5-8afa-79fe48bc1cab",
    empresa: "EDUCACAO E DIREITO TREINAMENTO LTDA",
    portalClientId: "53558216-4a79-4762-b693-bad459a38ef6",
    competencia: "2026-05",
    valorEsperado: 645.15,
    vencimentoEsperado: "2026-06-25",
    substitutaId: "560e5ce4-f268-449f-b494-fcb8f302af6b",
    exigirMesmoValorNaSubstituta: true,
    // ⚠ AQUI A SUBSTITUTA NÃO É `tipo:"OUTRA"` — é `tipo:"PIS"`, `source:"UPLOAD"`.
    // Apurado em 22/08/2026: o contador BAIXOU o DARF do e-CAC e subiu à mão em 11/06/2026 13:24
    // (arquivo GuiaPagamento_46848383000153_052026_1106202610233030591.pdf), 29 min ANTES de a
    // captura de INSS gravar o fantasma às 13:53. O PDF dela traz a MESMA composição
    // (COFINS 530,26 + PIS 114,89 = 645,15) — mesma dívida —, mas outro número de documento
    // (07.16.26162.6834456-1 contra 07.16.26162.7041922-0): são duas EMISSÕES do mesmo débito.
    // Ela já foi ENVIADA ao cliente (emailStatus=SENT) e já gerou a PROVISÃO da competência
    // (PROVISAO/PIS_COFINS/DARF_PIS, R$ 645,15).
    // ⚠⚠ POR ISSO 2026-05 NÃO ENTRA NA CAPTURA DO LP: rodar a captura aqui criaria uma SEGUNDA
    // provisão (PIS 114,89 + COFINS 530,26) por cima da que já existe. Aqui é só excluir.
    nota: "Substituta = guia MANUAL tipo:PIS (upload do contador), já enviada e já provisionada.",
  },

  // ---------- LOTE "orfas": ⚠ a substituta NÃO EXISTE AINDA. Rodar a captura do LP ANTES. ----------
  {
    lote: "orfas",
    id: "989de4b5-d9dc-4454-aa0d-5fd1be926909",
    empresa: "EDUCACAO E DIREITO TREINAMENTO LTDA",
    portalClientId: "53558216-4a79-4762-b693-bad459a38ef6",
    competencia: "2026-01",
    valorEsperado: 54.52,
    vencimentoEsperado: "2026-02-25",
    substitutaSourceFileId: "serpro:dctfweb:lp:46848383000153:2026-01",
    // ⚠ O DARF reemitido meses depois pode vir com juros/multa — valor MAIOR é NORMAL aqui.
    // Por isso não se exige igualdade de valor; o ensaio imprime a diferença para conferência.
    exigirMesmoValorNaSubstituta: false,
    nota: "Guia errada é o ÚNICO registro deste DARF. NUNCA apagar antes de a substituta existir.",
  },
  {
    lote: "orfas",
    id: "d17406ae-482d-4999-9221-4e9bcca792a2",
    empresa: "EDUCACAO E DIREITO TREINAMENTO LTDA",
    portalClientId: "53558216-4a79-4762-b693-bad459a38ef6",
    competencia: "2026-02",
    valorEsperado: 36.34,
    vencimentoEsperado: "2026-03-25",
    substitutaSourceFileId: "serpro:dctfweb:lp:46848383000153:2026-02",
    exigirMesmoValorNaSubstituta: false,
    nota: "Guia errada é o ÚNICO registro deste DARF.",
  },
  {
    lote: "orfas",
    id: "3b1989f8-373d-469c-90aa-7d00f8d7dd4e",
    empresa: "EDUCACAO E DIREITO TREINAMENTO LTDA",
    portalClientId: "53558216-4a79-4762-b693-bad459a38ef6",
    competencia: "2026-03",
    valorEsperado: 740.89,
    vencimentoEsperado: "2026-04-24",
    substitutaSourceFileId: "serpro:dctfweb:lp:46848383000153:2026-03",
    exigirMesmoValorNaSubstituta: false,
    nota: "Único registro. PDF traz os QUATRO tributos (COFINS/PIS/IRPJ/CSLL).",
  },
  {
    lote: "orfas",
    id: "6e33f6f4-1dac-4f61-b2cf-44385c33359f",
    empresa: "EDUCACAO E DIREITO TREINAMENTO LTDA",
    portalClientId: "53558216-4a79-4762-b693-bad459a38ef6",
    competencia: "2026-04",
    valorEsperado: 134.61,
    vencimentoEsperado: "2026-05-25",
    substitutaSourceFileId: "serpro:dctfweb:lp:46848383000153:2026-04",
    exigirMesmoValorNaSubstituta: false,
    nota: "Guia errada é o ÚNICO registro deste DARF.",
  },
]);

// =============================================================================================
const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.split("=").slice(1).join("=") : null;
};
const tem = (n) => process.argv.includes(`--${n}`);

const EXECUTAR = tem("executar");
const LOTE = (arg("lote") || "duplicadas").toLowerCase();
const SO_GUIA = arg("guia");

const money = (v) => (v == null ? "—" : Number(v).toFixed(2));
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const ts = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// ⚠ Decimal do Prisma tem de virar STRING, não a estrutura interna do decimal.js (`{s,e,d}`).
// Medido: o `v.constructor.name === "Decimal"` NÃO fecha — o nome vem minificado do runtime — e o
// objeto caía no percurso genérico. Quem prova que é Decimal é o par de métodos `toFixed`+`toNumber`
// (Date não tem, Buffer não tem, objeto de JSON não tem). Um valor em dinheiro gravado como estrutura
// interna de biblioteca é um valor que ninguém relê para restaurar.
function ehDecimal(v) {
  return typeof v.toFixed === "function" && typeof v.toNumber === "function" && typeof v.toString === "function";
}

function jsonSafe(v) {
  if (v == null) return v;
  if (Buffer.isBuffer(v)) return { __bytea_base64__: v.toString("base64"), __bytes__: v.length };
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (typeof v === "object") {
    if (ehDecimal(v)) return v.toString();
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

async function main() {
  const pdfParse = (await import("pdf-parse")).default;

  let alvo = ALVO.filter((a) => LOTE === "todas" || a.lote === LOTE);
  if (SO_GUIA) alvo = alvo.filter((a) => a.id === SO_GUIA);
  if (!alvo.length) {
    console.log(`Nada a fazer: lote="${LOTE}"${SO_GUIA ? ` guia="${SO_GUIA}"` : ""} não casou com nenhum alvo.`);
    return;
  }

  const outPath = path.resolve(arg("out") || `./backup-guias-inss-fantasma-${LOTE}-${ts()}.json`);

  console.log("=".repeat(96));
  console.log(EXECUTAR ? "⚠⚠  MODO EXECUÇÃO — VAI APAGAR  ⚠⚠" : "MODO ENSAIO (--dry-run é o padrão) — NADA SERÁ APAGADO");
  console.log(`lote=${LOTE}  alvos=${alvo.length}  despejo=${outPath}`);
  console.log("=".repeat(96));

  const despejo = { geradoEm: new Date().toISOString(), lote: LOTE, modo: EXECUTAR ? "EXECUCAO" : "ENSAIO", guias: [] };
  const resultados = [];

  for (const a of alvo) {
    console.log(`\n${"-".repeat(96)}`);
    console.log(`ALVO ${a.empresa} — ${a.competencia} — R$ ${money(a.valorEsperado)} — id=${a.id}`);
    console.log(`  ${a.nota}`);

    const motivosParaPular = [];

    // ---------- RECONFERÊNCIA 1: a guia ainda é a que pensamos? ----------
    const g = await prisma.guide.findUnique({
      where: { id: a.id },
      select: {
        id: true, portalClientId: true, competencia: true, tipo: true, status: true, source: true,
        valor: true, vencimento: true, pdfBytes: true, paymentStatus: true, emailStatus: true,
        emailSentAt: true, liberadaCliente: true, parcelamentoId: true, sourceFileId: true,
      },
    });
    if (!g) {
      console.log(`  ✖ NÃO EXISTE MAIS (já apagada?) — PULA.`);
      resultados.push({ id: a.id, acao: "PULOU", motivo: "guia_inexistente" });
      continue;
    }
    const conf = [];
    if (g.tipo !== "INSS") motivosParaPular.push(`tipo mudou: ${g.tipo} (esperado INSS)`);
    if (g.status !== "PROCESSED") motivosParaPular.push(`status mudou: ${g.status} (esperado PROCESSED)`);
    if (g.portalClientId !== a.portalClientId) motivosParaPular.push(`portalClientId mudou`);
    if (g.competencia !== a.competencia) motivosParaPular.push(`competência mudou: ${g.competencia}`);
    if (Math.abs(Number(g.valor) - a.valorEsperado) >= 0.005) motivosParaPular.push(`valor mudou: ${money(g.valor)} (esperado ${money(a.valorEsperado)})`);
    if (dia(g.vencimento) !== a.vencimentoEsperado) motivosParaPular.push(`vencimento mudou: ${dia(g.vencimento)} (esperado ${a.vencimentoEsperado})`);
    if (g.paymentStatus === "PAID") motivosParaPular.push(`⚠ guia foi CONFIRMADA COMO PAGA (paymentStatus=PAID) — não apagar`);
    if (g.emailStatus === "SENT" || g.emailSentAt) motivosParaPular.push(`⚠ guia FOI ENVIADA ao cliente (emailStatus=${g.emailStatus}, emailSentAt=${dia(g.emailSentAt)}) — não apagar em silêncio`);
    if (g.liberadaCliente) motivosParaPular.push(`⚠ guia está LIBERADA no app do cliente — não apagar em silêncio`);
    if (g.parcelamentoId) motivosParaPular.push(`⚠ guia é PARCELA de parcelamento (${g.parcelamentoId}) — não apagar`);
    conf.push(`tipo=${g.tipo} status=${g.status} valor=${money(g.valor)} venc=${dia(g.vencimento)} pay=${g.paymentStatus} email=${g.emailStatus} liberada=${g.liberadaCliente}`);
    console.log(`  estado atual: ${conf.join(" | ")}`);

    // ---------- RECONFERÊNCIA 2: o PDF continua provando que não é previdenciário? ----------
    let tributos = null;
    let itens = [];
    if (!g.pdfBytes || !g.pdfBytes.length) {
      motivosParaPular.push(`sem pdfBytes — impossível reconfirmar pelo documento`);
    } else {
      try {
        const texto = String((await pdfParse(Buffer.from(g.pdfBytes)))?.text || "");
        const comp = parseArrecadacaoComposicao(texto);
        itens = comp.itens;
        tributos = tributosSeNaoForPrevidenciario(comp.itens);
      } catch (e) {
        motivosParaPular.push(`PDF não parseou: ${e?.message || e}`);
      }
      if (!tributos) motivosParaPular.push(`⚠ o PDF NÃO prova mais que o documento é não-previdenciário (tributosSeNaoForPrevidenciario => null) — NÃO APAGAR`);
    }
    console.log(`  PDF diz: ${itens.map((i) => `${i.codigo} ${i.denominacao || ""} ${money(i.total)}`).join(" | ") || "(não parseou)"}`);
    console.log(`  => não-previdenciário? ${tributos ? `SIM (${tributos.join("/")})` : "NÃO CONSIGO AFIRMAR"}`);

    // ---------- RECONFERÊNCIA 3: a substituta existe e está boa? ----------
    let sub = null;
    if (a.substitutaId) {
      sub = await prisma.guide.findUnique({
        where: { id: a.substitutaId },
        select: { id: true, tipo: true, status: true, valor: true, vencimento: true, competencia: true, portalClientId: true, source: true, sourceFileId: true, extracted: true, emailStatus: true },
      });
      if (!sub) motivosParaPular.push(`⚠ SUBSTITUTA ${a.substitutaId} NÃO EXISTE — NÃO APAGAR`);
    } else if (a.substitutaSourceFileId) {
      sub = await prisma.guide.findUnique({
        where: { sourceFileId: a.substitutaSourceFileId },
        select: { id: true, tipo: true, status: true, valor: true, vencimento: true, competencia: true, portalClientId: true, source: true, sourceFileId: true, extracted: true, emailStatus: true },
      });
      if (!sub) motivosParaPular.push(`⚠ SUBSTITUTA (${a.substitutaSourceFileId}) AINDA NÃO EXISTE — rodar a captura do Lucro Presumido ANTES. NÃO APAGAR.`);
    }
    if (sub) {
      if (sub.status !== "PROCESSED") motivosParaPular.push(`⚠ substituta não está PROCESSED (${sub.status})`);
      if (sub.competencia !== a.competencia) motivosParaPular.push(`⚠ substituta é de outra competência (${sub.competencia})`);
      if (sub.portalClientId !== a.portalClientId) motivosParaPular.push(`⚠ substituta é de outra empresa`);
      if (sub.id === g.id) motivosParaPular.push(`⚠ substituta é a PRÓPRIA guia — erro de configuração`);
      if (a.exigirMesmoValorNaSubstituta) {
        if (Math.abs(Number(sub.valor) - Number(g.valor)) >= 0.005) motivosParaPular.push(`⚠ substituta tem valor diferente (${money(sub.valor)} × ${money(g.valor)}) e este alvo exige igualdade`);
        if (dia(sub.vencimento) !== dia(g.vencimento)) motivosParaPular.push(`⚠ substituta tem vencimento diferente (${dia(sub.vencimento)} × ${dia(g.vencimento)})`);
      } else {
        // Órfã pós-captura: a substituta TEM de ser a guia consolidada do LP, com composição só de
        // códigos não-previdenciários. Valor pode divergir (juros/multa de reemissão) — só reporta.
        if (sub.tipo !== "OUTRA") motivosParaPular.push(`⚠ substituta não é tipo:"OUTRA" (${sub.tipo}) — a captura do LP grava OUTRA`);
        const compo = Array.isArray(sub.extracted?.composicao) ? sub.extracted.composicao : [];
        if (!compo.length) motivosParaPular.push(`⚠ substituta sem composição em extracted.composicao`);
        else {
          const naoPrev = tributosSeNaoForPrevidenciario(compo.map((c) => ({ codigo: c.codigo })));
          if (!naoPrev) motivosParaPular.push(`⚠ composição da substituta tem código fora de 8109/2172/2089/2372`);
        }
        const dif = Number(sub.valor) - Number(g.valor);
        if (Math.abs(dif) >= 0.005) console.log(`  ⚠ CONFERIR: substituta R$ ${money(sub.valor)} × errada R$ ${money(g.valor)} (diferença ${money(dif)}) — reemissão com juros/multa é NORMAL, mas o orquestrador tem de olhar.`);
      }
      console.log(`  SUBSTITUTA: id=${sub.id} tipo=${sub.tipo} status=${sub.status} source=${sub.source} valor=${money(sub.valor)} venc=${dia(sub.vencimento)} email=${sub.emailStatus}`);
      console.log(`              sourceFileId=${sub.sourceFileId}`);
      console.log(`              composicao=${JSON.stringify(sub.extracted?.composicao ?? null)}`);
    } else {
      console.log(`  SUBSTITUTA: NÃO ENCONTRADA`);
    }

    // ---------- RECONFERÊNCIA 4: o que a exclusão arrasta ----------
    const entries = await prisma.accountingEntry.findMany({
      where: { sourceGuideId: g.id },
      select: { id: true, tipo: true, subtipo: true, eventType: true, competencia: true, status: true },
    });
    const envios = await prisma.envioGuia.findMany({ where: { guideId: g.id }, select: { id: true, canal: true, status: true, destino: true, enviadoEm: true } }).catch(() => []);
    const taxDocs = await prisma.taxDocument.findMany({ where: { guideId: g.id }, select: { id: true, sourceFileName: true, contentHash: true } }).catch(() => []);
    const tribParc = await prisma.tributoParcela.findMany({ where: { guideId: g.id }, select: { id: true, codigoTributo: true } }).catch(() => []);
    const parcelas = await prisma.parcela.findMany({ where: { guiaId: g.id }, select: { id: true } }).catch(() => []);

    console.log(`  ARRASTA:`);
    console.log(`     accounting_entries (FK sourceGuideId, onDelete:SetNull → o lançamento FICA, perde o vínculo): ${entries.length}${entries.length ? " -> " + entries.map((e) => `${e.id} ${e.tipo}/${e.subtipo}/${e.eventType}`).join(" ; ") : ""}`);
    console.log(`     envios_guia (onDelete:CASCADE → APAGA JUNTO): ${envios.length}${envios.length ? " -> " + envios.map((e) => `${e.canal}/${e.status}`).join(" ; ") : ""}`);
    console.log(`     tributos_parcela (onDelete:CASCADE → APAGA JUNTO): ${tribParc.length}`);
    console.log(`     documents/TaxDocument (onDelete:SetNull → FICA): ${taxDocs.length}`);
    console.log(`     parcelas.guiaId (onDelete:SetNull → FICA): ${parcelas.length}`);

    // ⚠ Lançamento contábil vinculado é BLOQUEIO: apagar a guia deixaria a provisão órfã (SetNull),
    // e a decisão do dono foi tomada sobre a medição "zero lançamentos".
    if (entries.length) motivosParaPular.push(`⚠ a guia TEM ${entries.length} lançamento(s) contábil(is) — a decisão do dono foi tomada sobre "zero". NÃO APAGAR sem nova decisão.`);

    // A circular NÃO tem FK para a guia: não é arrastada. Fica como está (o dono decidiu isso para
    // os marcadores VAZIO; a circular não foi objeto de decisão — ver relatório).
    const circ = await prisma.companyMonthlyCircular.findUnique({
      where: { portalClientId_competencia: { portalClientId: g.portalClientId, competencia: g.competencia } },
      select: { id: true, inssTotal: true, inssStatus: true, acrescimos: true },
    }).catch(() => null);
    console.log(`     CompanyMonthlyCircular: NÃO tem FK para Guide → NÃO é arrastada.`);
    console.log(`        id=${circ?.id ?? "—"} inssTotal=${money(circ?.inssTotal)} inssStatus=${circ?.inssStatus ?? "—"} acrescimos=${JSON.stringify(circ?.acrescimos ?? null)}`);
    console.log(`        ⚠ ESTES CAMPOS CONTINUAM AFIRMANDO INSS DEPOIS DA EXCLUSÃO. Fora do escopo desta correção.`);

    // Marcadores VAZIO da competência — só para provar que NÃO são tocados.
    const vazios = await prisma.guide.findMany({
      where: { portalClientId: g.portalClientId, competencia: g.competencia, status: "VAZIO" },
      select: { id: true, tipo: true },
    });
    console.log(`     marcadores VAZIO na competência: ${vazios.length ? vazios.map((v) => `${v.tipo}(${v.id})`).join(" ") : "nenhum"} — ⚠ NÃO SÃO TOCADOS (decisão do dono: "deixar como está").`);

    // ---------- VEREDITO ----------
    if (motivosParaPular.length) {
      console.log(`\n  ✖ PULA. Motivo(s):`);
      for (const m of motivosParaPular) console.log(`       - ${m}`);
      resultados.push({ id: a.id, empresa: a.empresa, competencia: a.competencia, acao: "PULOU", motivos: motivosParaPular });
      continue;
    }

    console.log(`\n  ✔ CONDIÇÕES OK — ${EXECUTAR ? "VAI APAGAR" : "APAGARIA (ensaio: não apaga)"}.`);

    // ---------- DESPEJO INTEGRAL (todas as colunas + PDF em base64) ----------
    const bruto = await prisma.$queryRawUnsafe(`SELECT * FROM "Guide" WHERE id = $1`, g.id);
    const linha = Array.isArray(bruto) ? bruto[0] : null;
    if (!linha) {
      console.log(`  ✖ despejo falhou: SELECT * não devolveu a linha. PULA (sem cópia não se apaga).`);
      resultados.push({ id: a.id, acao: "PULOU", motivos: ["despejo_falhou"] });
      continue;
    }
    const guideDump = jsonSafe(linha);
    if (guideDump.pdfBytes && guideDump.pdfBytes.__bytea_base64__) {
      guideDump.pdfBytes_base64 = guideDump.pdfBytes.__bytea_base64__;
      guideDump.pdfBytes_bytes = guideDump.pdfBytes.__bytes__;
      delete guideDump.pdfBytes;
    }
    despejo.guias.push({
      alvo: a,
      guide: guideDump,
      relacionados: {
        accounting_entries_que_perdem_o_vinculo: jsonSafe(entries),
        envios_guia_apagados_em_cascata: jsonSafe(envios),
        tributos_parcela_apagados_em_cascata: jsonSafe(tribParc),
        documents_que_perdem_o_vinculo: jsonSafe(taxDocs),
        parcelas_que_perdem_o_vinculo: jsonSafe(parcelas),
        circular_nao_tocada: jsonSafe(circ),
        marcadores_vazio_nao_tocados: jsonSafe(vazios),
      },
      substituta: jsonSafe(sub),
      pdf_composicao_reconferida: jsonSafe(itens),
    });

    resultados.push({
      id: a.id, empresa: a.empresa, competencia: a.competencia,
      acao: EXECUTAR ? "APAGAR" : "APAGARIA",
      substitutaId: sub?.id ?? null,
      cascata: { envios_guia: envios.length, tributos_parcela: tribParc.length },
      setNull: { accounting_entries: entries.length, documents: taxDocs.length, parcelas: parcelas.length },
    });
  }

  // ---------- GRAVA O DESPEJO ANTES DE QUALQUER DELETE ----------
  if (despejo.guias.length) {
    fs.writeFileSync(outPath, JSON.stringify(despejo, null, 2), "utf8");
    const conferido = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (!Array.isArray(conferido.guias) || conferido.guias.length !== despejo.guias.length) {
      throw new Error("Despejo gravado não confere ao ser relido — ABORTADO antes de apagar qualquer coisa.");
    }
    console.log(`\nDespejo gravado e relido com sucesso: ${outPath} (${despejo.guias.length} guia(s), ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log(`\nNenhuma guia passou nas condições — despejo não foi gravado.`);
  }

  // ---------- DELETE (só com --executar) ----------
  if (EXECUTAR && despejo.guias.length) {
    console.log(`\n${"=".repeat(96)}\nAPAGANDO ${despejo.guias.length} guia(s)...`);
    for (const item of despejo.guias) {
      const id = item.alvo.id;
      // Reconferência FINAL, imediatamente antes do DELETE: nada mudou desde a checagem acima?
      const ainda = await prisma.guide.findUnique({ where: { id }, select: { tipo: true, status: true, valor: true } });
      if (!ainda || ainda.tipo !== "INSS" || ainda.status !== "PROCESSED") {
        console.log(`   ✖ ${id}: mudou entre a checagem e o DELETE (${ainda ? `${ainda.tipo}/${ainda.status}` : "sumiu"}) — PULA.`);
        continue;
      }
      const ents = await prisma.accountingEntry.count({ where: { sourceGuideId: id } });
      if (ents > 0) {
        console.log(`   ✖ ${id}: ganhou ${ents} lançamento(s) contábil(is) entre a checagem e o DELETE — PULA.`);
        continue;
      }
      await prisma.guide.delete({ where: { id } });
      console.log(`   ✔ apagada: ${id} (${item.alvo.empresa} ${item.alvo.competencia})`);
    }
  }

  // ---------- RESUMO ----------
  console.log(`\n${"=".repeat(96)}\nRESUMO (${EXECUTAR ? "EXECUÇÃO" : "ENSAIO"})`);
  for (const r of resultados) {
    console.log(`  ${String(r.acao).padEnd(9)} ${String(r.competencia ?? "").padEnd(8)} ${String(r.empresa ?? "").slice(0, 36).padEnd(36)} ${r.id}`);
    if (r.motivos) for (const m of r.motivos) console.log(`             ${m}`);
  }
  const apagaria = resultados.filter((r) => r.acao === "APAGAR" || r.acao === "APAGARIA").length;
  console.log(`\n  ${EXECUTAR ? "apagadas" : "seriam apagadas"}: ${apagaria}   puladas: ${resultados.filter((r) => r.acao === "PULOU").length}`);
  if (!EXECUTAR) console.log(`\n  Isto foi um ENSAIO. Para executar de verdade, acrescente --executar.`);
}

main()
  .catch((e) => { console.error("FALHOU:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
