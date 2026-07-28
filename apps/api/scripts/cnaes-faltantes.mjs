// Lista os CNAEs usados pelas empresas da carteira que NÃO existem em `CnaeAnexo` — e, para cada
// um, os IRMÃOS de subclasse que já estão classificados.
//
// Por que os irmãos importam: sem sugestão, a Aba Fiscal não ajuda em nada. Mas classificar por
// conta própria é chutar regra fiscal. O meio-termo honesto é mostrar o que a PRÓPRIA tabela já
// decidiu para códigos da mesma subclasse (ex.: 4399-1/03 "Obras de alvenaria" → Anexo IV torna
// 4399-1/01 e /99 uma extensão do mesmo critério, não uma invenção nova).
//
// Só LÊ o banco. Considera principal E secundários — a sugestão de anexo é consolidada sobre o
// conjunto, então um secundário sem classificação também deixa buraco.
//
//   node scripts/cnaes-faltantes.mjs

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { normalizarCnae } from "../src/application/notas/apuracao/v2/CnaesDaEmpresaService.js";

// "8219999" → "82199" (subclasse até o 5º dígito: grupo + classe + dígito verificador do grupo).
// É o nível em que a CNAE agrupa atividades irmãs (4399-1/01, /03, /99 são a mesma subclasse).
const subclasse = (cnae) => String(cnae || "").slice(0, 5);

try {
  const portais = await prisma.portalClient.findMany({ select: { id: true, companyId: true } });
  const companies = await prisma.company.findMany({
    where: { id: { in: portais.map((p) => p.companyId).filter(Boolean) } },
    select: { id: true, razaoSocial: true, cnaePrincipal: true, cnaesSecundarios: true },
  });

  // cnae → { principalDe: [], secundarioDe: [] }
  const uso = new Map();
  const registrar = (cnae, empresa, papel) => {
    if (!cnae) return;
    if (!uso.has(cnae)) uso.set(cnae, { principalDe: [], secundarioDe: [] });
    uso.get(cnae)[papel].push(empresa);
  };
  for (const c of companies) {
    registrar(normalizarCnae(c.cnaePrincipal), c.razaoSocial, "principalDe");
    for (const s of c.cnaesSecundarios || []) registrar(normalizarCnae(s), c.razaoSocial, "secundarioDe");
  }

  const todos = [...uso.keys()];
  const existentes = await prisma.cnaeAnexo.findMany({
    where: { cnae: { in: todos } },
    select: { cnae: true, tipoReceitaSugerido: true },
  });
  const temNaTabela = new Set(existentes.map((e) => e.cnae));
  const faltantes = todos.filter((c) => !temNaTabela.has(c)).sort();

  console.log(`${todos.length} CNAE(s) distinto(s) em uso · ${faltantes.length} sem classificação\n`);
  if (!faltantes.length) {
    console.log("Todos classificados. A Aba Fiscal consegue sugerir anexo para todas as empresas.");
    process.exit(0);
  }

  // Irmãos de subclasse já classificados — a base para estender o critério sem inventar.
  const subclassesAlvo = [...new Set(faltantes.map(subclasse))];
  const irmaos = await prisma.cnaeAnexo.findMany({
    where: { OR: subclassesAlvo.map((s) => ({ cnae: { startsWith: s } })) },
    select: { cnae: true, descricao: true, tipoReceitaSugerido: true },
  });
  const irmaosPorSub = new Map();
  for (const i of irmaos) {
    const k = subclasse(i.cnae);
    if (!irmaosPorSub.has(k)) irmaosPorSub.set(k, []);
    irmaosPorSub.get(k).push(i);
  }

  const comIrmao = [];
  const semIrmao = [];
  for (const c of faltantes) {
    (irmaosPorSub.get(subclasse(c))?.length ? comIrmao : semIrmao).push(c);
  }

  const linha = (c) => {
    const u = uso.get(c);
    const quem = [
      ...u.principalDe.map((e) => `${e} (principal)`),
      ...u.secundarioDe.map((e) => `${e}`),
    ];
    return `  ${c}  ← ${quem.slice(0, 3).join(", ")}${quem.length > 3 ? ` +${quem.length - 3}` : ""}`;
  };

  console.log("═══ COM irmão de subclasse já classificado ═══");
  console.log("(estender o mesmo critério é decisão de consistência, não classificação nova)\n");
  for (const c of comIrmao) {
    console.log(linha(c));
    for (const i of irmaosPorSub.get(subclasse(c))) {
      console.log(`        irmão ${i.cnae} "${i.descricao}" → ${i.tipoReceitaSugerido}`);
    }
  }

  console.log("\n═══ SEM irmão na tabela — precisa de decisão ═══\n");
  for (const c of semIrmao) console.log(linha(c));

  console.log(`\n${comIrmao.length} com precedente · ${semIrmao.length} a decidir`);
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
