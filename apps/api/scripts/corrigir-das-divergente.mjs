// O LANÇAMENTO DO IMPOSTO VOLTA A VALER O QUE O EXTRATO DIZ — dry-run por padrão.
//
// ⚠ NASCE EM DRY-RUN E NÃO ESCREVE NADA SEM `--aplicar`. Corrigir valor de lançamento é ATO
// CONTÁBIL e é do dono; este script mostra o que mudaria, linha a linha, e para aí.
//
// ⚠ ZERO CHAMADA AO SERPRO. O valor certo JÁ ESTÁ GRAVADO: `CompanyMonthlyCircular.dasTotal` (o
// extrato/declaração, inclusive retificada) e, quando há juros/multa destacados,
// `acrescimos.<tributo>.principal`. A prova de que ele foi LIDO e descartado está no carimbo
// `recalculatedToValor` do próprio lançamento. Nenhuma consulta paga é necessária.
//
// ── O QUE ELE CORRIGE, E POR QUE POR ESTE CAMINHO ────────────────────────────────────────────
// Ele NÃO escreve linha à mão. Ele chama `generateEntriesFromCircular({ fonteValor: EXTRATO,
// edicaoManual: true })` — o MESMO gerador que cria o lançamento. Escrever `deleteMany` +
// `createMany` aqui seria uma segunda forma de lançamento, e mudar a forma do lançamento contábil
// exige pedido explícito do dono [[nao-mudar-forma-lancamentos]]. Pelo gerador, vêm de graça e
// idênticos: as contas memorizadas, o `statusPelasBaixas` (provisão já baixada não volta a ABERTO)
// e o balanceamento D/C.
//
// ── AS RECUSAS ───────────────────────────────────────────────────────────────────────────────
//  • COMPETÊNCIA FECHADA → recusa, sempre, inclusive com `--aplicar`. O projeto decidiu que mês
//    fechado gera CONTRA-LANÇAMENTO, nunca alteração silenciosa: os números já saíram para fora, e
//    reescrevê-los sem rastro de reabertura é exatamente o estrago que a trava do DELETE impede.
//    A saída está impressa na linha: reabrir a competência, ou estornar/contra-lançar.
//  • LANÇAMENTO `EXPORTADO` → recusa. Ele já foi para a escrituração.
//
// ── A SEGUNDA METADE: OS OUTROS TRIBUTOS ─────────────────────────────────────────────────────
// O dono disse "como todos os outros impostos". A seção 2 mede PIS/COFINS/IRPJ/CSLL/ISS/IRRF, cuja
// FONTE É OUTRA — não a circular, e sim a GUIA (`extracted.composicao[].total`, ou `guide.valor`).
// Ela é só medição: aquele caminho (`generateProvisionsFromGuide`) não tem a bifurcação por
// `eventType` que congelava o DAS, então a expectativa é ZERO. Se ela acusar, há um caminho
// quebrado a mais, e este script NÃO o corrige — nem tenta.
//
// USO (⚠ `bash -c` cai na WSL, corrompida — use `pwsh`):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/corrigir-das-divergente.mjs'
//
//   --cnpj=<digitos>       limita a uma empresa
//   --competencia=YYYY-MM  limita a uma competência
//   --aplicar              GRAVA (exigido; sem ele nada é escrito)

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { divergenciasDeFonte, SELECT_CIRCULAR_PARA_DIVERGENCIA } from "../src/application/accounting/divergenciaDeFonte.js";
import { generateEntriesFromCircular, FONTE_VALOR_EXTRATO, valorDoLancamento } from "../src/application/accounting/AccountingEntryGeneratorService.js";

const arg = (name) => {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
};
const flag = (name) => process.argv.includes(`--${name}`);
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const money = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const padL = (s, n) => String(s ?? "").slice(0, n).padStart(n);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const APLICAR = flag("aplicar");
const cnpjFiltro = onlyDigits(arg("cnpj"));
const compFiltro = arg("competencia");

// Eventos derivados da circular — os mesmos que o detector confere.
const EVENTOS = ["DAS_SIMPLES", "RECEITA_SERVICO", "RECEITA_VENDA_SEM_ST", "RECEITA_VENDA_COM_ST"];

// Tributos cuja fonte é a GUIA, não a circular (seção 2). `INSS` e `SIMPLES` ficam de fora porque
// `generateProvisionsFromGuide` os pula de propósito (INSS é manual; DAS vem do extrato).
const EVENTOS_DE_GUIA = ["DARF_PIS", "DARF_COFINS", "DARF_IRPJ", "DARF_CSLL", "DARF_ISS", "DARF_IRRF", "DARF_OUTROS"];

try {
  console.log("=".repeat(112));
  console.log(`LANÇAMENTO × CIRCULAR — ${APLICAR ? "⚠ MODO APLICAR (vai gravar)" : "DRY-RUN (nada será gravado)"}`);
  console.log("=".repeat(112));

  // ── 1. AS DIVERGÊNCIAS DERIVADAS DA CIRCULAR ────────────────────────────────────────────────
  const circulares = await prisma.companyMonthlyCircular.findMany({
    where: {
      ...(compFiltro ? { competencia: compFiltro } : {}),
      ...(cnpjFiltro ? { portalClient: { cnpj: { contains: cnpjFiltro.slice(0, 8) } } } : {}),
    },
    select: {
      id: true, portalClientId: true, competencia: true,
      fechadoContabilEm: true, pgdasNumeroDeclaracao: true,
      ...SELECT_CIRCULAR_PARA_DIVERGENCIA,
      portalClient: { select: { razao: true, cnpj: true } },
    },
    orderBy: [{ competencia: "asc" }],
  });

  const portalIds = [...new Set(circulares.map((c) => c.portalClientId))];
  const competencias = [...new Set(circulares.map((c) => c.competencia))];

  const entries = portalIds.length
    ? await prisma.accountingEntry.findMany({
      where: {
        portalClientId: { in: portalIds },
        competencia: { in: competencias },
        origem: "SERPRO",
        eventType: { in: EVENTOS },
      },
      select: {
        id: true, portalClientId: true, competencia: true, eventType: true, origem: true,
        historico: true, status: true, statusPagamento: true,
        recalculatedFromValor: true, recalculatedToValor: true, recalculatedAt: true,
        lines: { select: { tipo: true, valor: true, conta: true } },
        baixas: { select: { id: true } },
      },
    })
    : [];

  const chave = (p, c) => `${p}|${c}`;
  const entriesPorChave = new Map();
  for (const e of entries) {
    const k = chave(e.portalClientId, e.competencia);
    if (!entriesPorChave.has(k)) entriesPorChave.set(k, []);
    entriesPorChave.get(k).push(e);
  }
  const entryPorId = new Map(entries.map((e) => [e.id, e]));

  const casos = [];
  for (const circ of circulares) {
    const doMes = entriesPorChave.get(chave(circ.portalClientId, circ.competencia)) || [];
    // ⚠ MESMA função que a tela usa. Uma terceira leitura de "quanto a circular manda" foi o
    // defeito original deste módulo; reproduzi-la aqui faria o script corrigir para um número que
    // a tela não confirma.
    const divs = divergenciasDeFonte(circ, doMes);
    for (const d of divs) {
      const entry = entryPorId.get(d.entryId) || null;
      casos.push({ circ, div: d, entry });
    }
  }

  if (!casos.length) {
    console.log("\nNenhuma divergência entre lançamento e circular. Nada a corrigir.\n");
  } else {
    console.log(`\n${casos.length} lançamento(s) divergindo da circular:\n`);
    console.log(`${pad("EMPRESA", 24)} ${pad("COMP", 8)} ${pad("EVENTO", 21)} ${padL("ANTES", 14)} ${padL("DEPOIS", 14)} ${padL("Δ", 12)}  SITUAÇÃO`);
    console.log("-".repeat(112));
  }

  const aplicaveis = [];
  const recusados = [];

  for (const { circ, div, entry } of casos) {
    const fechada = Boolean(circ.fechadoContabilEm);
    const exportado = String(entry?.status || "") === "EXPORTADO";
    const temBaixa = Boolean(entry?.baixas?.length);

    let situacao;
    if (fechada) situacao = "⛔ RECUSADO · competência FECHADA";
    else if (exportado) situacao = "⛔ RECUSADO · lançamento EXPORTADO";
    else situacao = temBaixa ? "✔ corrigível (tem baixa — status será recalculado)" : "✔ corrigível";

    console.log(
      `${pad(circ.portalClient?.razao || "?", 24)} ${pad(circ.competencia, 8)} ${pad(div.eventType, 21)} `
      + `${padL(money(div.lancado), 14)} ${padL(money(div.esperado), 14)} ${padL(money(div.diferenca), 12)}  ${situacao}`,
    );
    // A prova de que o número novo já tinha sido lido e descartado.
    if (entry?.recalculatedToValor != null) {
      console.log(`      ↳ carimbo recalculated: ${money(entry.recalculatedFromValor)} → ${money(entry.recalculatedToValor)}`
        + (entry.recalculatedAt ? ` em ${new Date(entry.recalculatedAt).toISOString().slice(0, 10)}` : ""));
    }
    // As contas de hoje, para o antes/depois ser conferível linha a linha (o gerador as preserva).
    for (const l of entry?.lines || []) {
      console.log(`      ↳ ${l.tipo} ${pad(l.conta || "(vazia)", 8)} ${padL(money(l.valor), 14)}  →  ${padL(money(div.esperado), 14)}`);
    }
    if (fechada) {
      console.log(`      ↳ fechada em ${new Date(circ.fechadoContabilEm).toISOString().slice(0, 10)} — reabra a competência, ou estorne/contra-lance. Alterar em silêncio muda um número já reportado.`);
    }

    (fechada || exportado ? recusados : aplicaveis).push({ circ, div, entry });
  }

  // ── 2. OS OUTROS TRIBUTOS — fonte é a GUIA, não a circular ──────────────────────────────────
  console.log("");
  console.log("=".repeat(112));
  console.log("SEÇÃO 2 — OS OUTROS TRIBUTOS (PIS · COFINS · IRPJ · CSLL · ISS · IRRF)");
  console.log("=".repeat(112));
  console.log("A fonte deles NÃO é a circular: é a GUIA (`extracted.composicao[].total`, ou `guide.valor`).");
  console.log("`generateProvisionsFromGuide` não tem a bifurcação por eventType que congelava o DAS —");
  console.log("então o esperado aqui é ZERO. Qualquer linha abaixo é um caminho quebrado A MAIS.\n");

  const provisoesDeGuia = await prisma.accountingEntry.findMany({
    where: {
      tipo: "PROVISAO",
      eventType: { in: EVENTOS_DE_GUIA },
      sourceGuideId: { not: null },
      ...(compFiltro ? { competencia: compFiltro } : {}),
      ...(cnpjFiltro ? { portalClient: { cnpj: { contains: cnpjFiltro.slice(0, 8) } } } : {}),
    },
    select: {
      id: true, competencia: true, eventType: true, status: true, historico: true,
      lines: { select: { tipo: true, valor: true } },
      portalClient: { select: { razao: true } },
      sourceGuide: { select: { id: true, tipo: true, valor: true, extracted: true } },
    },
  });

  // A MESMA leitura de `generateProvisionsFromGuide`: composição por tributo quando existe, senão
  // o valor da guia. Reproduzi-la é inevitável aqui (a função escreve, não devolve o esperado) —
  // por isso ela fica NOMEADA, e o que ela cobre é exatamente o `linhas` daquele serviço.
  const NOME_DO_EVENTO = { DARF_PIS: "PIS", DARF_COFINS: "COFINS", DARF_IRPJ: "IRPJ", DARF_CSLL: "CSLL", DARF_ISS: "ISS", DARF_IRRF: "IRRF" };
  const divergentesDeGuia = [];
  for (const p of provisoesDeGuia) {
    const comp = Array.isArray(p.sourceGuide?.extracted?.composicao) ? p.sourceGuide.extracted.composicao : [];
    const nome = NOME_DO_EVENTO[p.eventType];
    let esperado = null;
    if (comp.length) {
      // Sem o `pickEventType` completo (código de receita + nome) não dá para casar a linha com
      // certeza; usa-se o NOME do tributo, que é o discriminador que o próprio serviço prefere.
      const item = comp.find((c) => String(c?.tributo || "").toUpperCase() === nome);
      if (item != null) esperado = round2(item.total);
    } else if (Number(p.sourceGuide?.valor) > 0) {
      esperado = round2(p.sourceGuide.valor);
    }
    if (esperado == null) continue; // sem base comparável — ausência não é resposta
    const lancado = round2(valorDoLancamento(p.lines));
    if (Math.abs(esperado - lancado) <= 0.01) continue;
    divergentesDeGuia.push({ p, esperado, lancado });
  }

  console.log(`provisões derivadas de guia conferidas ... ${provisoesDeGuia.length}`);
  console.log(`  ⚠ divergentes ......................... ${divergentesDeGuia.length}`);
  for (const { p, esperado, lancado } of divergentesDeGuia) {
    console.log(`   ${pad(p.portalClient?.razao || "?", 24)} ${pad(p.competencia, 8)} ${pad(p.eventType, 14)} guia ${padL(money(esperado), 14)} · lançado ${padL(money(lancado), 14)}`);
  }
  console.log("\n⚠ Este script NÃO corrige a seção 2 — a fonte é outra e o conserto seria outro.");

  // ── 3. A ESCRITA ────────────────────────────────────────────────────────────────────────────
  console.log("");
  console.log("=".repeat(112));
  console.log(`corrigíveis .... ${aplicaveis.length}     recusados .... ${recusados.length}`);
  console.log("=".repeat(112));

  if (!APLICAR) {
    console.log("\nDRY-RUN: nada foi gravado.");
    console.log("Para aplicar (só os corrigíveis; os recusados continuam recusados): acrescente --aplicar\n");
  } else if (!aplicaveis.length) {
    console.log("\nNada aplicável. Nada foi gravado.\n");
  } else {
    console.log("\n⚠ APLICANDO — pelo GERADOR (`generateEntriesFromCircular`), nunca por escrita de linha à mão.\n");
    // Uma chamada por (empresa, competência): o gerador trata todos os eventos do mês de uma vez.
    const alvos = new Map();
    for (const a of aplicaveis) alvos.set(chave(a.circ.portalClientId, a.circ.competencia), a.circ);
    for (const circ of alvos.values()) {
      // ⚠ Reconfere o fechamento AGORA. O dry-run pode ter sido lido ontem, e a competência pode
      // ter sido fechada nesse meio-tempo — gravar com base numa leitura velha é o mesmo defeito
      // que a conferência de total do estorno existe para impedir.
      const atual = await prisma.companyMonthlyCircular.findUnique({
        where: { id: circ.id },
        select: { fechadoContabilEm: true },
      });
      if (atual?.fechadoContabilEm) {
        console.log(`   ⛔ ${pad(circ.portalClient?.razao || "?", 24)} ${circ.competencia} — FECHADA desde a leitura. Pulada.`);
        continue;
      }
      const r = await generateEntriesFromCircular({
        portalClientId: circ.portalClientId,
        competencia: circ.competencia,
        // A DECLARAÇÃO é a verdade — é o que a guarda passou a distinguir da guia com juros.
        fonteValor: FONTE_VALOR_EXTRATO,
        // O contador (o dono) está mandando corrigir: as linhas acompanham.
        edicaoManual: true,
        // ⚠ ESTE SCRIPT RODA DE FORA DO RAILWAY (`railway run` conecta pelo proxy público), então
        // cada uma das mais de dez queries da transação paga latência de internet. Com o default
        // do Prisma (5s) a primeira execução estourou com `Transaction not found ... refers to an
        // old closed transaction` — o Postgres desfez tudo e NADA foi gravado (conferido rodando o
        // dry-run de novo: as 13 divergências continuavam idênticas). Produção não usa este
        // parâmetro: lá a rede é interna e o default sempre bastou.
        txTimeoutMs: 120000,
      });
      const acoes = (r?.generatedEntries || []).map((g) => `${g.eventType}=${g.action}`).join(" ");
      console.log(`   ✔ ${pad(circ.portalClient?.razao || "?", 24)} ${circ.competencia} — ${acoes || "sem ação"}`);
    }
    console.log("\nGravado. Rode `scripts/diag-retificadora-imposto.mjs` para conferir o resultado.\n");
  }
} catch (err) {
  console.error("ERRO:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
