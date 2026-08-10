// DIAGNÓSTICO: a empresa SEM FATURAMENTO consegue ser apurada e fechada?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum ato fiscal.
//
// POR QUE ELE EXISTE
// Empresa sem faturamento também precisa declarar o PGDAS-D — zerado. O caminho existe
// (`FechamentoService.calcularFechamento` com `semMovimento`), mas a caixa que LIGA esse caminho
// (`FechamentoModal`, "Declarar SEM MOVIMENTO") só é RENDERIZADA quando a lista de atividades chega
// vazia. E `getDadosFechamento` preenche a lista por duas vias que não dependem de receita nenhuma:
// a memória da última config (`ApuracaoConfigMemory`) e o CNAE (`montarAtividadesDoCnae`, que emite
// a linha "mesmo com faturamento 0, só pra TRAZER o ANEXO").
//
// Este script MEDE, competência a competência:
//   • quantas empresas ficaram com faturamento EMIT autorizada = 0;
//   • em que estado a apuração delas parou, com qual `conferenciaStatus`;
//   • se o mês foi marcado `semFaturamento` e se o fechamento CONTÁBIL saiu;
//   • e, para cada uma, se a caixa "Declarar SEM MOVIMENTO" seria ALCANÇÁVEL na tela — a mesma
//     derivação de `getDadosFechamento` (memória → CNAE), reproduzida aqui em leitura.
//
// Fecha com o que o SERPRO respondeu de fato (`serpro_chamadas`, TRANSDECLARACAO11), porque a
// mensagem da RFB é a única explicação que existe para uma recusa de declaração.
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-empresa-zerada.mjs'
//
//   --meses=N     janela (default 12)
//   --ate=YYYY-MM última competência (default: mês anterior)

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const money = (n) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);

function competenciasAte(ate, meses) {
  const [y, m] = ate.split("-").map(Number);
  const out = [];
  for (let i = meses - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

try {
  const hoje = new Date();
  const ateDefault = (() => {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const ate = arg("ate") || ateDefault;
  const meses = Number(arg("meses")) || 12;
  const comps = competenciasAte(ate, meses);

  // ── Empresas (só as que apuramos: Simples) ────────────────────────────────
  const portais = await prisma.portalClient.findMany({
    select: { id: true, razao: true, cnpj: true, companyId: true, empresaZerada: true },
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: portais.map((p) => p.companyId).filter(Boolean) } },
    select: { id: true, cnpj: true, razaoSocial: true, regimeTributario: true, tipoTributario: true, cnaePrincipal: true },
  });
  const byCompany = new Map(companies.map((c) => [c.id, c]));
  const ehSimples = (c) => !/PRESUMID|REAL/i.test(String(c?.regimeTributario || c?.tipoTributario || ""));
  const empresas = portais
    .filter((p) => p.companyId && byCompany.has(p.companyId) && ehSimples(byCompany.get(p.companyId)))
    .map((p) => ({
      portalClientId: p.id,
      razao: p.razao || byCompany.get(p.companyId)?.razaoSocial || "",
      cnpj: p.cnpj || byCompany.get(p.companyId)?.cnpj || "",
      empresaZerada: Boolean(p.empresaZerada),
      cnaeCompany: byCompany.get(p.companyId)?.cnaePrincipal || null,
    }));
  const ids = empresas.map((e) => e.portalClientId);
  console.log(`Empresa sem faturamento × apuração · ${comps[0]} → ${comps[comps.length - 1]} · ${empresas.length} empresa(s) do Simples\n`);
  if (!ids.length) { console.log("Nenhuma empresa."); process.exit(0); }

  // ── Faturamento EMIT autorizada por competência (a MESMA where do FechamentoService) ──
  const fatPorChave = new Map(); // `${pcId}|${comp}` → total
  for (const comp of comps) {
    const { gte, lt } = rangeMes(comp);
    // eslint-disable-next-line no-await-in-loop
    const linhas = await prisma.portalInvoice.groupBy({
      by: ["clientId"],
      where: { papel: "EMIT", statusEfetivo: "autorizada", clientId: { in: ids }, competencia: { gte, lt } },
      _sum: { total: true },
      _count: { _all: true },
    });
    for (const l of linhas) fatPorChave.set(`${l.clientId}|${comp}`, Number(l._sum?.total || 0));
  }

  // ── Snapshots / circulares / memória / cadastro ───────────────────────────
  const snaps = await prisma.apuracaoSnapshot.findMany({
    where: { portalClientId: { in: ids }, competencia: { in: comps } },
    select: {
      portalClientId: true, competencia: true, estado: true, conferenciaStatus: true, conferidaEm: true,
      receitaInterna: true, receitaExterna: true, dasCalculadoLocal: true, dasRetornadoSerpro: true,
      atividadesEscolhidas: true, erroMensagem: true, fechadaEm: true, transmitidoEm: true,
    },
  });
  const snapPorChave = new Map(snaps.map((s) => [`${s.portalClientId}|${s.competencia}`, s]));

  const circulares = await prisma.companyMonthlyCircular.findMany({
    where: { portalClientId: { in: ids }, competencia: { in: comps } },
    select: {
      portalClientId: true, competencia: true, semFaturamento: true, semFaturamentoConferencia: true,
      fechadoContabilEm: true, folhaProlaboreOk: true, despesasOk: true, receitasOk: true,
      provisoesOk: true, pagamentosOk: true,
    },
  });
  const circPorChave = new Map(circulares.map((c) => [`${c.portalClientId}|${c.competencia}`, c]));

  const memorias = await prisma.apuracaoConfigMemory.findMany({
    where: { portalClientId: { in: ids } },
    select: { portalClientId: true, atividadesEscolhidas: true, atualizadoEm: true },
  });
  const memPorId = new Map(memorias.map((m) => [m.portalClientId, m]));

  const cadastros = await prisma.cadastroFiscal.findMany({
    where: { portalClientId: { in: ids } },
    select: { portalClientId: true, cnaePrincipal: true },
  });
  const cadPorId = new Map(cadastros.map((c) => [c.portalClientId, c]));

  // Mapeamento CNAE → tipoReceita → idAtividade (o que `montarAtividadesDoCnae` faz).
  const cnaes = [...new Set(empresas
    .map((e) => String(cadPorId.get(e.portalClientId)?.cnaePrincipal || e.cnaeCompany || "").replace(/\D+/g, "").slice(0, 7))
    .filter((c) => c.length === 7))];
  const cnaeRows = cnaes.length
    ? await prisma.cnaeAnexo.findMany({ where: { cnae: { in: cnaes } }, select: { cnae: true, tipoReceitaSugerido: true } })
    : [];
  const cnaeTipo = new Map(cnaeRows.map((r) => [r.cnae, r.tipoReceitaSugerido]));
  const atvRows = await prisma.atividadePgdasd.findMany({
    where: { vigenciaInicio: { lte: new Date() }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date() } }] },
    select: { tipoReceita: true, mercado: true, idAtividade: true },
  });
  const atvChaves = new Set(atvRows.map((a) => `${a.tipoReceita}|${a.mercado}`));

  // A MESMA derivação de `getDadosFechamento`: memória vence; senão o CNAE.
  function atividadesQueOModalReceberia(emp) {
    const mem = memPorId.get(emp.portalClientId);
    const memAtv = Array.isArray(mem?.atividadesEscolhidas) ? mem.atividadesEscolhidas : [];
    if (memAtv.length) return { origem: "memoria", n: memAtv.length };
    const cnae = String(cadPorId.get(emp.portalClientId)?.cnaePrincipal || emp.cnaeCompany || "").replace(/\D+/g, "").slice(0, 7);
    const tipo = cnae.length === 7 ? cnaeTipo.get(cnae) : null;
    if (tipo && atvChaves.has(`${tipo}|INTERNO`)) return { origem: "cnae", n: 1 };
    return { origem: "vazia", n: 0 };
  }

  // ── Varredura ─────────────────────────────────────────────────────────────
  const zeradas = [];
  for (const emp of empresas) {
    for (const comp of comps) {
      const fat = fatPorChave.get(`${emp.portalClientId}|${comp}`) || 0;
      if (fat > 0) continue;
      const snap = snapPorChave.get(`${emp.portalClientId}|${comp}`) || null;
      const circ = circPorChave.get(`${emp.portalClientId}|${comp}`) || null;
      zeradas.push({ emp, comp, snap, circ, atv: atividadesQueOModalReceberia(emp) });
    }
  }

  const totalCelulas = empresas.length * comps.length;
  console.log(`Células empresa×competência ...........: ${totalCelulas}`);
  console.log(`Com faturamento EMIT = 0 (candidatas) .: ${zeradas.length}\n`);

  const conta = (lista, chave) => {
    const m = new Map();
    for (const z of lista) { const k = chave(z); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log("Estado da APURAÇÃO nas competências sem faturamento");
  for (const [k, n] of conta(zeradas, (z) => z.snap?.estado || "(sem snapshot)")) console.log(`   ${pad(k, 26)} ${n}`);
  console.log("\nConferência ADN dessas competências");
  for (const [k, n] of conta(zeradas, (z) => z.snap ? (z.snap.conferenciaStatus || "(nunca conferida)") : "(sem snapshot)")) console.log(`   ${pad(k, 26)} ${n}`);
  console.log("\n`semFaturamento` (afirmação do mês, aba Lançamentos)");
  for (const [k, n] of conta(zeradas, (z) => z.circ?.semFaturamento === true ? "marcado" : (z.circ ? "não marcado" : "(sem circular)"))) console.log(`   ${pad(k, 26)} ${n}`);
  console.log("\nFechamento CONTÁBIL do mês");
  for (const [k, n] of conta(zeradas, (z) => z.circ?.fechadoContabilEm ? "fechado" : "aberto")) console.log(`   ${pad(k, 26)} ${n}`);
  console.log("\nA caixa \"Declarar SEM MOVIMENTO\" seria RENDERIZADA? (só quando atividades = [])");
  for (const [k, n] of conta(zeradas, (z) => z.atv.n === 0 ? "SIM (lista vazia)" : `NÃO (${z.atv.origem} → ${z.atv.n} atividade[s])`)) console.log(`   ${pad(k, 30)} ${n}`);

  // ── Detalhe por empresa ───────────────────────────────────────────────────
  const porEmpresa = new Map();
  for (const z of zeradas) {
    if (!porEmpresa.has(z.emp.portalClientId)) porEmpresa.set(z.emp.portalClientId, []);
    porEmpresa.get(z.emp.portalClientId).push(z);
  }
  console.log(`\n${"─".repeat(100)}\nDETALHE (só competências sem faturamento)\n`);
  for (const [pcId, lista] of porEmpresa) {
    const emp = lista[0].emp;
    const alcanca = lista[0].atv.n === 0;
    console.log(`${pad(emp.razao, 38)} ${emp.cnpj}${emp.empresaZerada ? "  [empresaZerada]" : ""}`);
    console.log(`   caixa sem movimento: ${alcanca ? "alcançável" : `INALCANÇÁVEL — atividades vindas de ${lista[0].atv.origem}`}`);
    for (const z of lista) {
      const estado = z.snap?.estado || "sem snapshot";
      const conf = z.snap ? (z.snap.conferenciaStatus || "ADN —") : "ADN —";
      const sf = z.circ?.semFaturamento === true ? "semFat✓" : "semFat—";
      const fc = z.circ?.fechadoContabilEm ? "contábil✓" : "contábil—";
      const soma = z.snap ? Number(z.snap.receitaInterna || 0) + Number(z.snap.receitaExterna || 0) : null;
      const err = z.snap?.erroMensagem ? `  ERRO: ${String(z.snap.erroMensagem).slice(0, 90)}` : "";
      console.log(`     ${z.comp}  ${pad(estado, 22)} ${pad(conf, 18)} ${sf}  ${fc}  ${soma == null ? "" : `atv ${money(soma)}`}${err}`);
    }
    console.log("");
  }

  // ── O que o SERPRO respondeu de fato ──────────────────────────────────────
  console.log(`${"─".repeat(100)}\nSERPRO — TRANSDECLARACAO11 (o que a RFB respondeu)\n`);
  const desde = new Date(Date.now() - 180 * 24 * 3600 * 1000);
  const chamadas = await prisma.serproChamada.groupBy({
    by: ["status", "erroCodigo", "erroMensagem"],
    where: { idServico: "TRANSDECLARACAO11", createdAt: { gte: desde } },
    _count: { _all: true },
  }).catch((e) => { console.log("  (não consegui ler serpro_chamadas:", e?.message, ")"); return []; });
  const ordenadas = chamadas.sort((a, b) => b._count._all - a._count._all);
  for (const c of ordenadas.slice(0, 25)) {
    console.log(`   ${String(c._count._all).padStart(4)}×  ${pad(c.status, 20)} ${c.erroCodigo || ""}`);
    if (c.erroMensagem) console.log(`         ${String(c.erroMensagem).slice(0, 260)}`);
  }
  if (!ordenadas.length) console.log("   nenhuma chamada TRANSDECLARACAO11 nos últimos 180 dias.");

  // Chamadas das empresas zeradas, nominalmente.
  const idsZerados = [...porEmpresa.keys()];
  if (idsZerados.length) {
    const doGrupo = await prisma.serproChamada.findMany({
      where: { idServico: "TRANSDECLARACAO11", portalClientId: { in: idsZerados }, createdAt: { gte: desde } },
      select: { portalClientId: true, status: true, erroCodigo: true, erroMensagem: true, createdAt: true, origem: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    if (doGrupo.length) {
      console.log(`\n   Últimas chamadas das empresas SEM faturamento:`);
      const nome = new Map(empresas.map((e) => [e.portalClientId, e.razao]));
      for (const c of doGrupo) {
        console.log(`   ${c.createdAt.toISOString().slice(0, 16)}  ${pad(nome.get(c.portalClientId) || c.portalClientId, 26)} ${pad(c.status, 14)} ${pad(c.origem || "", 22)} ${String(c.erroMensagem || "").slice(0, 120)}`);
      }
    }
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
