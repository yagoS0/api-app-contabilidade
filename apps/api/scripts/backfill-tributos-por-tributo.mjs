// BACKFILL DA REPARTIÇÃO POR TRIBUTO — dry-run por padrão. ⚠ QUEM RODA COM `--aplicar` É O DONO.
//
// ─── O QUE ELE FAZ ──────────────────────────────────────────────────────────────────────────
//
// Relê o `metadata.parsedPgdas.rawText` que JÁ está guardado em `CompanyMonthlyCircular`, extrai a
// repartição com `parseTributosPgdas` (a MESMA função que a captura passou a usar — nunca uma
// segunda leitura) e a grava em `ApuracaoSnapshot.tributosPorTributo`.
//
// **Nenhuma chamada externa.** O dado é retroativo: medido em produção (17/08/2026), 82 de 82
// extratos guardados têm a linha, partem em 9 valores e fecham a soma. Recapturar para obter isto
// seria gastar chamada paga por um dado que já está no banco.
//
// ─── ⚠ O QUE ELE NÃO FAZ, E POR QUÊ ─────────────────────────────────────────────────────────
//
// · **Não cria `ApuracaoSnapshot`.** A linha tem `rbt12` e `receitaPorTipo` NOT NULL e
//   `idempotencyKey` @unique — criar uma só para pendurar esta marca exigiria **inventar dado
//   fiscal** num registro auditável. Competência sem snapshot é contada e nomeada (`SEM_SNAPSHOT`),
//   e o backfill pode ser rodado de novo depois que ela existir.
// · **Não grava repartição parcial.** Sem os 9 valores ou com a soma não fechando,
//   `tributosPorTributoParaColuna` devolve `null` e a linha é pulada com o motivo. Parcial gravada
//   parece completa — é pior que ausência.
// · **Não parte o DAS.** Regra escrita do dono: o DAS do Simples é **UM** lançamento contábil.
//   Isto é coluna de leitura/auditoria; nenhum lançamento, provisão ou alíquota sai daqui.
// · **Não toca em nenhuma outra coluna** — nem as três de DAS, nem as do motor
//   (`receitaPorAnexo`, `aliquotaEfetivaPorAnexo`, `vigenciaAliquota`). O `update` escreve
//   `tributosPorTributo` e mais nada.
//
// ─── IDEMPOTÊNCIA ───────────────────────────────────────────────────────────────────────────
//
// Reprocessar é seguro: a leitura é pura e sai do mesmo `rawText`, então o valor calculado é o
// mesmo. Por padrão o script **PULA** linhas que já têm a coluna preenchida (`JA_PREENCHIDO`) — use
// `--refazer` para reescrevê-las (útil se a forma da coluna mudar). ⚠ `lidoEm` muda a cada
// reescrita; por isso a comparação de "já está igual" ignora esse campo.
//
// Uso:
//   node scripts/backfill-tributos-por-tributo.mjs                 # dry-run (padrão)
//   node scripts/backfill-tributos-por-tributo.mjs --aplicar       # grava
//   node scripts/backfill-tributos-por-tributo.mjs --cnpj=... --comp=AAAA-MM --refazer
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/backfill-tributos-por-tributo.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  parseTributosPgdas,
  tributosPorTributoParaColuna,
} from "../src/application/fiscal/serpro/parseTributosPgdas.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

const APLICAR = flag("aplicar");
const REFAZER = flag("refazer");

const soDigitos = (v) => String(v || "").replace(/\D+/g, "");
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const num = (n, w = 5) => String(n ?? 0).padStart(w);

function rawTextDe(circular) {
  const m = circular?.metadata;
  if (!m || typeof m !== "object") return null;
  const t = m?.parsedPgdas?.rawText;
  return typeof t === "string" && t.trim() ? t : null;
}

/** Igualdade que ignora `lidoEm` — só ele muda numa reescrita do mesmo `rawText`. */
function mesmaColuna(a, b) {
  if (!a || !b) return false;
  const semData = ({ lidoEm, ...resto }) => JSON.stringify(resto, Object.keys(resto).sort());
  return semData(a) === semData(b);
}

async function main() {
  const cnpjFiltro = soDigitos(arg("cnpj"));
  const compFiltro = arg("comp");

  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log(`║ BACKFILL tributosPorTributo — ${APLICAR ? "APLICANDO (grava)" : "DRY-RUN (não grava nada)"}`.padEnd(79) + "║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("Fonte: metadata.parsedPgdas.rawText (já guardado). Nenhuma chamada externa.\n");

  const where = {};
  if (compFiltro) where.competencia = compFiltro;

  const circulares = await prisma.companyMonthlyCircular.findMany({
    where,
    select: {
      competencia: true, metadata: true, portalClientId: true,
      portalClient: { select: { cnpj: true, razao: true } },
    },
    orderBy: [{ competencia: "desc" }],
  });

  const alvos = circulares.filter((c) => {
    if (!rawTextDe(c)) return false;
    if (!cnpjFiltro) return true;
    return soDigitos(c.portalClient?.cnpj) === cnpjFiltro;
  });

  const contagem = new Map();
  const conta = (k) => contagem.set(k, (contagem.get(k) || 0) + 1);
  const pulados = [];
  let gravados = 0;

  for (const c of alvos) {
    const leitura = parseTributosPgdas(rawTextDe(c));
    const coluna = tributosPorTributoParaColuna(leitura);
    const quem = `${pad(c.portalClient?.razao, 28)} ${pad(c.competencia, 9)}`;

    if (!coluna) {
      // Motivo nomeado, nunca "não deu". Sem repartição confiável, nada é gravado.
      conta(leitura.motivo || "SEM_REPARTICAO");
      pulados.push(`${quem} ${leitura.motivo || "SEM_REPARTICAO"}`);
      continue;
    }

    // ⚠ SÓ ATUALIZA — nunca cria. Ver o cabeçalho: criar snapshot exigiria inventar rbt12.
    const snapshot = await prisma.apuracaoSnapshot.findUnique({
      where: {
        portalClientId_competencia: {
          portalClientId: c.portalClientId, competencia: c.competencia,
        },
      },
      select: { id: true, tributosPorTributo: true },
    });

    if (!snapshot) {
      conta("SEM_SNAPSHOT");
      pulados.push(`${quem} SEM_SNAPSHOT (a competência não foi apurada por aqui)`);
      continue;
    }
    if (snapshot.tributosPorTributo && !REFAZER) {
      conta(mesmaColuna(snapshot.tributosPorTributo, coluna) ? "JA_PREENCHIDO_IGUAL" : "JA_PREENCHIDO_DIFERENTE");
      continue;
    }

    conta("A_GRAVAR");
    if (APLICAR) {
      await prisma.apuracaoSnapshot.update({
        where: { id: snapshot.id },
        // ⚠ UMA coluna. Nenhuma das três de DAS, nenhuma do motor.
        data: { tributosPorTributo: coluna },
      });
      gravados += 1;
    } else if (gravados < 5) {
      // Amostra do que SERIA gravado — dry-run que não mostra o valor não deixa conferir nada.
      console.log(`  [seria gravado] ${quem} total=${coluna.total} ISS=${coluna.tributos.ISS} `
        + `INSS/CPP=${coluna.tributos["INSS/CPP"]}`);
      gravados += 1;
    }
  }

  console.log("\n── Resultado ─────────────────────────────────────────────────────────────────");
  console.log(`  circulares com extrato guardado  ${num(alvos.length, 6)}`);
  for (const [k, v] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(k, 30)} ${num(v, 6)}`);
  }

  if (pulados.length) {
    console.log("\n── Pulados (com o motivo; nada foi gravado nestes) ───────────────────────────");
    for (const l of pulados.slice(0, 20)) console.log(`  ${l}`);
    if (pulados.length > 20) console.log(`  … e mais ${pulados.length - 20}`);
  }

  console.log(
    APLICAR
      ? `\n✓ Gravadas ${gravados} linha(s). Rode de novo: o resultado deve ser JA_PREENCHIDO_IGUAL.`
      : "\n⚠ DRY-RUN — nada foi gravado. Para aplicar: --aplicar"
  );
  console.log("⚠ A ordem dos oito tributos é POSICIONAL (do cabeçalho) e vai gravada com");
  console.log("  `ordemVerificada: false`. Confirmar contra o PDF é ato de contador.");
}

main()
  .catch((e) => { console.error("Falhou:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
