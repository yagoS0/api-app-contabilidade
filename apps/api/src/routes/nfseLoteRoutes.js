// AS DUAS PORTAS DO LOTE DE NFS-e — baixar o modelo e ler a planilha preenchida.
//
// ⚠⚠ **NENHUMA DAS DUAS EMITE NADA.** Uma devolve um .xlsx; a outra lê um .xlsx, classifica as
// linhas e devolve o resultado. Não há chamada ao ADN, ao SERPRO nem a homologação, e nada é
// gravado — nem tomador, nem nota. A emissão em lote é fase seguinte e **não passa por aqui**.
//
// ─── ONDE ESTÁ MONTADO (19/08/2026) ─────────────────────────────────────────────────────────────
//
//     // routes/client/index.js, dentro de `createClientPortalRouter`
//     router.use(
//       "/companies/:companyId/nfse/lote",
//       requireClientCompanyAccess(),
//       createNfseLoteRouter({ log, resolverCompanyId: resolveLegacyCompanyId })
//     );
//
// ⚠⚠ **`resolverCompanyId` NÃO É OPCIONAL NA PRÁTICA, E A AUSÊNCIA DELE É SILENCIOSA.** O
// `:companyId` do path do portal do cliente é um **`PortalClient.id`**; `TomadorEmitido.companyId`
// é o id da **`Company` legada** (gravado com `company.id` em `NfseService.js`, depois do
// `markIssued`). São duas entidades com PKs próprias, e `routes/middlewares/portalAccess.js`
// registra por extenso que **o id de uma nunca encontra a outra** — é por isso que
// `resolveLegacyCompanyId` teve de existir para a emissão.
//
// Sem a resolução, `buscarTomadoresEmitidos` devolve **vazio, sem erro nenhum**: todo CNPJ cai em
// `CONSULTAR` e o *"se o CNPJ preenchido for de um tomador que já teve antes, só preencher"* —
// metade do que o dono descreveu — **nunca acontece**. A tela funciona, só consulta a Receita para
// todo mundo, e ninguém acha isso testando. É a mesma família do `legacyCompanySelect`.
//
// O padrão é a IDENTIDADE para quem montar este router num caminho que já fale o id legado (é o
// caso do teste da própria fábrica). ⚠ **Só o escopo da MEMÓRIA muda** — o portão de acesso
// continua sendo `requireClientCompanyAccess()` sobre o id do PATH, sempre.
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
import { aplicarAjustesLote, RECUSA_AJUSTE } from "../application/nfse/lote/ajustesLote.js";

/** 10 MB — o mesmo teto dos outros uploads do portal do cliente (`routes/client/index.js`). */
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function createNfseLoteRouter({ log = null, resolverCompanyId = null } = {}) {
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
   *
   * ⚠⚠ **O corpo também aceita `ajustes`** — o que a pessoa digitou por cima, na tela, chaveado
   * pelo NÚMERO DA LINHA DO EXCEL. O arquivo é o mesmo; a sobreposição é `ajustesLote.js`, e ela
   * roda ANTES da classificação: a regra continua num lugar só, e a tela não reimplementa nada.
   *
   * ⚠ **`ajustes` e `consultas` são tratados de forma DIFERENTE quando chegam malformados, e é
   * deliberado.** A consulta é dado DERIVADO — descartá-la devolve a linha a `consultar`, que é o
   * estado honesto, e o front refaz. O ajuste é o que uma PESSOA digitou: descartá-lo em silêncio
   * faria a correção sumir com a tela dizendo que enviou. Por isso ajuste malformado é **recusa
   * nomeada**, e nada é aplicado.
   */
  router.post("/leitura", upload.single("arquivo"), async (req, res) => {
    // ⚠ O id do PATH é o que o portão já autorizou. A memória de tomadores fala outro id — ver o
    // cabeçalho deste arquivo. A tradução acontece AQUI e não muda o escopo de acesso.
    const idDoPath = String(req.params.companyId || "");
    const companyId = resolverCompanyId ? await resolverCompanyId(idDoPath) : idDoPath;
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

    // ⚠ O AJUSTE ENTRA ANTES DE TUDO O QUE DEPENDE DAS CÉLULAS: a memória é buscada pelo documento,
    // e um ajuste que conserte o CNPJ tem de mudar qual tomador se procura.
    const pedidoDeAjuste = lerAjustesDoCorpo(req.body);
    const ajustados = pedidoDeAjuste.ok
      ? aplicarAjustesLote(lida.linhas, pedidoDeAjuste.ajustes)
      : pedidoDeAjuste;
    if (!ajustados.ok) {
      return res.status(422).json({
        error: ajustados.codigo,
        message: ajustados.mensagem,
        linhasDesconhecidas: ajustados.linhasDesconhecidas,
        colunasDesconhecidas: ajustados.colunasDesconhecidas,
      });
    }
    const linhas = ajustados.linhas;

    const documentos = linhas.map((l) => String(l.valores?.documento ?? ""));
    const { tomadores, motivo } = await buscarTomadoresEmitidos({
      prisma,
      companyId,
      documentos,
      log,
    });

    const classificacao = classificarPlanilhaLote(linhas, {
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
      /**
       * Os números das linhas do Excel que foram ajustadas NESTA leitura.
       *
       * ⚠ A tela precisa dizer isso: **a planilha no disco da pessoa continua com o valor antigo**.
       * Subir o mesmo arquivo amanhã perde os ajustes, e sem este campo a perda seria silenciosa.
       */
      linhasAjustadas: ajustados.ajustadas,
      ...classificacao,
      /**
       * ⚠⚠ AS CÉLULAS VOLTAM COM CADA LINHA, e não é conveniência: sem elas a tela de conferência
       * não consegue **dizer de que nota está falando**. A classificação devolve o estado e, para
       * `pronta`/`conferir`, os `dados` — mas a linha PENDENTE (justamente a que precisa de ajuste)
       * volta com `dados: null`. Ela apareceria como "linha 37" e um motivo, e quem lê teria de
       * abrir a planilha para saber qual tomador é. É também o que a pessoa edita para corrigir.
       *
       * ⚠ São os valores JÁ AJUSTADOS — é o que o servidor classificou.
       */
      linhas: classificacao.linhas.map((linha) => {
        const origem = linhas.find((l) => l.numero === linha.numero);
        return {
          ...linha,
          valores: celulasParaTela(origem?.valores),
          /** ⚠ Ajustada NESTA sessão. O arquivo no disco continua dizendo o antigo. */
          ajustada: origem?.ajustada === true,
        };
      }),
    });
  });

  return router;
}

/**
 * As células como a tela vai mostrá-las — e como a LEITURA as entendeu.
 *
 * ⚠⚠ A DATA É FORMATADA COM OS MESMOS ACESSADORES DE `lerCompetenciaDaPlanilha` (`getFullYear`,
 * `getMonth`, `getDate` — hora local), e **não** com `toJSON`/ISO. O ISO converte para UTC e, num
 * fuso a leste de Greenwich, mostraria um DIA DIFERENTE do que o classificador leu na mesma célula:
 * a tela diria "01/08" sobre a linha que o servidor classificou como 31/07. A competência sai
 * impressa na nota — a tela e a regra têm de estar falando da mesma data.
 *
 * ⚠ Tudo mais vira texto cru, sem máscara e sem arredondar: é a GRAFIA da planilha que decide o
 * valor ambíguo (`1.500`) e o zero à esquerda do CPF, e é ela que a pessoa precisa ver para
 * entender a pendência.
 */
function celulasParaTela(valores) {
  const saida = {};
  for (const [chave, valor] of Object.entries(valores || {})) {
    if (valor instanceof Date) {
      saida[chave] = Number.isNaN(valor.getTime())
        ? String(valor)
        : `${String(valor.getDate()).padStart(2, "0")}/${String(valor.getMonth() + 1).padStart(2, "0")}/${valor.getFullYear()}`;
      continue;
    }
    saida[chave] = valor === null || valor === undefined ? "" : String(valor);
  }
  return saida;
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

/**
 * Os ajustes que a pessoa digitou na tela.
 *
 * ⚠⚠ **AQUI O MALFORMADO RECUSA, ao contrário de `consultas`.** A consulta é dado derivado: jogá-la
 * fora devolve a linha ao estado `consultar`, que é honesto, e o front a refaz sem ninguém perder
 * nada. O ajuste é o que uma PESSOA escreveu — jogá-lo fora em silêncio faria a tela dizer que
 * enviou a correção e o servidor reclassificar com o valor velho, e a linha voltaria pendente pelo
 * mesmo motivo de antes. Ninguém descobriria isso olhando.
 */
function lerAjustesDoCorpo(body) {
  const bruto = body?.ajustes;
  if (bruto === undefined || bruto === null || bruto === "") return { ok: true, ajustes: null };
  if (typeof bruto === "object") return { ok: true, ajustes: bruto };
  try {
    return { ok: true, ajustes: JSON.parse(String(bruto)) };
  } catch {
    return {
      ok: false,
      codigo: RECUSA_AJUSTE.FORMA_INVALIDA,
      mensagem:
        "Os ajustes desta planilha não chegaram em forma que se possa ler. Nada foi aplicado — "
        + "confira a linha na tela e envie de novo.",
    };
  }
}
