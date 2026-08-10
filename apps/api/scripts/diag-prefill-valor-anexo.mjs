// DIAGNÓSTICO (SÓ LEITURA): de onde vem o VALOR pré-preenchido do modal de fechamento?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa (SERPRO/ADN), nenhum ato fiscal.
//
// Reproduz, em leitura, exatamente a derivação de `getDadosFechamento`:
//   memória (ApuracaoConfigMemory) → notas classificadas (montarAtividadesDefault) → CNAE
// e compara a SOMA pré-preenchida com o faturamento EMIT autorizada REAL da competência.
//
// USO:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-prefill-valor-anexo.mjs'
//     --meses=N        janela (default 6)
//     --ate=YYYY-MM    última competência (default: mês anterior)
//     --limite=N       máx. empresas listadas no detalhe (default 40)

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const money = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const padL = (s, n) => String(s ?? "").slice(0, n).padStart(n);
const round2 = (n) => +Number(n || 0).toFixed(2);

function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}
function competenciasAte(ate, meses) {
  const [y, m] = ate.split("-").map(Number);
  const out = [];
  for (let i = meses - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

try {
  const hoje = new Date();
  const ateDefault = (() => {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const ate = arg("ate") || ateDefault;
  const meses = Number(arg("meses")) || 6;
  const limite = Number(arg("limite")) || 40;
  const comps = competenciasAte(ate, meses);

  console.log("=".repeat(110));
  console.log(`PRÉ-PREENCHIMENTO DO VALOR NO MODAL DE FECHAMENTO — competências ${comps[0]} … ${comps[comps.length - 1]}`);
  console.log("=".repeat(110));

  // ─── 0. A CLASSIFICAÇÃO V2 RODOU? ────────────────────────────────────────────────────────────
  const totalItens = await prisma.notaItem.count();
  const comTipo = await prisma.notaItem.count({ where: { NOT: { tipoReceita: null } } });
  const comAnexo = await prisma.notaItem.count({ where: { NOT: { anexoResolvido: null } } });
  const comExport = await prisma.notaItem.count({ where: { flagExportacao: true } });
  console.log(`\n[0] CLASSIFICAÇÃO DOS ITENS`);
  console.log(`    nota_itens ................. ${totalItens}`);
  console.log(`    com tipoReceita (v2) ....... ${comTipo}`);
  console.log(`    com anexoResolvido (legado)  ${comAnexo}`);
  console.log(`    com flagExportacao ......... ${comExport}`);

  // ─── 0b. O CATÁLOGO TEM DE-PARA PARA "NÃO CLASSIFICADA"? ─────────────────────────────────────
  const atvs = await prisma.atividadePgdasd.findMany({
    select: { idAtividade: true, descricao: true, anexoImplicito: true, mercado: true, tipoReceita: true, sujeitoFatorR: true, vigenciaInicio: true, vigenciaFim: true },
  });
  const tiposMapeados = [...new Set(atvs.map((a) => a.tipoReceita).filter(Boolean))];
  console.log(`\n[0b] CATÁLOGO AtividadePgdasd: ${atvs.length} linhas; tipoReceita mapeados = ${tiposMapeados.length ? tiposMapeados.join(", ") : "(nenhum)"}`);
  console.log(`     existe de-para para RECEITA_NAO_CLASSIFICADA? ${tiposMapeados.includes("RECEITA_NAO_CLASSIFICADA") ? "SIM" : "NÃO"}`);

  // ─── 0c. MEMÓRIA DE CONFIG ───────────────────────────────────────────────────────────────────
  const memorias = await prisma.apuracaoConfigMemory.findMany({
    select: { portalClientId: true, atividadesEscolhidas: true, atualizadoEm: true },
  });
  const memPorId = new Map(memorias.map((m) => [m.portalClientId, m]));
  const memComValor = memorias.filter((m) => {
    const l = Array.isArray(m.atividadesEscolhidas) ? m.atividadesEscolhidas : [];
    return l.reduce((s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0) > 0;
  });
  console.log(`\n[0c] ApuracaoConfigMemory: ${memorias.length} empresas com memória; ${memComValor.length} com SOMA > 0 gravada`);

  // ─── 1. VARRE COMPETÊNCIAS ───────────────────────────────────────────────────────────────────
  const clientes = await prisma.portalClient.findMany({
    select: { id: true, cnpj: true, razao: true, companyId: true, empresaZerada: true },
  });
  const cadastros = await prisma.cadastroFiscal.findMany({ select: { portalClientId: true, cnaePrincipal: true } });
  const cadPorId = new Map(cadastros.map((c) => [c.portalClientId, c]));
  const companies = await prisma.company.findMany({ select: { id: true, cnaePrincipal: true } });
  const compPorId = new Map(companies.map((c) => [c.id, c]));
  const cnaeRows = await prisma.cnaeAnexo.findMany({ select: { cnae: true, tipoReceitaSugerido: true } });
  const cnaeMap = new Map(cnaeRows.map((r) => [r.cnae, r.tipoReceitaSugerido]));

  function mapAtividades(dataRef) {
    const m = new Map();
    const vig = atvs
      .filter((a) => a.vigenciaInicio <= dataRef && (!a.vigenciaFim || a.vigenciaFim >= dataRef))
      .sort((a, b) => b.vigenciaInicio - a.vigenciaInicio);
    for (const a of vig) {
      const k = `${a.tipoReceita || "?"}|${a.mercado}`;
      if (!m.has(k)) m.set(k, a);
    }
    return m;
  }

  const stats = {
    total: 0,
    porOrigem: { memoria: 0, notas: 0, cnae: 0, vazio: 0 },
    // casos com faturamento real > 0
    comFat: 0,
    batendo: 0,     // soma prefill == faturamento real (±0,01)
    divergindo: 0,  // soma prefill != faturamento real
    prefillZeroComFat: 0,
    // casos sem faturamento
    semFat: 0,
    semFatComPrefillPositivo: 0,
  };
  const divergencias = [];
  const semFatComValor = [];
  const escalaSuspeita = [];

  for (const competencia of comps) {
    const { gte, lt } = rangeMes(competencia);
    const dataRef = gte;
    const mapAtv = mapAtividades(dataRef);

    // notas EMIT autorizadas do mês, com itens
    const notas = await prisma.portalInvoice.findMany({
      where: { papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } },
      select: { id: true, clientId: true, total: true, itens: { select: { valor: true, tipoReceita: true, flagExportacao: true } } },
    });
    const porCliente = new Map();
    for (const n of notas) {
      if (!n.clientId) continue;
      if (!porCliente.has(n.clientId)) porCliente.set(n.clientId, []);
      porCliente.get(n.clientId).push(n);
    }

    for (const cli of clientes) {
      const minhas = porCliente.get(cli.id) || [];
      // só analisa quem tem alguma vida nessa competência: ou notas, ou memória, ou snapshot
      const temSnapshot = false;
      if (!minhas.length && !memPorId.has(cli.id) && !temSnapshot) continue;

      // faturamento REAL (mesma regra de faturamentoEmitDaCompetencia)
      const fatReal = round2(minhas.reduce((s, n) => s + Number(n.total || 0), 0));

      // receitaPorTipoMercado, reproduzido
      const acc = {};
      let semClassificacao = 0;
      for (const n of minhas) {
        const total = Number(n.total || 0);
        const somaItens = (n.itens || []).reduce((s, it) => s + Number(it.valor || 0), 0);
        const escala = somaItens > 0 ? total / somaItens : 0;
        if (Math.abs(somaItens - total) > 0.02 && somaItens > 0) {
          escalaSuspeita.push({ competencia, cnpj: cli.cnpj, razao: cli.razao, total, somaItens, escala });
        }
        if (!n.itens || n.itens.length === 0) { semClassificacao += total; continue; }
        for (const it of n.itens) {
          const tipo = it.tipoReceita || "RECEITA_NAO_CLASSIFICADA";
          const mercado = it.flagExportacao ? "EXTERNO" : "INTERNO";
          const v = Number(it.valor || 0) * escala;
          acc[`${tipo}|${mercado}`] = (acc[`${tipo}|${mercado}`] || 0) + v;
          if (tipo === "RECEITA_NAO_CLASSIFICADA") semClassificacao += v;
        }
      }
      for (const k of Object.keys(acc)) acc[k] = round2(acc[k]);
      const fatInterno = round2(Object.entries(acc).filter(([k]) => k.endsWith("|INTERNO")).reduce((s, [, v]) => s + v, 0));
      const fatExterno = round2(Object.entries(acc).filter(([k]) => k.endsWith("|EXTERNO")).reduce((s, [, v]) => s + v, 0));

      // ── derivação de getDadosFechamento ──
      let atividades = [];
      let origem = "vazio";
      const mem = memPorId.get(cli.id);
      if (mem && Array.isArray(mem.atividadesEscolhidas) && mem.atividadesEscolhidas.length) {
        atividades = mem.atividadesEscolhidas;
        origem = "memoria";
      } else {
        // montarAtividadesDefault
        const porId = new Map();
        for (const [chave, valor] of Object.entries(acc)) {
          const v = Number(valor) || 0;
          if (v <= 0) continue;
          const [tipoReceita, mercado] = chave.split("|");
          const atv = mapAtv.get(`${tipoReceita}|${mercado}`);
          if (!atv) continue;
          const ex = porId.get(atv.idAtividade) || { idAtividade: atv.idAtividade, anexoImplicito: atv.anexoImplicito, valorInterno: 0, valorExterno: 0 };
          if (mercado === "EXTERNO") ex.valorExterno += v; else ex.valorInterno += v;
          porId.set(atv.idAtividade, ex);
        }
        if (porId.size) { atividades = [...porId.values()]; origem = "notas"; }
      }
      if (!atividades.length) {
        const cnaeEfetivo = cadPorId.get(cli.id)?.cnaePrincipal
          || (cli.companyId ? compPorId.get(cli.companyId)?.cnaePrincipal : null) || null;
        const cnae = String(cnaeEfetivo || "").replace(/\D+/g, "");
        if (cnae.length >= 7) {
          const tipo = cnaeMap.get(cnae.slice(0, 7));
          if (tipo) {
            const ai = mapAtv.get(`${tipo}|INTERNO`);
            const ae = mapAtv.get(`${tipo}|EXTERNO`);
            const out = [];
            if (fatExterno > 0 && ae) out.push({ idAtividade: ae.idAtividade, anexoImplicito: ae.anexoImplicito, valorInterno: 0, valorExterno: round2(fatExterno) });
            if (ai) out.push({ idAtividade: ai.idAtividade, anexoImplicito: ai.anexoImplicito, valorInterno: round2(fatInterno), valorExterno: 0 });
            if (out.length) { atividades = out; origem = "cnae"; }
          }
        }
      }

      const somaPrefill = round2(atividades.reduce((s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0));

      stats.total += 1;
      stats.porOrigem[origem] = (stats.porOrigem[origem] || 0) + 1;

      if (fatReal > 0) {
        stats.comFat += 1;
        if (Math.abs(somaPrefill - fatReal) <= 0.01) stats.batendo += 1;
        else {
          stats.divergindo += 1;
          if (somaPrefill === 0) stats.prefillZeroComFat += 1;
          if (divergencias.length < limite) {
            divergencias.push({
              competencia, cnpj: cli.cnpj, razao: cli.razao, origem,
              fatReal, somaPrefill, delta: round2(somaPrefill - fatReal),
              memEm: mem?.atualizadoEm ? new Date(mem.atualizadoEm).toISOString().slice(0, 10) : "-",
              anexos: [...new Set(atividades.map((a) => a.anexoImplicito).filter(Boolean))].join("/") || "-",
              semClass: round2(semClassificacao),
            });
          }
        }
      } else {
        stats.semFat += 1;
        if (somaPrefill > 0) {
          stats.semFatComPrefillPositivo += 1;
          if (semFatComValor.length < limite) {
            semFatComValor.push({
              competencia, cnpj: cli.cnpj, razao: cli.razao, origem, somaPrefill,
              memEm: mem?.atualizadoEm ? new Date(mem.atualizadoEm).toISOString().slice(0, 10) : "-",
              anexos: [...new Set(atividades.map((a) => a.anexoImplicito).filter(Boolean))].join("/") || "-",
            });
          }
        }
      }
    }
  }

  console.log(`\n[1] RESUMO (${stats.total} pares empresa×competência analisados)`);
  console.log(`    origem do pré-preenchimento: memoria=${stats.porOrigem.memoria} notas=${stats.porOrigem.notas} cnae=${stats.porOrigem.cnae} vazio=${stats.porOrigem.vazio}`);
  console.log(`    COM faturamento real (${stats.comFat}): bate=${stats.batendo}  DIVERGE=${stats.divergindo}  (dos quais prefill=0: ${stats.prefillZeroComFat})`);
  console.log(`    SEM faturamento real (${stats.semFat}): prefill > 0 = ${stats.semFatComPrefillPositivo}  ← valor fantasma na tela`);

  console.log(`\n[2] DIVERGÊNCIAS (empresa TEM faturamento e o prefill não bate) — até ${limite}`);
  console.log(`    ${pad("comp", 8)}${pad("razao", 30)}${pad("origem", 9)}${padL("fat real", 14)}${padL("prefill", 14)}${padL("delta", 14)}  ${pad("anexo", 7)}${pad("memEm", 11)}${padL("semClass", 13)}`);
  for (const d of divergencias) {
    console.log(`    ${pad(d.competencia, 8)}${pad(d.razao, 30)}${pad(d.origem, 9)}${padL(money(d.fatReal), 14)}${padL(money(d.somaPrefill), 14)}${padL(money(d.delta), 14)}  ${pad(d.anexos, 7)}${pad(d.memEm, 11)}${padL(money(d.semClass), 13)}`);
  }
  if (!divergencias.length) console.log("    (nenhuma)");

  console.log(`\n[3] SEM FATURAMENTO mas com VALOR pré-preenchido — até ${limite}`);
  console.log(`    ${pad("comp", 8)}${pad("razao", 30)}${pad("origem", 9)}${padL("prefill", 14)}  ${pad("anexo", 7)}${pad("memEm", 11)}`);
  for (const d of semFatComValor) {
    console.log(`    ${pad(d.competencia, 8)}${pad(d.razao, 30)}${pad(d.origem, 9)}${padL(money(d.somaPrefill), 14)}  ${pad(d.anexos, 7)}${pad(d.memEm, 11)}`);
  }
  if (!semFatComValor.length) console.log("    (nenhum)");

  console.log(`\n[4] NOTAS onde soma(itens) != total (a 'escala' de rateio entra em ação) — até 20 de ${escalaSuspeita.length}`);
  for (const e of escalaSuspeita.slice(0, 20)) {
    console.log(`    ${pad(e.competencia, 8)}${pad(e.razao, 30)} total=${padL(money(e.total), 12)} somaItens=${padL(money(e.somaItens), 12)} escala=${e.escala.toFixed(6)}`);
  }
  if (!escalaSuspeita.length) console.log("    (nenhuma)");

  console.log("\n" + "=".repeat(110));
} catch (err) {
  console.error("ERRO:", err?.message || err);
  console.error(err?.stack);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
