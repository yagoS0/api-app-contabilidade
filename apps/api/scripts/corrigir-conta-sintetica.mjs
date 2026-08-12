// OS LANÇAMENTOS QUE JÁ ESTÃO EM CONTA SINTÉTICA — dry-run por padrão.
//
// ⚠ SÓ LEITURA sem `--aplicar`. Nenhum DDL, nenhuma chamada externa, nenhum ato fiscal.
//
// ─── POR QUE ELE EXISTE ───────────────────────────────────────────────────────────────────────
// Conta sintética é conta de AGREGAÇÃO: ela soma as filhas, e lançar nela é lançar num total. A
// partir de agora o servidor RECUSA lançamento novo nelas (400 `CONTA_SINTETICA`) — porque o
// registro I250 da ECD exige `IND_CTA = "A"` e o PGE do Sped Contábil recusa o arquivo na entrega.
//
// Mas os lançamentos que JÁ existem continuam lá, e a trava foi escrita de propósito para não
// impedir a correção deles (ela recusa a ENTRADA de conta sintética, nunca a permanência). Este
// script é o inventário dessa correção: mostra CADA lançamento inteiro, lista as analíticas
// CANDIDATAS de cada conta, e para.
//
// ⚠ ELE NÃO ESCOLHE, E ISSO NÃO É CAUTELA DE ESTILO. Para qual analítica cada lançamento vai é
// **decisão do contador**: `AccountingEntryLine.conta` é a identidade contábil da partida, e
// trocá-la muda o razão. A única exceção possível é a conta que tem UMA filha só — ali o destino é
// mecânico, e mesmo assim o script apenas DIZ que é mecânico; quem manda aplicar é o dono.
//
// ⚠ MÊS FECHADO NÃO É EDITADO. O projeto decidiu que competência fechada gera contra-lançamento,
// nunca alteração silenciosa (ver `application/accounting/CLAUDE.md`, "A trava do DELETE vale para
// TODO lançamento"). Com `--aplicar`, lançamento em mês fechado é RECUSADO por este script, com o
// caminho na mensagem — reabrir a competência (o ato fica gravado) ou estornar na competência
// aberta. Ele não reabre nada por conta própria.
//
// ⚠ DOIS MODOS, E O SEGUNDO EXISTE PORQUE A PRODUÇÃO AINDA NÃO DERIVOU NADA. Medido em
// 12/08/2026: as 1.199 contas do banco estão com `analitica` **NULL** — a coluna existe, o import do
// plano com `codigoCompleto` nunca rodou. Logo, hoje o banco não sabe que conta nenhuma é sintética
// (e a trava, corretamente, não recusa nada: `null` nunca recusa). Os 6 lançamentos medidos são o
// que a derivação PRODUZIRÁ quando o arquivo do ERP for importado.
//
//   · sem `--plano` → lê o que ESTÁ no banco (o estado depois do import);
//   · com `--plano <csv>` → SIMULA o import: usa o parser e a derivação de PRODUÇÃO
//     (`chartOfAccountsImport` + `lib/derivacaoAnalitica`), sem gravar uma linha. É o mesmo caminho
//     do `diag-conta-mae.mjs`, e é o único jeito de ver os 6 antes do import.
//
// ⚠ `--aplicar` É RECUSADO no modo simulado: mover partida contábil a partir de uma derivação que o
// banco ainda não tem seria corrigir pelo que o sistema *vai* saber, não pelo que ele sabe.
//
// USO (leitura em produção — ⚠ `bash -c` NÃO funciona nesta máquina, WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/corrigir-conta-sintetica.mjs --plano "G:\Meu Drive\Plano de Contas.csv"'
//
//   … com um destino escolhido pelo contador (continua dry-run, mostra o efeito):
//   … node apps/api/scripts/corrigir-conta-sintetica.mjs --mapa 169=170
//
//   … e só então, para GRAVAR (exige o plano já importado no banco):
//   … node apps/api/scripts/corrigir-conta-sintetica.mjs --mapa 169=170 --aplicar

import fs from "node:fs";
import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { filhasDiretas } from "../src/application/accounting/lib/gateContaSintetica.js";
import { parseCsvBuffer } from "../src/application/accounting/chartOfAccountsImport.js";
import { derivarAnalitica } from "../src/application/accounting/lib/derivacaoAnalitica.js";

const argv = process.argv.slice(2);
const aplicar = argv.includes("--aplicar");
const arquivoPlano = (() => {
  const i = argv.indexOf("--plano");
  return i >= 0 ? String(argv[i + 1] || "") : null;
})();
/** `--mapa 169=170,456=999` → Map("169" → "170", …). A escolha é do contador; aqui só se lê. */
const mapa = (() => {
  const i = argv.indexOf("--mapa");
  const bruto = i >= 0 ? String(argv[i + 1] || "") : "";
  const m = new Map();
  for (const par of bruto.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [de, para] = par.split("=").map((s) => String(s || "").trim());
    if (de && para) m.set(de, para);
  }
  return m;
})();

const money = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const risco = () => console.log("─".repeat(100));

console.log("═".repeat(100));
console.log(`LANÇAMENTOS EM CONTA SINTÉTICA — ${aplicar ? "⚠ MODO APLICAR (grava)" : "dry-run (nada é gravado)"}`);
console.log("═".repeat(100));

// ─── 1) o plano, por escopo ───────────────────────────────────────────────────────────────────
// ⚠ A derivação é POR ESCOPO (global com global, empresa com a própria) e a resolução do código de
// um lançamento é a mesma do `GET /chart-of-accounts`: a conta da EMPRESA vence a global.
let contas = await prisma.chartOfAccount.findMany({
  select: { id: true, portalClientId: true, codigo: true, nome: true, codigoCompleto: true, analitica: true, tipo: true },
});
const porEscopo = new Map();
for (const c of contas) {
  const chave = c.portalClientId ?? "__GLOBAL__";
  if (!porEscopo.has(chave)) porEscopo.set(chave, []);
  porEscopo.get(chave).push(c);
}

if (arquivoPlano) {
  // ⚠ SIMULAÇÃO: o `codigoCompleto` do arquivo entra em memória e a derivação roda POR ESCOPO —
  // exatamente o que o import fará. Nada é gravado, aqui nem depois (o modo simulado recusa
  // `--aplicar`). Usa o parser e a derivação de produção de propósito: uma cópia mediria outra regra.
  if (!fs.existsSync(arquivoPlano)) {
    console.log(`\n⚠ arquivo não encontrado: ${arquivoPlano}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const doArquivo = new Map(parseCsvBuffer(fs.readFileSync(arquivoPlano)).map((a) => [String(a.codigo), a.codigoCompleto || null]));
  const simuladas = [];
  for (const [chave, lista] of porEscopo) {
    const comArquivo = lista.map((c) => ({ ...c, codigoCompleto: doArquivo.get(String(c.codigo)) ?? c.codigoCompleto ?? null }));
    const derivadas = derivarAnalitica(comArquivo);
    porEscopo.set(chave, derivadas);
    simuladas.push(...derivadas);
  }
  contas = simuladas;
  console.log(`\n⚠ MODO SIMULADO — o \`codigoCompleto\` vem de ${arquivoPlano} (${doArquivo.size} códigos),`);
  console.log("   não do banco. É o retrato de DEPOIS do import; nada foi gravado e `--aplicar` é recusado.");
}
function resolverConta(portalClientId, codigo) {
  const cod = String(codigo ?? "").trim();
  if (!cod) return null;
  const daEmpresa = (porEscopo.get(portalClientId) || []).find((c) => c.codigo === cod);
  if (daEmpresa) return daEmpresa;
  return (porEscopo.get("__GLOBAL__") || []).find((c) => c.codigo === cod) || null;
}

const sinteticasNoPlano = contas.filter((c) => c.analitica === false);
console.log(`\nplano: ${contas.length} contas · ${sinteticasNoPlano.length} SINTÉTICAS · `
  + `${contas.filter((c) => c.analitica === true).length} analíticas · `
  + `${contas.filter((c) => c.analitica == null).length} sem resposta (analitica NULL — nunca recusadas)`);

// ─── 2) as LINHAS que apontam para uma sintética ──────────────────────────────────────────────
const linhas = await prisma.accountingEntryLine.findMany({
  select: {
    id: true, entryId: true, conta: true, tipo: true, valor: true, ordem: true,
    entry: {
      select: {
        id: true, portalClientId: true, competencia: true, data: true, historico: true,
        tipo: true, subtipo: true, origem: true, status: true, statusPagamento: true,
        descricaoImportacao: true, loteImportacao: true, parcelamentoId: true, sourceGuideId: true,
        lines: { select: { conta: true, tipo: true, valor: true, ordem: true }, orderBy: { ordem: "asc" } },
      },
    },
  },
});

const afetadas = linhas.filter((l) => {
  const conta = resolverConta(l.entry?.portalClientId, l.conta);
  // ⚠ `=== false`, nunca `!analitica`: `null` é "não se sabe", e não se afirma nada sobre ela.
  return conta?.analitica === false;
});

const entriesAfetados = new Map();
for (const l of afetadas) {
  if (!entriesAfetados.has(l.entryId)) entriesAfetados.set(l.entryId, { entry: l.entry, linhas: [] });
  entriesAfetados.get(l.entryId).linhas.push(l);
}

console.log(`\nlinhas em conta sintética: ${afetadas.length} · lançamentos afetados: ${entriesAfetados.size}`);
if (entriesAfetados.size === 0) {
  console.log("\n✅ Nenhum lançamento em conta de agregação. Nada a corrigir.");
  await prisma.$disconnect();
  process.exit(0);
}

// ─── 3) as empresas e as competências fechadas ────────────────────────────────────────────────
const empresasIds = [...new Set([...entriesAfetados.values()].map((e) => e.entry.portalClientId))];
const empresas = new Map(
  (await prisma.portalClient.findMany({ where: { id: { in: empresasIds } }, select: { id: true, razao: true, cnpj: true } }))
    .map((e) => [e.id, e]),
);
const competencias = [...new Set([...entriesAfetados.values()].map((e) => e.entry.competencia).filter(Boolean))];
const circulares = await prisma.companyMonthlyCircular.findMany({
  where: { portalClientId: { in: empresasIds }, competencia: { in: competencias } },
  select: { portalClientId: true, competencia: true, fechadoContabilEm: true },
});
const fechadas = new Map(circulares.map((c) => [`${c.portalClientId}|${c.competencia}`, c.fechadoContabilEm]));
const estaFechada = (e) => Boolean(fechadas.get(`${e.portalClientId}|${e.competencia}`));

// ─── 4) O RELATÓRIO — um lançamento inteiro por vez ───────────────────────────────────────────
const paraDecidir = [];
for (const { entry, linhas: linhasDoEntry } of entriesAfetados.values()) {
  risco();
  const emp = empresas.get(entry.portalClientId);
  const fechada = estaFechada(entry);
  console.log(`\nEMPRESA  ${emp?.razao || "(?)"}  ${emp?.cnpj || ""}`);
  console.log(`LANÇAMENTO ${entry.id}`);
  console.log(`   competência ${entry.competencia}${fechada ? "  ⚠ MÊS FECHADO" : "  (aberta)"}`
    + `   ·  data ${dia(entry.data)}   ·  ${entry.tipo}${entry.subtipo ? `/${entry.subtipo}` : ""}`
    + `   ·  origem ${entry.origem}   ·  status ${entry.status}/${entry.statusPagamento}`);
  console.log(`   histórico: ${entry.historico || "—"}`);
  if (entry.descricaoImportacao) console.log(`   descrição do arquivo: ${entry.descricaoImportacao}`);
  if (entry.parcelamentoId) console.log(`   ⚠ pendura em parcelamento ${entry.parcelamentoId} (o lote só balanceia em GRUPO)`);
  if (entry.sourceGuideId) console.log(`   ⚠ vem da guia ${entry.sourceGuideId}`);
  console.log("   pernas:");
  for (const l of entry.lines) {
    const conta = resolverConta(entry.portalClientId, l.conta);
    const selo = conta?.analitica === false ? "  ⚠ SINTÉTICA" : conta?.analitica === true ? "" : "  (sem resposta)";
    console.log(`      ${l.tipo}  ${String(l.conta).padEnd(6)} ${String(conta?.nome || "(fora do plano)").padEnd(46)}`
      + ` R$ ${money(l.valor).padStart(14)}${selo}`);
  }

  for (const l of linhasDoEntry) {
    const conta = resolverConta(entry.portalClientId, l.conta);
    const escopo = conta.portalClientId ? porEscopo.get(conta.portalClientId) : porEscopo.get("__GLOBAL__");
    const filhas = filhasDiretas(conta, escopo);
    const analiticas = filhas.filter((f) => f.analitica === true);
    console.log(`\n   ➜ a conta a trocar nesta partida: ${conta.codigo} ${conta.nome}`
      + `  (completo ${conta.codigoCompleto}, nível ${String(conta.codigoCompleto || "").length}`
      + `, escopo ${conta.portalClientId ? "EMPRESA" : "GLOBAL"})`);
    console.log(`     analíticas CANDIDATAS (filhas diretas): ${filhas.length}`);
    for (const f of filhas) {
      const rot = f.analitica === true ? "analítica" : f.analitica === false ? "SINTÉTICA (tem filhas — não serve)" : "sem resposta";
      console.log(`        ${String(f.codigo).padEnd(6)} ${String(f.codigoCompleto).padEnd(12)} ${String(f.nome).padEnd(46)} ${rot}`);
    }
    if (filhas.length === 0) {
      console.log("        (nenhuma — a conta é sintética por causa de filhas em OUTRO nível, ou o plano está incompleto)");
    }
    // ⚠ NENHUMA FILHA DIRETA É ANALÍTICA — é o caso da conta de 1º NÍVEL. Aqui o destino não está a
    // um passo: ele está mais fundo. Mostrar só as filhas diretas devolveria três contas que
    // TAMBÉM não podem receber lançamento, e o contador ficaria sem caminho nenhum na tela. Um
    // nível a mais é o que transforma a recusa em rota — e continua sem escolher nada.
    if (filhas.length > 0 && analiticas.length === 0) {
      console.log("     ⚠ NENHUMA filha direta é analítica: esta conta é de nível alto e o destino está MAIS FUNDO.");
      for (const f of filhas) {
        const netas = filhasDiretas(f, escopo);
        const rotulo = (x) => (x.analitica === true ? "analítica" : x.analitica === false ? "sintética" : "sem resposta");
        console.log(`        sob ${f.codigo} ${f.codigoCompleto} ${f.nome}:`);
        for (const nt of netas) {
          console.log(`           ${String(nt.codigo).padEnd(6)} ${String(nt.codigoCompleto).padEnd(12)} ${String(nt.nome).padEnd(46)} ${rotulo(nt)}`);
        }
        if (!netas.length) console.log("           (sem filhas diretas)");
      }
    }
    if (analiticas.length === 1) {
      console.log(`     ⚠ HÁ UMA ÚNICA CANDIDATA ANALÍTICA (${analiticas[0].codigo} ${analiticas[0].nome}) — o destino é MECÂNICO.`);
      console.log("       Ainda assim o script NÃO escolheu: quem manda aplicar é o contador (--mapa).");
    } else {
      console.log("     ⚠ O SCRIPT NÃO ESCOLHEU, e não vai escolher: qual analítica recebe esta partida é");
      console.log("       decisão do contador. Passe `--mapa <sintetica>=<analitica>` quando ele decidir.");
    }
    paraDecidir.push({ entry, linha: l, conta, candidatas: analiticas, fechada });
  }
}

// ─── 5) o quadro final ────────────────────────────────────────────────────────────────────────
risco();
console.log("\nRESUMO\n");
console.log(`   ${"conta".padEnd(8)}${"nome".padEnd(40)}${"lanç.".padStart(6)}  competências`);
const porConta = new Map();
for (const p of paraDecidir) {
  const k = p.conta.codigo;
  if (!porConta.has(k)) porConta.set(k, { conta: p.conta, itens: [] });
  porConta.get(k).itens.push(p);
}
for (const { conta, itens } of porConta.values()) {
  const comps = itens.map((i) => `${i.entry.competencia}${i.fechada ? " (FECHADA)" : ""}`).join(", ");
  console.log(`   ${String(conta.codigo).padEnd(8)}${String(conta.nome).slice(0, 39).padEnd(40)}${String(itens.length).padStart(6)}  ${comps}`);
}
const emFechada = paraDecidir.filter((p) => p.fechada);
console.log(`\n   competências FECHADAS entre os afetados: ${emFechada.length} de ${paraDecidir.length}`);
if (emFechada.length) {
  console.log("   ⚠ Nestas a correção NÃO pode ser um UPDATE silencioso. Ou se REABRE a competência");
  console.log("     (o ato fica gravado em CompanyMonthlyCircular) ou se corrige por contra-lançamento");
  console.log("     na competência aberta. Este script recusa gravar nelas.");
}

// ─── 6) ⚠ A MEMÓRIA DE D/C — o lugar por onde o erro VOLTA ────────────────────────────────────
// Corrigir os lançamentos não basta. `AccountingHistorico` guarda o par D/C aprendido por
// (empresa, histórico) e é dele que sai a conta do lançamento AUTOMÁTICO — o extrato do SERPRO, o
// import de Excel/OFX. Enquanto a memória apontar para a sintética, o próximo mês recria o
// problema, e o gate NÃO impede: ele mora na rota do lançamento manual, e worker não é derrubado
// no meio de uma sincronia (mesmo critério de `MES_FECHADO`/`contasInexistentes`).
//
// ⚠ A LINHA **GLOBAL** (`companyPortalClientId` nulo) é a mais cara: ela é o fallback de empresa
// nova, e `memorizeAccountHistorico` só a completa quando a conta está VAZIA — ou seja, corrigir o
// lançamento pela tela NÃO a corrige. Ela precisa de decisão própria.
const codigosSinteticosEmUso = [...new Set(paraDecidir.map((p) => p.conta.codigo))];
const memorias = await prisma.accountingHistorico.findMany({
  where: {
    OR: [{ contaDebito: { in: codigosSinteticosEmUso } }, { contaCredito: { in: codigosSinteticosEmUso } }],
  },
  select: {
    id: true, companyPortalClientId: true, text: true, contaDebito: true, contaCredito: true,
    eventType: true, usageCount: true,
  },
});
risco();
console.log(`\nMEMÓRIA DE D/C APONTANDO PARA CONTA SINTÉTICA: ${memorias.length}\n`);
for (const m of memorias) {
  const emp = m.companyPortalClientId ? (empresas.get(m.companyPortalClientId)?.razao || m.companyPortalClientId) : "⚠ GLOBAL (fallback de empresa nova)";
  console.log(`   [${emp}] D=${m.contaDebito || "—"} C=${m.contaCredito || "—"}`
    + ` evt=${m.eventType || "—"} uso=${m.usageCount} :: ${m.text}`);
}
if (memorias.length) {
  console.log("\n   ⚠ Corrigir o lançamento pela tela reescreve a linha DA EMPRESA (auto-save do PUT).");
  console.log("     A linha GLOBAL não — ela só é completada quando a conta está vazia. Decisão do dono.");
  console.log("     ⚠ Este script NÃO toca em memória: ele mostra. Repontar a memória é escolher a");
  console.log("       conta de destino, e essa escolha é do contador.");
}

// ─── 7) A ESCRITA — só com `--mapa` E `--aplicar` ─────────────────────────────────────────────
if (!mapa.size) {
  console.log("\nNada foi alterado. Sem `--mapa`, este script é só o inventário — que é o que ele deve ser");
  console.log("enquanto o destino de cada lançamento não for decidido pelo contador.");
  await prisma.$disconnect();
  process.exit(0);
}

risco();
console.log(`\nMAPA INFORMADO: ${[...mapa].map(([de, para]) => `${de} → ${para}`).join(" · ")}`);
console.log(aplicar ? "⚠ MODO APLICAR\n" : "(ainda dry-run — acrescente `--aplicar` para gravar)\n");

const plano = { fara: [], recusados: [] };
for (const p of paraDecidir) {
  const destinoCod = mapa.get(p.conta.codigo);
  if (!destinoCod) continue;
  const destino = resolverConta(p.entry.portalClientId, destinoCod);
  // ⚠ AS TRÊS RECUSAS. Nenhuma delas é formalidade:
  //  · destino inexistente → o lançamento apontaria para conta que não existe (não há FK que avise);
  //  · destino NÃO analítico → trocaria uma conta que a ECD recusa por outra que ela também recusa
  //    (`null` é "não se sabe" e não serve de destino: não se move partida para o desconhecido);
  //  · mês fechado → alteração silenciosa de número já reportado.
  if (!destino) {
    plano.recusados.push({ p, motivo: `destino ${destinoCod} não existe no plano desta empresa` });
  } else if (destino.analitica !== true) {
    plano.recusados.push({ p, motivo: `destino ${destinoCod} ${destino.nome} não é analítica (analitica=${destino.analitica})` });
  } else if (p.fechada) {
    plano.recusados.push({ p, motivo: `competência ${p.entry.competencia} FECHADA — reabra (fica gravado) ou corrija por contra-lançamento` });
  } else {
    plano.fara.push({ p, destino });
  }
}

for (const { p, destino } of plano.fara) {
  console.log(`   ✓ ${p.entry.competencia}  ${String(p.linha.tipo)}  R$ ${money(p.linha.valor).padStart(14)}`
    + `  ${p.conta.codigo} → ${destino.codigo} ${destino.nome}   [${p.entry.historico}]`);
  // ⚠ AVISO, NÃO RECUSA. Mudar a NATUREZA da conta (uma receita virando ativo) é quase sempre
  // engano de digitação no `--mapa` — mas há reclassificação legítima que muda de grupo, e recusar
  // seria o script decidindo contabilidade. Ele aponta; quem confirma é quem digitou.
  if (destino.tipo !== p.conta.tipo) {
    console.log(`       ⚠ ATENÇÃO: a conta de destino é ${destino.tipo} e a atual é ${p.conta.tipo}.`
      + " Confira se é isto mesmo — o script não julga.");
  }
}
for (const { p, motivo } of plano.recusados) {
  console.log(`   ✖ ${p.entry.competencia}  ${p.conta.codigo}  — ${motivo}`);
}

if (!aplicar) {
  console.log("\nNada foi alterado (dry-run).");
  await prisma.$disconnect();
  process.exit(0);
}
if (arquivoPlano) {
  console.log("\n⚠ `--aplicar` RECUSADO no modo simulado. A derivação usada aqui veio do ARQUIVO, não do");
  console.log("  banco — mover partida contábil por ela seria corrigir pelo que o sistema ainda não sabe.");
  console.log("  Importe o plano de contas primeiro (o import é quem grava `codigoCompleto`/`analitica`).");
  await prisma.$disconnect();
  process.exit(1);
}

// ⚠ Só `AccountingEntryLine.conta` muda — nada de valor, data, histórico, tipo ou forma do
// lançamento. [[nao-mudar-forma-lancamentos]]
let gravadas = 0;
for (const { p, destino } of plano.fara) {
  await prisma.accountingEntryLine.update({ where: { id: p.linha.id }, data: { conta: destino.codigo } });
  gravadas += 1;
}
console.log(`\n⚠ GRAVADO: ${gravadas} linha(s) tiveram a conta trocada. ${plano.recusados.length} recusada(s).`);

// Reconferência: relê do banco e confirma que nenhuma linha tocada ficou em sintética.
const releitura = await prisma.accountingEntryLine.findMany({
  where: { id: { in: plano.fara.map(({ p }) => p.linha.id) } },
  select: { id: true, conta: true, entry: { select: { portalClientId: true } } },
});
const aindaSinteticas = releitura.filter((l) => resolverConta(l.entry.portalClientId, l.conta)?.analitica === false);
console.log(aindaSinteticas.length === 0
  ? "   conferência: nenhuma das linhas gravadas está em conta sintética. ✅"
  : `   ⚠ conferência: ${aindaSinteticas.length} linha(s) AINDA em conta sintética — investigar.`);

await prisma.$disconnect();
