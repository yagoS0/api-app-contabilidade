// DIAGNÓSTICO: depois de uma RETIFICADORA, o lançamento do IMPOSTO acompanha o extrato novo?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada ao SERPRO, nenhum ato fiscal.
//
// POR QUE ELE EXISTE
// Ao reconsultar o extrato do Simples depois de uma retificadora, `syncPgdasByCompetencia` reescreve
// a circular INTEIRA (receitas E `dasTotal`) e chama `generateEntriesFromCircular` SEM
// `edicaoManual`. Lá dentro, `upsertGeneratedEntry` bifurca:
//   • RECEITA_*        → ramo genérico  → apaga e recria as LINHAS com o valor novo;
//   • DAS_SIMPLES      → ramo `recalculated` (AccountingEntryGeneratorService.js:369) → preserva
//                        `data`, `historico` e **as LINHAS**, e só carimba `recalculatedAt` /
//                        `recalculatedFromValor` / `recalculatedToValor`.
// Ou seja: a receita entra, o imposto NÃO. A guarda existe para o recálculo automático do SERPRO
// (juros após vencimento) e não sabe distinguir isso de uma declaração retificada.
//
// O QUE ELE MEDE (por competência com extrato consultado):
//   • se há indício de RETIFICADORA — o sufixo do `pgdasNumeroDeclaracao` (a RFB numera
//     001, 002, 003… por PA) e/ou o número transmitido no `ApuracaoSnapshot` divergindo do último
//     número que a RFB devolveu no extrato;
//   • se o lançamento do DAS está CONGELADO — soma das linhas ≠ `dasTotal` da circular;
//   • se o lançamento de RECEITA acompanhou — soma das linhas × campo correspondente da circular;
//   • o carimbo `recalculated*`, que é a prova de que o valor novo foi LIDO e IGNORADO
//     (distingue "não lê" de "lê e descarta").
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-retificadora-imposto.mjs'
//
//   --cnpj=<digitos>   filtra uma empresa
//   --todos            lista TODAS as competências, não só as divergentes

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const flag = (name) => process.argv.includes(`--${name}`);
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const num = (v) => (v == null ? null : Number(v));
const money = (n) => (n == null ? "     —      " : `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const padL = (s, n) => String(s ?? "").slice(0, n).padStart(n);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const difere = (a, b) => Math.abs(round2(a) - round2(b)) > 0.01;

// A RFB numera as declarações de um PA em sequência: os 3 últimos dígitos do número da declaração.
// `65227792202602003` = 8 dígitos + AAAA + MM + 003 → TERCEIRA declaração daquele período.
// Sufixo > 001 é, portanto, indício direto de retificadora (a 1ª é a original).
function sequenciaDaDeclaracao(numero) {
  const d = onlyDigits(numero);
  if (d.length < 3) return null;
  const seq = Number(d.slice(-3));
  return Number.isFinite(seq) ? seq : null;
}

// Mesma leitura de `resolveAmount` (AccountingEntryGeneratorService.js:186): havendo split
// principal/juros/multa gravado em `acrescimos`, a provisão do DAS usa o PRINCIPAL, não o total.
// Sem reproduzir isso aqui a medição acusaria como "congelado" o caso legítimo de juros.
function valorEsperadoDas(circ) {
  const acr = circ.acrescimos && typeof circ.acrescimos === "object" ? circ.acrescimos : null;
  const principal = acr?.DAS?.principal;
  if (principal != null && Number.isFinite(Number(principal))) {
    return { valor: round2(principal), fonte: "acrescimos.DAS.principal" };
  }
  return { valor: circ.dasTotal == null ? null : round2(circ.dasTotal), fonte: "dasTotal" };
}

const CAMPO_DA_RECEITA = {
  RECEITA_SERVICO: "receitaServicos",
  RECEITA_VENDA_SEM_ST: "receitaVendasSemST",
  RECEITA_VENDA_COM_ST: "receitaVendasComST",
};

try {
  const cnpjFiltro = onlyDigits(arg("cnpj"));

  const circulares = await prisma.companyMonthlyCircular.findMany({
    where: {
      OR: [{ pgdasNumeroDeclaracao: { not: null } }, { serproSyncStatus: { not: null } }],
      ...(cnpjFiltro ? { portalClient: { cnpj: { contains: cnpjFiltro.slice(0, 8) } } } : {}),
    },
    select: {
      id: true, portalClientId: true, competencia: true,
      receitaBruta: true, receitaServicos: true, receitaVendasSemST: true, receitaVendasComST: true,
      dasTotal: true, acrescimos: true, pgdasNumeroDeclaracao: true,
      serproSyncStatus: true, serproLastSyncAt: true, receitaStatus: true,
      portalClient: { select: { razao: true, cnpj: true } },
    },
    orderBy: [{ competencia: "asc" }],
  });

  if (!circulares.length) {
    console.log("Nenhuma circular com extrato consultado.");
    process.exit(0);
  }

  const portalIds = [...new Set(circulares.map((c) => c.portalClientId))];
  const competencias = [...new Set(circulares.map((c) => c.competencia))];

  const entries = await prisma.accountingEntry.findMany({
    where: {
      portalClientId: { in: portalIds },
      competencia: { in: competencias },
      origem: "SERPRO",
      eventType: { in: ["DAS_SIMPLES", "RECEITA_SERVICO", "RECEITA_VENDA_SEM_ST", "RECEITA_VENDA_COM_ST"] },
    },
    select: {
      id: true, portalClientId: true, competencia: true, eventType: true, updatedAt: true,
      recalculatedAt: true, recalculatedFromValor: true, recalculatedToValor: true,
      statusPagamento: true, status: true,
      lines: { select: { tipo: true, valor: true } },
    },
  });

  const snapshots = await prisma.apuracaoSnapshot.findMany({
    where: { portalClientId: { in: portalIds }, competencia: { in: competencias } },
    select: { portalClientId: true, competencia: true, estado: true, numeroDeclaracao: true, transmitidoEm: true, dasRetornadoSerpro: true },
  });

  const chave = (p, c) => `${p}|${c}`;
  const porChave = new Map();
  for (const e of entries) {
    const k = chave(e.portalClientId, e.competencia);
    if (!porChave.has(k)) porChave.set(k, {});
    porChave.get(k)[e.eventType] = e;
  }
  const snapPorChave = new Map(snapshots.map((s) => [chave(s.portalClientId, s.competencia), s]));

  const somaD = (e) => round2((e?.lines || []).filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0));

  const linhas = [];
  for (const circ of circulares) {
    const k = chave(circ.portalClientId, circ.competencia);
    const evs = porChave.get(k) || {};
    const snap = snapPorChave.get(k) || null;
    const das = evs.DAS_SIMPLES || null;
    const esperado = valorEsperadoDas(circ);

    const seq = sequenciaDaDeclaracao(circ.pgdasNumeroDeclaracao);
    const numeroDivergente = Boolean(
      snap?.numeroDeclaracao && circ.pgdasNumeroDeclaracao
      && onlyDigits(snap.numeroDeclaracao) !== onlyDigits(circ.pgdasNumeroDeclaracao),
    );
    const indicioRetificadora = (seq != null && seq > 1) || numeroDivergente;

    const dasLancado = das ? somaD(das) : null;
    const dasCongelado = Boolean(das && esperado.valor != null && difere(dasLancado, esperado.valor));

    const receitas = [];
    for (const [ev, campo] of Object.entries(CAMPO_DA_RECEITA)) {
      const e = evs[ev];
      if (!e) continue;
      const esperadoRec = round2(num(circ[campo]));
      receitas.push({ ev, campo, lancado: somaD(e), esperado: esperadoRec, diverge: difere(somaD(e), esperadoRec) });
    }
    const receitaDivergente = receitas.some((r) => r.diverge);

    linhas.push({
      razao: circ.portalClient?.razao || "?", cnpj: circ.portalClient?.cnpj || "?",
      competencia: circ.competencia,
      numeroDeclaracao: circ.pgdasNumeroDeclaracao, seq, numeroDivergente, indicioRetificadora,
      snapNumero: snap?.numeroDeclaracao || null, snapEstado: snap?.estado || null,
      serproSyncStatus: circ.serproSyncStatus, serproLastSyncAt: circ.serproLastSyncAt,
      dasTotal: num(circ.dasTotal), esperadoDas: esperado.valor, fonteEsperado: esperado.fonte,
      dasLancado, dasCongelado, temDas: Boolean(das),
      recalculatedAt: das?.recalculatedAt || null,
      recalculatedFrom: num(das?.recalculatedFromValor), recalculatedTo: num(das?.recalculatedToValor),
      receitas, receitaDivergente,
    });
  }

  const comExtrato = linhas.length;
  const comDeclaracao = linhas.filter((l) => l.numeroDeclaracao).length;
  const retificadoras = linhas.filter((l) => l.indicioRetificadora);
  const congelados = linhas.filter((l) => l.dasCongelado);
  const congeladosRetif = retificadoras.filter((l) => l.dasCongelado);
  const carimbados = linhas.filter((l) => l.recalculatedAt);
  const receitaOk = linhas.filter((l) => l.receitas.length && !l.receitaDivergente).length;
  const receitaDiv = linhas.filter((l) => l.receitaDivergente);

  console.log("=".repeat(118));
  console.log("RETIFICADORA × LANÇAMENTO DO IMPOSTO — só leitura");
  console.log("=".repeat(118));
  console.log(`circulares com extrato ............................. ${comExtrato}`);
  console.log(`  com número de declaração da RFB .................. ${comDeclaracao}`);
  console.log(`  com INDÍCIO de retificadora ..................... ${retificadoras.length}   (sufixo>001 ou snapshot≠extrato)`);
  console.log(`lançamentos DAS_SIMPLES presentes ................. ${linhas.filter((l) => l.temDas).length}`);
  console.log(`  ⚠ CONGELADOS (linhas ≠ circular) ................ ${congelados.length}`);
  console.log(`  ⚠ congelados E com indício de retificadora ...... ${congeladosRetif.length}`);
  console.log(`  com carimbo recalculated* (leu e ignorou) ....... ${carimbados.length}`);
  console.log(`lançamentos de RECEITA conferindo com a circular ... ${receitaOk}`);
  console.log(`  divergentes ..................................... ${receitaDiv.length}`);
  console.log("");

  const mostrar = flag("todos") ? linhas : linhas.filter((l) => l.indicioRetificadora || l.dasCongelado || l.recalculatedAt || l.receitaDivergente);

  if (!mostrar.length) {
    console.log("Nada a listar (nenhuma retificadora, nenhum congelamento).");
  } else {
    console.log(`${pad("EMPRESA", 26)} ${pad("COMP", 8)} ${pad("Nº DECLARAÇÃO", 19)} ${pad("SEQ", 4)} ${padL("DAS CIRCULAR", 15)} ${padL("DAS LANÇADO", 15)} ${pad("VEREDITO", 22)}`);
    console.log("-".repeat(118));
    for (const l of mostrar) {
      const veredito = !l.temDas
        ? "sem lançamento DAS"
        : l.dasCongelado
          ? (l.indicioRetificadora ? "⚠ CONGELADO (retif.)" : "⚠ CONGELADO")
          : "confere";
      console.log(
        `${pad(l.razao, 26)} ${pad(l.competencia, 8)} ${pad(l.numeroDeclaracao || "—", 19)} ${pad(l.seq ?? "—", 4)} `
        + `${padL(money(l.esperadoDas), 15)} ${padL(money(l.dasLancado), 15)} ${pad(veredito, 22)}`,
      );
      if (l.numeroDivergente) {
        console.log(`      ↳ transmitimos ${l.snapNumero} (snapshot ${l.snapEstado}); a RFB devolve ${l.numeroDeclaracao} como ÚLTIMA`);
      }
      if (l.recalculatedAt) {
        console.log(`      ↳ carimbo recalculated: ${money(l.recalculatedFrom)} → ${money(l.recalculatedTo)} em ${new Date(l.recalculatedAt).toISOString().slice(0, 10)}  (o valor novo FOI lido e descartado)`);
      }
      if (l.fonteEsperado !== "dasTotal") {
        console.log(`      ↳ esperado vem de ${l.fonteEsperado} (split de juros/multa gravado) — dasTotal=${money(l.dasTotal)}`);
      }
      for (const r of l.receitas) {
        const marca = r.diverge ? "⚠ DIVERGE" : "confere";
        console.log(`      ↳ ${pad(r.ev, 22)} circular=${padL(money(r.esperado), 15)} lançado=${padL(money(r.lancado), 15)} ${marca}`);
      }
    }
  }

  console.log("");
  console.log("-".repeat(118));
  console.log("COMO LER: 'CONGELADO' = a soma das linhas de débito do lançamento DAS_SIMPLES não bate com o");
  console.log("valor que o extrato mais recente gravou na circular. Havendo carimbo `recalculated*`, o valor");
  console.log("novo FOI lido — a guarda de AccountingEntryGeneratorService.js:369 o descartou de propósito.");
  console.log("Nada aqui é corrigido por este script: correção de valor de lançamento é ato contábil do dono.");
} catch (err) {
  console.error("ERRO:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
