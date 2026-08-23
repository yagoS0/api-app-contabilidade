// SOMENTE LEITURA. Não escreve, não chama SERPRO, não apaga.
//
// Fecha as três perguntas que sobraram antes de qualquer execução:
//   A. De onde nasceu a terceira linha de EDUCACAO 2026-05 (`tipo:"PIS"`, 645,15)?
//      — origem, arquivo, e se o PDF dela é o MESMO documento da guia INSS errada (sha256 + composição).
//   B. Como está o entorno de cada competência do alvo: TODAS as guias da empresa naquele mês
//      (inclusive os marcadores VAZIO, que NÃO serão tocados) e o estado da circular.
//   C. As pré-condições da captura do Lucro Presumido para as 4 órfãs:
//      regime da empresa (trava REGIME_INVALIDO_LP) e mês contábil fechado (trava MES_FECHADO).
//
//   node apps/api/scripts/diag-inss-fantasma-precondicoes.mjs

import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseArrecadacaoComposicao } from "../src/application/fiscal/serpro/parseArrecadacao.js";

const money = (v) => (v == null ? "—" : Number(v).toFixed(2));
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const ts = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—");
const sha = (buf) => (buf ? crypto.createHash("sha256").update(Buffer.from(buf)).digest("hex") : null);

// Os 6 ids reconfirmados pelo PDF em `diag-inss-fantasma-alvo.mjs`.
const ALVO = [
  { id: "989de4b5-d9dc-4454-aa0d-5fd1be926909", comp: "2026-01" },
  { id: "d17406ae-482d-4999-9221-4e9bcca792a2", comp: "2026-02" },
  { id: "3b1989f8-373d-469c-90aa-7d00f8d7dd4e", comp: "2026-03" },
  { id: "6e33f6f4-1dac-4f61-b2cf-44385c33359f", comp: "2026-04" },
  { id: "f950e6d4-7d54-42f5-8afa-79fe48bc1cab", comp: "2026-05" },
  { id: "43d2d0e9-dcde-464b-8538-446e4ca9e6bf", comp: "2026-07" },
];

async function main() {
  const pdfParse = (await import("pdf-parse")).default;

  const alvo = await prisma.guide.findMany({
    where: { id: { in: ALVO.map((a) => a.id) } },
    select: { id: true, portalClientId: true, competencia: true, tipo: true, valor: true, vencimento: true, pdfBytes: true, hash: true },
  });
  const pIds = [...new Set(alvo.map((g) => g.portalClientId))];
  const portais = await prisma.portalClient.findMany({
    where: { id: { in: pIds } },
    select: { id: true, razao: true, cnpj: true, companyId: true, hasProlabore: true, temFolha: true, status: true },
  });
  const legacy = await prisma.company.findMany({
    where: { id: { in: portais.map((p) => p.companyId).filter(Boolean) } },
    select: { id: true, razaoSocial: true, regimeTributario: true, tipoTributario: true },
  });
  const lMap = new Map(legacy.map((c) => [c.id, c]));

  // ================= C. PRÉ-CONDIÇÕES DA CAPTURA DO LP =================
  console.log("=".repeat(96));
  console.log("C. PRÉ-CONDIÇÕES DA CAPTURA DO LUCRO PRESUMIDO");
  console.log("=".repeat(96));
  for (const p of portais) {
    const l = p.companyId ? lMap.get(p.companyId) : null;
    const regime = String(l?.regimeTributario || l?.tipoTributario || "").trim().toUpperCase() || "(indefinido)";
    const passaTrava = regime === "LUCRO_PRESUMIDO" || regime === "LUCRO_REAL";
    console.log(`\n${p.razao} — CNPJ ${p.cnpj} — portalClientId=${p.id}`);
    console.log(`   regimeTributario=${l?.regimeTributario ?? "—"}  tipoTributario=${l?.tipoTributario ?? "—"}  status=${p.status}`);
    console.log(`   trava REGIME_INVALIDO_LP: ${passaTrava ? "PASSA ✔" : "BLOQUEIA ✖ (a captura recusaria)"}`);
    const rot = await prisma.companyRotina.findMany({
      where: { portalClientId: p.id }, select: { rotina: true, enabled: true },
    }).catch(() => []);
    console.log(`   rotinas: ${rot.map((r) => `${r.rotina}=${r.enabled}`).join(" ") || "(nenhuma linha)"}`);
    const proc = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "companies_monthly_circular" WHERE "portalClientId" = $1`, p.id,
    ).catch(() => null);
    if (proc) console.log(`   circulares existentes: ${proc[0]?.n}`);
  }

  console.log(`\nMÊS CONTÁBIL FECHADO (trava MES_FECHADO na rota /serpro/lp/capture):`);
  for (const a of alvo.sort((x, y) => x.competencia.localeCompare(y.competencia))) {
    const circ = await prisma.companyMonthlyCircular.findUnique({
      where: { portalClientId_competencia: { portalClientId: a.portalClientId, competencia: a.competencia } },
      select: { fechadoContabilEm: true, fechadoContabilPor: true, inssTotal: true, inssStatus: true, acrescimos: true },
    }).catch(() => null);
    const fechado = Boolean(circ?.fechadoContabilEm);
    const p = portais.find((x) => x.id === a.portalClientId);
    console.log(`   ${a.competencia}  ${(p?.razao || "").slice(0, 34).padEnd(34)}  fechadoContabilEm=${ts(circ?.fechadoContabilEm)}  => ${fechado ? "BLOQUEIA ✖ (reabrir antes)" : "PASSA ✔"}`);
    console.log(`             circular: inssTotal=${money(circ?.inssTotal)} inssStatus=${circ?.inssStatus ?? "—"} acrescimos=${JSON.stringify(circ?.acrescimos ?? null)}`);
  }

  // Já existe guia LP para a competência? (o worker pula quando existe; a rota manual faz upsert)
  console.log(`\nCHAVE DE IDEMPOTÊNCIA DA CAPTURA LP (Guide.sourceFileId = "serpro:dctfweb:lp:<cnpj>:<comp>"):`);
  for (const a of alvo.sort((x, y) => x.competencia.localeCompare(y.competencia))) {
    const p = portais.find((x) => x.id === a.portalClientId);
    const key = `serpro:dctfweb:lp:${String(p?.cnpj || "").replace(/\D+/g, "")}:${a.competencia}`;
    const existe = await prisma.guide.findUnique({ where: { sourceFileId: key }, select: { id: true, status: true, valor: true } });
    console.log(`   ${key}  =>  ${existe ? `JÁ EXISTE id=${existe.id} status=${existe.status} valor=${money(existe.valor)}` : "não existe (a captura CRIARIA)"}`);
    console.log(`      (a guia ERRADA usa a chave "serpro:dctfweb:${String(p?.cnpj || "").replace(/\D+/g, "")}:${a.competencia}" — chave DIFERENTE, não colidem)`);
  }

  // ================= B. ENTORNO DE CADA COMPETÊNCIA =================
  console.log("\n" + "=".repeat(96));
  console.log("B. TODAS AS GUIAS DA EMPRESA EM CADA COMPETÊNCIA DO ALVO (⚠ marcadores VAZIO NÃO SERÃO TOCADOS)");
  console.log("=".repeat(96));
  for (const a of alvo.sort((x, y) => x.competencia.localeCompare(y.competencia))) {
    const p = portais.find((x) => x.id === a.portalClientId);
    const todas = await prisma.guide.findMany({
      where: { portalClientId: a.portalClientId, competencia: a.competencia },
      select: {
        id: true, tipo: true, status: true, source: true, valor: true, vencimento: true,
        sourceFileId: true, emailStatus: true, paymentStatus: true, createdAt: true,
        vazioEm: true, vazioPor: true, liberadaCliente: true,
      },
      orderBy: { createdAt: "asc" },
    });
    console.log(`\n${p?.razao} — ${a.competencia} (${todas.length} guia(s))`);
    for (const g of todas) {
      const marca = g.id === a.id ? " <<< ERRADA (alvo)" : (g.status === "VAZIO" ? "  [VAZIO — NÃO TOCAR]" : "");
      console.log(`   ${g.tipo.padEnd(8)} ${g.status.padEnd(10)} ${g.source.padEnd(7)} R$${String(money(g.valor)).padStart(10)} venc=${dia(g.vencimento)} email=${String(g.emailStatus).padEnd(7)} criada=${ts(g.createdAt)} id=${g.id}${marca}`);
    }
  }

  // ================= A. A TERCEIRA LINHA DE 2026-05 =================
  console.log("\n" + "=".repeat(96));
  console.log("A. ORIGEM DA TERCEIRA LINHA — EDUCACAO 2026-05, tipo=\"PIS\", R$ 645,15");
  console.log("=".repeat(96));
  const inss05 = alvo.find((g) => g.competencia === "2026-05");
  const pis05 = await prisma.guide.findFirst({
    where: { portalClientId: inss05.portalClientId, competencia: "2026-05", tipo: "PIS" },
    select: {
      id: true, tipo: true, status: true, source: true, sourceFileId: true, sourcePath: true, hash: true,
      valor: true, valorOriginal: true, vencimento: true, extracted: true, errors: true, pdfBytes: true,
      emailStatus: true, emailSentAt: true, emailAttempts: true, paymentStatus: true,
      reviewedByUserId: true, reviewedAt: true, liberadaCliente: true, liberadaPor: true,
      storageProvider: true, storageKey: true, driveFinalFileId: true,
      createdAt: true, updatedAt: true,
    },
  });
  if (!pis05) {
    console.log("   NÃO ENCONTRADA — reavaliar.");
  } else {
    console.log(`   id=${pis05.id}`);
    console.log(`   source=${pis05.source}  sourceFileId=${pis05.sourceFileId}  sourcePath=${pis05.sourcePath ?? "—"}`);
    console.log(`   storageProvider=${pis05.storageProvider ?? "—"} storageKey=${pis05.storageKey ?? "—"} driveFinalFileId=${pis05.driveFinalFileId ?? "—"}`);
    console.log(`   valor=${money(pis05.valor)} valorOriginal=${money(pis05.valorOriginal)} venc=${dia(pis05.vencimento)} status=${pis05.status}`);
    console.log(`   emailStatus=${pis05.emailStatus} emailSentAt=${ts(pis05.emailSentAt)} tentativas=${pis05.emailAttempts} paymentStatus=${pis05.paymentStatus}`);
    console.log(`   liberadaCliente=${pis05.liberadaCliente} liberadaPor=${pis05.liberadaPor ?? "—"} reviewedByUserId=${pis05.reviewedByUserId ?? "—"} reviewedAt=${ts(pis05.reviewedAt)}`);
    console.log(`   criada=${ts(pis05.createdAt)}  atualizada=${ts(pis05.updatedAt)}`);
    console.log(`   extracted (íntegro) = ${JSON.stringify(pis05.extracted)}`);
    console.log(`   errors = ${JSON.stringify(pis05.errors)}`);

    if (pis05.reviewedByUserId || pis05.liberadaPor) {
      const uid = pis05.reviewedByUserId || pis05.liberadaPor;
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, name: true, email: true, role: true } }).catch(() => null);
      console.log(`   quem registrou: ${u ? `${u.name} <${u.email}> role=${u.role}` : "(usuário não encontrado)"}`);
    }

    const shaPis = sha(pis05.pdfBytes);
    const shaInss = sha(inss05.pdfBytes);
    console.log(`\n   É O MESMO DOCUMENTO?`);
    console.log(`      sha256(pdfBytes) PIS   = ${shaPis}  (${pis05.pdfBytes?.length ?? 0} bytes)`);
    console.log(`      sha256(pdfBytes) INSS  = ${shaInss}  (${inss05.pdfBytes?.length ?? 0} bytes)`);
    console.log(`      bytes idênticos: ${shaPis && shaPis === shaInss ? "SIM" : "NÃO"}`);
    if (pis05.pdfBytes) {
      const texto = String((await pdfParse(Buffer.from(pis05.pdfBytes)))?.text || "");
      const comp = parseArrecadacaoComposicao(texto);
      console.log(`      composição impressa no PDF do "PIS": ${comp.itens.map((i) => `${i.codigo} ${i.denominacao || ""} total=${money(i.total)}`).join(" | ") || "(não parseou)"}`);
      console.log(`      total impresso: ${money(comp.totais?.total)}`);
      const nDoc = texto.match(/(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)/);
      console.log(`      número do documento no PDF do "PIS": ${nDoc ? nDoc[1] : "(não encontrado)"}`);
      const textoInss = String((await pdfParse(Buffer.from(inss05.pdfBytes)))?.text || "");
      const nDocInss = textoInss.match(/(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)/);
      console.log(`      número do documento no PDF do "INSS": ${nDocInss ? nDocInss[1] : "(não encontrado)"}`);
      console.log(`      MESMO NÚMERO DE DOCUMENTO: ${nDoc && nDocInss && nDoc[1] === nDocInss[1] ? "SIM — é o MESMO DARF" : "NÃO / indeterminado"}`);
    }
    const envs = await prisma.envioGuia.findMany({ where: { guideId: pis05.id }, select: { canal: true, status: true, destino: true, enviadoEm: true } }).catch(() => []);
    console.log(`      envios_guia da linha "PIS": ${envs.length ? envs.map((e) => `${e.canal}/${e.status}/${e.destino ?? "—"}/${dia(e.enviadoEm)}`).join(" ; ") : "nenhuma linha (mas emailStatus diz " + pis05.emailStatus + ")"}`);
    const ents = await prisma.accountingEntry.findMany({ where: { sourceGuideId: pis05.id }, select: { id: true, tipo: true, subtipo: true, eventType: true } }).catch(() => []);
    console.log(`      lançamentos contábeis originados na linha "PIS": ${ents.length ? ents.map((e) => `${e.tipo}/${e.subtipo}/${e.eventType}`).join(" ; ") : "NENHUM"}`);
  }
}

main()
  .catch((e) => { console.error("FALHOU:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
