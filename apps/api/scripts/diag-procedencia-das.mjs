// MEDE quantos `ApuracaoSnapshot.dasCalculadoLocal` dá para desambiguar — e quantos NÃO dá.
//
// Só LÊ o banco. Nenhuma escrita, nenhuma chamada externa (SERPRO/ADN/SEFAZ). Dry-run é o único
// modo que existe: não há flag para "aplicar".
//
//   node scripts/diag-procedencia-das.mjs                 → carteira inteira
//   node scripts/diag-procedencia-das.mjs --cnpj=<cnpj>   → uma empresa
//   node scripts/diag-procedencia-das.mjs --ano=2026
//   node scripts/diag-procedencia-das.mjs --listar         → imprime as linhas AMBÍGUAS uma a uma
//
// ─── O QUE ELE MEDE, E POR QUE A MEDIDA É CONFIÁVEL ──────────────────────────────────────────
//
// `dasCalculadoLocal` teve, na história desta tabela, EXATAMENTE DOIS escritores — e cada um grava
// um objeto inteiro numa transação só, o que deixa uma assinatura na própria linha:
//
//   • `FechamentoService.calcularFechamento` (a SIMULAÇÃO OFICIAL da RFB, indicadorTransmissao:false)
//       grava `dasCalculadoLocal` + `receitaPorTipo = {}` + `receitaPorAnexo = {}` + `simulacaoSerpro`
//   • `MotorApuracaoService.calcularApuracaoLocal` (o NOSSO motor)
//       grava `dasCalculadoLocal` + `receitaPorTipo` com as SETE chaves de TipoReceita — nunca
//       vazio, nem quando todas valem 0 — + `aliquotaEfetivaPorAnexo`
//
// Logo `receitaPorTipo` diz QUEM ESCREVEU POR ÚLTIMO: vazio ⇒ simulação; não-vazio ⇒ motor.
// Isso é evidência na linha, não inferência sobre o passado — e é o mesmo critério que o backfill
// da migration `20260813120000_add_procedencia_das` usa.
//
// ⚠ O QUE NÃO CASAR COM NENHUMA DAS DUAS ASSINATURAS SAI COMO **AMBÍGUO**, e é para isso que este
// script existe: dizer QUANTAS são, em vez de deixar alguém chutar. Ambíguo não é erro do script;
// é o resultado honesto de uma linha que não guarda a própria procedência.
//
// ⚠ ESTE SCRIPT NÃO DIZ SE A MIGRATION FOI APLICADA. Se as colunas novas já existirem, ele mostra
// também o que está gravado em `dasCalculadoLocalProcedencia`/`dasSimuladoSerpro`, para conferir o
// backfill contra a mesma conta.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const flag = (name) => process.argv.includes(`--${name}`);
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const money = (n) => (n == null ? "—" : `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** `receitaPorTipo` vazio? Cobre `{}`, `null` e o Json que voltou como string. */
function jsonVazio(v) {
  if (v == null) return true;
  if (typeof v === "string") {
    try { return jsonVazio(JSON.parse(v)); } catch { return false; }
  }
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/**
 * A CLASSIFICAÇÃO — a mesma do backfill, escrita uma vez.
 * @returns {"SIMULACAO_RFB"|"MOTOR_LOCAL"|"AMBIGUO"}
 */
function classificar(snap) {
  const temSimulacao = snap.simulacaoSerpro != null;
  const tipoVazio = jsonVazio(snap.receitaPorTipo);
  // Assinatura da simulação: ela zera `receitaPorTipo` E guarda o retorno cru da RFB.
  if (tipoVazio && temSimulacao) return "SIMULACAO_RFB";
  // Assinatura do motor: `receitaPorTipo` preenchido só sai dele (a simulação sempre grava `{}`).
  if (!tipoVazio) return "MOTOR_LOCAL";
  // `receitaPorTipo` vazio e sem `simulacaoSerpro`: nenhuma das duas assinaturas fecha. Não se
  // afirma nada. (Linha muito antiga, snapshot mexido à mão, ou escrita parcial.)
  return "AMBIGUO";
}

try {
  const cnpjFiltro = arg("cnpj");
  const anoFiltro = arg("ano");
  const listar = flag("listar");

  const portais = await prisma.portalClient.findMany({ select: { id: true, companyId: true, razao: true, cnpj: true } });
  let alvo = portais;
  if (cnpjFiltro) {
    const d = onlyDigits(cnpjFiltro);
    alvo = portais.filter((p) => onlyDigits(p.cnpj) === d);
    if (!alvo.length) { console.error(`Nenhuma empresa com CNPJ ${cnpjFiltro}.`); process.exit(1); }
  }
  const razaoPorId = new Map(alvo.map((p) => [p.id, p.razao || p.cnpj || p.id]));

  // ⚠ `select` explícito, e sem as colunas novas por padrão: o script precisa rodar ANTES da
  // migration (é essa a ordem: medir, depois o dono decide aplicar). As colunas novas são lidas
  // num segundo passo, tolerante a erro.
  const snaps = await prisma.apuracaoSnapshot.findMany({
    where: {
      portalClientId: { in: alvo.map((p) => p.id) },
      ...(anoFiltro ? { competencia: { startsWith: `${anoFiltro}-` } } : {}),
    },
    select: {
      id: true, portalClientId: true, competencia: true, estado: true,
      dasCalculadoLocal: true, dasRetornadoSerpro: true,
      receitaPorTipo: true, receitaPorAnexo: true,
      simulacaoSerpro: true, aliquotaEfetivaPorAnexo: true, updatedAt: true,
    },
    orderBy: [{ competencia: "asc" }],
  });

  const comValor = snaps.filter((s) => s.dasCalculadoLocal != null);

  const baldes = { SIMULACAO_RFB: [], MOTOR_LOCAL: [], AMBIGUO: [] };
  for (const s of comValor) baldes[classificar(s)].push(s);

  const total = snaps.length;
  const n = comValor.length;
  const pct = (x) => (n ? `${((x / n) * 100).toFixed(1)}%` : "—");

  console.log(`Procedência de \`ApuracaoSnapshot.dasCalculadoLocal\`${cnpjFiltro ? ` · CNPJ ${cnpjFiltro}` : ""}${anoFiltro ? ` · ano ${anoFiltro}` : ""}`);
  console.log("SÓ LEITURA — nada é escrito, nada é chamado por fora.\n");
  console.log(`Snapshots no recorte .................: ${total}`);
  console.log(`Com \`dasCalculadoLocal\` preenchido ...: ${n}`);
  console.log("─".repeat(78));
  console.log(`DESAMBIGUÁVEIS ..... ${baldes.SIMULACAO_RFB.length + baldes.MOTOR_LOCAL.length}  (${pct(baldes.SIMULACAO_RFB.length + baldes.MOTOR_LOCAL.length)})`);
  console.log(`  ├─ SIMULAÇÃO RFB . ${baldes.SIMULACAO_RFB.length}  → o backfill move para \`dasSimuladoSerpro\``);
  console.log(`  └─ MOTOR LOCAL ... ${baldes.MOTOR_LOCAL.length}  → fica onde está, marcado 'MOTOR_LOCAL'`);
  console.log(`AMBÍGUOS ........... ${baldes.AMBIGUO.length}  (${pct(baldes.AMBIGUO.length)})  → ficam 'AMBIGUO'. NÃO se inventa procedência.`);
  console.log("─".repeat(78));

  // Quanto dinheiro está em cada balde — o tamanho do que ficaria sem dono.
  const soma = (arr) => arr.reduce((s, x) => s + Number(x.dasCalculadoLocal || 0), 0);
  console.log(`Valor em linhas ambíguas .............: ${money(soma(baldes.AMBIGUO))}`);

  // Já transmitidas: nessas o número oficial existe em `dasRetornadoSerpro`, então a ambiguidade
  // do `dasCalculadoLocal` não chega à tela (o KPI prefere o transmitido). Medir para dimensionar
  // o impacto REAL do resíduo.
  const ambiguasVisiveis = baldes.AMBIGUO.filter((s) => s.dasRetornadoSerpro == null);
  console.log(`Ambíguas que a tela ainda MOSTRA .....: ${ambiguasVisiveis.length}  (as demais têm DAS transmitido, que vence no KPI)`);

  if (listar && baldes.AMBIGUO.length) {
    console.log("\nLinhas ambíguas:");
    console.log("  competência  empresa                              estado           DAS local");
    for (const s of baldes.AMBIGUO) {
      console.log(`  ${s.competencia}      ${String(razaoPorId.get(s.portalClientId)).slice(0, 34).padEnd(34)} ${String(s.estado || "—").padEnd(16)} ${money(s.dasCalculadoLocal)}`);
    }
  }

  // Segundo passo: se a migration JÁ tiver sido aplicada, confere o gravado contra esta conta.
  let jaMigrado = null;
  try {
    jaMigrado = await prisma.$queryRawUnsafe(
      `SELECT "dasCalculadoLocalProcedencia" AS p, COUNT(*)::int AS n
         FROM "apuracao_snapshots"
        WHERE "dasCalculadoLocal" IS NOT NULL
        GROUP BY 1`,
    );
  } catch { /* coluna ainda não existe — é o estado esperado ANTES da migration */ }

  if (jaMigrado) {
    console.log("\nMigration JÁ aplicada — o que está gravado hoje:");
    for (const r of jaMigrado) console.log(`  ${String(r.p ?? "(nulo)").padEnd(14)} ${r.n}`);
    const simulados = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "apuracao_snapshots" WHERE "dasSimuladoSerpro" IS NOT NULL`,
    ).catch(() => null);
    if (simulados) console.log(`  com dasSimuladoSerpro: ${simulados[0]?.n ?? 0}`);
    console.log("  ⚠ Se estes números divergirem dos de cima, alguém escreveu na coluna por fora");
    console.log("    do backfill — investigue antes de confiar no rótulo da tela.");
  } else {
    console.log("\nA coluna `dasCalculadoLocalProcedencia` ainda não existe neste banco:");
    console.log("a migration `20260813120000_add_procedencia_das` NÃO foi aplicada. Os números");
    console.log("acima são a previsão do que ela faria.");
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
