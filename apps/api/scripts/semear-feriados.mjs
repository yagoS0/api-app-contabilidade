// Semeia a tabela `Feriado` com os feriados NACIONAIS de data conhecida.
//
//   node scripts/semear-feriados.mjs                    → simula (não grava), ano atual + próximo
//   node scripts/semear-feriados.mjs --aplicar          → grava
//   node scripts/semear-feriados.mjs --de=2026 --ate=2028 --aplicar
//
// CARNAVAL, CORPUS CHRISTI E CONSCIÊNCIA NEGRA — decisão do dono (2026-07-30)
//
// Carnaval (segunda e terça) e Corpus Christi são PONTO FACULTATIVO federal, não feriado. Levantei
// a distinção; o dono decidiu tratá-los como dia não útil, porque na prática banco não opera e o
// escritório não trabalha. Consciência Negra (20/11) entrou junto, por decisão dele.
//
// Efeito combinado: o calendário AVISA que o dia é feriado, e obrigação que cai ali é antecipada
// para o dia útil anterior. O `ajusteDiaUtil` de cada obrigação continua mandando — quem escolheu
// POSTERGAR ou MANTER segue como escolheu.
//
// Continua de fora o feriado MUNICIPAL: varia por cidade e não há como derivar. Cadastro à parte,
// com `abrangencia: "MUNICIPAL"` e o nome do município como está em `PortalClient.municipio`.
//
// Feriado ausente da tabela não quebra nada: o ajuste de dia útil continua tratando fim de semana,
// e a data simplesmente não se move pelo feriado desconhecido.

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

function maisDias(data, dias) {
  const d = new Date(data.getTime());
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

const iso = (d) => d.toISOString().slice(0, 10);

async function main() {
  const linhas = [];
  for (let ano = de; ano <= ate; ano += 1) {
    for (const [mes, dia, nome] of FIXOS) {
      linhas.push({ data: new Date(Date.UTC(ano, mes - 1, dia)), abrangencia: "NACIONAL", municipio: null, nome });
    }
    // Consciência Negra — fixo, mas separado dos demais por ter entrado por decisão do dono.
    linhas.push({ data: new Date(Date.UTC(ano, 10, 20)), abrangencia: "NACIONAL", municipio: null, nome: "Consciência Negra" });

    // Móveis, todos derivados da Páscoa.
    const pascoa = domingoDePascoa(ano);
    for (const [dias, nome] of [
      [48, "Carnaval (segunda)"],
      [47, "Carnaval (terça)"],
      [2, "Sexta-feira Santa"],
    ]) {
      linhas.push({ data: menosDias(pascoa, dias), abrangencia: "NACIONAL", municipio: null, nome });
    }
    linhas.push({ data: maisDias(pascoa, 60), abrangencia: "NACIONAL", municipio: null, nome: "Corpus Christi" });
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

  console.log("\n── Fica de fora ───────────────────────────────────────────────────────────");
  console.log("  • Feriados MUNICIPAIS — variam por cidade e não há como derivar. Cadastre com");
  console.log("    abrangencia MUNICIPAL e o município igual ao de PortalClient.municipio; só as");
  console.log("    empresas daquela cidade são afetadas.");
  console.log("\nCarnaval e Corpus Christi entram como dia não útil por decisão do dono, embora");
  console.log("sejam ponto facultativo federal e não feriado.");
}

main()
  .catch((err) => { console.error("ERRO:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
