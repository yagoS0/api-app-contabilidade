// AS NOTAS RECEBIDAS VIRAM DESPESA? -- o ENSAIO da varredura da Fase B1.
//
// SOMENTE LEITURA. Nao existe --aplicar: este script nao cria declarado nenhum, nao escreve e nao
// chama servico externo. Ele responde, contra a base real, o que a varredura FARIA.
//
// ⚠ Usa a MESMA regra pura da varredura (`lib/notaViraDeclarado.js`) e o MESMO ciclo da tela
// (`notas/cicloNota.js`). Uma segunda leitura divergiria na primeira correcao, e aqui a divergencia
// apareceria como "o ensaio disse 12 e a varredura criou 400".
//
// Uso:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-notas-viram-despesa.mjs'
//   ... node apps/api/scripts/diag-notas-viram-despesa.mjs --desde 2026-07-01
//   ... node apps/api/scripts/diag-notas-viram-despesa.mjs --empresa <cnpj|razao>

import { PrismaClient } from "@prisma/client";
import { derivarCiclo, montarIndiceDeCiclo } from "../src/application/notas/cicloNota.js";
import { separarNotas } from "../src/application/declarados/lib/notaViraDeclarado.js";

const prisma = new PrismaClient();
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const so = (v) => String(v || "").replace(/\D+/g, "");
const linha = (c = "=") => console.log(c.repeat(96));
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

const desdeArg = arg("desde");
const dataPiso = desdeArg ? new Date(`${desdeArg}T00:00:00.000Z`) : null;
if (desdeArg && Number.isNaN(dataPiso?.getTime())) {
  console.error("--desde precisa ser AAAA-MM-DD");
  process.exit(1);
}
const filtroEmpresa = arg("empresa");

const clientes = await prisma.portalClient.findMany({ select: { id: true, cnpj: true, razao: true } });
const alvo = filtroEmpresa
  ? clientes.filter(
      (c) =>
        so(c.cnpj) === so(filtroEmpresa) ||
        String(c.razao || "").toUpperCase().includes(String(filtroEmpresa).toUpperCase()),
    )
  : clientes;

linha();
console.log(`AS NOTAS RECEBIDAS VIRAM DESPESA? -- ENSAIO -- ${alvo.length} empresa(s)`);
console.log(dataPiso ? `Data-piso: ${desdeArg} (notas anteriores ficam FORA)` : "⚠ SEM data-piso: a varredura pegaria TUDO");
console.log("SOMENTE LEITURA. Nenhum declarado e criado por este script.");
linha();

const totalGeral = { viram: 0, fora: new Map(), valor: 0, semCompetencia: 0, semCnpj: 0, semDetalhe: 0 };
const fornecedoresGerais = new Set();

for (const cli of alvo) {
  const notas = await prisma.portalInvoice.findMany({
    where: { clientId: cli.id, papel: "DEST" },
    select: {
      id: true, type: true, papel: true, total: true, issueDate: true, competencia: true,
      emitenteNome: true, emitenteDoc: true, xDescServ: true,
      statusEfetivo: true, chaveAcesso: true, chaveSubstituida: true, motivoSubstituicao: true,
    },
    orderBy: { issueDate: "asc" },
  });
  if (!notas.length) continue;

  // ⚠ O CICLO E A AUTORIDADE sobre cancelada/substituida -- nunca `statusEfetivo` lido cru.
  const eventos = await prisma.portalInvoiceEvent.findMany({
    where: { invoiceId: { in: notas.map((n) => n.id) } },
  });
  // ⚠⚠ `montarIndiceDeCiclo` devolve um ARRAY de {...nota, ciclo}, apesar do nome. Trata-lo como
  // Map devolve undefined SEM ERRO e o codigo cai num fallback que perde o contexto de
  // substituicao -- a nota substituida sairia rotulada "cancelada".
  const cicloPorNota = new Map(
    montarIndiceDeCiclo({ notas, eventos, relacionadas: notas }).map((n) => [n.id, n.ciclo]),
  );

  const { viram, fora } = separarNotas(notas, (n) => ({
    situacao: (cicloPorNota.get(n.id) || derivarCiclo({ nota: n }))?.situacao,
    dataPiso,
  }));

  const valor = viram.reduce((s, v) => s + Number(v.dados.valor || 0), 0);
  const semComp = viram.filter((v) => !v.dados.competencia).length;
  const semCnpj = viram.filter((v) => !v.dados.cnpjFornecedor).length;
  const semDet = viram.filter((v) => !v.dados.detalheServico).length;
  const fornecedores = new Set(viram.map((v) => v.dados.cnpjFornecedor || v.dados.descricaoOriginal));

  totalGeral.viram += viram.length;
  totalGeral.valor += valor;
  totalGeral.semCompetencia += semComp;
  totalGeral.semCnpj += semCnpj;
  totalGeral.semDetalhe += semDet;
  for (const f of fornecedores) fornecedoresGerais.add(`${cli.id}|${f}`);
  for (const g of fora) totalGeral.fora.set(g.motivo, (totalGeral.fora.get(g.motivo) || 0) + g.n);

  console.log(`\n## ${cli.razao || cli.id}  --  ${notas.length} nota(s) recebida(s)`);
  console.log(`   viram despesa: ${viram.length}   R$ ${brl(valor)}   ${fornecedores.size} fornecedor(es)`);
  if (semComp) console.log(`   ⚠ SEM competencia: ${semComp}  (nao serao atribuidas a mes nenhum, e nao viram lancamento)`);
  if (semCnpj) console.log(`   ⚠ sem CNPJ do fornecedor: ${semCnpj}  (a ancora forte do aprendizado nao nasce nelas)`);
  if (semDet) console.log(`   sem descricao de servico: ${semDet}  (esperado nas NF-e, que sao resumo)`);
  for (const g of fora) console.log(`   fora -- ${String(g.motivo).padEnd(22)} ${String(g.n).padStart(5)}  ${g.frase}`);

  if (viram.length) {
    console.log("\n   as 5 primeiras que virariam fila:");
    for (const v of viram.slice(0, 5)) {
      const d = v.dados;
      console.log(
        `     ${String(d.dataDocumento.toISOString().slice(0, 10))}  ${String(d.competencia || "sem comp").padEnd(8)}` +
          ` R$ ${brl(d.valor).padStart(12)}  ${String(d.descricaoOriginal).slice(0, 42)}`,
      );
    }
  }
}

linha();
console.log("## PLACAR GERAL\n");
console.log(`   virariam declarado: ${totalGeral.viram}   R$ ${brl(totalGeral.valor)}`);
console.log(`   fornecedores distintos (por empresa): ${fornecedoresGerais.size}`);
console.log(`   ⚠ sem competencia: ${totalGeral.semCompetencia}  -- ficam na fila e NAO viram lancamento`);
console.log(`   ⚠ sem CNPJ:        ${totalGeral.semCnpj}  -- so a ancora por descricao serve nelas`);
console.log(`   sem xDescServ:     ${totalGeral.semDetalhe}`);
console.log("\n   ficaram de fora:");
if (!totalGeral.fora.size) console.log("     nenhuma");
for (const [motivo, n] of [...totalGeral.fora.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`     ${String(motivo).padEnd(24)} ${String(n).padStart(6)}`);
}

if (!dataPiso) {
  console.log("\n   ⚠⚠ SEM DATA-PISO. Uma fila com este tamanho nao e fila, e muro.");
  console.log("      Rode de novo com --desde AAAA-MM-DD para ver o tamanho real da primeira carga.");
}
linha();

await prisma.$disconnect();
