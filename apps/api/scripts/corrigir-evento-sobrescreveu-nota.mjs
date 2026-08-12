// Correção das 62 linhas de `PortalInvoice` em que o XML de um EVENTO ocupou o lugar da nota.
//
// ⚠ DRY-RUN POR PADRÃO. Sem `--aplicar` NADA é escrito. Não chama o ADN. Não roda DDL.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ LEIA ISTO ANTES DE RODAR COM `--aplicar`: A MEDIÇÃO MUDOU O DIAGNÓSTICO.
//
// A tarefa nasceu da hipótese "62 notas de KAIZEN e LIFAT foram sobrescritas pelo evento que as
// cancelava, e o XML da nota não é recuperável do nosso dado". Medido em produção (12/08/2026),
// os três pontos dessa frase estão errados:
//
//   1. NÃO SÃO 62 DOCUMENTOS — são **31 chaves de acesso, gravadas duas vezes** (uma sob KAIZEN,
//      uma sob LIFAT). O conjunto de chaves das duas empresas é idêntico.
//
//   2. AS NOTAS NÃO SE PERDERAM. Cada uma das 31 chaves tem, no MESMO banco, uma linha com o XML
//      da nota de verdade (raiz `NFSe`/`infNFSe`), `numero` e `total` preenchidos — sob DIAGONAL
//      FORMAS E ESCORAMENTOS, capturada em 03/08/2026. E **as 31 já estão `CANCELADA/cancelada`**.
//      Ou seja: o estado real das 31 é conhecido SEM UMA ÚNICA CHAMADA AO ADN.
//
//   3. NENHUMA DAS 31 NOTAS É DE KAIZEN OU LIFAT. Conferido contra o metadado da NOTA (não do
//      evento): KAIZEN (60237497000198) e LIFAT (60994583000145) não são prestadoras nem tomadoras
//      de nenhuma delas. As partes reais são 39254243000191, 36503186000149, 29309127012266,
//      41000346000177 e o CPF 12219079724.
//
// Isto NÃO é a classe "evento sobrescreveu a nota". É a classe **`rejeitada_outro_cnpj`** já
// documentada em `apps/api/CLAUDE.md`: o A1 do escritório consultou o ADN e as notas DELE foram
// gravadas debaixo das empresas clientes, entrando como DEST. O cinturão de ingestão de hoje
// **recusaria as 62** (conferido: em todas, o CNPJ da empresa não bate com prestador nem tomador).
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE SCRIPT FAZ (Ação 1) — e o que ele DELIBERADAMENTE NÃO FAZ (Ação 2)
//
// **Ação 1 (implementada, atrás de `--aplicar`):** `status='CANCELADA'`, `statusEfetivo='cancelada'`
// nas 62. É a correção mínima do perigo nomeado: hoje elas estão `EMITIDA/autorizada` e a tela as
// pinta de VERDE. O rótulo é `cancelada` porque é isso que o documento é — o evento é um
// cancelamento, e a nota afetada está cancelada, provado pela linha viva sob DIAGONAL.
// ⚠ NÃO existe um terceiro valor. `substituida` não casa com nenhum dos dois filtros de dinheiro
// (receita = `autorizada`, exclusão = `cancelada`) e faria a linha reaparecer na aba e no total do
// resumo; o commit `e8500568` documenta por quê. As 6 linhas de `e105102` recebem o MESMO rótulo.
//
// **Ação 2 (NÃO implementada — decisão do dono):** remover as 62 linhas e os 62 `NotaItem` órfãos.
// É o que o diagnóstico realmente pede, já que são documentos de outros CNPJs que nunca deveriam
// ter entrado. Não está aqui por dois motivos: apagar nota fiscal é decisão do contador (a mesma
// razão pela qual `diag-notas-de-outro-cnpj.mjs` só lê), e a Ação 1 já tira o verde da tela sem
// destruir nada. Rodar a Ação 1 não atrapalha a Ação 2 depois.
//
// ⚠ `statusEfetivo` é CAMPO DE DINHEIRO. As 62 são todas `papel=DEST`, então **o faturamento não
// muda** (receita filtra EMIT + autorizada). O que muda é a aba de Notas e as contagens.
//
// Uso:
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/corrigir-evento-sobrescreveu-nota.mjs'
//   …e só depois, com o dono ciente, acrescentar `--aplicar`.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const aplicar = process.argv.includes("--aplicar");
const linha = (c = "─") => console.log(c.repeat(104));
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—");
const dig = (s) => String(s || "").replace(/\D+/g, "");

console.log(`\nCORREÇÃO DAS LINHAS EM QUE O XML DE UM EVENTO OCUPOU O LUGAR DA NOTA`);
console.log(aplicar ? "⚠ MODO: --aplicar (VAI ESCREVER NO BANCO)" : "MODO: DRY-RUN (nada será escrito)");
linha("═");

// ── Pré-voo: a população ainda é a mesma que foi medida? ────────────────────────────────────
const alvo = await prisma.$queryRawUnsafe(`
  SELECT p.id, p."clientId", c.razao, c.cnpj AS cnpj_empresa,
         p.papel, p.status, p."statusEfetivo", p.numero, p.total,
         p."chaveAcesso", p."emitenteDoc", p."tomadorDoc", p."createdAt",
         (p."xmlRaw" LIKE '%e105102%') AS eh_substituicao,
         (SELECT count(*)::int FROM "nota_itens" ni WHERE ni."notaId" = p.id) AS n_itens
    FROM "PortalInvoice" p JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE p."xmlRaw" LIKE '%pedRegEvento%'
   ORDER BY c.razao, p."createdAt", p.id`);

console.log(`\nPRÉ-VOO`);
console.log(`  linhas com o marcador \`pedRegEvento\` .......... ${alvo.length}`);
if (alvo.length !== 62) {
  console.log(`\n⚠ ABORTANDO: esperava 62, encontrei ${alvo.length}.`);
  console.log(`  A população mudou desde a medição. Fale com o dono antes de qualquer escrita.`);
  await prisma.$disconnect();
  process.exit(2);
}
const jaCorretas = alvo.filter((r) => r.statusEfetivo === "cancelada" && r.status === "CANCELADA").length;
const aMudar = alvo.filter((r) => !(r.statusEfetivo === "cancelada" && r.status === "CANCELADA"));
console.log(`  já em CANCELADA/cancelada (nada a fazer) ...... ${jaCorretas}`);
console.log(`  a mudar ....................................... ${aMudar.length}`);
console.log(`  papel=EMIT entre elas (afetariam FATURAMENTO) . ${alvo.filter((r) => r.papel === "EMIT").length}`);
console.log(`  NotaItem órfãos pendurados .................... ${alvo.reduce((a, r) => a + r.n_itens, 0)}  (a Ação 1 NÃO os toca)`);

// ── O desfecho de cada chave, tirado do banco (zero chamada ao ADN) ──────────────────────────
const chaves = [...new Set(alvo.map((r) => r.chaveAcesso).filter(Boolean))];
const vivas = await prisma.$queryRawUnsafe(`
  SELECT p."chaveAcesso", c.razao, p.numero, p.total, p.status, p."statusEfetivo"
    FROM "PortalInvoice" p JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE p."chaveAcesso" = ANY($1::text[]) AND p."xmlRaw" NOT LIKE '%pedRegEvento%'`, chaves);
const porChave = new Map(vivas.map((v) => [v.chaveAcesso, v]));

const desfecho = { restauravel: [], cancelada_confirmada: [], desconhecida: [] };
for (const ch of chaves) {
  const v = porChave.get(ch);
  if (!v) desfecho.desconhecida.push(ch);
  else if (v.statusEfetivo === "cancelada") desfecho.cancelada_confirmada.push(ch);
  else desfecho.restauravel.push(ch);
}
console.log(`\nDESFECHO POR CHAVE (${chaves.length} chaves distintas nas 62 linhas)`);
console.log(`  cancelada CONFIRMADA (nota viva no banco, já cancelada) .. ${desfecho.cancelada_confirmada.length}`);
console.log(`  restaurável (nota viva e ainda autorizada) ............... ${desfecho.restauravel.length}`);
console.log(`  DESCONHECIDA (nenhuma nota no banco) .................... ${desfecho.desconhecida.length}`);
if (desfecho.desconhecida.length) {
  console.log(`  ⚠ As desconhecidas saem da apuração até resolver — decisão do dono. Chaves:`);
  for (const ch of desfecho.desconhecida) console.log(`      …${ch.slice(-14)}`);
}

// ── ANTES → DEPOIS, linha a linha ───────────────────────────────────────────────────────────
console.log(`\nANTES → DEPOIS (linha a linha)`);
linha();
for (const r of alvo) {
  const v = porChave.get(r.chaveAcesso);
  const alheia = !(dig(r.cnpj_empresa) === dig(r.emitenteDoc) || dig(r.cnpj_empresa) === dig(r.tomadorDoc));
  const de = `${r.status}/${r.statusEfetivo}`;
  const para = "CANCELADA/cancelada";
  const mudou = de !== para;
  console.log(
    `${String(r.razao).slice(0, 22).padEnd(22)} …${String(r.chaveAcesso || "").slice(-10)}`
    + ` ${r.papel} ${de.padEnd(20)} ${mudou ? "→" : "="} ${para.padEnd(20)}`
    + ` ${r.eh_substituicao ? "e105102" : "e101101"} ${alheia ? "⚠ CNPJ alheio" : ""}`,
  );
  console.log(
    `${" ".repeat(22)}  prova: ${v ? `nota viva sob ${String(v.razao).slice(0, 26)} nº ${v.numero} R$ ${v.total} (${v.status}/${v.statusEfetivo})` : "⚠ NENHUMA nota viva — estado DESCONHECIDO"}`,
  );
}
linha();

console.log(`\nRESUMO DA AÇÃO 1`);
console.log(`  linhas que mudariam ....... ${aMudar.length}`);
console.log(`  campos tocados ............ status, statusEfetivo  (mais nada)`);
console.log(`  efeito no FATURAMENTO ..... nenhum (as ${alvo.length} são papel=DEST)`);
console.log(`  efeito visível ............ saem do verde "autorizada"; entram no filtro de exclusão`);
console.log(`\nAÇÃO 2 (NÃO executada por este script)`);
console.log(`  remover as ${alvo.length} linhas + ${alvo.reduce((a, r) => a + r.n_itens, 0)} NotaItem órfãos, por serem documentos de outro CNPJ.`);
console.log(`  Todas as ${alvo.length} seriam recusadas pelo cinturão de ingestão de hoje (rejeitada_outro_cnpj).`);
console.log(`  Apagar nota fiscal é decisão do dono — este script não a implementa.`);

if (!aplicar) {
  console.log(`\n✋ DRY-RUN: nada foi escrito. Para aplicar a Ação 1, rode de novo com --aplicar.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

// ── Escrita (só com --aplicar) ──────────────────────────────────────────────────────────────
console.log(`\n⚠ APLICANDO a Ação 1 em ${aMudar.length} linhas…`);
const ids = aMudar.map((r) => r.id);
const res = await prisma.portalInvoice.updateMany({
  where: { id: { in: ids } },
  data: { status: "CANCELADA", statusEfetivo: "cancelada" },
});
console.log(`  linhas atualizadas: ${res.count}`);

// Relê e confere — não confiar no contador do updateMany.
const conferencia = await prisma.$queryRawUnsafe(`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE "statusEfetivo" = 'cancelada' AND status = 'CANCELADA')::int AS ok
    FROM "PortalInvoice" WHERE "xmlRaw" LIKE '%pedRegEvento%'`);
console.log(`  conferência (releitura): ${conferencia[0].ok}/${conferencia[0].total} em CANCELADA/cancelada`);
if (conferencia[0].ok !== conferencia[0].total) {
  console.log(`  ⚠ A conferência NÃO fechou. Investigue antes de seguir.`);
  process.exitCode = 1;
}
console.log(`\nFeito. Nenhuma chamada externa foi feita em momento algum.\n`);
await prisma.$disconnect();
