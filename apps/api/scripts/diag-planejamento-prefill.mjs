// O PLANEJAMENTO INFLADO ×100 — quantas empresas estão hoje com o comparativo errado.
//
// ⚠⚠ O DEFEITO, medido em 25/08/2026: a tela do planejamento escreve o número JS CRU no input
// (`renderPlanejamentoPage.jsx:131-134,163`, `String(888286.09)` → `"888286.09"`) e o parser dela
// remove TODO ponto como separador de milhar (`:44`, que é o certo para digitação pt-BR).
// Resultado: `888286.09` entra no motor como **88.828.609**.
//
// As duas consequências que o dono viu na tela, e que têm esta única causa:
//   · receita > R$ 78 mi  ⇒ "A empresa não é elegível a este regime" (Lucro Presumido)
//   · RBT12   > R$ 4,8 mi ⇒ `faixaDoRbt12` devolve `null` ⇒ "Sem RBT12 não há alíquota efetiva"
//
// ⚠ Valor SEM centavos passa ileso — foi por isso que o mock (que usa inteiros redondos) nunca
// pegou nada, e por isso este script conta exatamente quem tem centavos.
//
// Ele chama `montarDadosPlanejamento`, o MESMO serviço da rota, e reproduz o `num()` da tela
// letra por letra. Uma segunda conta escrita aqui divergiria da tela na primeira correção.
//
// ⚠ SOMENTE LEITURA — o serviço não escreve (é invariante dele, com teste próprio) e este script
// não tem `--aplicar`. Nenhuma chamada a SERPRO, SEFAZ ou ADN.
//
// Uso:
//   node apps/api/scripts/diag-planejamento-prefill.mjs [--cnpj=...]
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-planejamento-prefill.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { montarDadosPlanejamento } from "../src/application/planejamento/DadosPlanejamentoService.js";

const LIMITE_LUCRO_PRESUMIDO = 78_000_000; // tabelasFiscais.js:186 (Lei 9.718/1998, art. 13)
const TETO_SIMPLES = 4_800_000; // a 6ª faixa termina aqui; acima, `faixaDoRbt12` devolve null

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const soDigitos = (s) => String(s || "").replace(/\D+/g, "");
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const dir = (s, n) => String(s ?? "").slice(0, n).padStart(n);
const brl = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));

/** ⚠ CÓPIA LITERAL de `renderPlanejamentoPage.jsx:42-46`. Não "melhorar" aqui: o ponto é reproduzir. */
const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** O que a tela faz hoje: número → `String(n)` → input → `num()`. */
const comoAtelaLe = (n) => (n == null ? null : num(String(n)));

async function main() {
  const cnpjFiltro = soDigitos(arg("cnpj"));
  const portais = await prisma.portalClient.findMany({
    select: { id: true, razao: true, cnpj: true },
    orderBy: { razao: "asc" },
  });
  const alvos = cnpjFiltro ? portais.filter((p) => soDigitos(p.cnpj) === cnpjFiltro) : portais;

  console.log(`\nEmpresas: ${alvos.length}\n`);
  console.log(`${pad("EMPRESA", 26)} ${dir("RECEITA (real)", 16)} ${dir("→ o motor lê", 16)} ${dir("RBT12 (real)", 15)} ${dir("→ o motor lê", 16)}  EFEITO`);
  console.log("-".repeat(126));

  const placar = { total: 0, comDado: 0, inflada: 0, matouPresumido: 0, matouSimples: 0, issTorto: 0 };

  for (const p of alvos) {
    placar.total += 1;
    const d = await montarDadosPlanejamento({ portalClientId: p.id }).catch(() => null);
    if (!d) { console.log(`${pad(p.razao, 26)} (não foi possível montar)`); continue; }

    const receita = d.campos.receitaAnual?.apurado ? d.campos.receitaAnual.valor : null;
    const rbt12 = d.campos.rbt12?.apurado ? d.campos.rbt12.valor : null;
    const iss = d.campos.aliquotaIss?.apurado ? d.campos.aliquotaIss.valor : null;
    if (receita == null && rbt12 == null && iss == null) continue;
    placar.comDado += 1;

    const receitaLida = comoAtelaLe(receita);
    const rbtLido = comoAtelaLe(rbt12);
    // ⚠ O ISS passa por `String(Math.round(v * 1e6) / 1e4)` (`:134`): 3,5% vira "3.5" e é lido 35.
    const issTela = iss == null ? null : Math.round(iss * 1e6) / 1e4;
    const issLido = comoAtelaLe(issTela);

    const efeitos = [];
    if (receitaLida != null && receita != null && receitaLida !== receita) {
      placar.inflada += 1;
      if (receitaLida > LIMITE_LUCRO_PRESUMIDO && receita <= LIMITE_LUCRO_PRESUMIDO) {
        placar.matouPresumido += 1;
        efeitos.push("⚠⚠ Presumido sai INELEGÍVEL");
      }
    }
    if (rbtLido != null && rbt12 != null && rbtLido !== rbt12 && rbtLido > TETO_SIMPLES && rbt12 <= TETO_SIMPLES) {
      placar.matouSimples += 1;
      efeitos.push('⚠⚠ Simples sai "Sem RBT12"');
    }
    if (issLido != null && issTela != null && issLido !== issTela) {
      placar.issTorto += 1;
      efeitos.push(`⚠ ISS ${issTela}% vira ${issLido}%`);
    }

    console.log(
      `${pad(p.razao, 26)} ${dir(brl(receita), 16)} ${dir(brl(receitaLida), 16)}`
      + ` ${dir(brl(rbt12), 15)} ${dir(brl(rbtLido), 16)}  ${efeitos.join(" · ") || "ok"}`,
    );
  }

  console.log("\n─── PLACAR ───");
  console.log(`  empresas com algum dado apurado ......... ${placar.comDado} de ${placar.total}`);
  console.log(`  ⚠⚠ valor lido ≠ valor real (inflado) .... ${placar.inflada}`);
  console.log(`  ⚠⚠ card do Presumido morto ("inelegível") ${placar.matouPresumido}`);
  console.log(`  ⚠⚠ card do Simples morto ("Sem RBT12") .. ${placar.matouSimples}`);
  console.log(`  ⚠ alíquota de ISS distorcida ............ ${placar.issTorto}`);
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
