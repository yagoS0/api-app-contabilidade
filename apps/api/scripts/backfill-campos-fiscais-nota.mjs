// BACKFILL: materializa em coluna os campos fiscais que já estão dentro do `xmlRaw` das notas.
//
// ⚠ DRY-RUN POR PADRÃO. Sem `--aplicar` ele não escreve NADA — só mede e mostra o que faria.
// ⚠ ZERO CHAMADA DE REDE. Nem ADN, nem SEFAZ, nem SERPRO. A fonte é o XML que já está no banco.
//
// ─── POR QUE ELE EXISTE ─────────────────────────────────────────────────────────────────────
//
// O dono (17/08/2026): "precisamos trazer os XMLs das notas (…) nos ajuda em uma auditoria
// pré-apuração para entender se a nota está correta ou não, baseado na atividade e baseado na data
// de emissão".
//
// ⚠ NÃO HAVIA NADA A TRAZER: medido antes de qualquer código (`diag-cobertura-xml-notas.mjs`), EMIT
// tem 14.946 notas com 100% de `xmlRaw` e DEST 1.846 com 98%. O XML sempre esteve lá; o que não
// existia era coluna. Mesmo molde de `backfill-substituicao-nfse.mjs`, que fez isto com o vínculo
// de substituição.
//
// ─── AS TRÊS DISCIPLINAS, E ELAS SÃO O DESENHO ──────────────────────────────────────────────
//
// 1. **O EXTRATOR É O ÚNICO ESCRITOR.** Tudo sai de `application/nfse/camposFiscaisNfse.js`, que lê
//    POR CAMINHO (NT 008 §2.4.5, transcrita em `nfse/danfse/danfseLeiaute.js`). Este script não
//    tem nenhum caminho de XML escrito nele — reescrevê-los aqui faria o backfill produzir um
//    valor diferente do que a extração produz daqui para frente, na MESMA coluna.
// 2. **RE-EXECUTÁVEL A QUALQUER MOMENTO, MESMO RESULTADO.** A extração é pura; a comparação é campo
//    a campo contra o que já está gravado; linha idêntica não vira UPDATE.
// 3. **ONDE FALHA, A COLUNA FICA NULA E O MOTIVO É REGISTRADO** (`camposFiscaisMotivo`, vocabulário
//    fechado). Ausência é resposta; palpite não é.
//
// ─── ⚠ O QUE ELE NÃO ESCREVE, DE PROPÓSITO ──────────────────────────────────────────────────
//
// Só as colunas novas. Nem `status`, nem `statusEfetivo`, nem `total`, nem `serie`, nem `numero`,
// nem `nota_itens`. O aviso do schema sobre `statusEfetivo` é explícito: gravar um terceiro valor
// ali é mudança de DINHEIRO disfarçada de rótulo.
//
// ⚠ **NF-e NÃO É TOCADA.** O XML da NF-e é outro documento (`nfeProc/NFe/infNFe`) e não tem
// `cTribNac`, nem DPS, nem ISSQN. Aplicar o leiaute da NFS-e nele devolveria tudo nulo — e nulo
// indistinguível de "NFS-e ilegível". Elas são CONTADAS no relatório e saem do universo de escrita;
// nem sequer o carimbo `camposFiscaisExtraidosEm` é gravado nelas. Quem responde "isto é uma NF-e?"
// já é a coluna `type`.
//
// ─── USO ────────────────────────────────────────────────────────────────────────────────────
//
//   ⚠ `railway run … bash -c` NÃO funciona nesta máquina — use `pwsh`:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/backfill-campos-fiscais-nota.mjs'
//
//     --aplicar          GRAVA (sem ele, nada é escrito)
//     --cnpj=<digitos>   limita a uma empresa
//     --lote=<n>         tamanho do lote (padrão 200)
//     --limite=<n>       para depois de N notas — para uma amostra rápida
//     --verbose          imprime linha a linha o que mudaria

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  extrairCamposFiscaisNfse,
  IDS_DOS_CAMPOS,
  MOTIVO,
} from "../src/application/nfse/camposFiscaisNfse.js";
import { parseXmlMetadata } from "../src/application/nfse/AdnXmlMetadata.js";

const arg = (nome) => {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.split("=").slice(1).join("=") : null;
};
const flag = (nome) => process.argv.includes(`--${nome}`);
const soDigitos = (v) => String(v || "").replace(/\D+/g, "");
const num = (v) => Number(v || 0).toLocaleString("pt-BR");
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const padL = (s, n) => String(s ?? "").slice(0, n).padStart(n);
const pct = (parte, total) => (total ? `${((parte * 100) / total).toFixed(1)}%` : "—");

const APLICAR = flag("aplicar");
const VERBOSE = flag("verbose");
const CNPJ = soDigitos(arg("cnpj"));
const LOTE = Math.max(1, Math.min(1000, Number(arg("lote")) || 200));
const LIMITE = Number(arg("limite")) || null;

// As colunas que este script escreve — e nenhuma outra. A lista é usada tanto para conferir a
// existência no banco quanto para montar o `update`, então ela não pode divergir de si mesma.
const COLUNAS = [...IDS_DOS_CAMPOS, "camposFiscaisExtraidosEm", "camposFiscaisMotivo"];
const COLUNAS_DECIMAIS = new Set(["issqnBaseCalculo", "issqnAliquota", "issqnValor"]);

try {
  console.log("=".repeat(112));
  console.log(
    `CAMPOS FISCAIS DA NOTA ← XML — ${APLICAR ? "⚠ MODO APLICAR (vai gravar)" : "DRY-RUN (nada será gravado)"}`,
  );
  console.log("=".repeat(112));

  // ── 0. AS COLUNAS EXISTEM NESTE BANCO? ─────────────────────────────────────────────────────
  // ⚠ O script serve JUSTAMENTE para rodar ANTES do deploy da migration — é assim que se vê o que
  // ele faria antes de a coluna existir. Sem esta checagem, sai um stack do Prisma de 400 linhas
  // dizendo `column p."cTribNac" does not exist`: a informação certa enterrada no lugar errado.
  const existentes = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'PortalInvoice'`;
  const nomes = new Set(existentes.map((c) => c.column_name));
  const faltando = COLUNAS.filter((c) => !nomes.has(c));
  const TEM_COLUNAS = faltando.length === 0;

  if (!TEM_COLUNAS) {
    console.log("\n⚠ AS COLUNAS AINDA NÃO EXISTEM NESTE BANCO.");
    console.log(`  Faltam: ${faltando.join(", ")}`);
    console.log("  A migration `20260817120000_add_campos_fiscais_nota` não foi aplicada aqui.");
    console.log("  O dry-run CONTINUA (é o que se quer ver antes do deploy), mas `--aplicar` está");
    console.log("  BLOQUEADO — e nenhuma comparação com o valor já gravado é possível.\n");
  }

  // ── 1. O UNIVERSO, ANTES DE LER UM XML SEQUER ──────────────────────────────────────────────
  const filtroCnpj = CNPJ ? `AND c.cnpj LIKE '%' || $1 || '%'` : "";
  const paramsCnpj = CNPJ ? [CNPJ] : [];

  const universo = await prisma.$queryRawUnsafe(
    `SELECT p."type"                                       AS tipo,
            COALESCE(p.papel, '(sem papel)')               AS papel,
            COUNT(*)                                       AS total,
            COUNT(*) FILTER (WHERE p."xmlRaw" IS NOT NULL) AS com_xml
       FROM "PortalInvoice" p
       JOIN "PortalClient" c ON c.id = p."clientId"
      WHERE 1 = 1 ${filtroCnpj}
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    ...paramsCnpj,
  );

  console.log("\n── UNIVERSO ──────────────────────────────────────────────────────────────────");
  console.log(`${pad("TIPO", 8)} ${pad("PAPEL", 12)} ${padL("TOTAL", 8)} ${padL("COM XML", 9)}  cobertura`);
  let totalGeral = 0;
  let totalNfse = 0;
  let totalNfe = 0;
  for (const l of universo) {
    const t = Number(l.total);
    const c = Number(l.com_xml);
    totalGeral += t;
    if (String(l.tipo) === "NFSE") totalNfse += t;
    else totalNfe += t;
    console.log(`${pad(l.tipo, 8)} ${pad(l.papel, 12)} ${padL(num(t), 8)} ${padL(num(c), 9)}  ${pct(c, t)}`);
  }
  console.log(`${pad("", 8)} ${pad("TOTAL", 12)} ${padL(num(totalGeral), 8)}`);
  console.log(`\n⚠ NF-e no universo: ${num(totalNfe)} — NÃO são tocadas (leiaute diferente; ver o cabeçalho).`);
  console.log(`  NFS-e a processar: ${num(totalNfse)}`);

  // ── 2. A VARREDURA — em lotes, por cursor de id (estável e sem OFFSET crescente) ───────────
  //
  // ⚠ POR QUE CURSOR E NÃO `findMany` INTEIRO: são ~16 mil XMLs de alguns KB cada. Carregar tudo de
  // uma vez enche a memória do processo e, rodando de FORA do Railway (que é o caso — `railway run`
  // conecta pelo proxy PÚBLICO), cada round trip paga latência de internet. Foi essa mesma latência
  // que estourou o timeout de transação de 5s do Prisma em `corrigir-das-divergente.mjs`.
  //
  // ⚠ E POR QUE NENHUMA TRANSAÇÃO INTERATIVA AQUI: cada linha é independente e a operação é
  // idempotente, então não há invariante entre linhas a proteger. A escrita usa
  // `$transaction([...])` (forma de ARRAY), que vai num round trip só e não está sujeita ao
  // `timeout` de 5s das transações interativas — em vez de aumentar o timeout, o desenho tira a
  // transação longa do caminho.
  const colunasNovas = TEM_COLUNAS ? `, ${COLUNAS.map((c) => `p."${c}"`).join(", ")}` : "";

  const contadores = Object.fromEntries(IDS_DOS_CAMPOS.map((id) => [id, 0]));
  const motivos = new Map();
  const avisos = [];
  const aEscrever = [];
  let lidas = 0;
  let semXml = 0;
  let jaIguais = 0;
  let comMotivo = 0;

  // A comparação com o caminho ANTIGO: `nota_itens.codigoServico`, gravado pela captura a partir de
  // `AdnXmlMetadata` — que lê por VARREDURA DE NOME. Não é para eleger vencedor: é para MEDIR se a
  // varredura já trouxe outro código, o que é o defeito que a leitura por caminho existe para
  // impedir. Nada em `nota_itens` é escrito por este script.
  let itemIgual = 0;
  let itemDivergente = 0;
  let itemAusente = 0;
  const exemplosDivergentes = [];

  let cursor = "";
  for (;;) {
    if (LIMITE && lidas >= LIMITE) break;
    const take = LIMITE ? Math.min(LOTE, LIMITE - lidas) : LOTE;

    const params = CNPJ ? [cursor, take, CNPJ] : [cursor, take];
    const lote = await prisma.$queryRawUnsafe(
      `SELECT p.id, p."clientId", p.numero, p."issueDate", p."xmlRaw", c.razao ${colunasNovas}
         FROM "PortalInvoice" p
         JOIN "PortalClient" c ON c.id = p."clientId"
        WHERE p."type" = 'NFSE' AND p.id > $1
          ${CNPJ ? "AND c.cnpj LIKE '%' || $3 || '%'" : ""}
        ORDER BY p.id
        LIMIT $2`,
      ...params,
    );
    if (!lote.length) break;
    cursor = lote[lote.length - 1].id;

    for (const nota of lote) {
      lidas += 1;
      if (!nota.xmlRaw) semXml += 1;

      // ⚠ A EXTRAÇÃO É A MESMA QUE VALERÁ DAQUI PARA FRENTE — importada, não reescrita.
      const r = extrairCamposFiscaisNfse(nota.xmlRaw);

      for (const id of IDS_DOS_CAMPOS) if (r.campos[id] != null) contadores[id] += 1;
      if (r.motivo) {
        comMotivo += 1;
        // ⚠ Um motivo pode trazer VÁRIOS códigos (`CAMPO_ILEGIVEL:issqnValor;CTRIBNAC_FORA_DA_FORMA`)
        // e cada um é contado por si: agregá-los pela string inteira esconderia qual campo falhou.
        for (const m of String(r.motivo).split(";")) motivos.set(m, (motivos.get(m) || 0) + 1);
      }
      for (const a of r.avisos) if (avisos.length < 20) avisos.push(`${nota.razao} nº ${nota.numero}: ${a}`);

      // O contraponto com a leitura por NOME que a captura já usa.
      if (r.campos.cTribNac != null && nota.xmlRaw) {
        let antigo = null;
        try {
          antigo = parseXmlMetadata(nota.xmlRaw)?.codigoServico || null;
        } catch {
          antigo = null;
        }
        if (antigo == null) itemAusente += 1;
        else if (String(antigo).trim() === String(r.campos.cTribNac).trim()) itemIgual += 1;
        else {
          itemDivergente += 1;
          if (exemplosDivergentes.length < 10) {
            exemplosDivergentes.push(
              `${pad(nota.razao, 34)} nº ${pad(nota.numero, 10)} caminho=${r.campos.cTribNac} · varredura=${antigo}`,
            );
          }
        }
      }

      // Idempotência: só entra na fila de escrita o que MUDA.
      const destino = {
        ...Object.fromEntries(IDS_DOS_CAMPOS.map((id) => [id, r.campos[id]])),
        camposFiscaisMotivo: r.motivo,
      };
      if (TEM_COLUNAS) {
        const igual = Object.entries(destino).every(([k, v]) => {
          const atual = nota[k];
          if (v == null && atual == null) return true;
          if (v == null || atual == null) return false;
          // Decimal volta do Postgres como objeto/string com escala fixa ("198.00" vs "198.0000").
          if (COLUNAS_DECIMAIS.has(k)) return Number(String(atual)) === Number(String(v));
          return String(atual) === String(v);
        });
        if (igual && nota.camposFiscaisExtraidosEm != null) {
          jaIguais += 1;
          continue;
        }
      }

      aEscrever.push({ id: nota.id, clientId: nota.clientId, razao: nota.razao, numero: nota.numero, destino });
      if (VERBOSE) {
        console.log(
          `   ${pad(nota.razao, 30)} nº ${pad(nota.numero, 9)} ` +
            `cTribNac=${pad(destino.cTribNac ?? "—", 8)} ISS=${padL(destino.issqnValor ?? "—", 10)} ` +
            `DPS=${destino.dpsSerie ?? "—"}/${destino.dpsNumero ?? "—"}` +
            (r.motivo ? `  ⚠ ${r.motivo}` : ""),
        );
      }
    }

    process.stdout.write(`\r   lidas ${num(lidas)} de ${num(totalNfse)} …`);
  }
  process.stdout.write("\n");

  // ── 3. A MEDIÇÃO — quantas de N renderam CADA campo ────────────────────────────────────────
  console.log("\n── RENDIMENTO POR CAMPO ──────────────────────────────────────────────────────");
  console.log(`   NFS-e lidas: ${num(lidas)}   (sem xmlRaw: ${num(semXml)})`);
  console.log(`${pad("CAMPO", 24)} ${padL("RENDEU", 9)}  cobertura`);
  for (const id of IDS_DOS_CAMPOS) {
    const c = contadores[id];
    // ⚠ Campo que não sai em QUASE NENHUMA nota é sinal de CAMINHO ERRADO, não de nota incompleta.
    const alerta = lidas && c / lidas < 0.05 ? "   ⚠ quase nenhuma — conferir o caminho no leiaute" : "";
    console.log(`${pad(id, 24)} ${padL(num(c), 9)}  ${pct(c, lidas)}${alerta}`);
  }

  if (motivos.size) {
    console.log("\n── MOTIVOS (a coluna fica NULA e o motivo é registrado) ──────────────────────");
    console.log(`   notas com algum motivo: ${num(comMotivo)}`);
    for (const [m, q] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${pad(m, 34)} ${padL(num(q), 8)}`);
    }
  }
  if (avisos.length) {
    console.log("\n   avisos (amostra):");
    for (const a of avisos) console.log(`     · ${a}`);
  }

  console.log("\n── CONTRAPONTO: leitura por CAMINHO × varredura por NOME (`nota_itens.codigoServico`) ──");
  console.log("   (só medição — este script NÃO escreve em `nota_itens` nem muda a captura)");
  console.log(`   iguais ................ ${padL(num(itemIgual), 8)}`);
  console.log(`   ⚠ divergentes ......... ${padL(num(itemDivergente), 8)}`);
  console.log(`   varredura não achou ... ${padL(num(itemAusente), 8)}`);
  for (const e of exemplosDivergentes) console.log(`     · ${e}`);

  // ── 4. A ESCRITA ───────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(112));
  console.log(`   já iguais (nada a fazer): ${num(jaIguais)}   ·   a gravar: ${num(aEscrever.length)}`);
  console.log("=".repeat(112));

  if (!APLICAR || !TEM_COLUNAS) {
    console.log(
      !TEM_COLUNAS
        ? "\nNada foi alterado — as colunas não existem neste banco. Aplique a migration e rode de novo.\n"
        : "\nDRY-RUN: nada foi gravado. Para aplicar, acrescente --aplicar\n",
    );
  } else if (!aEscrever.length) {
    console.log("\nNada a gravar — a base já reflete a extração. (Idempotente: rodar de novo não muda nada.)\n");
  } else {
    console.log("\n⚠ APLICANDO — só as colunas novas. Nenhum status, nenhum total, nenhum item.\n");
    let gravadas = 0;
    for (let i = 0; i < aEscrever.length; i += LOTE) {
      const chunk = aEscrever.slice(i, i + LOTE);
      await prisma.$transaction(
        chunk.map((p) =>
          prisma.portalInvoice.update({
            // ⚠ MULTI-TENANCY INEGOCIÁVEL, INCLUSIVE NO SCRIPT: o `clientId` viaja no `where` junto
            // do id. Escolher a linha só pelo id é o furo já fechado no cadastro de contatos do
            // WhatsApp — e aqui seria escrever campo fiscal na nota de outra empresa.
            where: { id: p.id, clientId: p.clientId },
            data: { ...p.destino, camposFiscaisExtraidosEm: new Date() },
          }),
        ),
      );
      gravadas += chunk.length;
      process.stdout.write(`\r   gravadas ${num(gravadas)} de ${num(aEscrever.length)} …`);
    }
    process.stdout.write("\n");
    console.log(`\n✓ ${num(gravadas)} nota(s) atualizada(s). Rode de novo (sem --aplicar): deve dizer "a gravar: 0".\n`);
  }
} catch (err) {
  console.error("\nERRO:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
