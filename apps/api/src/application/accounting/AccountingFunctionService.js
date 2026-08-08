// Aplica uma AccountingFunction (template reutilizável) em uma competência específica,
// gerando N AccountingEntry de uma vez. Contas D/C e histórico vêm do template;
// valor e (opcionalmente) data são informados pelo contador a cada aplicação.

import { prisma } from "../../infrastructure/db/prisma.js";
import { applyTemplate, formatCompetenciaLabel } from "./AccountingEntryGeneratorService.js";
import { normalizeCompetencia } from "../guides/guideContract.js";
import { tipoLinhaDaBaixa } from "./tipoLinhaBaixa.js";

function getLastDayOfCompetencia(competencia) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) return null;
  const [yyyy, mm] = normalized.split("-").map(Number);
  return new Date(Date.UTC(yyyy, mm, 0, 23, 59, 59, 999));
}

/**
 * Lista funções aplicáveis a uma empresa: GLOBAIS (isSystem ou portalClientId=null) + da empresa.
 */
export async function listAccountingFunctionsForCompany(portalClientId) {
  return prisma.accountingFunction.findMany({
    where: { OR: [{ portalClientId: null }, { portalClientId: String(portalClientId) }] },
    include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
}

/**
 * Cria uma função no escopo da empresa (sempre não-system).
 * payload: { name, description?, entries: [{ ordem, historico, tipo, subtipo?, lines: [{conta, tipo, ordem}] }] }
 */
export async function createAccountingFunction({ portalClientId, userId, payload }) {
  const name = String(payload?.name || "").trim();
  if (!name) throw new Error("name_required");
  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    throw new Error("entries_required");
  }

  return prisma.accountingFunction.create({
    data: {
      portalClientId: String(portalClientId),
      isSystem: false, // criação por usuário nunca é system
      createdByUserId: userId ? String(userId) : null,
      name,
      description: payload.description ? String(payload.description).trim() : null,
      entries: {
        create: payload.entries.map((e, idx) => ({
          ordem: Number.isFinite(Number(e.ordem)) ? Number(e.ordem) : idx,
          historico: String(e.historico || "").trim(),
          tipo: String(e.tipo || "DESPESA").toUpperCase(),
          subtipo: e.subtipo ? String(e.subtipo).toUpperCase() : null,
          lines: {
            create: (Array.isArray(e.lines) ? e.lines : []).map((ln, lidx) => ({
              conta: String(ln.conta || "").trim(),
              tipo: String(ln.tipo || "D").toUpperCase(),
              ordem: Number.isFinite(Number(ln.ordem)) ? Number(ln.ordem) : lidx,
            })),
          },
        })),
      },
    },
    include: { entries: { include: { lines: true } } },
  });
}

/**
 * Atualiza uma função (bloqueia se isSystem=true). Substitui entries/lines em bloco.
 */
export async function updateAccountingFunction({ portalClientId, functionId, payload }) {
  const existing = await prisma.accountingFunction.findUnique({
    where: { id: String(functionId) },
  });
  if (!existing) throw new Error("function_not_found");
  if (existing.isSystem) throw new Error("system_function_immutable");
  if (existing.portalClientId !== String(portalClientId)) throw new Error("function_scope_mismatch");

  return prisma.$transaction(async (tx) => {
    // Replace strategy: apaga entries (cascade lines) e cria novas se entries vier no payload.
    if (Array.isArray(payload.entries)) {
      await tx.accountingFunctionEntry.deleteMany({ where: { functionId: existing.id } });
    }
    return tx.accountingFunction.update({
      where: { id: existing.id },
      data: {
        ...(payload.name !== undefined ? { name: String(payload.name).trim() } : {}),
        ...(payload.description !== undefined ? { description: payload.description ? String(payload.description).trim() : null } : {}),
        ...(Array.isArray(payload.entries) ? {
          entries: {
            create: payload.entries.map((e, idx) => ({
              ordem: Number.isFinite(Number(e.ordem)) ? Number(e.ordem) : idx,
              historico: String(e.historico || "").trim(),
              tipo: String(e.tipo || "DESPESA").toUpperCase(),
              subtipo: e.subtipo ? String(e.subtipo).toUpperCase() : null,
              lines: {
                create: (Array.isArray(e.lines) ? e.lines : []).map((ln, lidx) => ({
                  conta: String(ln.conta || "").trim(),
                  tipo: String(ln.tipo || "D").toUpperCase(),
                  ordem: Number.isFinite(Number(ln.ordem)) ? Number(ln.ordem) : lidx,
                })),
              },
            })),
          },
        } : {}),
      },
      include: { entries: { include: { lines: true } } },
    });
  });
}

/**
 * Deleta uma função (bloqueia se isSystem=true).
 */
export async function deleteAccountingFunction({ portalClientId, functionId }) {
  const existing = await prisma.accountingFunction.findUnique({ where: { id: String(functionId) } });
  if (!existing) throw new Error("function_not_found");
  if (existing.isSystem) throw new Error("system_function_immutable");
  if (existing.portalClientId !== String(portalClientId)) throw new Error("function_scope_mismatch");

  await prisma.accountingFunction.delete({ where: { id: existing.id } });
  return { ok: true };
}

/**
 * Aplica a função em uma competência: cria N entries.
 * entryValores: [{ functionEntryId, valor, data? }] — 1 valor por entry do template.
 * Entries sem valor (ou valor <= 0) são pulados.
 */
export async function applyAccountingFunction({ portalClientId, functionId, competencia, entryValores }) {
  const normCompetencia = normalizeCompetencia(competencia);
  if (!normCompetencia) throw new Error("competencia_required");

  const func = await prisma.accountingFunction.findUnique({
    where: { id: String(functionId) },
    include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
  });
  if (!func) throw new Error("function_not_found");
  // Escopo: GLOBAL (portalClientId=null) OU mesma empresa.
  if (func.portalClientId && func.portalClientId !== String(portalClientId)) {
    throw new Error("function_scope_mismatch");
  }

  const company = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
    select: { id: true, razao: true, cnpj: true },
  });
  if (!company) throw new Error("company_not_found");

  const defaultDate = getLastDayOfCompetencia(normCompetencia);
  const valoresMap = new Map((entryValores || []).map((v) => [String(v.functionEntryId), v]));

  const context = {
    competencia: normCompetencia,
    competenciaLabel: formatCompetenciaLabel(normCompetencia),
    companyName: company.razao || "",
    cnpj: company.cnpj || "",
  };

  const loteImportacao = `FUNC-${func.id.slice(0, 8)}-${normCompetencia}`;
  const createdEntries = [];

  await prisma.$transaction(async (tx) => {
    for (const e of func.entries) {
      const v = valoresMap.get(String(e.id));
      const valor = Number(v?.valor);
      if (!Number.isFinite(valor) || valor <= 0) continue; // skip sem valor

      const data = v?.data ? new Date(v.data) : defaultDate;
      const historico = applyTemplate(e.historico, context);
      const tipo = String(e.tipo || "DESPESA").toUpperCase();
      const subtipo = e.subtipo ? String(e.subtipo).toUpperCase() : null;
      const statusPagamento = tipo === "PROVISAO" ? "ABERTO" : "NA";

      const entry = await tx.accountingEntry.create({
        data: {
          portalClientId: String(portalClientId),
          data, competencia: normCompetencia, historico,
          tipo, subtipo,
          // ⚠ O template MANDA no tipo, e ele pode ser BAIXA — os seeds de PARCELAMENTO_PAYMENT
          // são, e o modal deixa o contador escolher. Toda baixa precisa de `tipoLinha` (CHECK
          // `chk_baixa_tipo_linha`), e a função de lançamento não tem papel de linha para declarar.
          tipoLinha: tipoLinhaDaBaixa(tipo),
          origem: "MANUAL",
          loteImportacao,
          status: "RASCUNHO",
          statusPagamento,
          lines: {
            createMany: {
              data: (e.lines || []).map((ln, idx) => ({
                conta: ln.conta || "",
                tipo: ln.tipo,
                valor,
                ordem: Number.isFinite(Number(ln.ordem)) ? Number(ln.ordem) : idx,
              })),
            },
          },
        },
        include: { lines: true },
      });
      createdEntries.push(entry);
    }
  });

  return { ok: true, entries: createdEntries };
}
