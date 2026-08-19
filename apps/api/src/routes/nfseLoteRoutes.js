// AS DUAS PORTAS DO LOTE DE NFS-e — baixar o modelo e ler a planilha preenchida.
//
// ⚠⚠ **NENHUMA DAS DUAS EMITE NADA.** Uma devolve um .xlsx; a outra lê um .xlsx, classifica as
// linhas e devolve o resultado. Não há chamada ao ADN, ao SERPRO nem a homologação, e nada é
// gravado — nem tomador, nem nota. A emissão em lote é fase seguinte e **não passa por aqui**.
//
// ─── ONDE MONTAR (ainda NÃO montado — de propósito) ─────────────────────────────────────────────
//
// Este arquivo exporta uma FÁBRICA de router e não se monta sozinho, porque a porta do cliente
// (`routes/client/index.js`) está sendo editada por outra sessão. Para ligar, dentro de
// `createClientPortalRouter`, ao lado das outras sub-rotas de empresa:
//
//     import { createNfseLoteRouter } from "../nfseLoteRoutes.js";
//     …
//     router.use(
//       "/companies/:companyId/nfse/lote",
//       requireClientCompanyAccess(),
//       createNfseLoteRouter({ log })
//     );
//
// ⚠ **`requireClientCompanyAccess()` SEM `minRole`, e é decisão, não descuido.** Estas rotas não
// emitem: baixar um modelo e conferir uma planilha são LEITURA, e o piso das rotas financeiras do
// cliente é "membro ativo" — é o mesmo raciocínio já registrado para o DANFSe do cliente. O portão
// de emissão (`ensureEmissaoNfseAutorizada`, que exige `CLIENT_ADMIN` **e** a liberação do
// contador) é da EMISSÃO, e vai na rota que emitir — na fase seguinte, não nesta.
//
// ⚠ O `companyId` vem do PATH, sempre. Nenhuma destas rotas aceita empresa vinda do corpo: foi
// exatamente `{...body, companyId}` invertido que produziu o furo de multi-tenancy medido na F1 do
// WhatsApp.

import { Router } from "express";
import multer from "multer";
import { prisma } from "../infrastructure/db/prisma.js";
import { buscarTomadoresEmitidos } from "../application/nfse/tomadorEmitido.js";
import { gerarModeloPlanilhaLote } from "../application/nfse/lote/modeloPlanilhaLote.js";
import { lerPlanilhaLote } from "../application/nfse/lote/lerPlanilhaLote.js";
import { classificarPlanilhaLote } from "../application/nfse/lote/classificarLinhaLote.js";

/** 10 MB — o mesmo teto dos outros uploads do portal do cliente (`routes/client/index.js`). */
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function createNfseLoteRouter({ log = null } = {}) {
  // `mergeParams` porque o `:companyId` vem do caminho do router pai.
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAMANHO_MAXIMO } });

  /**
   * O MODELO. ⚠ Não depende de empresa nenhuma: a lista de colunas é fechada e igual para todos, e
   * nada do CADASTRO da empresa entra na planilha (é a trava contra emitir contradizendo o
   * cadastro — ver `colunasLote.js`). O `:companyId` continua no caminho só para o portão de acesso.
   */
  router.get("/modelo", (req, res) => {
    const modelo = gerarModeloPlanilhaLote();
    res.setHeader("Content-Type", TIPO_XLSX);
    res.setHeader("Content-Disposition", `attachment; filename="${modelo.nomeDoArquivo}"`);
    res.setHeader("Content-Length", String(modelo.buffer.length));
    return res.send(modelo.buffer);
  });

  /**
   * A LEITURA. Recebe a planilha, classifica cada linha e devolve.
   *
   * ⚠⚠ **NÃO ESCREVE NADA E NÃO CONSULTA NADA.** As linhas que precisam da consulta ao CNPJ voltam
   * no estado `consultar`, com a lista `aConsultar`. **Quem consulta é o front**, que é onde a
   * chamada à BrasilAPI já mora (sai do browser, sem proxy — está escrito em
   * `portal-cliente-web/src/api/real/brasilApi.js`) e onde está a lista oficial do IBGE que faz a
   * prova tripla do `cMun`. Um segundo cliente HTTP aqui seria uma segunda implementação da mesma
   * consulta, e as duas divergiriam na primeira correção.
   *
   * ⚠ **RESULTADOS PARCIAIS SÃO ACEITOS.** O corpo pode trazer `consultas` (documento → resultado
   * já resolvido) e a classificação é refeita com o que houver: 40 linhas resolvidas e 160 ainda em
   * `consultar` é um estado normal, e é o que impede a tela de travar esperando o lote inteiro ou
   * uma consulta que falha no meio derrubar tudo.
   *
   * ⚠ **`municipios` NÃO É INJETADO AQUI**, e por isso o `cMun` que vier NA PLANILHA sai marcado
   * `municipio_nao_conferido` (estado `conferir`, nunca `pronta`). A lista oficial do IBGE não
   * existe no `apps/api` — ela mora nos dois fronts, e uma terceira cópia foi recusada em
   * 19/08/2026. **A conferência não se perde: ela acontece na tela de ajuste**, que tem a lista.
   */
  router.post("/leitura", upload.single("arquivo"), async (req, res) => {
    const companyId = String(req.params.companyId || "");
    if (!req.file?.buffer?.length) {
      return res.status(400).json({
        error: "arquivo_ausente",
        message: "Envie a planilha preenchida no campo “arquivo”.",
      });
    }

    const lida = lerPlanilhaLote(req.file.buffer);
    if (!lida.ok) {
      // ⚠ 422, não 400: o pedido está bem formado — o CONTEÚDO é que não é uma planilha que
      // saibamos ler. E a recusa vem NOMEADA, com a mensagem que diz o que fazer.
      return res.status(422).json({
        error: lida.codigo,
        message: lida.mensagem,
        faltando: lida.faltando,
        cabecalhoEncontrado: lida.cabecalhoEncontrado,
      });
    }

    const documentos = lida.linhas.map((l) => String(l.valores?.documento ?? ""));
    const { tomadores, motivo } = await buscarTomadoresEmitidos({
      prisma,
      companyId,
      documentos,
      log,
    });

    const classificacao = classificarPlanilhaLote(lida.linhas, {
      tomadoresConhecidos: tomadores,
      consultas: lerConsultasDoCorpo(req.body),
      municipios: null,
    });

    return res.json({
      aba: lida.aba,
      linhaDoCabecalho: lida.linhaDoCabecalho,
      colunasReconhecidas: lida.colunasReconhecidas,
      colunasIgnoradas: lida.colunasIgnoradas,
      exemploDescartado: lida.exemploDescartado,
      /** ⚠ Nulo quando a memória foi lida sem problema. Preenchido, a tela DIZ que não consultou a
       *  memória — em vez de dar a entender que nenhum tomador é conhecido. */
      memoriaIndisponivel: motivo,
      ...classificacao,
    });
  });

  return router;
}

/**
 * As consultas já resolvidas que o front manda de volta.
 *
 * ⚠ Vem como JSON num campo de `multipart/form-data`, então chega como STRING. Corpo malformado
 * **não derruba a leitura**: vira "nenhuma consulta conhecida", e as linhas voltam em `consultar` —
 * que é o estado honesto quando não se sabe o resultado.
 */
function lerConsultasDoCorpo(body) {
  const bruto = body?.consultas;
  if (!bruto) return null;
  if (typeof bruto === "object") return bruto;
  try {
    const lido = JSON.parse(String(bruto));
    return lido && typeof lido === "object" ? lido : null;
  } catch {
    return null;
  }
}
