// DIAGNÓSTICO: existe espelho de DEFIS em empresa que NÃO é do Simples Nacional?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum ato fiscal. Nada aqui apaga
// espelho nenhum: dado preenchido é afirmação de alguém, e a decisão de removê-lo é do dono.
//
// POR QUE ELE EXISTE
// A DEFIS é obrigação de quem foi optante pelo Simples Nacional em algum período do ano-calendário
// (Manual do PGDAS-D e DEFIS, RFB, seção 9 — "deve ser prestada por contribuinte optante do Simples
// Nacional por pelo menos um período nela abrangido"; LC 123/2006, art. 25, caput). A tela oferecia
// o espelho a TODA empresa, sem perguntar o regime — inclusive às do Lucro Presumido, que não a
// entregam. Este script mede o estrago real antes de qualquer conserto:
//
//   • quantas empresas existem por regime cadastrado;
//   • quantos espelhos de DEFIS existem, e de que regime é a empresa de cada um;
//   • quais espelhos de empresa NÃO-Simples têm DADO PREENCHIDO (≠ folha em branco);
//   • e, o mais importante, quais têm RECIBO/TRANSMISSÃO registrada — isso é FATO a preservar e
//     relatar, nunca a apagar.
//
// ⚠ O regime cadastrado é o de HOJE. Empresa que saiu do Simples continua devendo a DEFIS do
// ano em que foi optante ("em relação ao ano-calendário de exclusão da PJ do Simples Nacional, a
// DEFIS abrangerá o período em que esteve na condição de optante" — mesmo manual, item 9.2.2).
// Por isso o script imprime o ANO de cada espelho: espelho de ano antigo numa empresa hoje no
// Presumido pode ser trabalho legítimo, não engano.
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-defis-por-regime.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

/** Mesma normalização da regra da tela (`obrigatoriedadeDefis.js`). */
function normalizarRegime(regime) {
  return String(regime || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

const DO_SIMPLES = new Set(["SIMPLES", "SIMPLES_NACIONAL"]);

/**
 * O espelho tem DADO, ou é folha em branco?
 * `espelhoVazio()` já nasce com `anoCalendario`, `tipoDeclaracao` e listas vazias — contar isso
 * como "preenchido" transformaria todo clique de abrir a tela em dado digitado.
 */
function temDadoPreenchido(dados) {
  if (!dados || typeof dados !== "object") return false;
  let achou = false;
  const visitar = (v, chave) => {
    if (achou) return;
    if (chave === "anoCalendario" || chave === "tipoDeclaracao" || chave === "transmitida") return;
    if (v == null || v === "" || v === false) return;
    if (Array.isArray(v)) { v.forEach((item) => visitar(item, null)); return; }
    if (typeof v === "object") { for (const [k, val] of Object.entries(v)) visitar(val, k); return; }
    achou = true;
  };
  visitar(dados, null);
  return achou;
}

async function main() {
  // ⚠ O regime NÃO mora no PortalClient — ele é do cadastro legado (`Company.regimeTributario`),
  // exatamente como a tela lê (`selectedCompany.legacyCompany.regimeTributario`). Ler do lugar
  // errado devolveria `undefined` para a carteira inteira e o script diria "sem regime" de todo
  // mundo, que é o oposto do que se quer medir.
  const portais = await prisma.portalClient.findMany({
    select: { id: true, companyId: true, razao: true, cnpj: true },
  });
  const companyIds = portais.map((p) => p.companyId).filter(Boolean);
  const legadas = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, regimeTributario: true, tipoTributario: true, optanteSimples: true },
  });
  const legadaPorId = new Map(legadas.map((c) => [c.id, c]));

  const empresas = portais.map((p) => {
    const legacy = p.companyId ? legadaPorId.get(p.companyId) : null;
    return {
      id: p.id,
      name: p.razao,
      cnpj: p.cnpj,
      regimeTributario: legacy?.regimeTributario || legacy?.tipoTributario || null,
      optanteSimples: legacy?.optanteSimples ?? null,
    };
  });
  const porId = new Map(empresas.map((e) => [e.id, e]));

  // ── 1. A carteira por regime ────────────────────────────────────────────────
  const porRegime = new Map();
  for (const e of empresas) {
    const r = normalizarRegime(e.regimeTributario) || "(sem regime cadastrado)";
    porRegime.set(r, (porRegime.get(r) || 0) + 1);
  }
  console.log(`\n=== CARTEIRA (${empresas.length} empresas) ===`);
  for (const [r, n] of [...porRegime].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${r}`);
  }

  // ── 2. Os espelhos de DEFIS ─────────────────────────────────────────────────
  const espelhos = await prisma.defisEspelho.findMany({
    select: {
      id: true, portalClientId: true, anoCalendario: true, dados: true,
      transmitidaEm: true, transmitidaPorId: true, reciboFileId: true,
      createdAt: true, updatedAt: true,
    },
    orderBy: [{ anoCalendario: "desc" }],
  });
  console.log(`\n=== ESPELHOS DE DEFIS (${espelhos.length}) ===`);
  if (!espelhos.length) {
    console.log("  nenhum espelho gravado.");
  }

  const naoSimples = [];
  let simplesCount = 0;
  for (const esp of espelhos) {
    const emp = porId.get(esp.portalClientId);
    const regime = normalizarRegime(emp?.regimeTributario);
    const ehSimples = DO_SIMPLES.has(regime) || (!regime && emp?.optanteSimples === true);
    if (ehSimples) { simplesCount += 1; continue; }
    naoSimples.push({ esp, emp, regime: regime || "(sem regime cadastrado)" });
  }

  console.log(`  de empresa do Simples ............ ${simplesCount}`);
  console.log(`  de empresa NÃO-Simples / sem regime ${naoSimples.length}`);

  // ── 3. O que importa: espelho em empresa que não é do Simples ───────────────
  if (naoSimples.length) {
    console.log(`\n=== ESPELHOS EM EMPRESA NÃO-SIMPLES — detalhe ===`);
    console.log("  (⚠ nada é apagado por este script; a decisão é do dono)\n");
    for (const { esp, emp, regime } of naoSimples) {
      const preenchido = temDadoPreenchido(esp.dados);
      const recibo = Boolean(esp.transmitidaEm || esp.reciboFileId);
      const marcas = [
        preenchido ? "COM DADO PREENCHIDO" : "folha em branco",
        recibo ? "⚠ COM RECIBO/TRANSMISSÃO REGISTRADA" : "sem recibo",
      ].join(" · ");
      console.log(`  ano ${esp.anoCalendario} · regime ${regime}`);
      console.log(`    empresa: ${emp?.name || "(não encontrada)"} ${emp?.cnpj || ""}`);
      console.log(`    ${marcas}`);
      if (esp.transmitidaEm) {
        console.log(`    transmitidaEm: ${esp.transmitidaEm.toISOString()} · por: ${esp.transmitidaPorId || "—"}`);
      }
      console.log(`    criado ${esp.createdAt?.toISOString?.() || "—"} · atualizado ${esp.updatedAt?.toISOString?.() || "—"}`);
      console.log("");
    }
  }

  // ── 4. Veredito ─────────────────────────────────────────────────────────────
  const comDado = naoSimples.filter((x) => temDadoPreenchido(x.esp.dados)).length;
  const comRecibo = naoSimples.filter((x) => x.esp.transmitidaEm || x.esp.reciboFileId).length;
  console.log("=== VEREDITO ===");
  console.log(`  espelhos em empresa não-Simples ....... ${naoSimples.length}`);
  console.log(`  …destes, COM DADO preenchido .......... ${comDado}`);
  console.log(`  …destes, COM RECIBO/TRANSMISSÃO ....... ${comRecibo}`);
  if (comRecibo) {
    console.log("  ⚠ Há entrega REGISTRADA em empresa não-Simples. É fato, não engano de tela:");
    console.log("    pode ser o ano em que a empresa ainda era optante. NÃO apagar — relatar ao dono.");
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
