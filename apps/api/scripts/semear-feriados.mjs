// Semeia a tabela `Feriado` com os feriados NACIONAIS de data conhecida.
//
//   node scripts/semear-feriados.mjs                    → simula (não grava), ano atual + próximo
//   node scripts/semear-feriados.mjs --aplicar          → grava
//   node scripts/semear-feriados.mjs --de=2026 --ate=2028 --aplicar
//
// ⚠ O QUE ESTE SCRIPT NÃO INSERE, E POR QUÊ
//
// Feriado é fato jurídico, e o projeto não chuta fato jurídico (regra 1). Três casos ficam de
// fora, listados no fim da execução para o dono decidir:
//
//   • Carnaval (segunda e terça) e Corpus Christi — são PONTO FACULTATIVO federal, não feriado,
//     ainda que banco não opere. Inseri-los antecipa vencimento por conta própria; deixá-los de
//     fora, no máximo, não antecipa. A falha segura é não inserir.
//   • Consciência Negra (20/11) — passou a feriado nacional por lei recente. Como é fato jurídico
//     externo, entra só com a confirmação do dono.
//   • Feriado MUNICIPAL — varia por cidade e não há como derivar. Cadastro à parte.
//
// Feriado ausente da tabela não quebra nada: o ajuste de dia útil continua tratando fim de semana,
// que é a maioria dos casos, e a data simplesmente não se move pelo feriado desconhecido.

import { prisma } from "../src/infrastructure/db/prisma.js";

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const valor = (nome, padrao) => {
  const a = args.find((x) => x.startsWith(`--${nome}=`));
  return a ? Number(a.split("=")[1]) : padrao;
};

const anoAtual = new Date().getUTCFullYear();
const de = valor("de", anoAtual);
const ate = valor("ate", anoAtual + 1);

/** Fixos: mesma data todo ano. */
const FIXOS = [
  [1, 1, "Confraternização Universal"],
  [4, 21, "Tiradentes"],
  [5, 1, "Dia do Trabalho"],
  [9, 7, "Independência do Brasil"],
  [10, 12, "Nossa Senhora Aparecida"],
  [11, 2, "Finados"],
  [11, 15, "Proclamação da República"],
  [12, 25, "Natal"],
];

/**
 * Domingo de Páscoa (algoritmo gregoriano anônimo, Meeus/Jones/Butcher).
 * Isto é aritmética de calendário, não interpretação jurídica — por isso pode ser calculado.
 */
function domingoDePascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function menosDias(data, dias) {
  const d = new Date(data.getTime());
  d.setUTCDate(d.getUTCDate() - dias);
  return d;
}

const iso = (d) => d.toISOString().slice(0, 10);

async function main() {
  const linhas = [];
  for (let ano = de; ano <= ate; ano += 1) {
    for (const [mes, dia, nome] of FIXOS) {
      linhas.push({ data: new Date(Date.UTC(ano, mes - 1, dia)), abrangencia: "NACIONAL", municipio: null, nome });
    }
    // Sexta-feira Santa: dois dias antes da Páscoa. É feriado nacional, diferente de Carnaval e
    // Corpus Christi, que são ponto facultativo.
    linhas.push({
      data: menosDias(domingoDePascoa(ano), 2),
      abrangencia: "NACIONAL",
      municipio: null,
      nome: "Sexta-feira Santa",
    });
  }
  linhas.sort((a, b) => a.data - b.data);

  console.log(`Feriados nacionais de ${de} a ${ate}: ${linhas.length} datas\n`);
  for (const l of linhas) console.log(`  ${iso(l.data)}  ${l.nome}`);

  if (!aplicar) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
  } else {
    const r = await prisma.feriado.createMany({ data: linhas, skipDuplicates: true });
    console.log(`\n${r.count} inserido(s); os repetidos foram ignorados (unique data+abrangência+município).`);
  }

  console.log("\n── NÃO inseridos, precisam da sua decisão ──────────────────────────────────");
  console.log("  • Carnaval (segunda e terça) e Corpus Christi — ponto facultativo federal, não");
  console.log("    feriado. Banco não opera, mas inserir por conta própria anteciparia vencimento.");
  console.log("  • Consciência Negra (20/11) — virou feriado nacional por lei recente; como é fato");
  console.log("    jurídico externo, só entra com a sua confirmação.");
  console.log("  • Feriados MUNICIPAIS — variam por cidade; não há como derivar.");
  console.log("\nEnquanto não entrarem, o ajuste de dia útil segue tratando fim de semana (a maioria");
  console.log("dos casos) e não move a data pelo feriado que ele não conhece.");
}

main()
  .catch((err) => { console.error("ERRO:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
