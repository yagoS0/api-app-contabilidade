// O VENCIMENTO DO DAS QUE ESTÁ GRAVADO NO `rawPayload` E NUNCA CHEGOU À COLUNA.
//
// ⚠⚠ ENSAIO POR PADRÃO. Só grava com `--aplicar`.
//
// ─── POR QUE ESTE SCRIPT EXISTE ──────────────────────────────────────────────────────────────
//
// `parsePossibleDate` não conhecia o formato compacto `AAAAMMDD` — que é exatamente como o SERPRO
// manda `dados[].detalhamentoDas.dataVencimento` ("20260622"). `new Date("20260622")` é **Invalid
// Date**, o guarda de `NaN` devolvia `null`, e o vencimento sumia **sem erro nenhum**.
//
// Medido em 21/08/2026: `Guide.vencimento` NULO em **51 de 67** guias de SIMPLES processadas, com a
// data presente em **51 de 51** dos payloads guardados. O parser **já foi consertado** (o ramo
// compacto está em `CaptureSerproGuidesService.js`), então guias capturadas daqui para frente
// nascem certas — mas **as 51 históricas continuam nulas**, e nada as conserta sozinho.
//
// ⚠⚠ E A CONSEQUÊNCIA É SILENCIOSA, EM DOIS LUGARES:
//   · `CalendarioFiscalService` filtra por `vencimento` ⇒ essas guias **não aparecem no calendário
//     fiscal**. Guia que não aparece é guia que não é paga.
//   · `GET /client/companies/:id/fluxo` filtra por `vencimento: { not: null }` ⇒ elas **somem do
//     fluxo de caixa do cliente**. É o item mais caro do mês de quem é do Simples.
//
// ─── O QUE ELE FAZ, E O QUE NÃO FAZ ──────────────────────────────────────────────────────────
//
// ⚠ **ZERO CHAMADA AO SERPRO.** A data já está no disco, em `Guide.extracted.rawPayload`. Este
//   script lê o que foi guardado e preenche a coluna — nada sai para a rede.
//
// ⚠ **SÓ PREENCHE NULO. NUNCA SOBRESCREVE.** O `where` exige `vencimento: null` e o `updateMany`
//   repete a condição, então uma data posta à mão por alguém não é tocada nem numa corrida.
//
// ⚠ **REUSA `parsePossibleDate`**, não reescreve. O `diag-vencimento-das-recuperavel.mjs` tem uma
//   leitura própria (`dataAaaammdd`) porque nasceu antes do conserto; duplicar aqui daria uma
//   TERCEIRA leitura da mesma data, e elas divergiriam na primeira correção.
//
// ⚠⚠ **AVISE O DONO ANTES DE `--aplicar`.** No instante em que isto gravar, **51 guias de DAS
//   aparecem no calendário fiscal** — uma tela que ninguém pediu para mudar muda sozinha. É a
//   mudança certa, mas ela tem de ser anunciada, não descoberta.
//
// ─── COMO CONFERIR ───────────────────────────────────────────────────────────────────────────
//
//   node apps/api/scripts/backfill-vencimento-das.mjs              # ensaio: diz o que gravaria
//   node apps/api/scripts/backfill-vencimento-das.mjs --aplicar    # grava
//   node apps/api/scripts/backfill-vencimento-das.mjs              # ⚠ tem de dizer "a gravar: 0"
//   node apps/api/scripts/diag-vencimento-das-recuperavel.mjs      # a conferência independente

// ⚠ O singleton (`db/prisma.js`), como fazem 98 dos scripts desta pasta — não um `new PrismaClient`
// próprio. Os 28 que instanciam o seu são anteriores à convenção.
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parsePossibleDate } from "../src/application/fiscal/serpro/CaptureSerproGuidesService.js";

const aplicar = process.argv.includes("--aplicar");
const LOTE = 500;

/**
 * Achata um objeto em pares `caminho → valor`, entrando em JSON serializado como texto.
 *
 * ⚠ É a MESMA função do `diag-vencimento-das-recuperavel.mjs`, copiada de propósito: são dois
 * SCRIPTS (não código de produção), e um `lib/` compartilhado entre scripts de diagnóstico seria
 * abstração para dois chamadores. A cópia está declarada aqui para quem mexer num saber do outro.
 */
function achatar(obj, prefixo = "", saida = []) {
  if (obj == null) return saida;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { return achatar(JSON.parse(t), prefixo, saida); } catch { /* é texto mesmo */ }
    }
    saida.push([prefixo, obj]);
    return saida;
  }
  if (typeof obj !== "object") { saida.push([prefixo, obj]); return saida; }
  for (const [k, v] of Object.entries(obj)) achatar(v, prefixo ? `${prefixo}.${k}` : k, saida);
  return saida;
}

/** A data do payload, ou `null` com o motivo. ⚠ Nunca devolve "hoje" nem inventa. */
function vencimentoDoPayload(guide) {
  const pares = achatar(guide?.extracted?.rawPayload || {});
  const par = pares.find(([k]) => /detalhamentoDas\.dataVencimento$/i.test(k));
  if (!par) return { data: null, motivo: "sem `detalhamentoDas.dataVencimento` no payload" };
  const data = parsePossibleDate(par[1]);
  if (!data) return { data: null, motivo: `data ilegível: ${JSON.stringify(par[1])}` };
  return { data, motivo: null };
}

async function main() {
  console.log(`[backfill-vencimento-das] ${aplicar ? "APLICANDO" : "ENSAIO (nada será gravado)"}`);
  console.log("[backfill-vencimento-das] zero chamada ao SERPRO — a data já está no rawPayload\n");

  // ⚠ O mesmo recorte do diagnóstico: SIMPLES, sem vencimento, já processadas (ou com erro, que
  // também guardaram payload). `VAZIO` fica de fora — ali a ausência de vencimento é legítima.
  const where = {
    tipo: "SIMPLES",
    vencimento: null,
    status: { in: ["PROCESSED", "ERROR"] },
  };

  const total = await prisma.guide.count({ where });
  console.log(`guias de SIMPLES sem vencimento: ${total}`);
  if (total === 0) {
    console.log("\na gravar: 0");
    return;
  }

  let cursor = null;
  let lidas = 0;
  let aGravar = 0;
  let gravadas = 0;
  const semPayload = [];
  const ilegiveis = [];

  for (;;) {
    const pagina = await prisma.guide.findMany({
      where,
      select: { id: true, competencia: true, portalClientId: true, extracted: true },
      orderBy: { id: "asc" },
      take: LOTE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!pagina.length) break;
    cursor = pagina[pagina.length - 1].id;
    lidas += pagina.length;

    for (const g of pagina) {
      const { data, motivo } = vencimentoDoPayload(g);
      if (!data) {
        (motivo.startsWith("sem ") ? semPayload : ilegiveis).push({ id: g.id, competencia: g.competencia, motivo });
        continue;
      }
      aGravar += 1;
      if (!aplicar) continue;

      // ⚠ `updateMany` com `vencimento: null` no `where` — a condição é REPETIDA na escrita, para
      // que uma data gravada entre a leitura e este ponto não seja sobrescrita.
      const r = await prisma.guide.updateMany({
        where: { id: g.id, vencimento: null },
        data: { vencimento: data },
      });
      gravadas += r.count;
    }
  }

  console.log(`lidas: ${lidas}`);
  console.log(`\na gravar: ${aGravar}`);
  if (aplicar) console.log(`gravadas: ${gravadas}`);

  // ⚠ O que NÃO foi recuperado sai NOMEADO — silêncio aqui viraria "o backfill resolveu tudo".
  if (semPayload.length) {
    console.log(`\nsem a data no payload (não recuperáveis por aqui): ${semPayload.length}`);
    for (const x of semPayload.slice(0, 10)) console.log(`  ${x.competencia || "?"}  ${x.id}  ${x.motivo}`);
    if (semPayload.length > 10) console.log(`  … e mais ${semPayload.length - 10}`);
  }
  if (ilegiveis.length) {
    console.log(`\ncom data ILEGÍVEL no payload: ${ilegiveis.length}`);
    for (const x of ilegiveis.slice(0, 10)) console.log(`  ${x.competencia || "?"}  ${x.id}  ${x.motivo}`);
  }

  if (aplicar && gravadas > 0) {
    console.log(
      `\n⚠⚠ ${gravadas} guias de DAS passam a ter vencimento — elas APARECEM AGORA no calendário` +
      `\n   fiscal e no fluxo de caixa do cliente, telas que ninguém pediu para mudar.`
    );
  }
  if (!aplicar) console.log("\n[fim] ENSAIO — nada foi escrito. Use --aplicar para gravar.");
}

main()
  .catch((err) => { console.error("[backfill-vencimento-das] falhou:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
