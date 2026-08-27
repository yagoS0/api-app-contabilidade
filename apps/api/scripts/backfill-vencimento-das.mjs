// O VENCIMENTO DO DAS QUE ESTÁ GRAVADO NO `rawPayload` E NUNCA CHEGOU À COLUNA.
//
// ⚠⚠ ENSAIO POR PADRÃO. Só grava com `--aplicar`.
//
// ─── POR QUE ESTE SCRIPT EXISTE ──────────────────────────────────────────────────────────────
//
// `parsePossibleDate` não conhecia o formato compacto `AAAAMMDD` — que é exatamente como o SERPRO
// manda `dados[].detalhamentoDas.dataVencimento` ("20260622"). `new Date("20260622")` é **Invalid
// Date**, o guarda de `NaN` devolvia `null`, e o vencimento sumia **sem erro nenhum**.
//
// Medido em 21/08/2026: `Guide.vencimento` NULO em **51 de 67** guias de SIMPLES processadas, com a
// data presente em **51 de 51** dos payloads guardados. O parser **já foi consertado** (o ramo
// compacto está em `CaptureSerproGuidesService.js`), então guias capturadas daqui para frente
// nascem certas — mas **as 51 históricas continuam nulas**, e nada as conserta sozinho.
//
// ⚠⚠ E A CONSEQUÊNCIA É SILENCIOSA, EM DOIS LUGARES:
//   · `CalendarioFiscalService` filtra por `vencimento` ⇒ essas guias **não aparecem no calendário
//     fiscal**. Guia que não aparece é guia que não é paga.
//   · `GET /client/companies/:id/fluxo` filtra por `vencimento: { not: null }` ⇒ elas **somem do
//     fluxo de caixa do cliente**. É o item mais caro do mês de quem é do Simples.
//
// ─── O QUE ELE FAZ, E O QUE NÃO FAZ ──────────────────────────────────────────────────────────
//
// ⚠ **ZERO CHAMADA AO SERPRO.** A data já está no disco, em `Guide.extracted.rawPayload`. Este
//   script lê o que foi guardado e preenche a coluna — nada sai para a rede.
//
// ⚠ **SÓ PREENCHE NULO. NUNCA SOBRESCREVE.** O `where` exige `vencimento: null` e o `updateMany`
//   repete a condição, então uma data posta à mão por alguém não é tocada nem numa corrida.
//
// ⚠⚠ **AVISE O DONO ANTES DE `--aplicar`.** No instante em que isto gravar, **51 guias de DAS
//   aparecem no calendário fiscal** — uma tela que ninguém pediu para mudar muda sozinha. É a
//   mudança certa, mas ela tem de ser anunciada, não descoberta.
//
// ─── ⚠⚠ SÃO TRÊS LEITURAS DE "ONDE A DATA MORA", E ESTE SCRIPT É A TERCEIRA ───────────────────
//
// Um cabeçalho anterior afirmava que o script REUSA a leitura de produção e que duplicar daria
// "uma TERCEIRA leitura". **Isso era falso, e a distinção importa:**
//
//   · o **PARSER** (o texto "20260622" → `Date`) é REUSADO de verdade: `parsePossibleDate`,
//     importada de `CaptureSerproGuidesService.js`. Uma segunda cópia dele divergiria na primeira
//     correção, e é por isso que ele não foi reescrito;
//   · o **CAMINHO** (em que campo do payload a data está) **NÃO é reusado**. Quem responde isso em
//     produção é `extractDateValue` (`CaptureSerproGuidesService.js:99`), uma varredura PROFUNDA
//     que pega o **primeiro** campo string cuja chave case `/venc/i`, no payload inteiro. Este
//     script usa o caminho **específico** `detalhamentoDas.dataVencimento`.
//
// ⚠ O caminho específico é deliberadamente MAIS ESTREITO que o de produção, e há precedente forte
//   a favor dele no arquivo ao lado: `extractDocumentNumber` foi trocada de varredura frouxa para
//   nome exato dentro de `dados` **porque a frouxa pegava o CNPJ do escritório** e gravou um número
//   inexistente em todas as guias de DAS.
// ⚠⚠ MAS A DIVERGÊNCIA É REAL E FICA NOMEADA: se `extractDateValue` escolher outra chave `/venc/`
//   do mesmo payload, uma RECAPTURA futura da mesma guia grava data diferente da que este backfill
//   gravou, **e nada acusa**. Unificar as duas é trabalho à parte, e é do dono.
//
// ─── ⚠ O QUE ESTE RECORTE NÃO ALCANÇA (o `total` NÃO é o universo de DAS sem vencimento) ──────
//
//   · **DAS tipado como `DARF`.** O classificador antigo do `pdf-reader` tipava como DARF todo DAS
//     com tabela de composição (PGDAS-D, PGMEI, DAS de PARCSN). Essas guias ficam fora do `where`
//     e **fora até do total**. São uploads, sem `rawPayload`, então não são recuperáveis por aqui —
//     mas também não são visíveis, e o relatório não pode se passar pelo universo inteiro.
//   · **A parcela de parcelamento** grava `tipo: "SIMPLES"` e não guarda `rawPayload`. Ela ENTRA no
//     total e sai em "sem a data no payload" — é verdade, mas ela é outra espécie (parcela, não o
//     DAS do mês). Por isso o relatório a conta separado.
//
// ─── COMO CONFERIR ───────────────────────────────────────────────────────────────────────────
//
//   node apps/api/scripts/backfill-vencimento-das.mjs              # ensaio: diz o que gravaria
//   node apps/api/scripts/backfill-vencimento-das.mjs --aplicar    # grava
//   node apps/api/scripts/backfill-vencimento-das.mjs              # ⚠ tem de dizer "a gravar: 0"
//   node apps/api/scripts/diag-vencimento-das-recuperavel.mjs      # a conferência independente
//
// ⚠ O ensaio tem de ser comparado com o diagnóstico ANTES do `--aplicar`. `parsePossibleDate`
//   aceita formatos que a leitura do diagnóstico recusa, então `a gravar` pode ser MAIOR que os 51
//   medidos. Excedente se investiga, não se grava.

// ⚠ O singleton (`db/prisma.js`), como fazem 112 dos scripts desta pasta — não um `new PrismaClient`
// próprio. Os 29 que instanciam o seu são anteriores à convenção.
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parsePossibleDate } from "../src/application/fiscal/serpro/CaptureSerproGuidesService.js";

const aplicar = process.argv.includes("--aplicar");
const LOTE = 500;

/**
 * Achata um objeto em pares `caminho → valor`, entrando em JSON serializado como texto.
 *
 * ⚠ É a MESMA função do `diag-vencimento-das-recuperavel.mjs`, copiada de propósito: são dois
 * SCRIPTS (não código de produção), e um `lib/` compartilhado entre scripts de diagnóstico seria
 * abstração para dois chamadores. A cópia está declarada aqui para quem mexer num saber do outro.
 */
function achatar(obj, prefixo = "", saida = []) {
  if (obj == null) return saida;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { return achatar(JSON.parse(t), prefixo, saida); } catch { /* é texto mesmo */ }
    }
    saida.push([prefixo, obj]);
    return saida;
  }
  if (typeof obj !== "object") { saida.push([prefixo, obj]); return saida; }
  for (const [k, v] of Object.entries(obj)) achatar(v, prefixo ? `${prefixo}.${k}` : k, saida);
  return saida;
}

/** A data do payload, ou `null` com o motivo. ⚠ Nunca devolve "hoje" nem inventa. */
function vencimentoDoPayload(guide) {
  const pares = achatar(guide?.extracted?.rawPayload || {});
  // ⚠⚠ TODAS as ocorrências, não a primeira. `dados` chega "ora objeto, ora array" do Integra
  // Contador, então um payload PODE trazer dois `detalhamentoDas`. Com `.find` uma data arbitrária
  // venceria em silêncio — e a regra da casa é que ambiguidade NÃO ESCOLHE.
  const achados = pares.filter(([k]) => /detalhamentoDas\.dataVencimento$/i.test(k));
  if (!achados.length) return { data: null, motivo: "sem `detalhamentoDas.dataVencimento` no payload" };

  const distintas = [...new Set(achados.map(([, v]) => String(v).trim()))];
  if (distintas.length > 1) {
    return { data: null, ambigua: true, motivo: `${distintas.length} datas divergentes no payload: ${distintas.join(" / ")}` };
  }

  const data = parsePossibleDate(achados[0][1]);
  if (!data) return { data: null, motivo: `data ilegível: ${JSON.stringify(achados[0][1])}` };
  return { data, motivo: null };
}

/** ⚠ A parcela de parcelamento também é `tipo: "SIMPLES"` e NÃO é o DAS do mês. */
function ehParcela(guide) {
  return Boolean(guide?.parcelamentoId);
}

async function main() {
  console.log(`[backfill-vencimento-das] ${aplicar ? "APLICANDO" : "ENSAIO (nada será gravado)"}`);
  console.log("[backfill-vencimento-das] zero chamada ao SERPRO — a data já está no rawPayload\n");

  // ⚠ O mesmo recorte do diagnóstico: SIMPLES, sem vencimento, já processadas (ou com erro, que
  // também guardaram payload). `VAZIO` fica de fora — ali a ausência de vencimento é legítima.
  const where = {
    tipo: "SIMPLES",
    vencimento: null,
    status: { in: ["PROCESSED", "ERROR"] },
  };

  const total = await prisma.guide.count({ where });
  console.log(`guias de SIMPLES sem vencimento: ${total}`);
  if (total === 0) {
    console.log("\na gravar: 0");
    return;
  }

  let ultimoId = null;
  let lidas = 0;
  let aGravar = 0;
  let gravadas = 0;
  const semPayload = [];
  const ilegiveis = [];
  const ambiguas = [];
  let parcelas = 0;

  for (;;) {
    // ⚠⚠ PAGINAÇÃO POR `id: { gt: … }` NO PRÓPRIO `where` — NUNCA `cursor` + `skip: 1`.
    //
    // O `where` exige `vencimento: null` e este laço GRAVA `vencimento`: a linha que serve de
    // âncora sai do conjunto filtrado no instante em que é atualizada. O `skip: 1` do Prisma existe
    // para descartar a própria linha do cursor e é aplicado DEPOIS do `WHERE` — com a âncora já
    // fora do conjunto, ele descarta a PRÓXIMA linha, que é legítima.
    //
    // ⚠ MEDIDO, não deduzido: experimento contra Postgres real, com âncora fora do filtro e 4
    // linhas válidas depois dela — `cursor + skip:1` devolveu 3 (perdeu a primeira);
    // `where: { id: { gt: ancora } }` devolveu as 4. O defeito era latente só porque o recorte de
    // hoje (67) cabe em uma página de 500; ele viraria determinístico na primeira vez que passasse.
    const pagina = await prisma.guide.findMany({
      where: ultimoId ? { ...where, id: { gt: ultimoId } } : where,
      select: { id: true, competencia: true, portalClientId: true, parcelamentoId: true, extracted: true },
      orderBy: { id: "asc" },
      take: LOTE,
    });
    if (!pagina.length) break;
    ultimoId = pagina[pagina.length - 1].id;
    lidas += pagina.length;

    for (const g of pagina) {
      if (ehParcela(g)) parcelas += 1;
      const { data, motivo, ambigua } = vencimentoDoPayload(g);
      if (!data) {
        const linha = { id: g.id, competencia: g.competencia, portalClientId: g.portalClientId, motivo };
        if (ambigua) ambiguas.push(linha);
        else if (motivo.startsWith("sem ")) semPayload.push(linha);
        else ilegiveis.push(linha);
        continue;
      }
      aGravar += 1;
      if (!aplicar) continue;

      // ⚠ `updateMany` com `vencimento: null` no `where` — a condição é REPETIDA na escrita, para
      // que uma data gravada entre a leitura e este ponto não seja sobrescrita.
      const r = await prisma.guide.updateMany({
        where: { id: g.id, vencimento: null },
        data: { vencimento: data },
      });
      gravadas += r.count;
    }
  }

  console.log(`lidas: ${lidas}`);
  if (parcelas > 0) {
    console.log(`  ⚠ destas, ${parcelas} são PARCELA de parcelamento, não o DAS do mês`);
  }
  console.log(`\na gravar: ${aGravar}`);
  if (aplicar) {
    console.log(`gravadas: ${gravadas}`);
    // ⚠ A diferença não é ruído: quer dizer que alguém gravou o vencimento entre a leitura e a
    // escrita, e a guarda de não-sobrescrita fez o seu trabalho. Dizer isso é melhor que dois
    // números diferentes sem explicação.
    if (gravadas !== aGravar) {
      console.log(
        `  ⚠ ${aGravar - gravadas} não foram gravadas porque o vencimento deixou de ser nulo entre` +
        `\n    a leitura e a escrita — a guarda de não-sobrescrita recusou. Rode o ensaio de novo.`
      );
    }
  }

  // ⚠ O que NÃO foi recuperado sai NOMEADO — silêncio aqui viraria "o backfill resolveu tudo".
  const imprimir = (titulo, lista, limite = 10) => {
    if (!lista.length) return;
    console.log(`\n${titulo}: ${lista.length}`);
    for (const x of lista.slice(0, limite)) {
      console.log(`  ${x.competencia || "?"}  empresa=${x.portalClientId || "?"}  ${x.id}  ${x.motivo}`);
    }
    if (lista.length > limite) console.log(`  … e mais ${lista.length - limite}`);
  };

  imprimir("sem a data no payload (não recuperáveis por aqui)", semPayload);
  imprimir("com data ILEGÍVEL no payload", ilegiveis);
  // ⚠⚠ Ambíguas NÃO são gravadas — o script não escolhe entre duas datas divergentes.
  imprimir("com DUAS OU MAIS datas divergentes (NÃO gravadas — ambiguidade não escolhe)", ambiguas);

  if (aplicar && gravadas > 0) {
    console.log(
      `\n⚠⚠ ${gravadas} guias de DAS passam a ter vencimento — elas APARECEM AGORA no calendário` +
      `\n   fiscal e no fluxo de caixa do cliente, telas que ninguém pediu para mudar.`
    );
  }
  if (!aplicar) console.log("\n[fim] ENSAIO — nada foi escrito. Use --aplicar para gravar.");
}

main()
  .catch((err) => { console.error("[backfill-vencimento-das] falhou:", err); process.exitCode = 1; })
  // ⚠ O `.catch` do disconnect não é decoração: sem ele, uma rejeição no encerramento vira
  // unhandled rejection e derruba o código de saída de uma corrida que deu certo.
  .finally(() => prisma.$disconnect().catch(() => {}));
