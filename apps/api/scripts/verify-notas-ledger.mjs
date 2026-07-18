// Verificação offline do ledger append-only (Robustez NFS-e/ADN — Fase 1).
// Rodar de dentro de apps/api com o banco no ar e o client já gerado:
//   node scripts/verify-notas-ledger.mjs
// Prova: idempotência (re-append = 0 dup), evento-antes-da-nota, projeção CANCELADA/SUBSTITUIDA,
// e detecção de gap (recebe 1048 e 1050 → grava 1049 aberto). Limpa o que criou no fim.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { appendDocumento, appendEvento, avancarWatermark } from "../src/application/notas/ledger/LedgerService.js";
import { computeSituacao, projetarSituacao } from "../src/application/notas/ledger/LedgerProjectionService.js";
import { detectarGaps } from "../src/application/notas/ledger/NsuGapService.js";

const CID = "__verify_ledger__"; // portalClientId sintético (não referencia PortalClient real)
const FONTE = "ADN";
const CHAVE_A = "35260700000000000000550010000000011000000001"; // vira CANCELADA
const CHAVE_B = "35260700000000000000550010000000022000000002"; // vira SUBSTITUIDA
const CHAVE_C = "35260700000000000000550010000000033000000003"; // evento antes da nota

let ok = true;
function check(nome, cond) {
  console.log(`${cond ? "✓" : "✗"} ${nome}`);
  if (!cond) ok = false;
}

async function limpar() {
  await prisma.evento.deleteMany({ where: { portalClientId: CID } });
  await prisma.documento.deleteMany({ where: { portalClientId: CID } });
  await prisma.nsuGap.deleteMany({ where: { portalClientId: CID } });
  await prisma.nsuWatermark.deleteMany({ where: { portalClientId: CID } });
}

async function main() {
  await limpar();

  // 1) Idempotência de documento: 2 appends da mesma chave = 1 linha.
  const r1 = await appendDocumento({ portalClientId: CID, chaveAcesso: CHAVE_A, dataEmissao: "2026-07-10T12:00:00Z", valorServico: 100, fonte: FONTE, nsuOrigem: 1048 });
  const r2 = await appendDocumento({ portalClientId: CID, chaveAcesso: CHAVE_A, dataEmissao: "2026-07-10T12:00:00Z", valorServico: 100, fonte: FONTE });
  const countA = await prisma.documento.count({ where: { portalClientId: CID, chaveAcesso: CHAVE_A } });
  check("append documento idempotente (1 linha, 1º created, 2º não)", countA === 1 && r1.created === true && r2.created === false);
  check("competência derivada da emissão (2026-07)", r1.documento.competencia === "2026-07");

  // 2) Documento sem eventos → AUTORIZADA.
  const sitInicial = await computeSituacao(CHAVE_A);
  check("sem eventos → AUTORIZADA", sitInicial.situacao === "AUTORIZADA");

  // 3) Cancelamento → CANCELADA (idempotente por (chave,tipo,nSeq)).
  await appendEvento({ portalClientId: CID, chaveAcesso: CHAVE_A, tipoEvento: "cancelamento", nSeqEvento: 1, dataEvento: "2026-08-01T09:00:00Z", fonte: FONTE });
  const evDup = await appendEvento({ portalClientId: CID, chaveAcesso: CHAVE_A, tipoEvento: "cancelamento", nSeqEvento: 1, dataEvento: "2026-08-01T09:00:00Z", fonte: FONTE });
  const countEvA = await prisma.evento.count({ where: { chaveAcesso: CHAVE_A } });
  const sitCanc = await computeSituacao(CHAVE_A);
  check("evento cancelamento idempotente (1 linha, 2º não created)", countEvA === 1 && evDup.created === false);
  check("cancelamento → CANCELADA", sitCanc.situacao === "CANCELADA");

  // 4) Substituição → SUBSTITUIDA + chaveSubstituta.
  await appendDocumento({ portalClientId: CID, chaveAcesso: CHAVE_B, dataEmissao: "2026-07-11T12:00:00Z", valorServico: 200, fonte: FONTE });
  await appendEvento({ portalClientId: CID, chaveAcesso: CHAVE_B, tipoEvento: "canc_por_substituicao", nSeqEvento: 1, dataEvento: "2026-07-20T10:00:00Z", chaveSubstituta: "NOVACHAVE", fonte: FONTE });
  const sitSub = await computeSituacao(CHAVE_B);
  check("substituição → SUBSTITUIDA + chaveSubstituta", sitSub.situacao === "SUBSTITUIDA" && sitSub.chaveSubstituta === "NOVACHAVE");

  // 5) Evento ANTES da nota: grava mesmo sem documento; projeção já funciona.
  const evOrfao = await appendEvento({ portalClientId: CID, chaveAcesso: CHAVE_C, tipoEvento: "cancelamento", nSeqEvento: 1, dataEvento: "2026-08-02T09:00:00Z", fonte: FONTE });
  const docC = await prisma.documento.findUnique({ where: { portalClientId_chaveAcesso: { portalClientId: CID, chaveAcesso: CHAVE_C } } });
  const sitC = await computeSituacao(CHAVE_C);
  check("evento-antes-da-nota gravado sem documento", evOrfao.created === true && docC === null);
  check("projeção do evento órfão → CANCELADA", sitC.situacao === "CANCELADA");

  // 6) Projeção pura: bloqueio sem desbloqueio → BLOQUEADA.
  const sitBloq = projetarSituacao([{ tipoEvento: "bloqueio_oficio", nSeqEvento: 1, dataEvento: "2026-07-01" }]);
  check("bloqueio sem desbloqueio → BLOQUEADA", sitBloq.situacao === "BLOQUEADA");

  // 7) Watermark avança só pra frente.
  await avancarWatermark({ portalClientId: CID, fonte: FONTE, nsu: 1050 });
  await avancarWatermark({ portalClientId: CID, fonte: FONTE, nsu: 1049 }); // não regride
  const wm = await prisma.nsuWatermark.findUnique({ where: { portalClientId_fonte: { portalClientId: CID, fonte: FONTE } } });
  check("watermark avança só pra frente (1050, não regride pra 1049)", wm.ultimoNsuProcessado === 1050n);

  // 8) Detecção de gap: recebe 1048 e 1050 com nsuAnterior 1047 → grava 1049 aberto.
  await detectarGaps({ portalClientId: CID, fonte: FONTE, nsusRecebidos: [1048, 1050], nsuAnterior: 1047 });
  const gaps = await prisma.nsuGap.findMany({ where: { portalClientId: CID, status: "aberto" } });
  check("gap detectado (1049 aberto)", gaps.length === 1 && gaps[0].nsuFaltante === 1049n);

  await limpar();
  console.log(ok ? "\n✅ LEDGER OK" : "\n❌ FALHOU");
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("Erro na verificação:", e);
  try { await limpar(); } catch { /* ignore */ }
  await prisma.$disconnect();
  process.exit(1);
});
