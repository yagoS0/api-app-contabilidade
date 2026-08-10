// EXPORTAÇÃO DE SERVIÇO — o que foi DECLARADO contra o que o sistema consegue enxergar.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum DDL.
//
// POR QUE ELE EXISTE
// O dono afirmou: "a CDA presta serviço para o exterior". A memória da apuração dela guarda uma
// atividade de mercado EXTERNO — ou seja, a memória está CERTA. As notas dizem o contrário:
// `flagExportacao` é `false` em 16.153 de 16.153 itens.
//
// ⚠ E A CAUSA É ESTRUTURAL, não um caso mal cadastrado. `flagExportacao` tem UM ÚNICO escritor em
// todo o backend: `notas/dfe/DfeParser.js:213`, que o deriva do CFOP começando com 7 — isto é,
// **NF-e da SEFAZ**. A criação do item da NFS-e (`notas/adn/AdnNotasService.js:229-235`) grava
// apenas `codigoServico`, `descricao` e `valor`. Não há caminho pelo qual uma NFS-e chegue marcada
// como exportação, e serviço prestado ao exterior é NFS-e por definição.
//
// O MESMO VALE PARA `tipoReceita` (nulo em 16.153/16.153): é por isso que `montarAtividadesDefault`
// devolve `[]` sempre e o modal de apuração depende inteiramente de memória e CNAE.
//
// O QUE ESTE SCRIPT RESPONDE, e que a leitura de código não responde:
//   1. o que foi DECLARADO à Receita — interno ou externo — nas competências já transmitidas;
//   2. quantas empresas têm memória com mercado EXTERNO (candidatas ao mesmo caso da CDA);
//   3. o tamanho do que está classificado como interno e talvez não seja.
//
// ⚠ ELE NÃO DIZ QUAL É O TRATAMENTO TRIBUTÁRIO CORRETO. A segregação da receita de exportação no
// PGDAS-D tem efeito próprio e isso é decisão do contador, com a norma na mão — não deste script.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-exportacao-servico.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const money = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const linha = () => console.log("─".repeat(94));

console.log("═".repeat(94));
console.log("EXPORTAÇÃO DE SERVIÇO — declarado × enxergado");
console.log("═".repeat(94));

// ─── 1. O escritor que não existe ────────────────────────────────────────────────────────────
console.log("\n1) O QUE AS NOTAS CARREGAM\n");
const itens = await prisma.$queryRaw`
  SELECT count(*)::int                                              AS total,
         count(*) FILTER (WHERE "flagExportacao" IS TRUE)::int      AS exportacao,
         count(*) FILTER (WHERE "tipoReceita" IS NOT NULL)::int     AS com_tipo
    FROM "nota_itens"`;
const it = itens?.[0] || {};
console.log(`   itens de nota: ${it.total}`);
console.log(`   com flagExportacao = true: ${it.exportacao}`);
console.log(`   com tipoReceita preenchido: ${it.com_tipo}`);
console.log(`   ⚠ o único escritor de flagExportacao é o parser de NF-e (CFOP 7xxx).`);
console.log(`     A NFS-e nunca passa por ele — serviço ao exterior é invisível por construção.`);

// ─── 2. Quem a MEMÓRIA diz que exporta ───────────────────────────────────────────────────────
linha();
console.log("\n2) O QUE A MEMÓRIA DA APURAÇÃO LEMBRA (a fonte que discorda das notas)\n");
const memorias = await prisma.$queryRaw`
  SELECT c.razao, c.cnpj, m."atividadesEscolhidas"
    FROM "apuracao_config_memory" m
    JOIN "PortalClient" c ON c.id = m."portalClientId"
   ORDER BY c.razao`;
for (const m of memorias) {
  const atvs = Array.isArray(m.atividadesEscolhidas) ? m.atividadesEscolhidas : [];
  const externas = atvs.filter((a) => String(a?.mercado || "").toUpperCase() === "EXTERNO");
  const marca = externas.length ? "  ⚠ MERCADO EXTERNO" : "";
  console.log(`   ${m.razao} (${m.cnpj})${marca}`);
  for (const a of atvs) {
    console.log(`      idAtividade=${a?.idAtividade} · anexo ${a?.anexoImplicito || "—"} · mercado ${a?.mercado || "—"}`
      + ` · interno ${money(a?.valorInterno)} · externo ${money(a?.valorExterno)}`);
  }
}

// ─── 3. O QUE FOI DECLARADO — a pergunta que importa ─────────────────────────────────────────
linha();
console.log("\n3) ⚠ O QUE FOI TRANSMITIDO À RECEITA (só os snapshots já entregues)\n");
const snaps = await prisma.$queryRaw`
  SELECT c.razao, c.cnpj, s.competencia, s.estado, s."atividadesEscolhidas",
         s."numeroDeclaracao", s."transmitidoEm"
    FROM "apuracao_snapshots" s
    JOIN "PortalClient" c ON c.id = s."portalClientId"
   WHERE s.estado = 'transmitida'
   ORDER BY c.razao, s.competencia`;
let externasDeclaradas = 0;
for (const s of snaps) {
  const atvs = Array.isArray(s.atividadesEscolhidas) ? s.atividadesEscolhidas : [];
  const ext = atvs.reduce((t, a) => t + Number(a?.valorExterno || 0), 0);
  const int = atvs.reduce((t, a) => t + Number(a?.valorInterno || 0), 0);
  if (ext > 0) externasDeclaradas += 1;
  const marca = ext > 0 ? "  ← declarou EXTERNO" : "";
  console.log(`   ${s.razao} · ${s.competencia} · decl ${s.numeroDeclaracao || "—"}`);
  console.log(`      interno ${money(int)} · externo ${money(ext)}${marca}`);
}
console.log(`\n   declarações com receita EXTERNA > 0: ${externasDeclaradas} de ${snaps.length}`);
if (externasDeclaradas === 0) {
  console.log(`   ⚠ NENHUMA. Toda receita transmitida foi como MERCADO INTERNO.`);
  console.log(`     Se alguma dessas empresas presta serviço ao exterior, a segregação não foi feita`);
  console.log(`     — e isso é matéria do contador, com a norma, não deste script.`);
}

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
