// O CÓDIGO DE SERVIÇO MUNICIPAL E OS CNAEs DA CARTEIRA — SOMENTE LEITURA.
//
// Duas perguntas, uma leitura só, e nenhuma delas se responde por suposição:
//
// 1. ⚠ O dono disse (25/08/2026), sobre o código de serviço do município: **"geralmente é 001"**.
//    Isso responde EM PARTE uma pergunta que está pendente no projeto desde 16/08/2026 — o
//    `apps/api/CLAUDE.md` registra que "o comprimento do `cTribMun` NÃO está provado" e que
//    `buildDpsXml` corta os últimos 3 dígitos "por enquanto".
//    ⚠⚠ MAS "GERALMENTE" NÃO É "SEMPRE", e código de serviço municipal errado sai como nota fiscal
//    com o ISS classificado errado — no município, contra o cliente. Este script mede o que a base
//    REALMENTE tem antes de qualquer default ser desenhado.
//
// 2. Quais CNAEs distintos existem na carteira — é a lista que o de-para CNAE→categoria de
//    presunção do Lucro Presumido precisa cobrir, e o dono vai confirmar um a um.
//
// ⚠ NÃO ESCREVE NADA e não há `--aplicar`. Zero chamada a SERPRO, SEFAZ, ADN ou Meta.
//
// Uso:
//   node apps/api/scripts/diag-codigo-servico-municipal.mjs
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-codigo-servico-municipal.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const soDigitos = (s) => String(s || "").replace(/\D+/g, "");

async function main() {
  const portais = await prisma.portalClient.findMany({
    select: { id: true, razao: true, cnpj: true, companyId: true, municipio: true, uf: true },
    orderBy: { razao: "asc" },
  });

  const companies = await prisma.company.findMany({
    select: {
      id: true, codigoServicoMunicipal: true, codigoServicoNacional: true,
      codigosServicoNacional: true, cnaePrincipal: true, cnaesSecundarios: true,
      codigoMunicipioIbge: true, inscricaoMunicipal: true,
    },
  }).catch(() => []);
  const porCompany = new Map(companies.map((c) => [c.id, c]));

  console.log(`\nEmpresas: ${portais.length}\n`);
  console.log(`${pad("EMPRESA", 28)} ${pad("MUNICÍPIO", 18)} ${pad("CÓD.SERV.MUNIC.", 16)} ${pad("IBGE", 8)} CNAE principal`);
  console.log("-".repeat(104));

  const municipais = new Map();
  const cnaes = new Map();
  let semCompany = 0;

  for (const p of portais) {
    const c = p.companyId ? porCompany.get(p.companyId) : null;
    if (!c) semCompany += 1;

    const codMun = (c?.codigoServicoMunicipal || "").trim();
    const chave = codMun || "(vazio)";
    municipais.set(chave, (municipais.get(chave) || 0) + 1);

    const principal = soDigitos(c?.cnaePrincipal).slice(0, 7);
    const todos = [principal, ...(c?.cnaesSecundarios || []).map((x) => soDigitos(x).slice(0, 7))].filter((x) => x.length === 7);
    for (const cn of todos) {
      if (!cnaes.has(cn)) cnaes.set(cn, { empresas: 0, principalEm: 0 });
      cnaes.get(cn).empresas += 1;
      if (cn === principal) cnaes.get(cn).principalEm += 1;
    }

    console.log(
      `${pad(p.razao, 28)} ${pad(`${p.municipio || "—"}/${p.uf || "—"}`, 18)} `
      + `${pad(codMun || "— vazio —", 16)} ${pad(c?.codigoMunicipioIbge || "—", 8)} ${principal || "—"}`,
    );
  }

  console.log("\n─── CÓDIGO DE SERVIÇO MUNICIPAL, por valor ───");
  for (const [valor, n] of [...municipais.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(valor, 18)} ${String(n).padStart(3)} empresa(s)`);
  }
  const preenchidos = [...municipais.entries()].filter(([v]) => v !== "(vazio)");
  const total = portais.length;
  const nPreenchidos = preenchidos.reduce((s, [, n]) => s + n, 0);
  console.log(`\n  preenchidos: ${nPreenchidos} de ${total}`);
  if (nPreenchidos === 0) {
    console.log(
      "\n  ⚠⚠ NENHUMA EMPRESA TEM O CÓDIGO PREENCHIDO. Então a base NÃO CORROBORA nem contradiz o\n"
      + '     "geralmente é 001" — ela não tem opinião. Cravar 001 como default seria o portal\n'
      + "     AFIRMANDO a classificação de ISS de 33 empresas a partir de uma frase, e o erro sai\n"
      + "     como nota fiscal emitida no município. Se virar sugestão, tem de vir marcada como\n"
      + "     sugestão, e o contador confirma — nunca pré-preenchida em silêncio.",
    );
  }

  console.log("\n─── CNAEs DISTINTOS NA CARTEIRA (o de-para de presunção precisa cobrir estes) ───");
  const ordenados = [...cnaes.entries()].sort((a, b) => b[1].empresas - a[1].empresas);
  console.log(`  ${ordenados.length} CNAEs distintos\n`);
  const refs = ordenados.length
    ? await prisma.cnaeAnexo.findMany({
      where: { cnae: { in: ordenados.map(([c]) => c) } },
      select: { cnae: true, descricao: true, tipoReceitaSugerido: true },
    }).catch(() => [])
    : [];
  const porCnae = new Map(refs.map((r) => [r.cnae, r]));
  let foraDoCatalogo = 0;
  for (const [cnae, info] of ordenados) {
    const ref = porCnae.get(cnae);
    if (!ref) foraDoCatalogo += 1;
    console.log(
      `  ${cnae}  ${String(info.empresas).padStart(2)} empresa(s)  ${pad(ref?.tipoReceitaSugerido || "⚠ FORA DO CATÁLOGO", 20)} ${(ref?.descricao || "").slice(0, 52)}`,
    );
  }
  console.log(`\n  fora do catálogo de CNAE do portal: ${foraDoCatalogo} de ${ordenados.length}`);
  if (semCompany) console.log(`  ⚠ ${semCompany} empresa(s) sem \`Company\` legada — nada a ler nelas`);
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
