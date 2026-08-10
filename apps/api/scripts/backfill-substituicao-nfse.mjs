// BACKFILL: materializa o vínculo de SUBSTITUIÇÃO que já está gravado no XML das notas.
//
// ⚠ DRY-RUN POR PADRÃO. Sem `--apply` ele não escreve NADA — só mostra o que faria.
// ⚠ NÃO CHAMA O ADN. Nenhuma chamada externa: a fonte é o `xmlRaw` que já está no banco.
//
// POR QUE ELE EXISTE
// A nota substituta declara, dentro da própria DPS, quem ela substitui:
//     <subst><chSubstda>…50 dígitos…</chSubstda><cMotivo>…</cMotivo><xMotivo>…</xMotivo></subst>
// (leiaute oficial ANEXO_I-SEFIN_ADN-DPS_NFSe v1.01)
//
// Esse bloco sempre esteve lá — `parseXmlMetadata` é que não o lia, e não havia coluna para
// guardá-lo. Medido em produção (10/08/2026): **22 notas** com o bloco e ZERO expressão disso em
// coluna. É por isso que este dado é recuperável e o do EVENTO não: o XML da nota nós guardamos
// inteiro; o XML do evento era descartado no ato.
//
// ⚠ O QUE ELE NÃO FAZ, DE PROPÓSITO:
//   · não muda `status` nem `statusEfetivo` de nada — não toca em dinheiro;
//   · não cria evento nenhum (evento é fato do ADN; inventá-lo aqui seria fabricar dado fiscal);
//   · não mexe nas 62 linhas em que o XML de um evento sobrescreveu a nota — aquilo é decisão do
//     dono, não efeito colateral de backfill.
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     node apps/api/scripts/backfill-substituicao-nfse.mjs [--apply]'

import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseXmlMetadata } from "../src/application/nfse/AdnXmlMetadata.js";

const APLICAR = process.argv.includes("--apply");
const num = (v) => Number(v || 0).toLocaleString("pt-BR");

console.log("═".repeat(94));
console.log(`BACKFILL DO VÍNCULO DE SUBSTITUIÇÃO — ${APLICAR ? "⚠ MODO APLICAR (escreve)" : "dry-run (não escreve nada)"}`);
console.log("═".repeat(94));

// ⚠ O SCRIPT PRECISA RODAR **ANTES** DO DEPLOY, e é aí que ele mais serve: é assim que se vê o
// que o backfill faria antes de a coluna existir. Sem esta checagem ele estourava um stack do
// Prisma de 400 linhas dizendo `column p.chaveSubstituida does not exist` — que é a informação
// certa enterrada no lugar errado.
const temColuna = (await prisma.$queryRaw`
  SELECT 1 AS ok FROM information_schema.columns
   WHERE table_name = 'PortalInvoice' AND column_name = 'chaveSubstituida'`).length > 0;

if (!temColuna) {
  console.log("\n⚠ A COLUNA `chaveSubstituida` AINDA NÃO EXISTE NESTE BANCO.");
  console.log("  A migration `20260810160000_add_nfse_ciclo_vida` não foi aplicada aqui.");
  console.log("  O dry-run continua (é justamente o que se quer ver antes do deploy), mas `--apply`");
  console.log("  está BLOQUEADO — e nenhuma comparação com o valor já gravado é possível.\n");
}

// Só quem tem o bloco. O LIKE evita ler 16 mil XMLs para achar 22.
const candidatas = temColuna
  ? await prisma.$queryRaw`
      SELECT p.id, p."clientId", p.numero, p."chaveAcesso", p."chaveSubstituida", p."xmlRaw", c.razao
        FROM "PortalInvoice" p
        JOIN "PortalClient" c ON c.id = p."clientId"
       WHERE p.type = 'NFSE' AND p."xmlRaw" LIKE '%<subst>%'
       ORDER BY c.razao, p."issueDate"`
  : (await prisma.$queryRaw`
      SELECT p.id, p."clientId", p.numero, p."chaveAcesso", NULL::text AS "chaveSubstituida", p."xmlRaw", c.razao
        FROM "PortalInvoice" p
        JOIN "PortalClient" c ON c.id = p."clientId"
       WHERE p.type = 'NFSE' AND p."xmlRaw" LIKE '%<subst>%'
       ORDER BY c.razao, p."issueDate"`);

console.log(`\nNotas com bloco <subst> no XML: ${num(candidatas.length)}\n`);

let jaOk = 0; let aEscrever = 0; let semChave = 0; let divergentes = 0;
const paraEscrever = [];

for (const n of candidatas) {
  // ⚠ A EXTRAÇÃO É A MESMA DA CAPTURA — importada, não reescrita. Um parser próprio aqui
  // divergiria do que a captura grava daqui para frente, e o backfill passaria a produzir um
  // vínculo diferente do vínculo novo, na mesma coluna.
  const meta = parseXmlMetadata(n.xmlRaw);
  const chave = meta.chaveSubstituida || null;

  if (!chave) {
    semChave++;
    console.log(`   ⚠ ${String(n.razao).slice(0, 40).padEnd(40)} nº ${String(n.numero).padEnd(8)} tem <subst> e NENHUMA chave legível — não escrevo por suposição.`);
    continue;
  }
  if (n.chaveSubstituida === chave) { jaOk++; continue; }
  if (n.chaveSubstituida && n.chaveSubstituida !== chave) {
    // Não sobrescreve divergência em silêncio: alguém (ou algo) já escreveu outra coisa ali.
    divergentes++;
    console.log(`   ⚠ ${String(n.razao).slice(0, 40).padEnd(40)} nº ${String(n.numero).padEnd(8)} JÁ TEM outra chave gravada — PULO. banco=…${n.chaveSubstituida.slice(-6)} xml=…${chave.slice(-6)}`);
    continue;
  }

  aEscrever++;
  paraEscrever.push({ id: n.id, clientId: n.clientId, chave, motivo: meta.motivoSubstituicao || null });
  console.log(`   ${String(n.razao).slice(0, 40).padEnd(40)} nº ${String(n.numero).padEnd(8)} → substitui …${chave.slice(-6)}  "${String(meta.motivoSubstituicao || "").slice(0, 44)}"`);
}

console.log("\n" + "─".repeat(94));
console.log(`   já corretas: ${num(jaOk)} · a gravar: ${num(aEscrever)} · sem chave legível: ${num(semChave)} · divergentes (puladas): ${num(divergentes)}`);

// A OUTRA PONTA: a substituída está na base DESTA EMPRESA? "Aponta para fora" é resposta legítima.
// ⚠ A busca é por `clientId`, não global — é assim que a rota resolve o vínculo
// (`derivarCiclo`/`montarIndiceDeCiclo` filtram por empresa, porque multi-tenancy é inegociável).
// Procurar a chave na base inteira dava ZERO "fora da base" e escondia os casos reais: a nota
// substituída existe, mas debaixo de OUTRA empresa — que é a contaminação de certificado já
// conhecida, não um vínculo resolvido.
let foraDaBase = 0;
let mutilada = 0;
for (const p of paraEscrever) {
  const alvo = await prisma.portalInvoice.findFirst({
    where: { clientId: p.clientId, chaveAcesso: p.chave },
    select: { id: true, numero: true, statusEfetivo: true },
  });
  if (!alvo) { foraDaBase++; continue; }
  // ⚠ EXISTIR NÃO É ESTAR INTEIRA. A substituída pode ser uma das 62 linhas em que o XML de um
  // EVENTO sobrescreveu a NOTA: sobra a chave, some o número e o valor, e ela fica "autorizada".
  // Contar essas como "vínculo resolvido" é o que mascarava o estrago — foi assim que uma medição
  // anterior reportou "4 substituídas fora da base" quando elas estavam na base, mutiladas.
  if (alvo.numero == null || alvo.statusEfetivo === "autorizada") mutilada++;
}
console.log(`   dessas, apontam para nota que NÃO está na base DA MESMA EMPRESA: ${num(foraDaBase)}`);
console.log(`   ⚠ dessas, a substituída EXISTE mas está sem número ou marcada "autorizada": ${num(mutilada)}`);
console.log("      (linhas sobrescritas pelo próprio evento de cancelamento — decisão do dono, o");
console.log("       backfill NÃO as toca; o vínculo gravado é justamente o que as torna visíveis)");

if (!APLICAR || !temColuna) {
  console.log(!temColuna
    ? "\nNada foi alterado — a coluna não existe neste banco. Aplique a migration e rode de novo."
    : "\nDRY-RUN — nada foi alterado. Rode com `--apply` para gravar.");
  await prisma.$disconnect();
  process.exit(0);
}

let gravadas = 0;
for (const p of paraEscrever) {
  await prisma.portalInvoice.update({
    where: { id: p.id },
    data: { chaveSubstituida: p.chave, motivoSubstituicao: p.motivo },
  });
  gravadas++;
}
console.log(`\n✓ ${num(gravadas)} nota(s) atualizada(s). Nenhum status foi tocado.`);
await prisma.$disconnect();
