// Q9: seeds idempotentes de AccountingFunction com kind PARCELAMENTO_*.
// Roda 1x no startup (server.js). Upsert por (name, isSystem=true, portalClientId=null).
// Contador pode duplicar pra empresa e personalizar contas (já existe botão Duplicar em Q6).

import { prisma } from "../../infrastructure/db/prisma.js";

const SEEDS = [
  // ─── SIMPLES NACIONAL ───────────────────────────────────────────────────
  {
    name: "Parc. Simples Nacional — Abertura",
    description: "Lançamento de abertura do parcelamento (entra saldo + juros total RFB)",
    kind: "PARCELAMENTO_OPENING",
    entries: [{
      ordem: 0,
      historico: "VR REF RE-PARCELAMENTO SIMPLES NACIONAL {{periodosReferenciados}} EM {{numParcelas}} PARCELAS, SENDO {{numEntradas}} ENTRADA E MAIS {{numParcelasRestantes}} PARCELAS N/DATA",
      tipo: "PROVISAO",
      subtipo: "PARC_DAS_ABERTURA",
      lines: [
        { tipo: "D", conta: "265", ordem: 0 }, // dívida ativa - principal
        { tipo: "D", conta: "501", ordem: 1 }, // juros total RFB
        { tipo: "C", conta: "553", ordem: 2 }, // saldo parcelamento (total)
      ],
    }],
  },
  {
    name: "Parc. Simples Nacional — Pagamento (com juros)",
    description: "Baixa de parcela mensal — principal fixo + juros variável do mês",
    kind: "PARCELAMENTO_PAYMENT",
    entries: [{
      ordem: 0,
      historico: "PAGO RE-PARCELAMENTO SIMPLES NACIONAL PARC {{numeroParcela}}/{{numParcelas}} - {{competencia}}",
      tipo: "BAIXA",
      lines: [
        { tipo: "D", conta: "553", ordem: 0 }, // baixa do saldo
        { tipo: "C", conta: "5", ordem: 1 },   // caixa/banco
      ],
    }, {
      ordem: 1,
      historico: "PAGO JUROS S/RE-PARCELAMENTO SIMPLES NACIONAL PARC {{numeroParcela}}/{{numParcelas}} - {{competencia}}",
      tipo: "BAIXA",
      lines: [
        { tipo: "D", conta: "501", ordem: 0 }, // juros do mês
        { tipo: "C", conta: "5", ordem: 1 },
      ],
    }],
  },
  {
    name: "Parc. Simples Nacional — Rescisão",
    description: "Rescinde parcelamento — devolve saldo remanescente pra contas originais",
    kind: "PARCELAMENTO_RESCISION",
    entries: [{
      ordem: 0,
      historico: "VR REF RESCISAO PARCELAMENTO SIMPLES NACIONAL N/DATA",
      tipo: "PROVISAO",
      subtipo: "PARC_DAS_RESCISAO",
      lines: [
        { tipo: "D", conta: "265", ordem: 0 }, // devolve principal remanescente
        { tipo: "D", conta: "501", ordem: 1 }, // devolve juros remanescente
        { tipo: "C", conta: "553", ordem: 2 }, // baixa saldo restante
      ],
    }],
  },

  // ─── INSS (estrutura espelhada com contas placeholder) ───────────────────
  {
    name: "Parc. INSS — Abertura",
    description: "Lançamento de abertura de parcelamento INSS",
    kind: "PARCELAMENTO_OPENING",
    entries: [{
      ordem: 0,
      historico: "VR REF PARCELAMENTO INSS {{periodosReferenciados}} EM {{numParcelas}} PARCELAS N/DATA",
      tipo: "PROVISAO",
      subtipo: "PARC_INSS_ABERTURA",
      lines: [
        { tipo: "D", conta: "", ordem: 0 }, // contador preenche INSS a recolher
        { tipo: "D", conta: "501", ordem: 1 }, // juros
        { tipo: "C", conta: "", ordem: 2 }, // contador preenche parcelamento INSS
      ],
    }],
  },
  {
    name: "Parc. INSS — Pagamento (com juros)",
    description: "Baixa de parcela mensal INSS",
    kind: "PARCELAMENTO_PAYMENT",
    entries: [{
      ordem: 0,
      historico: "PAGO PARCELAMENTO INSS PARC {{numeroParcela}}/{{numParcelas}} - {{competencia}}",
      tipo: "BAIXA",
      lines: [
        { tipo: "D", conta: "", ordem: 0 }, // baixa saldo INSS
        { tipo: "C", conta: "5", ordem: 1 },
      ],
    }, {
      ordem: 1,
      historico: "PAGO JUROS S/PARCELAMENTO INSS PARC {{numeroParcela}}/{{numParcelas}} - {{competencia}}",
      tipo: "BAIXA",
      lines: [
        { tipo: "D", conta: "501", ordem: 0 },
        { tipo: "C", conta: "5", ordem: 1 },
      ],
    }],
  },
  {
    name: "Parc. INSS — Rescisão",
    description: "Rescinde parcelamento INSS",
    kind: "PARCELAMENTO_RESCISION",
    entries: [{
      ordem: 0,
      historico: "VR REF RESCISAO PARCELAMENTO INSS N/DATA",
      tipo: "PROVISAO",
      subtipo: "PARC_INSS_RESCISAO",
      lines: [
        { tipo: "D", conta: "", ordem: 0 },
        { tipo: "D", conta: "501", ordem: 1 },
        { tipo: "C", conta: "", ordem: 2 },
      ],
    }],
  },
];

/**
 * Idempotente: upsert por (name, isSystem=true, portalClientId=null).
 * Se contador apagou cópia da empresa, NÃO recria — só os globais.
 */
export async function seedParcelamentoFunctions({ logger } = {}) {
  const log = logger || console;
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const seed of SEEDS) {
    try {
      // Tenta achar existente
      const existing = await prisma.accountingFunction.findFirst({
        where: {
          name: seed.name,
          isSystem: true,
          portalClientId: null,
        },
      });

      if (existing) {
        // Update: recria entries (replace strategy — kind muda? sem problema)
        await prisma.$transaction(async (tx) => {
          await tx.accountingFunctionEntry.deleteMany({ where: { functionId: existing.id } });
          await tx.accountingFunction.update({
            where: { id: existing.id },
            data: {
              description: seed.description,
              kind: seed.kind,
              entries: {
                create: seed.entries.map((e) => ({
                  ordem: e.ordem,
                  historico: e.historico,
                  tipo: e.tipo,
                  subtipo: e.subtipo || null,
                  lines: {
                    create: e.lines.map((ln) => ({
                      conta: ln.conta || "",
                      tipo: ln.tipo,
                      ordem: ln.ordem,
                    })),
                  },
                })),
              },
            },
          });
        });
        updated++;
      } else {
        await prisma.accountingFunction.create({
          data: {
            portalClientId: null,
            isSystem: true,
            kind: seed.kind,
            name: seed.name,
            description: seed.description,
            entries: {
              create: seed.entries.map((e) => ({
                ordem: e.ordem,
                historico: e.historico,
                tipo: e.tipo,
                subtipo: e.subtipo || null,
                lines: {
                  create: e.lines.map((ln) => ({
                    conta: ln.conta || "",
                    tipo: ln.tipo,
                    ordem: ln.ordem,
                  })),
                },
              })),
            },
          },
        });
        created++;
      }
    } catch (err) {
      failed++;
      log.warn?.({ err: err?.message || String(err), seed: seed.name }, "Seed de parcelamento falhou");
    }
  }

  log.info?.({ created, updated, failed, total: SEEDS.length }, "seedParcelamentoFunctions concluído");
  return { created, updated, failed, total: SEEDS.length };
}
