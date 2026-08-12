// A MEMÓRIA DE D/C QUE APONTA PARA CONTA SINTÉTICA — dry-run por padrão.
//
// ⚠ SÓ LEITURA sem `--aplicar`. Nenhum DDL, nenhuma chamada externa, nenhum ato fiscal.
//
// ─── POR QUE ELE EXISTE, E POR QUE ELE NÃO É O `corrigir-conta-sintetica.mjs` ──────────────────
// Aquele trata do RAZÃO (os lançamentos que já existem em conta de agregação) e não escolhe nada:
// mover partida contábil é decisão do contador. Este trata da MEMÓRIA — `AccountingHistorico`, o
// par D/C aprendido por (empresa, eventType) ou pelo TEXTO, de onde sai a conta do lançamento
// AUTOMÁTICO (extrato do SERPRO, provisão de guia, import de Excel/OFX).
//
// A diferença que autoriza consertar um e não o outro:
//
//   · o razão já é número reportado — trocar a conta de uma partida muda o passado;
//   · a memória só influencia lançamento FUTURO, é reaprendida quando o contador corrige a conta
//     na tela, e não muda um número sequer já gravado. É reversível por natureza.
//
// ⚠ A LINHA **GLOBAL** (`companyPortalClientId` nulo) é a razão de o script existir: ela é o
// fallback de toda empresa sem memória própria (`lookupAccountsFromHistorico`, 2ª busca), e
// `memorizeAccountHistorico` só a COMPLETA quando a conta está vazia — corrigir o lançamento pela
// tela NÃO a reescreve. Ela nunca se conserta sozinha.
//
// ─── ⚠ ELE NÃO ESCOLHE A CONTA. NUNCA. ────────────────────────────────────────────────────────
// Escolher qual conta de receita (ou de despesa) recebe um valor é o que um CONTADOR faz. Este
// script PROPÕE e PARA: para cada memória em conta de agregação ele mostra a família inteira, marca
// a "DEMAIS …" quando existe UMA (o catch-all que o próprio plano criou), e não grava nada.
//
// **A escrita exige `--mapa <sintetica>=<analitica>` — a decisão de quem manda — E `--aplicar`.**
// Sem mapa ele é inventário. Com mapa e sem `--aplicar` ele mostra o antes/depois e para.
//
// ⚠ E o mapa não é aceito no escuro: destino inexistente ou NÃO analítico é RECUSADO por registro
// (`analitica: null` é "não se sabe", e não se move memória para o desconhecido). Destino de outra
// natureza contábil vira AVISO — há reclassificação legítima que muda de grupo, e recusá-la seria
// o script decidindo contabilidade.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/corrigir-memoria-conta-sintetica.mjs'
//
//   … com o destino decidido pelo dono (continua dry-run, mostra o efeito):
//   … node apps/api/scripts/corrigir-memoria-conta-sintetica.mjs --mapa 365=372,357=372
//
//   … e só então, para GRAVAR:
//   … node apps/api/scripts/corrigir-memoria-conta-sintetica.mjs --mapa 365=372,357=372 --aplicar

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const argv = process.argv.slice(2);
const aplicar = argv.includes("--aplicar");
/** `--mapa 365=372,357=372` → Map("365" → "372", …). A escolha é de quem digitou; aqui só se lê. */
const mapa = (() => {
  const m = new Map();
  // Aceita `--mapa a=b,c=d` repetido, para o comando poder crescer sem virar uma string só.
  argv.forEach((arg, i) => {
    if (arg !== "--mapa") return;
    for (const par of String(argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const [de, para] = par.split("=").map((s) => String(s || "").trim());
      if (de && para) m.set(de, para);
    }
  });
  return m;
})();

const risco = () => console.log("─".repeat(104));
const pad = (v, n) => String(v ?? "").padEnd(n);

console.log("═".repeat(104));
console.log(`MEMÓRIA DE D/C EM CONTA SINTÉTICA — ${aplicar ? "⚠ MODO APLICAR (grava)" : "dry-run (nada é gravado)"}`);
console.log("═".repeat(104));

// ─── 1) o plano, por escopo ───────────────────────────────────────────────────────────────────
// ⚠ Mesma resolução do `GET /chart-of-accounts` e do gate: a conta da EMPRESA vence a global.
// `AccountingHistorico.contaDebito` é TEXTO, sem FK — quem decide qual das duas é a conta é esta
// resolução, não o banco.
const contas = await prisma.chartOfAccount.findMany({
  select: { id: true, portalClientId: true, codigo: true, nome: true, codigoCompleto: true, analitica: true, tipo: true },
});
const porEscopo = new Map();
for (const c of contas) {
  const chave = c.portalClientId ?? "__GLOBAL__";
  if (!porEscopo.has(chave)) porEscopo.set(chave, []);
  porEscopo.get(chave).push(c);
}
const GLOBAL = porEscopo.get("__GLOBAL__") || [];

function resolverConta(portalClientId, codigo) {
  const cod = String(codigo ?? "").trim();
  if (!cod) return null;
  if (portalClientId) {
    const daEmpresa = (porEscopo.get(portalClientId) || []).find((c) => c.codigo === cod);
    if (daEmpresa) return daEmpresa;
  }
  return GLOBAL.find((c) => c.codigo === cod) || null;
}
/** O escopo em que a conta vive — é nele, e só nele, que se procura parentesco. */
function escopoDa(conta) {
  return conta.portalClientId ? (porEscopo.get(conta.portalClientId) || []) : GLOBAL;
}
/** Descendentes (qualquer profundidade) pelo código COMPLETO, dentro do mesmo escopo. */
function descendentes(mae, escopo) {
  const raiz = String(mae?.codigoCompleto ?? "").trim();
  if (!raiz) return [];
  return escopo
    .filter((c) => {
      const cc = String(c.codigoCompleto ?? "").trim();
      return cc.length > raiz.length && cc.startsWith(raiz);
    })
    .sort((a, b) => String(a.codigoCompleto).localeCompare(String(b.codigoCompleto)));
}

const sinteticas = contas.filter((c) => c.analitica === false);
console.log(`\nplano: ${contas.length} contas · ${sinteticas.length} SINTÉTICAS`
  + ` · ${contas.filter((c) => c.analitica === true).length} analíticas`
  + ` · ${contas.filter((c) => c.analitica == null).length} sem resposta (analitica NULL — nunca recusadas)`);

// ⚠ `\bDEMAIS\b` na palavra, não `includes`: casar por substring é como se escolhe conta por
// acidente. E o rótulo é só INFORMATIVO — ele marca a candidata, não a elege.
const EH_DEMAIS = /\bDEMAIS\b/i;

// ─── 2) as memórias afetadas ──────────────────────────────────────────────────────────────────
const memorias = await prisma.accountingHistorico.findMany({
  select: {
    id: true, companyPortalClientId: true, text: true, historicoSugerido: true,
    contaDebito: true, contaCredito: true, eventType: true, usageCount: true, updatedAt: true,
  },
  orderBy: [{ companyPortalClientId: "asc" }, { eventType: "asc" }],
});
const empresasIds = [...new Set(memorias.map((m) => m.companyPortalClientId).filter(Boolean))];
const empresas = new Map(
  (await prisma.portalClient.findMany({ where: { id: { in: empresasIds } }, select: { id: true, razao: true, cnpj: true } }))
    .map((e) => [e.id, e]),
);
const nomeEmpresa = (id) => {
  if (!id) return "⚠ GLOBAL (fallback de empresa nova)";
  const e = empresas.get(id);
  // ⚠ Empresa que não existe mais NÃO é escondida: a memória continua no banco e continua sendo
  // lida por (empresa, evento) se o id voltar. Dizer "órfã" é mais honesto que imprimir um uuid.
  return e ? e.razao : `${id}  ⚠ ÓRFÃ (não há PortalClient com este id)`;
};

const afetadas = [];
for (const m of memorias) {
  const lados = [];
  for (const lado of ["contaDebito", "contaCredito"]) {
    const conta = resolverConta(m.companyPortalClientId, m[lado]);
    if (conta?.analitica === false) lados.push({ lado, conta });
  }
  if (lados.length) afetadas.push({ m, lados });
}

console.log(`\nmemórias no banco: ${memorias.length} · APONTANDO PARA SINTÉTICA: ${afetadas.length}`);
console.log(`   por escopo: ${afetadas.filter((a) => !a.m.companyPortalClientId).length} GLOBAL`
  + ` · ${afetadas.filter((a) => a.m.companyPortalClientId).length} de EMPRESA`);
// ⚠ A distinção que decide QUEM lê a memória: só a memória COM `eventType` alimenta
// `lookupAccountsFromHistorico` (o extrato do SERPRO). A de `eventType` nulo é casada por TEXTO,
// e serve ao import de Excel/OFX. Tratá-las como a mesma coisa faz procurar defeito no lugar errado.
console.log(`   por leitor:  ${afetadas.filter((a) => a.m.eventType).length} com eventType (extrato do SERPRO / provisão de guia)`
  + ` · ${afetadas.filter((a) => !a.m.eventType).length} sem eventType (casadas por TEXTO — import de Excel/OFX)`);
if (!afetadas.length) console.log("\n✅ Nenhuma memória em conta de agregação. Nada a consertar.");

// ─── 3) o inventário: a família inteira de cada uma, e o que o mapa faria ─────────────────────
const plano = { fara: [], recusados: [], semMapa: [] };
for (const { m, lados } of afetadas) {
  risco();
  console.log(`\n[${nomeEmpresa(m.companyPortalClientId)}]`);
  console.log(`   evento ${m.eventType || "— (casada por TEXTO)"}   ·  usos ${m.usageCount}`
    + `   ·  atualizada ${m.updatedAt.toISOString().slice(0, 10)}`);
  console.log(`   texto: ${m.text}`);
  console.log(`   ANTES  D=${m.contaDebito || "—"}  C=${m.contaCredito || "—"}`);

  const troca = {};
  for (const { lado, conta } of lados) {
    const rotulo = lado === "contaDebito" ? "D" : "C";
    const escopo = escopoDa(conta);
    const filhas = descendentes(conta, escopo);
    const analiticas = filhas.filter((f) => f.analitica === true);
    const demais = analiticas.filter((f) => EH_DEMAIS.test(String(f.nome || "")));
    console.log(`\n   ⚠ ${rotulo}=${conta.codigo} ${conta.nome}`
      + `  (completo ${conta.codigoCompleto}, nível ${String(conta.codigoCompleto || "").length}, `
      + `escopo ${conta.portalClientId ? "EMPRESA" : "GLOBAL"}) é SINTÉTICA`);
    console.log(`     família: ${filhas.length} descendente(s), ${analiticas.length} analítica(s),`
      + ` ${demais.length} com "DEMAIS" no nome`);
    // ⚠ A lista sai INTEIRA. Cortá-la esconderia justamente a candidata que quem decide procura —
    // e a recusa deste script só é útil se vier com o caminho.
    for (const f of filhas) {
      const rot = f.analitica === true ? "analítica" : f.analitica === false ? "sintética" : "sem resposta";
      const selo = f.analitica === true && EH_DEMAIS.test(String(f.nome || "")) ? "  ← \"DEMAIS\" (catch-all do plano)" : "";
      console.log(`        ${pad(f.codigo, 6)} ${pad(f.codigoCompleto, 12)} ${pad(String(f.nome).slice(0, 46), 46)} ${rot}${selo}`);
    }
    if (!filhas.length) console.log("        (nenhum — o plano está incompleto neste ramo)");

    const destinoCod = mapa.get(conta.codigo);
    if (!destinoCod) {
      console.log(`     ✖ O SCRIPT NÃO ESCOLHEU, e não vai escolher: qual analítica recebe este par é`);
      console.log(`       decisão de quem manda. Passe \`--mapa ${conta.codigo}=<analitica>\` quando ele decidir.`);
      plano.semMapa.push({ m, conta, lado, analiticas, demais });
      continue;
    }
    const destino = resolverConta(m.companyPortalClientId, destinoCod);
    if (!destino) {
      plano.recusados.push({ m, conta, lado, motivo: `destino ${destinoCod} não existe no plano deste escopo` });
      console.log(`     ✖ RECUSADO: destino ${destinoCod} não existe no plano deste escopo.`);
    } else if (destino.analitica !== true) {
      plano.recusados.push({ m, conta, lado, motivo: `destino ${destinoCod} ${destino.nome} não é analítica (analitica=${destino.analitica})` });
      console.log(`     ✖ RECUSADO: destino ${destinoCod} ${destino.nome} não é analítica (analitica=${destino.analitica}).`);
    } else {
      const naFamilia = filhas.some((f) => f.codigo === destino.codigo);
      console.log(`     ➜ MAPA: ${conta.codigo} → ${destino.codigo} ${destino.codigoCompleto} ${destino.nome}`
        + `${naFamilia ? "  (dentro da família)" : "  ⚠ FORA da família desta sintética"}`);
      if (destino.tipo !== conta.tipo) {
        console.log(`       ⚠ ATENÇÃO: destino é ${destino.tipo} e a atual é ${conta.tipo}. Confira — o script não julga.`);
      }
      troca[lado] = destino;
    }
  }

  if (Object.keys(troca).length) {
    console.log(`\n   DEPOIS D=${troca.contaDebito ? troca.contaDebito.codigo : (m.contaDebito || "—")}`
      + `  C=${troca.contaCredito ? troca.contaCredito.codigo : (m.contaCredito || "—")}`);
    plano.fara.push({ m, troca });
  } else {
    console.log(`\n   DEPOIS (inalterada)`);
  }
}

// ─── 4) ⚠ AS OUTRAS PORTAS: regra, template e default — elas também geram lançamento sozinhas ──
// SÓ LEITURA, sempre — nem com `--aplicar`. A memória é (empresa, evento) e se reaprende; uma
// `AccountingEntryRule` é configuração deliberada e um `AccountingFunction` é template que o
// contador aplica à mão. Reescrevê-los é mexer na forma do lançamento de outra pessoa.
//
// ⚠ ESTA SEÇÃO É O PORTÃO DA DECISÃO "a memória basta". Se qualquer um destes apontar para
// sintética, a memória NÃO é a única fonte da conta no caminho automático, e consertá-la não fecha
// a porta sozinha.
risco();
console.log("\n⚠ AS OUTRAS FONTES DE CONTA NO CAMINHO AUTOMÁTICO (só medição — este script NÃO as toca)\n");

const regras = await prisma.accountingEntryRule.findMany({
  select: {
    id: true, portalClientId: true, scope: true, eventType: true, isActive: true,
    debitAccountCode: true, creditAccountCode: true,
  },
});
for (const id of [...new Set(regras.map((r) => r.portalClientId).filter(Boolean))]) {
  if (!empresas.has(id)) {
    // eslint-disable-next-line no-await-in-loop
    const e = await prisma.portalClient.findUnique({ where: { id }, select: { id: true, razao: true } });
    if (e) empresas.set(e.id, e);
  }
}
const regrasRuins = [];
for (const r of regras) {
  for (const lado of ["debitAccountCode", "creditAccountCode"]) {
    const conta = resolverConta(r.portalClientId, r[lado]);
    if (conta?.analitica === false) regrasRuins.push({ r, lado, conta });
  }
}
// ⚠ A REGRA VENCE A MEMÓRIA (`AccountingEntryGeneratorService.js:318-327`): havendo conta na regra,
// `lookupAccountsFromHistorico` nem é chamado. Uma regra ruim torna o conserto da memória inócuo
// naquele evento — por isso ela é medida aqui, e não só citada.
console.log(`   AccountingEntryRule (VENCE a memória): ${regras.length} regra(s), ${regras.filter((r) => r.isActive).length} ativa(s)`
  + ` · apontando para SINTÉTICA: ${regrasRuins.length}`);
for (const { r, lado, conta } of regrasRuins) {
  console.log(`      [${r.portalClientId ? (empresas.get(r.portalClientId)?.razao || r.portalClientId) : "GLOBAL"}]`
    + ` ${r.eventType} ${r.isActive ? "ATIVA" : "inativa"} ${lado === "debitAccountCode" ? "D" : "C"}=${conta.codigo} ${conta.nome}`);
}

// ⚠ O DEFAULT DO FORMULÁRIO É UMA FONTE, mesmo sem nenhuma regra gravada. `EVENT_RULE_DEFAULTS`
// (`routes/firm/accountingEntryRules.js:5-29`) é servido por `GET /event-types` e preenche o corpo
// omitido em `buildRuleData` — quem criar a regra aceitando o padrão grava ESTAS contas, e elas
// passam a vencer a memória. Conferi-las é barato; descobri-las depois de gravadas, não.
const DEFAULTS_DA_ROTA = [
  { evento: "RECEITA_SIMPLES", D: "5", C: "301" },
  { evento: "DAS_SIMPLES", D: "401", C: "5" },
  { evento: "BAIXA_DAS_SIMPLES", D: "", C: "" },
];
console.log(`\n   EVENT_RULE_DEFAULTS (o que o formulário de regra grava se ninguém trocar):`);
let defaultsRuins = 0;
for (const d of DEFAULTS_DA_ROTA) {
  const linha = [];
  for (const [rot, cod] of [["D", d.D], ["C", d.C]]) {
    if (!cod) { linha.push(`${rot}=(vazio)`); continue; }
    const conta = resolverConta(null, cod);
    const estado = conta == null ? "⚠ NÃO EXISTE no plano global"
      : conta.analitica === false ? "⚠ SINTÉTICA"
        : conta.analitica === true ? "analítica" : "sem resposta";
    if (conta?.analitica === false) defaultsRuins += 1;
    linha.push(`${rot}=${cod} ${conta?.nome || "?"} [${estado}]`);
  }
  console.log(`      ${pad(d.evento, 20)} ${linha.join("  ·  ")}`);
}

const linhasFn = await prisma.accountingFunctionLine.findMany({
  select: {
    id: true, conta: true, tipo: true,
    functionEntry: {
      select: {
        id: true, historico: true,
        function: { select: { id: true, name: true, portalClientId: true, isSystem: true, kind: true } },
      },
    },
  },
});
const fnRuins = [];
for (const l of linhasFn) {
  const fn = l.functionEntry?.function;
  const conta = resolverConta(fn?.portalClientId, l.conta);
  if (conta?.analitica === false) fnRuins.push({ l, fn, conta });
}
console.log(`\n   AccountingFunction (templates): ${new Set(linhasFn.map((l) => l.functionEntry?.function?.id)).size} função(ões),`
  + ` ${linhasFn.length} linha(s) · apontando para SINTÉTICA: ${fnRuins.length} linha(s)`
  + ` em ${new Set(fnRuins.map((x) => x.fn?.id)).size} função(ões)`);
for (const { l, fn, conta } of fnRuins) {
  console.log(`      [${fn?.portalClientId ? (empresas.get(fn.portalClientId)?.razao || fn.portalClientId) : "GLOBAL"}]`
    + ` "${fn?.name}" ${fn?.isSystem ? "(sistema)" : ""} kind=${fn?.kind} :: ${l.tipo}=${conta.codigo} ${conta.nome}`);
}

// ⚠ A coluna chama `contaId` mas guarda o CÓDIGO da conta ("conta aprendida"), não é FK — por isso
// resolve pelo mesmo `resolverConta`. É a memória do parcelamento V2, e ela também gera sozinha.
const mapas = await prisma.mapaContaTributo.findMany({
  select: { id: true, portalClientId: true, tipoParcelamento: true, tipoLinha: true, codigoTributo: true, contaId: true },
}).catch(() => null);
if (mapas) {
  const mapasRuins = mapas.filter((mp) => resolverConta(mp.portalClientId, mp.contaId)?.analitica === false);
  console.log(`\n   MapaContaTributo (memória de conta do parcelamento V2): ${mapas.length}`
    + ` · apontando para SINTÉTICA: ${mapasRuins.length}`);
  for (const mp of mapasRuins) {
    const conta = resolverConta(mp.portalClientId, mp.contaId);
    console.log(`      ${mp.tipoParcelamento}/${mp.tipoLinha}/${mp.codigoTributo || "—"} → ${conta.codigo} ${conta.nome}`);
  }
}

// ─── 5) os lançamentos com conta VAZIA — o caminho legítimo, medido e NÃO consertado ──────────
// Conta em branco é o desenho ("Contas em branco são esperadas no 1º mês — a memória preenche as
// próximas"). O que importa saber é POR QUAL conta a memória consertada os preencheria.
const vazias = await prisma.accountingEntryLine.findMany({
  where: { conta: "" },
  select: { id: true, entryId: true, entry: { select: { portalClientId: true, eventType: true, origem: true, status: true } } },
});
const porChave = new Map();
for (const l of vazias) {
  const k = `${l.entry?.portalClientId}|${l.entry?.eventType || "—"}`;
  if (!porChave.has(k)) porChave.set(k, { entry: l.entry, linhas: 0, entries: new Set() });
  porChave.get(k).linhas += 1;
  porChave.get(k).entries.add(l.entryId);
}
console.log(`\n   Lançamentos com conta VAZIA: ${vazias.length} linha(s) em ${new Set(vazias.map((l) => l.entryId)).size} lançamento(s)`);
for (const [, v] of porChave) {
  // A MESMA ordem de `lookupAccountsFromHistorico`: memória da empresa primeiro, global depois.
  const daEmpresa = memorias.find((mm) => mm.companyPortalClientId === v.entry?.portalClientId
    && mm.eventType === v.entry?.eventType && (mm.contaDebito || mm.contaCredito));
  const global = memorias.find((mm) => mm.companyPortalClientId === null
    && mm.eventType === v.entry?.eventType && (mm.contaDebito || mm.contaCredito));
  const fonte = daEmpresa || global;
  const rotuloFonte = daEmpresa ? "memória DA EMPRESA" : global ? "memória GLOBAL (fallback)" : "NENHUMA memória — continuaria em branco";
  const contas = fonte ? ` (D=${fonte.contaDebito || "—"} C=${fonte.contaCredito || "—"})` : "";
  console.log(`      [${nomeEmpresa(v.entry?.portalClientId)}] ${v.entry?.eventType || "—"} ${v.entry?.origem}/${v.entry?.status}`
    + ` — ${v.entries.size} lanç., ${v.linhas} linha(s) → ${rotuloFonte}${contas}`);
}
console.log("\n   ⚠ Conta em branco NÃO é consertada aqui: é o caminho documentado (nasce vazia, é");
console.log("     aprendida). E a memória consertada NÃO as preenche sozinha: `findChangedValue`");
console.log("     (`AccountingEntryGeneratorService.js:286-297`) compara tipo/circularId/ruleId/");
console.log("     eventType/VALOR — nunca a conta. Sync com o mesmo valor devolve `noop` e as linhas");
console.log("     não são reescritas. Só o lançamento NOVO (ou aquele cujo valor mudar, que cai no");
console.log("     `update` e recria as linhas) nasce na conta certa.");

// ─── 6) o quadro final e a escrita ────────────────────────────────────────────────────────────
risco();
console.log("\nRESUMO\n");
console.log(`   memórias em conta sintética: ${afetadas.length}`);
console.log(`   com destino no --mapa (seriam gravadas): ${plano.fara.length}`);
console.log(`   RECUSADAS pelo destino informado: ${plano.recusados.length}`);
for (const r of plano.recusados) console.log(`      [${nomeEmpresa(r.m.companyPortalClientId)}] ${r.conta.codigo} — ${r.motivo}`);
console.log(`   SEM MAPA — o script parou (a escolha é de quem manda): ${plano.semMapa.length}`);
for (const p of plano.semMapa) {
  const dica = p.demais.length === 1 ? `há UMA "DEMAIS": ${p.demais[0].codigo} ${p.demais[0].nome}`
    : p.demais.length > 1 ? `há ${p.demais.length} "DEMAIS" — ambíguo`
      : p.analiticas.length === 1 ? `há UMA analítica na família: ${p.analiticas[0].codigo} ${p.analiticas[0].nome}`
        : `${p.analiticas.length} analíticas, nenhuma "DEMAIS"`;
  console.log(`      [${nomeEmpresa(p.m.companyPortalClientId)}] ${p.m.eventType || "(por texto)"}`
    + ` ${p.lado === "contaDebito" ? "D" : "C"}=${p.conta.codigo} ${p.conta.nome} — ${dica}`);
}

if (!mapa.size) {
  console.log("\nNada foi alterado. Sem `--mapa`, este script é só o inventário — que é o que ele deve ser");
  console.log("enquanto o destino de cada memória não for decidido por quem manda.");
  await prisma.$disconnect();
  process.exit(0);
}
if (!aplicar) {
  console.log("\nNada foi alterado (dry-run). Para gravar, repita o comando com `--aplicar`.");
  console.log("⚠ Isto não muda nenhum número já lançado — a memória só influencia lançamento FUTURO,");
  console.log("  e é reaprendida quando o contador corrige a conta na tela.");
  await prisma.$disconnect();
  process.exit(0);
}

let gravadas = 0;
for (const { m, troca } of plano.fara) {
  const data = {};
  if (troca.contaDebito) data.contaDebito = troca.contaDebito.codigo;
  if (troca.contaCredito) data.contaCredito = troca.contaCredito.codigo;
  // ⚠ SÓ as duas colunas de conta. `text`, `historicoSugerido`, `eventType` e `usageCount` ficam
  // como estão — mudar a chave de match transformaria um conserto de conta em outra memória.
  // eslint-disable-next-line no-await-in-loop
  await prisma.accountingHistorico.update({ where: { id: m.id }, data });
  gravadas += 1;
}
console.log(`\n⚠ GRAVADO: ${gravadas} memória(s) repontada(s). ${plano.recusados.length} recusada(s).`);

// Reconferência: relê do banco e confirma que nenhuma das tocadas ficou em sintética.
const releitura = await prisma.accountingHistorico.findMany({
  where: { id: { in: plano.fara.map(({ m }) => m.id) } },
  select: { id: true, companyPortalClientId: true, eventType: true, text: true, contaDebito: true, contaCredito: true },
});
const aindaRuins = releitura.filter((r) =>
  resolverConta(r.companyPortalClientId, r.contaDebito)?.analitica === false
  || resolverConta(r.companyPortalClientId, r.contaCredito)?.analitica === false);
console.log(aindaRuins.length === 0
  ? "   conferência: nenhuma das memórias gravadas aponta para conta sintética. ✅"
  : `   ⚠ conferência: ${aindaRuins.length} memória(s) AINDA em conta sintética — investigar.`);
for (const r of releitura) {
  console.log(`      [${nomeEmpresa(r.companyPortalClientId)}] ${r.eventType || "(por texto)"}`
    + `  D=${r.contaDebito || "—"}  C=${r.contaCredito || "—"}  :: ${r.text}`);
}

await prisma.$disconnect();
