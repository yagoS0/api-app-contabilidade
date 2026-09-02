/**
 * ⚠ SÓ LEITURA — confere no BANCO o que as migrações de 01/09/2026 prometeram.
 *
 * O `prisma migrate status` diz que ele APLICOU; isto diz que a coluna EXISTE. São afirmações
 * diferentes, e a segunda é a que importa: uma migration com DDL torto pode constar como aplicada.
 *
 * Uso: `node scripts/diag-migracoes-01set.mjs`
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COLUNAS = [
  ["saidas_avulsas_cliente", "accountingEntryId", "o vínculo que torna «lançar a saída» idempotente"],
  ["lancamentos_declarados", "previstoNoFluxoEm", "a data em que a despesa entra no fluxo, sem lançar"],
];
const TABELAS = [
  ["simulacoes_planejamento", "a foto da simulação do planejamento tributário"],
];

let faltou = 0;

for (const [tabela, coluna, paraQue] of COLUNAS) {
  const r = await prisma.$queryRaw`
    SELECT data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = ${tabela} AND column_name = ${coluna}
  `;
  if (!r.length) {
    faltou += 1;
    console.log(`✗ ${tabela}.${coluna} — NÃO EXISTE (${paraQue})`);
  } else {
    console.log(`✓ ${tabela}.${coluna} — ${r[0].data_type}, nullable=${r[0].is_nullable} (${paraQue})`);
  }
}

for (const [tabela, paraQue] of TABELAS) {
  const r = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = ${tabela}
  `;
  if (!r[0].n) {
    faltou += 1;
    console.log(`✗ ${tabela} — NÃO EXISTE (${paraQue})`);
  } else {
    console.log(`✓ ${tabela} — existe (${paraQue})`);
  }
}

/**
 * ⚠ O estado `LANCADA` NÃO tem DDL: `estado` é TEXT, sem enum e sem CHECK no banco — quem guarda o
 * vocabulário é a aplicação. Contar as linhas por estado é o que se pode afirmar daqui.
 */
const porEstado = await prisma.saidaAvulsaCliente.groupBy({
  by: ["estado"],
  _count: { _all: true },
}).catch((e) => ({ erro: e.message }));
console.log("\nsaidas_avulsas_cliente por estado:", porEstado);

await prisma.$disconnect();
process.exit(faltou ? 1 : 0);
