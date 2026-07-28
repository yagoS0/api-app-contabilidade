import { prisma } from "../../../infrastructure/db/prisma.js";
import { ROTINA_KEYS } from "./SerproRuntimeSettings.js";

/**
 * Quais rotinas de captura cada empresa faz.
 *
 * Antes isso era IMPLÍCITO, derivado do regime dentro de cada worker:
 *   - serproPgdasdWorker: regime SIMPLES → DAS + extrato + parcelamento
 *                         regime LUCRO_PRESUMIDO → presumido (DCTFWeb/LP)
 *   - serproDctfwebWorker: INSS em TODA empresa (não filtra regime)
 * Agora é DECLARADO — o contador vê e escolhe na página Rotinas.
 *
 * O seed abaixo reproduz exatamente a regra acima, para que ligar esta feature não mude o
 * comportamento de quem já está em produção.
 *
 * A AGENDA (dia/hora por rotina) NÃO vive aqui: está em SerproRuntimeSettings.rotinas.
 */

export const ROTINA_LABELS = {
  das: "DAS",
  inss: "INSS",
  extrato: "Extrato",
  presumido: "Presumido",
  parcelamento: "Parcelamento",
  pagamento: "Pagamento",
  conferencia: "Conferência ADN",
};

function normalizaRegime(legacyRow) {
  return String(legacyRow?.regimeTributario || legacyRow?.tipoTributario || "")
    .trim()
    .toUpperCase();
}

/** Rotinas que a empresa faria HOJE, pela regra implícita dos workers. Base do seed. */
export function rotinasPadraoPorRegime(regime) {
  const set = new Set();
  // serproDctfwebWorker não filtra regime: INSS é tentado em toda empresa.
  set.add("inss");
  // O worker de pagamento escolhe guias, não empresas — vale pra todas.
  set.add("pagamento");
  if (regime === "SIMPLES") {
    set.add("das");
    set.add("extrato");
    set.add("parcelamento");
  } else if (regime === "LUCRO_PRESUMIDO") {
    set.add("presumido");
  }
  return set;
}

/**
 * Cria as linhas que faltam, sem tocar nas existentes. Idempotente e não-destrutivo:
 * se o contador desligou `das` numa empresa, a linha já existe (enabled=false) e o seed
 * NÃO a religa.
 */
export async function seedRotinasFromLegacy() {
  const portalRows = await prisma.portalClient.findMany({
    where: { cnpj: { not: "" } },
    select: { id: true, companyId: true },
  });
  if (portalRows.length === 0) return { criadas: 0, empresas: 0 };

  const legacyIds = portalRows.map((p) => p.companyId).filter(Boolean);
  const legacy = legacyIds.length > 0
    ? await prisma.company.findMany({
        where: { id: { in: legacyIds } },
        select: { id: true, regimeTributario: true, tipoTributario: true },
      })
    : [];
  const legacyMap = new Map(legacy.map((c) => [c.id, c]));

  const existentes = await prisma.companyRotina.findMany({
    select: { portalClientId: true, rotina: true },
  });
  const jaTem = new Set(existentes.map((r) => `${r.portalClientId}:${r.rotina}`));

  const novas = [];
  for (const p of portalRows) {
    const regime = normalizaRegime(p.companyId ? legacyMap.get(p.companyId) : null);
    const padrao = rotinasPadraoPorRegime(regime);
    for (const rotina of ROTINA_KEYS) {
      if (jaTem.has(`${p.id}:${rotina}`)) continue;
      novas.push({ portalClientId: p.id, rotina, enabled: padrao.has(rotina) });
    }
  }
  if (novas.length === 0) return { criadas: 0, empresas: portalRows.length };

  await prisma.companyRotina.createMany({ data: novas, skipDuplicates: true });
  return { criadas: novas.length, empresas: portalRows.length };
}

/** Dados da tabela da página Rotinas: empresa × rotina. Semeia antes, para não vir vazio. */
export async function listCompanyRotinas() {
  await seedRotinasFromLegacy();

  const portalRows = await prisma.portalClient.findMany({
    where: { cnpj: { not: "" } },
    select: { id: true, razao: true, cnpj: true, status: true, companyId: true },
    orderBy: { razao: "asc" },
  });
  const legacyIds = portalRows.map((p) => p.companyId).filter(Boolean);
  const legacy = legacyIds.length > 0
    ? await prisma.company.findMany({
        where: { id: { in: legacyIds } },
        select: { id: true, regimeTributario: true, tipoTributario: true },
      })
    : [];
  const legacyMap = new Map(legacy.map((c) => [c.id, c]));

  const rows = await prisma.companyRotina.findMany({
    select: { portalClientId: true, rotina: true, enabled: true },
  });
  const porEmpresa = new Map();
  for (const r of rows) {
    if (!porEmpresa.has(r.portalClientId)) porEmpresa.set(r.portalClientId, {});
    porEmpresa.get(r.portalClientId)[r.rotina] = r.enabled;
  }

  return portalRows.map((p) => {
    const marcadas = porEmpresa.get(p.id) || {};
    const rotinas = {};
    for (const key of ROTINA_KEYS) rotinas[key] = marcadas[key] === true;
    return {
      companyId: p.id,
      razao: p.razao,
      cnpj: p.cnpj,
      status: p.status,
      regime: normalizaRegime(p.companyId ? legacyMap.get(p.companyId) : null) || null,
      rotinas,
    };
  });
}

/**
 * Salva em lote. `items` = [{ companyId, rotinas: { das: true, ... } }].
 * Só mexe nas rotinas presentes no payload — o resto da empresa fica como está.
 */
export async function saveCompanyRotinas(items) {
  if (!Array.isArray(items) || items.length === 0) return { atualizadas: 0 };

  let atualizadas = 0;
  for (const item of items) {
    const portalClientId = String(item?.companyId || "").trim();
    if (!portalClientId) continue;
    const rotinas = item?.rotinas && typeof item.rotinas === "object" ? item.rotinas : {};
    for (const rotina of ROTINA_KEYS) {
      if (rotinas[rotina] === undefined) continue;
      const enabled = rotinas[rotina] === true;
      // eslint-disable-next-line no-await-in-loop
      await prisma.companyRotina.upsert({
        where: { portalClientId_rotina: { portalClientId, rotina } },
        create: { portalClientId, rotina, enabled },
        update: { enabled },
      });
      atualizadas += 1;
    }
  }
  return { atualizadas };
}

/**
 * Usado pelos workers: quais empresas (ids) têm a rotina ligada.
 * Devolve um Set para o worker filtrar a lista de elegíveis dele.
 */
export async function idsComRotinaAtiva(rotina) {
  const rows = await prisma.companyRotina.findMany({
    where: { rotina: String(rotina), enabled: true },
    select: { portalClientId: true },
  });
  return new Set(rows.map((r) => r.portalClientId));
}
