// RELEITURA da linha digitável das guias JÁ GRAVADAS — o backfill.
//
// ⚠⚠ NÃO RODA SOZINHO, E NÃO DEVE PASSAR A RODAR. Não há cron, worker nem rota que o chame; ele é
// executado à mão, pelo dono, quando ele decidir. **DRY-RUN POR PADRÃO** — sem `--aplicar` nada é
// escrito. A leitura acontece nos dois modos, então dá para medir antes de decidir.
//
// POR QUE ELE EXISTE: a leitura da linha digitável foi ligada no funil de gravação
// (`GuideService.createOrUpdateGuideFromProcessing`), e o funil só passa quando a guia é criada ou
// recapturada. Toda guia que já estava no banco nasce com as quatro colunas nulas — isto é, com
// "NÃO TENTAMOS", que é a resposta honesta e é justamente o que este script existe para desfazer.
//
// ⚠ O QUE ELE FAZ, E SÓ ISSO:
//   LÊ  — o PDF que já está guardado (`Guide.pdfBytes` e, na ausência dele, o PDF em base64 que
//         ficou em `extracted.rawPayload`). Nenhuma chamada ao SERPRO, a lugar nenhum.
//   ESCREVE — exclusivamente as QUATRO colunas de linha digitável, e nada mais. Não toca em valor,
//         vencimento, status, e-mail, pagamento, `extracted` nem `pdfBytes`.
//
// ⚠ Ele usa a MESMA função do funil (`lerLinhaDigitavelDoPdf`). Reescrever a leitura aqui faria o
// backfill e a captura discordarem sobre a mesma guia — que é como duas verdades nascem.
//
//   node scripts/reler-linha-digitavel.mjs                    # mede, não escreve
//   node scripts/reler-linha-digitavel.mjs --aplicar          # escreve as quatro colunas
//   node scripts/reler-linha-digitavel.mjs --competencia=2026-07 --aplicar
//   node scripts/reler-linha-digitavel.mjs --guia=<guideId>
//   node scripts/reler-linha-digitavel.mjs --somente-nao-lidas   # pula quem já tem leitura

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { lerLinhaDigitavelDoPdf } from "../src/application/guides/lerLinhaDigitavelDoPdf.js";
import { formatarLinhaDigitavel } from "../src/application/guides/linhaDigitavelArrecadacao.js";

function arg(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const tem = (nome) => process.argv.includes(`--${nome}`);
const APLICAR = tem("aplicar");

// PDF do payload do SERPRO já salvo: `dados` é JSON EM STRING; o item traz `pdf` em base64.
// (Mesma leitura de `scripts/diag-linha-digitavel.mjs`.)
function pdfDoRawPayload(extracted) {
  const raw = extracted && extracted.rawPayload;
  if (!raw) return null;
  let dados = raw.dados ?? raw.Dados;
  if (typeof dados === "string") {
    try { dados = JSON.parse(dados); } catch { return null; }
  }
  const itens = Array.isArray(dados) ? dados : dados ? [dados] : [];
  for (const item of itens) {
    const b64 = item && (item.pdf || item.docArrecadacaoPdfB64 || item.pdfBase64);
    if (typeof b64 === "string" && b64.length > 100) {
      try {
        const buf = Buffer.from(b64, "base64");
        if (buf.slice(0, 4).toString("latin1") === "%PDF") return buf;
      } catch { /* base64 ilegível */ }
    }
  }
  return null;
}

// ⚠ A conferência é contra o DOCUMENTO OFICIAL quando ele existe. `detalhamentoDas.valores.total`
// veio da Receita; `Guide.valor` pode ser número digitado por alguém. Mesma precedência do
// diagnóstico — e é ela que decide se uma guia sai como "conferida" ou como "divergente".
function referenciaOficial(extracted) {
  const raw = extracted && extracted.rawPayload;
  if (!raw) return null;
  let dados = raw.dados ?? raw.Dados;
  if (typeof dados === "string") {
    try { dados = JSON.parse(dados); } catch { return null; }
  }
  const item = Array.isArray(dados) ? dados[0] : dados;
  const det = item && item.detalhamentoDas;
  if (!det) return null;
  const total = det.valores && det.valores.total;
  if (total == null) return null;
  return { valorTotal: Number(total), vencimento: det.dataVencimento != null ? String(det.dataVencimento) : null };
}

async function main() {
  const where = {};
  const competencia = arg("competencia");
  const guiaId = arg("guia");
  const tipo = arg("tipo");
  if (competencia) where.competencia = competencia;
  if (guiaId) where.id = guiaId;
  if (tipo) where.tipo = tipo.toUpperCase();
  // "Ainda não tentamos" = `linhaDigitavelLidaEm` nulo. É o recorte natural de um backfill.
  if (tem("somente-nao-lidas")) where.linhaDigitavelLidaEm = null;

  const limite = Number(arg("limite") || 1000);
  const guias = await prisma.guide.findMany({
    where,
    select: {
      id: true, tipo: true, competencia: true, valor: true, vencimento: true,
      pdfBytes: true, extracted: true, source: true, sourcePath: true,
      linhaDigitavel: true, linhaDigitavelLidaEm: true, linhaDigitavelMotivo: true,
      linhaDigitavelValorLidoCentavos: true,
    },
    orderBy: [{ competencia: "desc" }, { createdAt: "desc" }],
    take: limite,
  });

  console.log(
    `\n${APLICAR ? "⚠ MODO APLICAR — as quatro colunas SERÃO escritas" : "modo DRY-RUN — nada será escrito (use --aplicar)"}`,
  );
  console.log(`guias selecionadas: ${guias.length}\n`);

  const resumo = { comLinha: 0, divergente: 0, naoEncontrada: 0, naoTentada: 0, mudariam: 0, escritas: 0 };
  const porMotivo = new Map();
  const mudancas = [];

  for (const g of guias) {
    let buffer = g.pdfBytes && g.pdfBytes.length ? Buffer.from(g.pdfBytes) : null;
    if (!buffer) buffer = pdfDoRawPayload(g.extracted);

    const oficial = referenciaOficial(g.extracted);
    const patch = await lerLinhaDigitavelDoPdf(
      buffer,
      oficial || { valorTotal: g.valor != null ? Number(g.valor) : null, vencimento: g.vencimento || null },
    );

    if (patch.linhaDigitavel) resumo.comLinha += 1;
    else if (patch.linhaDigitavelMotivo === "valor_divergente_do_documento") resumo.divergente += 1;
    else if (patch.linhaDigitavelLidaEm) resumo.naoEncontrada += 1;
    else resumo.naoTentada += 1;

    if (patch.linhaDigitavelMotivo) {
      porMotivo.set(patch.linhaDigitavelMotivo, (porMotivo.get(patch.linhaDigitavelMotivo) || 0) + 1);
    }

    const mudou =
      (patch.linhaDigitavel || null) !== (g.linhaDigitavel || null)
      || (patch.linhaDigitavelMotivo || null) !== (g.linhaDigitavelMotivo || null)
      || (patch.linhaDigitavelValorLidoCentavos ?? null) !== (g.linhaDigitavelValorLidoCentavos ?? null)
      || Boolean(patch.linhaDigitavelLidaEm) !== Boolean(g.linhaDigitavelLidaEm);

    if (!mudou) continue;
    resumo.mudariam += 1;
    if (mudancas.length < 40) {
      mudancas.push({
        id: g.id.slice(0, 8),
        tipo: g.tipo,
        comp: g.competencia,
        antes: g.linhaDigitavel ? "linha" : g.linhaDigitavelLidaEm ? `recusa:${g.linhaDigitavelMotivo}` : "nao_tentada",
        depois: patch.linhaDigitavel
          ? formatarLinhaDigitavel(patch.linhaDigitavel)
          : patch.linhaDigitavelLidaEm
            ? `recusa:${patch.linhaDigitavelMotivo}`
            : "nao_tentada",
        valor_lido: patch.linhaDigitavelValorLidoCentavos ?? "",
        referencia: oficial ? "payload SERPRO" : "Guide.valor",
      });
    }

    if (APLICAR) {
      // ⚠ SÓ AS QUATRO COLUNAS. Um `data` mais largo aqui é como um backfill vira perda de dado.
      await prisma.guide.update({
        where: { id: g.id },
        data: {
          linhaDigitavel: patch.linhaDigitavel,
          linhaDigitavelLidaEm: patch.linhaDigitavelLidaEm,
          linhaDigitavelMotivo: patch.linhaDigitavelMotivo,
          linhaDigitavelValorLidoCentavos: patch.linhaDigitavelValorLidoCentavos,
        },
      });
      resumo.escritas += 1;
    }
  }

  console.log("== O QUE A RELEITURA ENCONTRA ==");
  console.table([
    { situacao: "TEMOS A LINHA", n: resumo.comLinha },
    { situacao: "DIVERGENTE (mostra os dois valores ao contador)", n: resumo.divergente },
    { situacao: "TENTAMOS E NAO DEU", n: resumo.naoEncontrada },
    { situacao: "NAO TENTAMOS (sem PDF guardado)", n: resumo.naoTentada },
  ]);

  if (porMotivo.size) {
    console.log("== MOTIVOS DE RECUSA ==");
    console.table([...porMotivo.entries()].sort((a, b) => b[1] - a[1]).map(([motivo, n]) => ({ motivo, n })));
  }

  if (mudancas.length) {
    console.log(`\n== LINHAS QUE MUDARIAM (${resumo.mudariam} no total; mostrando ${mudancas.length}) ==`);
    console.table(mudancas);
  } else {
    console.log("\nNenhuma linha mudaria — o banco já reflete a leitura atual.");
  }

  console.log(
    APLICAR
      ? `\n✔ ${resumo.escritas} guias atualizadas (somente as quatro colunas de linha digitável).`
      : `\n(dry-run) ${resumo.mudariam} guias seriam atualizadas. Rode de novo com --aplicar para escrever.`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
