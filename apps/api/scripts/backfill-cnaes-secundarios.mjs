// Preenche os CNAEs SECUNDÁRIOS das empresas cadastradas antes de a consulta ao CNPJ passar a
// trazê-los. Busca na BrasilAPI (pública, gratuita, sem credencial) e grava no Company.
//
// Por que importa: o classificador consolida a sugestão de anexo sobre o CONJUNTO de CNAEs
// (principal + secundários). Uma empresa de apoio administrativo que também tem "administração de
// obras" e "serviços de engenharia" nos secundários é um caso diferente de quem só tem o primeiro
// — e era assim que a ERISANGELA estava: os 3 secundários existiam no cartão CNPJ e não no sistema.
//
//   node scripts/backfill-cnaes-secundarios.mjs             → relatório (não grava)
//   node scripts/backfill-cnaes-secundarios.mjs --aplicar   → grava
//   ... --cnpj=<cnpj>                                       → uma empresa só
//
// NÃO sobrescreve secundários já preenchidos, a menos que --forcar. O CNAE principal nunca é
// tocado aqui: mexer nele muda enquadramento, e isso é decisão do contador, não de um script.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { normalizarCnae } from "../src/application/notas/apuracao/v2/CnaesDaEmpresaService.js";

const aplicar = process.argv.includes("--aplicar");
const forcar = process.argv.includes("--forcar");
function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A BrasilAPI é pública e sem contrato de uso pesado: uma consulta por vez, com pausa.
async function consultarCnpj(cnpj) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${onlyDigits(cnpj)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

try {
  const cnpjFiltro = arg("cnpj");
  const empresas = await prisma.company.findMany({
    where: cnpjFiltro ? { cnpj: { in: [cnpjFiltro, onlyDigits(cnpjFiltro)] } } : {},
    select: { id: true, cnpj: true, razaoSocial: true, cnaePrincipal: true, cnaesSecundarios: true },
    orderBy: { razaoSocial: "asc" },
  });
  if (!empresas.length) { console.error("Nenhuma empresa encontrada."); process.exit(1); }

  console.log(`${empresas.length} empresa(s)${aplicar ? "" : "  (simulação — use --aplicar para gravar)"}\n`);

  let corrigidas = 0, jaTinham = 0, semSecundarios = 0, falhas = 0;

  for (const emp of empresas) {
    const atuais = (emp.cnaesSecundarios || []).map(normalizarCnae).filter(Boolean);
    if (atuais.length && !forcar) { jaTinham += 1; continue; }

    let dados;
    try {
      dados = await consultarCnpj(emp.cnpj);
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${(emp.razaoSocial || "").slice(0, 36).padEnd(36)} ${emp.cnpj}  — consulta falhou: ${err.message}`);
      await sleep(1200);
      continue;
    }

    const principalNorm = normalizarCnae(emp.cnaePrincipal);
    const novos = [...new Set(
      (Array.isArray(dados?.cnaes_secundarios) ? dados.cnaes_secundarios : [])
        .map((c) => normalizarCnae(c?.codigo))
        .filter(Boolean)
        // O principal não se repete entre os secundários — duplicado só polui a consolidação.
        .filter((c) => c !== principalNorm),
    )];

    if (!novos.length) { semSecundarios += 1; await sleep(1200); continue; }

    const descricoes = new Map(
      (dados.cnaes_secundarios || []).map((c) => [normalizarCnae(c?.codigo), String(c?.descricao || "")]),
    );
    console.log(`  ${(emp.razaoSocial || "").slice(0, 36).padEnd(36)} ${emp.cnpj}`);
    console.log(`     principal: ${principalNorm || "?"}`);
    for (const c of novos) console.log(`     + ${c}  ${descricoes.get(c) || ""}`.slice(0, 100));

    if (aplicar) {
      await prisma.company.update({ where: { id: emp.id }, data: { cnaesSecundarios: novos } });
    }
    corrigidas += 1;
    await sleep(1200);
  }

  console.log("\n" + "─".repeat(64));
  console.log(`A corrigir/corrigidas ..: ${corrigidas}`);
  console.log(`Já tinham secundários ..: ${jaTinham}${forcar ? " (reconsultadas por --forcar)" : ""}`);
  console.log(`Sem secundários no CNPJ : ${semSecundarios}`);
  console.log(`Falhas na consulta .....: ${falhas}`);
  if (corrigidas && !aplicar) console.log("\nRode de novo com --aplicar para gravar.");
  if (corrigidas && aplicar) {
    console.log("\nOs CNAEs novos entram na sugestão de anexo assim que houver linha em CnaeAnexo.");
    console.log("Rode `node scripts/diag-notas-apuracao.mjs` para ver quais ainda faltam na tabela.");
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
