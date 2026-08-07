// Reavalia o estado das parcelas EM ABERTO contra o calendário (a vencer × vencida).
//
// PARA QUE SERVE
// `estadoEmAberto` só era chamado UMA VEZ, na ingestão da parcela. Uma parcela ingerida antes do
// vencimento ficava `PREVISTA` para sempre — inclusive meses depois de vencida e não paga. Não
// havia erro, não havia log: o atraso simplesmente nunca aparecia.
//
// Este script põe a coluna em dia. É mecânico e reversível: não gera lançamento, não toca em
// valor, não chama o SERPRO, e só move estado que o relógio autoriza mover (parcela paga,
// confirmada ou cancelada não é tocada).
//
// ⚠ O ALERTA DE RISCO DE RESCISÃO NÃO DEPENDE DESTE SCRIPT. Ele deriva o atraso do vencimento e do
// estado de pagamento, não da coluna — senão uma coluna desatualizada mostraria "tudo em dia" numa
// empresa a uma parcela da rescisão. Aqui é a coluna que a TELA lê.
//
// Uso:
//   node scripts/recalcular-estado-parcelas.mjs                 (dry-run, carteira inteira)
//   node scripts/recalcular-estado-parcelas.mjs --aplicar
//   node scripts/recalcular-estado-parcelas.mjs --cnpj=00000000000191 --aplicar

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { recalcularEstadosParcelasEmAberto } from "../src/application/accounting/parcelamento/ParcelamentoV2Service.js";
import { estadoRecalculado, ESTADOS_EM_ABERTO } from "../src/application/accounting/parcelamento/parcelaStateMachine.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const cnpj = String(arg("cnpj") || "").replace(/\D/g, "");
const aplicar = process.argv.includes("--aplicar");

let portalClientId = null;
if (cnpj) {
  const empresa = await prisma.portalClient.findFirst({ where: { cnpj }, select: { id: true, razao: true } });
  if (!empresa) {
    console.error(`✕ CNPJ ${cnpj} não está na carteira.`);
    await prisma.$disconnect();
    process.exit(2);
  }
  portalClientId = empresa.id;
  console.log(`EMPRESA: ${empresa.razao}`);
}

const agora = new Date();

if (!aplicar) {
  // Dry-run: mostra parcela por parcela o que mudaria. É o relatório de conferência — o mesmo
  // padrão dos outros scripts do projeto.
  const guias = await prisma.guide.findMany({
    where: {
      parcelamentoId: { not: null },
      parcelaEstado: { in: ESTADOS_EM_ABERTO },
      baixada: false,
      ...(portalClientId ? { portalClientId } : {}),
    },
    select: {
      id: true, parcelaEstado: true, vencimento: true, paymentStatus: true, numeroParcela: true,
      anoMesParcela: true, valor: true,
      portalClient: { select: { razao: true } },
      parcelamento: { select: { tipo: true, numeroParcelamento: true } },
    },
    orderBy: { vencimento: "asc" },
  });

  const mudariam = [];
  for (const g of guias) {
    if (String(g.paymentStatus || "").toUpperCase() === "PAID") continue;
    const novo = estadoRecalculado({ estadoAtual: g.parcelaEstado, vencimento: g.vencimento, agora });
    if (novo) mudariam.push({ ...g, novo });
  }

  console.log(`\nparcelas em aberto avaliadas: ${guias.length}`);
  console.log(`mudariam de estado: ${mudariam.length}`);
  if (mudariam.length) {
    console.table(mudariam.map((g) => ({
      empresa: String(g.portalClient?.razao || "?").slice(0, 24),
      parcelamento: `${g.parcelamento?.tipo || "?"} ${g.parcelamento?.numeroParcelamento || ""}`.trim(),
      parcela: `${g.numeroParcela ?? "?"} (${g.anoMesParcela || "?"})`,
      vencimento: g.vencimento ? new Date(g.vencimento).toISOString().slice(0, 10) : "—",
      valor: g.valor != null ? Number(g.valor) : null,
      de: g.parcelaEstado,
      para: g.novo,
    })));
  }
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("Isto foi um DRY-RUN — nada foi gravado.");
  console.log("Confira a lista acima e repita com --aplicar para gravar.");
  console.log("───────────────────────────────────────────────────────────────");
  await prisma.$disconnect();
  process.exit(0);
}

const r = await recalcularEstadosParcelasEmAberto({ portalClientId, agora });
console.log(`\navaliadas: ${r.avaliadas} · atualizadas: ${r.atualizadas}`);
for (const [estado, n] of Object.entries(r.porEstado)) console.log(`  → ${estado}: ${n}`);
if (!r.atualizadas) console.log("Nada a mudar — os estados já estavam em dia.");

await prisma.$disconnect();
