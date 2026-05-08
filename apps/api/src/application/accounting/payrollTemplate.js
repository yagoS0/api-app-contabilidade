import { prisma } from "../../infrastructure/db/prisma.js";

/**
 * Templates de folha/pró-labore.
 * `code` é uma chave semântica buscada no plano de contas da empresa por nome OU descrição;
 * se não encontrar, o frontend exibe campo vazio para o contador escolher manualmente.
 */
export const PAYROLL_TEMPLATES = Object.freeze({
  PROLABORE: {
    label: "Pró-labore",
    historicoTemplate: "PRÓ-LABORE - {{competencia}}",
    lines: [
      { side: "D", role: "salary", label: "Despesa de Pró-labore",
        accountHints: ["pro labore", "prolabore", "pro-labore", "pró labore", "despesa pro labore", "despesa prolabore", "remuneracao socios", "remuneração sócios", "honorarios diretoria"],
        historicoTemplate: "VR REF PRO LAB FP {{competencia}}" },
      { side: "C", role: "inss",   label: "INSS a Recolher",
        accountHints: ["inss a recolher", "inss a pagar", "inss obrigacoes", "obrigacoes inss", "obrigações inss", "inss"],
        historicoTemplate: "VR REF INSS S/PRO LAB FP {{competencia}}" },
      { side: "C", role: "irrf",   label: "IRRF a Recolher",
        accountHints: ["irrf a recolher", "irrf a pagar", "irrf obrigacoes", "obrigacoes irrf", "irf retido", "irrf"],
        historicoTemplate: "VR REF IRRF S/PRO LAB FP {{competencia}}" },
      { side: "C", role: "liquid", label: "Pró-labore a Pagar",
        accountHints: ["pro labore a pagar", "prolabore a pagar", "pro-labore a pagar", "pró labore a pagar", "honorarios a pagar"],
        historicoTemplate: "VR PRO LAB LIQ FP {{competencia}}" },
    ],
    baixa: {
      debitFromRole: "liquid",
      creditAccountHints: ["caixa matriz", "caixa geral", "caixa", "banco conta movimento", "banco conta corrente", "banco itau", "banco bradesco", "banco do brasil", "banco santander", "banco caixa", "bancos contas com movimentos", "banco"],
      historicoTemplate: "PAGO PRO-LAB {{competencia}}",
    },
  },
  FOLHA: {
    label: "Folha de Pagamento",
    historicoTemplate: "FOLHA DE PAGAMENTO - {{competencia}}",
    lines: [
      { side: "D", role: "salary", label: "Despesa de Salários",
        accountHints: ["salarios", "salários", "despesa salarios", "despesa de salarios", "salarios e ordenados", "remuneracao funcionarios", "ordenados"],
        historicoTemplate: "VR REF SALARIO FP {{competencia}}" },
      { side: "C", role: "inss",   label: "INSS a Recolher",
        accountHints: ["inss a recolher", "inss a pagar", "obrigacoes inss", "obrigações inss", "inss"],
        historicoTemplate: "VR REF INSS S/SALARIO FP {{competencia}}" },
      { side: "C", role: "fgts",   label: "FGTS a Recolher",
        accountHints: ["fgts a recolher", "fgts a pagar", "obrigacoes fgts", "obrigações fgts", "fgts"],
        historicoTemplate: "VR REF FGTS S/SALARIO FP {{competencia}}" },
      { side: "C", role: "irrf",   label: "IRRF a Recolher",
        accountHints: ["irrf a recolher", "irrf a pagar", "obrigacoes irrf", "obrigações irrf", "irf retido", "irrf"],
        historicoTemplate: "VR REF IRRF S/SALARIO FP {{competencia}}" },
      { side: "C", role: "liquid", label: "Salários a Pagar",
        accountHints: ["salarios a pagar", "salários a pagar", "ordenados a pagar", "salario a pagar"],
        historicoTemplate: "VR SALARIO LIQ FP {{competencia}}" },
    ],
    baixa: {
      debitFromRole: "liquid",
      creditAccountHints: ["caixa matriz", "caixa geral", "caixa", "banco conta movimento", "banco conta corrente", "banco itau", "banco bradesco", "banco do brasil", "banco santander", "banco caixa", "bancos contas com movimentos", "banco"],
      historicoTemplate: "PAGO SALARIOS FP {{competencia}}",
    },
  },
});

function applyHistoricoTemplate(template, competencia) {
  // competencia esperada como YYYY-MM; histórico pede MM/YYYY
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  const label = m ? `${m[2]}/${m[1]}` : String(competencia || "");
  return String(template || "").replace(/\{\{\s*competencia\s*\}\}/gi, label);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos combinantes
    .replace(/[\s\-_/]+/g, " ")        // normaliza espaços, hífens, underscores
    .trim();
}

function findAccountByHints(accounts, hints) {
  const normalizedAccounts = accounts.map((acc) => ({
    ...acc,
    _norm: normalizeText(acc.nome),
  }));
  const normalizedHints = hints.map((h) => normalizeText(h)).filter(Boolean);
  if (normalizedHints.length === 0) return null;

  // Pass 1: match exato (mais específico). Tenta TODOS os hints antes de cair para próximo nível.
  for (const hint of normalizedHints) {
    const found = normalizedAccounts.find((acc) => acc._norm === hint);
    if (found) return found;
  }
  // Pass 2: startsWith.
  for (const hint of normalizedHints) {
    const found = normalizedAccounts.find((acc) => acc._norm.startsWith(hint));
    if (found) return found;
  }
  // Pass 3: contains (último recurso, mais permissivo).
  for (const hint of normalizedHints) {
    const found = normalizedAccounts.find((acc) => acc._norm.includes(hint));
    if (found) return found;
  }
  return null;
}

export async function resolvePayrollTemplate({ portalClientId, kind, competencia }) {
  const template = PAYROLL_TEMPLATES[String(kind || "").toUpperCase()];
  if (!template) {
    const err = new Error(`unknown_payroll_kind: ${kind}`);
    err.code = "UNKNOWN_PAYROLL_KIND";
    throw err;
  }

  // Inclui contas globais (portalClientId=null) + da empresa.
  // Quando ambas existem para o mesmo código, a da empresa tem prioridade (override).
  // Não filtra por status — contas PENDENTE_ERP também são consideradas para matching.
  const rawAccounts = await prisma.chartOfAccount.findMany({
    where: { OR: [{ portalClientId: String(portalClientId) }, { portalClientId: null }] },
    select: { id: true, codigo: true, nome: true, tipo: true, natureza: true, portalClientId: true },
    orderBy: { codigo: "asc" },
  });
  const byCodigo = new Map();
  for (const acc of rawAccounts) {
    const existing = byCodigo.get(acc.codigo);
    if (!existing || (acc.portalClientId && !existing.portalClientId)) {
      byCodigo.set(acc.codigo, acc);
    }
  }
  const accounts = [...byCodigo.values()];

  const lines = template.lines.map((line) => {
    const matched = findAccountByHints(accounts, line.accountHints);
    return {
      side: line.side,
      role: line.role,
      label: line.label,
      accountCode: matched?.codigo || null,
      accountName: matched?.nome || null,
      value: 0,
      historico: applyHistoricoTemplate(line.historicoTemplate || "", competencia),
    };
  });

  // Resolve bloco de baixa (pagamento)
  let baixa = null;
  if (template.baixa) {
    const liquidLine = lines.find((l) => l.role === template.baixa.debitFromRole);
    const creditMatch = findAccountByHints(accounts, template.baixa.creditAccountHints || []);
    baixa = {
      debitAccountCode: liquidLine?.accountCode || null,
      debitAccountName: liquidLine?.accountName || null,
      creditAccountCode: creditMatch?.codigo || null,
      creditAccountName: creditMatch?.nome || null,
      historico: applyHistoricoTemplate(template.baixa.historicoTemplate || "", competencia),
    };
  }

  // Buscar guia INSS da competência para exibir no rodapé do modal
  const inssGuide = await prisma.guide.findFirst({
    where: {
      portalClientId: String(portalClientId),
      tipo: "INSS",
      competencia: String(competencia),
      status: "PROCESSED",
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, valor: true, vencimento: true, paymentStatus: true },
  });

  return {
    kind: String(kind).toUpperCase(),
    label: template.label,
    competencia: String(competencia),
    historicoTemplate: template.historicoTemplate,
    lines,
    baixa,
    inssGuide: inssGuide
      ? {
          guideId: inssGuide.id,
          valor: inssGuide.valor != null ? Number(inssGuide.valor) : null,
          vencimento: inssGuide.vencimento ? inssGuide.vencimento.toISOString() : null,
          paymentStatus: inssGuide.paymentStatus,
        }
      : null,
  };
}
