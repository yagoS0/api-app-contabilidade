// DIAGNÓSTICO — QUANTOS REGISTROS DA MEMÓRIA DE HISTÓRICOS SÃO ALCANÇÁVEIS PELO MATCH.
//
// SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
// A memória (`accounting_historicos`) GRAVA o texto passando por `normalizarHistorico` — a
// competência vira `{{competencia}}`. A leitura (`findHistoricoMatches`) comparava com
// `normalizeMatchText` cru, que só troca pontuação por espaço. As duas chaves divergiam em todo
// registro que carrega competência, e nenhum dos dois passos (exato e substring) casava.
//
// O que este script mede: para cada registro, monta a descrição que o ARQUIVO traria
// (`aplicarCompetencia(text, <competência>)` — literalmente "PAGO INSS - 08/2026") e pergunta se o
// match a encontraria, pela chave ANTIGA e pela chave NOVA, com exatamente as mesmas duas passadas
// do serviço.
//
//   railway run --service Postgres pwsh -NoProfile -Command \
//     '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-match-historicos.mjs'
//
// Argumento opcional: a competência a resolver (default: o mês corrente).

import { PrismaClient } from "@prisma/client";
import { normalizarHistorico, aplicarCompetencia } from "../src/application/accounting/historicoCompetencia.js";
import { normalizeMatchText, chaveDeMatch } from "../src/application/accounting/excelImport.js";

const prisma = new PrismaClient();

const hoje = new Date();
const COMPETENCIA =
  process.argv[2] || `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;

// As DUAS passadas do `findHistoricoMatches`, sem mudar nada — só parametrizadas pela chave.
function procurar(descricao, candidatos, chave) {
  const norm = candidatos.map((h) => ({ h, k: chave(h.text) }));
  const alvo = chave(descricao);
  if (!alvo) return null;
  for (const { h, k } of norm) if (k && k === alvo) return { h, tipo: "exact" };
  let best = null;
  for (const { h, k } of norm) {
    if (!k) continue;
    if (alvo.includes(k) || k.includes(alvo)) {
      if (!best || (h.usageCount || 0) > (best.h.usageCount || 0)) best = { h, tipo: "substring" };
    }
  }
  return best;
}

async function main() {
  const todos = await prisma.accountingHistorico.findMany({
    select: {
      id: true, text: true, createdByUserId: true, companyPortalClientId: true,
      usageCount: true, historicoSugerido: true,
    },
  });

  const comDigito = todos.filter((h) => /\d/.test(h.text));
  const tokenizados = todos.filter((h) => h.text.includes("{{competencia}}"));
  const semSugestao = todos.filter((h) => !h.historicoSugerido);
  const jaComPago = todos.filter((h) => /^pago\b/i.test(h.text.trim()));

  console.log(`Competência resolvida na simulação: ${COMPETENCIA}`);
  console.log(`Registros na memória ............. ${todos.length}`);
  console.log(`  com dígito no texto ............ ${comDigito.length}`);
  console.log(`  com {{competencia}} ............ ${tokenizados.length}`);
  console.log(`  sem historicoSugerido .......... ${semSugestao.length}`);
  console.log(`  já começando com "PAGO" ........ ${jaComPago.length}`);
  console.log("");

  let antesOk = 0, depoisOk = 0, ganhos = 0, perdas = 0;
  const exemplos = [];

  for (const h of todos) {
    // O universo que o serviço carregaria para este usuário/empresa.
    const candidatos = todos.filter(
      (c) =>
        c.createdByUserId === h.createdByUserId &&
        (c.companyPortalClientId === h.companyPortalClientId || c.companyPortalClientId === null),
    );
    // A descrição como ela viria no ARQUIVO: com a competência escrita por extenso.
    const descricaoDoArquivo = aplicarCompetencia(h.text, COMPETENCIA);

    const antes = procurar(descricaoDoArquivo, candidatos, normalizeMatchText);
    const depois = procurar(descricaoDoArquivo, candidatos, chaveDeMatch);

    if (antes) antesOk++;
    if (depois) depoisOk++;
    if (!antes && depois) {
      ganhos++;
      if (exemplos.length < 12) {
        exemplos.push(`  + "${descricaoDoArquivo}"  →  ${depois.tipo}  ("${depois.h.text}")`);
      }
    }
    if (antes && !depois) {
      perdas++;
      console.log(`  ⚠ PERDA: "${descricaoDoArquivo}" casava e deixou de casar`);
    }
  }

  console.log(`Achavam alguma memória ANTES ..... ${antesOk} de ${todos.length}`);
  console.log(`Acham alguma memória DEPOIS ...... ${depoisOk} de ${todos.length}`);
  console.log(`Ganho líquido .................... +${ganhos}`);
  console.log(`Regressões (casava e parou) ...... ${perdas}`);
  if (exemplos.length) {
    console.log("\nExemplos do que passou a casar:");
    console.log(exemplos.join("\n"));
  }

  // Sanidade: a chave de gravação e a de leitura precisam coincidir em TODO registro.
  const divergentes = todos.filter((h) => chaveDeMatch(h.text) !== chaveDeMatch(normalizarHistorico(h.text)));
  console.log(`\nRegistros com chave instável (deve ser 0): ${divergentes.length}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
