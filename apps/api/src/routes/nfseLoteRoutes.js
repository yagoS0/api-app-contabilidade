// AS PORTAS DO LOTE DE NFS-e — baixar o modelo, ler a planilha preenchida, e EMITIR.
//
// ⚠⚠ **ESTE ARQUIVO PASSOU A EMITIR EM 20/08/2026.** Até então ele dizia, com razão, que "nenhuma
// das duas portas emite nada" — a frase ficou falsa e está corrigida aqui, porque documento que
// erra sobre o próprio estado é pior que documento nenhum.
//
//   `GET  /modelo`                    devolve um .xlsx. Não toca em banco nem em rede.
//   `POST /leitura`                   lê e classifica. ⚠ Continua sem gravar e sem emitir nada.
//   `POST /emissao`                   ⚠⚠ EMITE NOTA FISCAL EM SÉRIE.
//   `GET  /emissao/:loteId`           o relatório (polling).
//   `POST /emissao/:loteId/retomar`   ⚠⚠ EMITE — as linhas DEPOIS da indeterminada.
//
// ⚠⚠ AS TRÊS ÚLTIMAS NASCEM DESLIGADAS por `INTEGRACAO_NFSE_LOTE`, e a recusa é do SERVIDOR (503
// nomeado), não da tela. Uma tela que emite em série não pode chegar à produção ligada por acidente
// de deploy.
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
import { municipiosIbgeOuNulo } from "../application/nfse/lote/municipiosIbge.js";
// ⚠ A partir daqui o router passa a EMITIR. Ver o bloco da emissão em lote, no fim do arquivo.
import { INTEGRACAO_NFSE_LOTE } from "../config.js";
import { NfseService } from "../application/nfse/NfseService.js";
import { ensureEmissaoNfseAutorizada } from "./middlewares/emissaoNfseGate.js";
import {
  criarOuReconhecerLote,
  processarLoteEmissao,
  linhasEmitiveis,
  recontar,
} from "../application/nfse/lote/emissaoLote.js";

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

    // ⚠⚠ A LISTA DO IBGE ENTRA AQUI DESDE 20/08/2026 — antes era `municipios: null`, e isso tinha
    // duas consequências que só apareceram ao desenhar a EMISSÃO em lote:
    //   1. endereço vindo da PLANILHA **nunca** podia ser `pronta` (saía `municipio_nao_conferido`,
    //      que é conferência e rebaixa a linha) — ou seja, o cliente que preenchesse o endereço,
    //      que é o fluxo do dono, teria ZERO linhas emitíveis;
    //   2. o `cMun` da CONSULTA era aceito por um booleano do navegador (`cMunVerificado`).
    // Com a tabela unificada em `packages/shared`, o servidor refaz a prova por conta própria.
    // ⚠ Falha ao carregar devolve `null`, e `null` NÃO é "aceite sem conferir": é
    // `municipio_nao_conferido` em toda linha, ou seja, lote parado — nunca nota sem prova.
    const municipios = await municipiosIbgeOuNulo({ log });

    const classificacao = classificarPlanilhaLote(linhas, {
      tomadoresConhecidos: tomadores,
      consultas: lerConsultasDoCorpo(req.body),
      municipios,
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

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ A EMISSÃO EM LOTE — A PARTIR DAQUI SAI NOTA FISCAL DE VERDADE, EM SÉRIE
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠⚠ NASCE DESLIGADA (`INTEGRACAO_NFSE_LOTE`) E O **SERVIDOR** RECUSA — não é a tela que esconde
  // o botão. Tela escondida é decisão de front, e um `curl` passa por cima dela. Ligar é ato do
  // dono, acompanhando o primeiro lote real.
  //
  // ⚠ ESTA É UMA FACHADA, no mesmo desenho de `POST /client/companies/:id/nfse`: nenhuma regra de
  // emissão mora aqui. Ela delega —
  //   leitura + classificação → os MESMOS módulos do `POST /leitura` (a conferência é REFEITA aqui,
  //                             no servidor: a lista que o navegador mandou nunca é a autoridade)
  //   identidade do lote      → `impressaoDigitalDoLote` (a mesma planilha não emite duas vezes)
  //   permissão               → `ensureEmissaoNfseAutorizada` (o MESMO portão da emissão avulsa)
  //   emissão                 → `NfseService.issue`, INJETADO no laço
  //   sequência e desfechos   → `emissaoLote.js`

  /** A recusa da flag — declarada, com o nome da variável, antes de qualquer trabalho. */
  function recusarSeDesligada(res) {
    if (INTEGRACAO_NFSE_LOTE) return false;
    res.status(503).json({
      error: "emissao_lote_desligada",
      codigo: "INTEGRACAO_NFSE_LOTE_DESLIGADA",
      message:
        "A emissão de NFS-e em lote está desligada neste ambiente (INTEGRACAO_NFSE_LOTE). "
        + "Nenhuma nota é emitida enquanto a integração não for habilitada.",
    });
    return true;
  }

  /**
   * ⚠⚠ EMITE. Recebe a MESMA planilha da conferência (+ `ajustes` e `consultas`), **reclassifica no
   * servidor** e emite as linhas `PRONTA`, em série.
   *
   * ⚠ A CONFERÊNCIA É REFEITA AQUI. O corpo não traz "as linhas a emitir" — traz o ARQUIVO. Aceitar
   * uma lista pronta do navegador seria deixar o cliente escolher o que emitir por cima da regra: a
   * linha que a classificação recusou entraria com um campo a mais no JSON.
   */
  router.post("/emissao", upload.single("arquivo"), async (req, res) => {
    if (recusarSeDesligada(res)) return;

    const idDoPath = String(req.params.companyId || "");
    const companyId = resolverCompanyId ? await resolverCompanyId(idDoPath) : idDoPath;
    if (!companyId) return res.status(404).json({ error: "company_not_found" });

    // ⚠ O PORTÃO, ANTES DA PRIMEIRA LINHA (regra 7). Empresa não liberada não emite NENHUMA — e
    // isso se descobre agora, não na décima nota. Ele continua valendo por nota, porque quem emite
    // é `NfseService.issue` pela mesma fachada.
    const portao = await ensureEmissaoNfseAutorizada(req, res, companyId, { log });
    if (!portao.ok) return;

    if (!req.file?.buffer?.length) {
      return res.status(400).json({
        error: "arquivo_ausente",
        message: "Envie a mesma planilha que você conferiu, no campo “arquivo”.",
      });
    }

    const classificacao = await reclassificarNoServidor({ buffer: req.file.buffer, body: req.body, companyId });
    if (!classificacao.ok) return res.status(classificacao.status).json(classificacao.corpo);

    const prontas = linhasEmitiveis(classificacao.resultado);
    if (!prontas.length) {
      // ⚠ NÃO é erro: é o estado honesto. A tela de conferência já mostra por linha o que falta.
      return res.status(422).json({
        error: "nenhuma_linha_pronta",
        message:
          "Nenhuma linha desta planilha está pronta para emitir. Só linhas conferidas e sem "
          + "pendência entram no lote — confira a tela e corrija o que estiver marcado.",
        resumo: classificacao.resultado.resumo,
      });
    }

    const { lote, reconhecido } = await criarOuReconhecerLote({
      prisma,
      companyId,
      linhasProntas: prontas,
      criadoPor: req.auth?.user?.id || null,
    });

    // ⚠⚠ A SEGUNDA SUBIDA DA MESMA PLANILHA **NÃO REEMITE** — devolve o lote que já existe, com o
    // relatório dele. Não é 409: o que a pessoa precisa ver é o que aconteceu da primeira vez.
    if (reconhecido) {
      const atual = await recontar({ prisma, loteId: lote.id });
      return res.status(200).json({ reconhecido: true, lote: paraTela(atual) });
    }

    // ⚠ DESTACADO, e o cliente acompanha por polling — o desenho de `NotasCapturaJob`. Um lote de
    // 50 pode levar minutos (teto de 15 s por nota em `NfseService`), e o `requestTimeout` do Node
    // mata a requisição aos 300 s: segurar a resposta perderia o relatório no meio de uma série de
    // atos fiscais. O desfecho de cada linha já está gravado quando acontece.
    // ⚠ A fotografia da resposta é tirada ANTES de disparar o laço: `recontar` escreve no lote, e
    // chamá-lo depois disputaria a linha com o próprio processamento.
    const inicial = paraTela(await recontar({ prisma, loteId: lote.id }));

    processarLoteEmissao({ prisma, loteId: lote.id, companyId, emitir: NfseService.issue, log })
      .catch((err) => {
        log?.error?.({ err: err?.message, loteId: lote.id }, "NFS-e lote: falha não tratada no processamento");
        return prisma.loteEmissaoNfse
          .update({ where: { id: lote.id }, data: { status: "erro", paradoMotivo: String(err?.message || err) } })
          .catch(() => {});
      });

    return res.status(202).json({ reconhecido: false, lote: inicial });
  });

  /** O relatório do lote — é isto que a tela consulta enquanto o laço corre. */
  router.get("/emissao/:loteId", async (req, res) => {
    if (recusarSeDesligada(res)) return;
    const idDoPath = String(req.params.companyId || "");
    const companyId = resolverCompanyId ? await resolverCompanyId(idDoPath) : idDoPath;
    const lote = await prisma.loteEmissaoNfse.findUnique({ where: { id: String(req.params.loteId) } });
    // ⚠ 404 e não 403: confirmar a existência de um lote de outra empresa já é vazamento.
    if (!lote || lote.companyId !== companyId) return res.status(404).json({ error: "lote_nao_encontrado" });
    return res.json({ lote: paraTela(await recontar({ prisma, loteId: lote.id })) });
  });

  /**
   * ⚠⚠ RETOMAR — e ela **JAMAIS** reprocessa a linha indeterminada.
   *
   * A seleção é `numeroLinha > linhaIndeterminada`, uma QUERY (ver `selecionarParaRetomada`). Quem
   * decide o que fazer com a linha cujo desfecho não se sabe é o CONTADOR, olhando o portal
   * nacional — nunca este código, e nunca automaticamente.
   *
   * ⚠ NÃO ACEITA A PLANILHA DE NOVO: trabalha sobre as linhas já persistidas, com o payload
   * congelado. Subir o arquivo outra vez é o outro caminho, e ele cai na impressão digital.
   */
  router.post("/emissao/:loteId/retomar", async (req, res) => {
    if (recusarSeDesligada(res)) return;
    const idDoPath = String(req.params.companyId || "");
    const companyId = resolverCompanyId ? await resolverCompanyId(idDoPath) : idDoPath;
    if (!companyId) return res.status(404).json({ error: "company_not_found" });

    const portao = await ensureEmissaoNfseAutorizada(req, res, companyId, { log });
    if (!portao.ok) return;

    const lote = await prisma.loteEmissaoNfse.findUnique({ where: { id: String(req.params.loteId) } });
    if (!lote || lote.companyId !== companyId) return res.status(404).json({ error: "lote_nao_encontrado" });

    const inicial = paraTela(await recontar({ prisma, loteId: lote.id }));

    processarLoteEmissao({ prisma, loteId: lote.id, companyId, emitir: NfseService.issue, log })
      .catch((err) => {
        log?.error?.({ err: err?.message, loteId: lote.id }, "NFS-e lote: falha não tratada na retomada");
      });

    return res.status(202).json({ lote: inicial });
  });

  /**
   * Lê a planilha e reclassifica — exatamente o que `POST /leitura` faz, pelos MESMOS módulos.
   *
   * ⚠ Uma segunda leitura/classificação aqui divergiria da conferência na primeira correção, e a
   * tela diria "pronta" sobre uma linha que a emissão recusa.
   */
  async function reclassificarNoServidor({ buffer, body, companyId }) {
    const lida = lerPlanilhaLote(buffer);
    if (!lida.ok) {
      return {
        ok: false,
        status: 422,
        corpo: { error: lida.codigo, message: lida.mensagem, faltando: lida.faltando },
      };
    }
    const pedidoDeAjuste = lerAjustesDoCorpo(body);
    const ajustados = pedidoDeAjuste.ok ? aplicarAjustesLote(lida.linhas, pedidoDeAjuste.ajustes) : pedidoDeAjuste;
    if (!ajustados.ok) {
      return {
        ok: false,
        status: 422,
        corpo: {
          error: ajustados.codigo,
          message: ajustados.mensagem,
          linhasDesconhecidas: ajustados.linhasDesconhecidas,
          colunasDesconhecidas: ajustados.colunasDesconhecidas,
        },
      };
    }
    const linhas = ajustados.linhas;
    const documentos = linhas.map((l) => String(l.valores?.documento ?? ""));
    const { tomadores } = await buscarTomadoresEmitidos({ prisma, companyId, documentos, log });
    const municipios = await municipiosIbgeOuNulo({ log });
    return {
      ok: true,
      resultado: classificarPlanilhaLote(linhas, {
        tomadoresConhecidos: tomadores,
        consultas: lerConsultasDoCorpo(body),
        municipios,
      }),
    };
  }

  return router;
}

/**
 * O lote como a tela o lê.
 *
 * ⚠ O `dados` de cada linha (o payload congelado da nota) **não sai daqui**: a tela já tem o que
 * mostrar em `tomadorNome`/`valorServicos`, e devolver o bloco inteiro só engordaria o polling.
 */
function paraTela(lote) {
  return {
    id: lote.id,
    status: lote.status,
    totalLinhas: lote.totalLinhas,
    emitidas: lote.emitidas,
    recusadas: lote.recusadas,
    naoTentadas: lote.naoTentadas,
    /** ⚠ O número da linha do Excel cujo desfecho NÃO se sabe. É o que a tela precisa gritar. */
    linhaIndeterminada: lote.linhaIndeterminada,
    paradoEm: lote.paradoEm,
    paradoMotivo: lote.paradoMotivo,
    criadoEm: lote.criadoEm,
    linhas: (lote.linhas || []).map((l) => ({
      numeroLinha: l.numeroLinha,
      tomadorDoc: l.tomadorDoc,
      tomadorNome: l.tomadorNome,
      valorServicos: l.valorServicos,
      desfecho: l.desfecho,
      /** ⚠ O número RESERVADO — informação fiscal. Nulo na recusa NOSSA, que não queima número. */
      rpsSerie: l.rpsSerie,
      rpsNumero: l.rpsNumero,
      serviceInvoiceId: l.serviceInvoiceId,
      camada: l.camada,
      codigo: l.codigo,
      mensagem: l.mensagem,
      correcao: l.correcao,
    })),
  };
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
