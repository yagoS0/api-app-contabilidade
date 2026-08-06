// Controle de Obrigações.
// Mount: /firm/obrigacoes e /firm/ocorrencias
//
// A listagem NÃO exige empresa: no portal do escritório o contador sempre tem várias, e a pergunta
// que a tela responde é "o que EU preciso entregar", em toda a carteira. O filtro por empresa é
// opcional — mesma decisão já tomada no calendário.

import { Router } from "express";
// O espelho da DEFIS é guardado direto (uma tabela, um upsert) — não há regra de negócio a
// encapsular num service, e criar um só para repassar o Prisma seria a abstração prematura que o
// projeto proíbe.
import { prisma } from "../../infrastructure/db/prisma.js";
import {
  ObrigacaoError,
  VERIFICADORES,
  aplicarVerificadores,
  atualizar,
  concluir,
  criar,
  listar,
  reabrir,
  remover,
} from "../../application/obrigacoes/ObrigacoesService.js";
import { AJUSTES_DIA_UTIL, PERIODICIDADES } from "../../application/obrigacoes/gerarOcorrencias.js";
import {
  ESCOPOS,
  REGIMES,
  adicionarExcecao,
  atualizarRegra,
  criarRegra,
  listarRegras,
  preverEscopo,
  removerExcecao,
  removerRegra,
} from "../../application/obrigacoes/RegrasObrigacaoService.js";
import { empresasVisiveis } from "./empresasVisiveis.js";

export function createObrigacoesRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  // Erro de domínio traz `status`/`code` próprios; o resto vira 500 sem vazar stack.
  function falhar(res, err, contexto) {
    const conhecido = err instanceof ObrigacaoError;
    if (!conhecido) log?.error?.({ err: err?.message || err, ...contexto }, "Falha em obrigações");
    return res.status(conhecido ? err.status : 500).json({
      ok: false,
      error: conhecido ? err.code : "erro_interno",
      message: conhecido ? err.message : "Erro interno.",
    });
  }

  router.get("/obrigacoes", async (req, res) => {
    try {
      const portalIds = await empresasVisiveis(req);
      const companyId = String(req.query?.companyId || "").trim() || null;

      // Conclui na hora o que o sistema já consegue observar, antes de montar a lista. Roda uma
      // escrita num GET de propósito: a alternativa é a tela pedir clique em algo que o banco já
      // sabe que foi feito — exatamente o que faz uma agenda envelhecer e perder a confiança.
      // São duas queries agregadas para todo o conjunto, não uma por ocorrência.
      try {
        await aplicarVerificadores({ portalIds });
      } catch (err) {
        // Falhar aqui não pode derrubar a listagem: sem os verificadores a tela fica desatualizada,
        // sem a lista ela fica vazia.
        log?.warn?.({ err: err?.message || err }, "Verificadores de obrigação falharam; listando assim mesmo");
      }

      const out = await listar({
        portalIds,
        companyId,
        incluirInativas: req.query?.incluirInativas === "1",
      });
      return res.json({
        ok: true,
        ...out,
        // A tela monta os selects a partir daqui, em vez de repetir as listas no front — assim
        // um verificador novo aparece sozinho.
        opcoes: {
          periodicidades: PERIODICIDADES,
          ajustesDiaUtil: AJUSTES_DIA_UTIL,
          verificadores: Object.entries(VERIFICADORES).map(([chave, rotulo]) => ({ chave, rotulo })),
        },
      });
    } catch (err) { return falhar(res, err, {}); }
  });

  router.post("/companies/:companyId/obrigacoes", async (req, res) => {
    const companyId = String(req.params.companyId);
    try {
      const portalIds = await empresasVisiveis(req);
      if (!portalIds.includes(companyId)) {
        return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      }
      const out = await criar({
        portalClientId: companyId,
        dados: req.body || {},
        criadoPorId: req.auth?.user?.id || null,
      });
      // O retorno diz o que aconteceu de fato — quantas ocorrências entraram no calendário —, não
      // um "ok" liso: é o número que a tela mostra no toast.
      return res.status(201).json({ ok: true, obrigacao: out.obrigacao, ocorrenciasCriadas: out.criadas });
    } catch (err) { return falhar(res, err, { companyId }); }
  });

  router.patch("/obrigacoes/:obrigacaoId", async (req, res) => {
    const obrigacaoId = String(req.params.obrigacaoId);
    try {
      const portalIds = await empresasVisiveis(req);
      const out = await atualizar({ portalIds, obrigacaoId, dados: req.body || {} });
      return res.json({
        ok: true,
        obrigacao: out.obrigacao,
        ocorrenciasCriadas: out.criadas,
        ocorrenciasRemovidas: out.removidas,
      });
    } catch (err) { return falhar(res, err, { obrigacaoId }); }
  });

  router.delete("/obrigacoes/:obrigacaoId", async (req, res) => {
    const obrigacaoId = String(req.params.obrigacaoId);
    try {
      const portalIds = await empresasVisiveis(req);
      const removida = await remover({ portalIds, obrigacaoId });
      return res.json({ ok: true, removida });
    } catch (err) { return falhar(res, err, { obrigacaoId }); }
  });

  // ── Ocorrências ────────────────────────────────────────────────────────────────────────────
  router.post("/ocorrencias/:ocorrenciaId/concluir", async (req, res) => {
    const ocorrenciaId = String(req.params.ocorrenciaId);
    try {
      const portalIds = await empresasVisiveis(req);
      const ocorrencia = await concluir({ portalIds, ocorrenciaId, userId: req.auth?.user?.id || null });
      return res.json({ ok: true, ocorrencia });
    } catch (err) { return falhar(res, err, { ocorrenciaId }); }
  });

  router.post("/ocorrencias/:ocorrenciaId/reabrir", async (req, res) => {
    const ocorrenciaId = String(req.params.ocorrenciaId);
    try {
      const portalIds = await empresasVisiveis(req);
      const ocorrencia = await reabrir({ portalIds, ocorrenciaId });
      return res.json({ ok: true, ocorrencia });
    } catch (err) { return falhar(res, err, { ocorrenciaId }); }
  });

  // ── Regras do escritório ───────────────────────────────────────────────────────────────────
  router.get("/regras-obrigacao", async (req, res) => {
    try {
      const portalIds = await empresasVisiveis(req);
      const regras = await listarRegras({ portalIds });
      return res.json({
        ok: true,
        regras,
        opcoes: {
          escopos: ESCOPOS,
          regimes: REGIMES,
          periodicidades: PERIODICIDADES,
          ajustesDiaUtil: AJUSTES_DIA_UTIL,
          verificadores: Object.entries(VERIFICADORES).map(([chave, rotulo]) => ({ chave, rotulo })),
        },
      });
    } catch (err) { return falhar(res, err, {}); }
  });

  // Prévia do passo "Para quem": quantas e quais empresas entram, SEM gravar. O contador não
  // descobre o alcance depois de salvar — o número aparece enquanto ele mexe nos filtros.
  router.post("/regras-obrigacao/previa", async (req, res) => {
    try {
      const portalIds = await empresasVisiveis(req);
      const out = await preverEscopo({
        portalIds,
        escopo: String(req.body?.escopo || "").toUpperCase(),
        filtros: req.body?.filtros || null,
      });
      return res.json({ ok: true, ...out });
    } catch (err) { return falhar(res, err, {}); }
  });

  router.post("/regras-obrigacao", async (req, res) => {
    try {
      const portalIds = await empresasVisiveis(req);
      const out = await criarRegra({
        portalIds,
        dados: req.body || {},
        criadoPorId: req.auth?.user?.id || null,
      });
      return res.status(201).json({ ok: true, ...out });
    } catch (err) { return falhar(res, err, {}); }
  });

  router.patch("/regras-obrigacao/:regraId", async (req, res) => {
    const regraId = String(req.params.regraId);
    try {
      const portalIds = await empresasVisiveis(req);
      const out = await atualizarRegra({ portalIds, regraId, dados: req.body || {} });
      return res.json({ ok: true, ...out });
    } catch (err) { return falhar(res, err, { regraId }); }
  });

  router.delete("/regras-obrigacao/:regraId", async (req, res) => {
    const regraId = String(req.params.regraId);
    // "remover" apaga as obrigações nas empresas; "desvincular" as deixa como avulsas. Não há
    // default silencioso entre os dois: são efeitos opostos, e a UI pergunta antes.
    const modo = String(req.query?.modo || req.body?.modo || "").toLowerCase();
    if (!["remover", "desvincular"].includes(modo)) {
      return res.status(400).json({
        ok: false,
        error: "modo_obrigatorio",
        message: "Diga se as obrigações devem ser removidas das empresas ou apenas desvinculadas.",
      });
    }
    try {
      const out = await removerRegra({ regraId, modo });
      return res.json({ ok: true, ...out });
    } catch (err) { return falhar(res, err, { regraId }); }
  });

  router.post("/regras-obrigacao/:regraId/excecoes", async (req, res) => {
    const regraId = String(req.params.regraId);
    try {
      const portalIds = await empresasVisiveis(req);
      const out = await adicionarExcecao({
        portalIds,
        regraId,
        companyId: String(req.body?.companyId || ""),
        motivo: String(req.body?.motivo || "").trim() || null,
      });
      return res.json({ ok: true, ...out });
    } catch (err) { return falhar(res, err, { regraId }); }
  });

  router.delete("/regras-obrigacao/:regraId/excecoes/:companyId", async (req, res) => {
    const regraId = String(req.params.regraId);
    try {
      const portalIds = await empresasVisiveis(req);
      const out = await removerExcecao({ portalIds, regraId, companyId: String(req.params.companyId) });
      return res.json({ ok: true, ...out });
    } catch (err) { return falhar(res, err, { regraId }); }
  });

  // ── ENTREGA POR ARQUIVO (EFD-Contribuições, ECD, ECF…) ─────────────────────────────────────
  //
  // ⚠ NADA AQUI GERA NEM TRANSMITE ARQUIVO. O leiaute da EFD-Contribuições (Guia Prático, blocos
  // 0/A/C/D/F/M/1/9) não está no projeto, e escrevê-lo por dedução produziria um arquivo que o
  // validador recusa — ou, pior, aceita com dado errado. A validação, a assinatura e a transmissão
  // acontecem no PROGRAMA OFICIAL da Receita (PVA), e é assim mesmo: não existe API para isso.
  //
  // O que estas rotas guardam é o RASTRO. Sem ele, "a EFD de março foi entregue?" só se responde
  // abrindo o programa oficial, empresa por empresa — que é exatamente o trabalho que o app existe
  // para poupar. A obrigação continua rastreável mesmo sem o app gerar coisa alguma.

  router.get("/companies/:companyId/entregas/:tipo", async (req, res) => {
    const companyId = String(req.params.companyId);
    const tipo = String(req.params.tipo).toUpperCase();
    try {
      const portalIds = await empresasVisiveis(req);
      if (!portalIds.includes(companyId)) {
        return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      }
      const entregas = await prisma.entregaObrigacaoArquivo.findMany({
        where: { portalClientId: companyId, tipo },
        orderBy: { competencia: "desc" },
        take: 24,
      });
      return res.json({ ok: true, tipo, entregas });
    } catch (err) { return falhar(res, err, { companyId, tipo }); }
  });

  /**
   * ⚠ GUARDA DE OBRIGATORIEDADE — optante do Simples Nacional NÃO entrega EFD-Contribuições
   * (IN RFB 1.252/2012; Guia Prático v1.35, Cap. I, Seção 3). A tela já não oferece o fluxo, mas a
   * aba aberta antes de a empresa migrar para o Simples ainda pode enviar o PUT, e um registro de
   * "entregue" numa empresa dispensada é pior que nenhum: ele responde a pergunta errada com
   * confiança.
   *
   * ⚠ E A GUARDA SÓ RECUSA COM CERTEZA. Regime ausente ou desconhecido PASSA — `mapRegime` do
   * apuracaoV2 assume Simples por default porque lá o default é inofensivo; aqui ele bloquearia
   * trabalho legítimo de toda empresa sem regime cadastrado. Bloquear por falta de dado é o erro
   * caro nesta direção.
   */
  async function dispensadaPorRegime(portalClientId) {
    const pc = await prisma.portalClient
      .findUnique({ where: { id: portalClientId }, select: { companyId: true } })
      .catch(() => null);
    if (!pc?.companyId) return null;
    const company = await prisma.company
      .findUnique({ where: { id: pc.companyId }, select: { regimeTributario: true, optanteSimples: true } })
      .catch(() => null);
    const raw = String(company?.regimeTributario || "").toUpperCase();
    if (/MEI/.test(raw)) return "microempreendedor individual";
    if (/SIMPLES/.test(raw) || company?.optanteSimples === true) return "optante pelo Simples Nacional";
    return null;
  }

  router.put("/companies/:companyId/entregas/:tipo/:competencia", async (req, res) => {
    const companyId = String(req.params.companyId);
    const tipo = String(req.params.tipo).toUpperCase();
    const competencia = String(req.params.competencia).trim();
    // Aceita "YYYY-MM" (mensais) e "YYYY" (ECD/ECF, que são anuais).
    if (!/^\d{4}(-\d{2})?$/.test(competencia)) {
      return res.status(400).json({ ok: false, error: "competencia_invalida" });
    }
    try {
      const portalIds = await empresasVisiveis(req);
      if (!portalIds.includes(companyId)) {
        return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      }
      // A guarda vale para EFD-Contribuições; ECD e ECF têm outro rol de obrigados e não passam
      // por aqui (a dispensa do Simples é específica desta obrigação).
      if (tipo === "EFD_CONTRIBUICOES") {
        const dispensa = await dispensadaPorRegime(companyId);
        if (dispensa) {
          return res.status(409).json({
            ok: false,
            error: "OBRIGACAO_NAO_DEVIDA",
            message: `Empresa ${dispensa} — a EFD-Contribuições não é devida nos períodos abrangidos pelo regime (IN RFB 1.252/2012).`,
          });
        }
      }

      const body = req.body || {};
      // ⚠ Só os campos enviados são tocados. Anexar o recibo não pode apagar o arquivo, e vice-versa
      // — são dois passos separados, feitos em momentos diferentes.
      const data = {};
      for (const c of ["arquivoFileId", "arquivoNome", "reciboFileId", "reciboNome", "observacao"]) {
        if (body[c] !== undefined) data[c] = body[c] || null;
      }
      if (body.transmitida === true) {
        data.transmitidaEm = new Date();
        data.transmitidaPorId = req.auth?.user?.id || null;
      }
      // Desmarcar é explícito: `transmitida: false` desfaz. Sem isso, um erro de marcação viraria
      // permanente — e a EFD é obrigação que se retifica.
      if (body.transmitida === false) {
        data.transmitidaEm = null;
        data.transmitidaPorId = null;
      }

      const entrega = await prisma.entregaObrigacaoArquivo.upsert({
        where: { portalClientId_tipo_competencia: { portalClientId: companyId, tipo, competencia } },
        create: { portalClientId: companyId, tipo, competencia, ...data },
        update: data,
      });
      return res.json({ ok: true, entrega });
    } catch (err) { return falhar(res, err, { companyId, tipo, competencia }); }
  });

  // ── ESPELHO DA DEFIS ───────────────────────────────────────────────────────────────────────
  //
  // ⚠ NADA AQUI TRANSMITE. A DEFIS é transmitida NO PORTAL do Simples Nacional. Estas rotas
  // guardam a folha de transcrição (para o contador não perder ~40 campos digitados ao fechar a
  // aba) e registram, como MARCA MANUAL, que ele transmitiu. A forma canônica do payload vive em
  // `apps/web/src/features/obrigacoes/defis/lib/defisSpec.js`, com a citação do manual da RFB.
  //
  // O ano vem na URL porque é a chave junto da empresa (unique `portalClientId + anoCalendario`):
  // reabrir a tela continua o MESMO espelho, nunca cria outro.

  /** Ano-calendário válido? Fora de faixa é erro de rota, não dado a gravar. */
  function anoValido(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
  }

  router.get("/companies/:companyId/defis/:ano", async (req, res) => {
    const companyId = String(req.params.companyId);
    const ano = anoValido(req.params.ano);
    if (!ano) return res.status(400).json({ ok: false, error: "ano_invalido" });
    try {
      const portalIds = await empresasVisiveis(req);
      if (!portalIds.includes(companyId)) {
        return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      }
      const espelho = await prisma.defisEspelho.findUnique({
        where: { portalClientId_anoCalendario: { portalClientId: companyId, anoCalendario: ano } },
      });
      // ⚠ Espelho inexistente NÃO é 404: é uma folha em branco, que é o estado normal do primeiro
      // acesso. Devolver erro faria a tela mostrar falha onde não há nada de errado.
      return res.json({ ok: true, espelho: espelho || null, dados: espelho?.dados || null });
    } catch (err) { return falhar(res, err, { companyId, ano }); }
  });

  router.put("/companies/:companyId/defis/:ano", async (req, res) => {
    const companyId = String(req.params.companyId);
    const ano = anoValido(req.params.ano);
    if (!ano) return res.status(400).json({ ok: false, error: "ano_invalido" });
    const dados = req.body?.dados;
    if (!dados || typeof dados !== "object") {
      return res.status(400).json({ ok: false, error: "dados_obrigatorios" });
    }
    try {
      const portalIds = await empresasVisiveis(req);
      if (!portalIds.includes(companyId)) {
        return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      }
      const espelho = await prisma.defisEspelho.upsert({
        where: { portalClientId_anoCalendario: { portalClientId: companyId, anoCalendario: ano } },
        create: { portalClientId: companyId, anoCalendario: ano, dados },
        // ⚠ O update NÃO toca em `transmitidaEm` nem no recibo. Salvar rascunho depois de marcar
        // transmitida não pode apagar o registro da entrega — desfazer a marca é ato próprio.
        update: { dados },
      });
      return res.json({ ok: true, espelho });
    } catch (err) { return falhar(res, err, { companyId, ano }); }
  });

  router.post("/companies/:companyId/defis/:ano/transmitida", async (req, res) => {
    const companyId = String(req.params.companyId);
    const ano = anoValido(req.params.ano);
    if (!ano) return res.status(400).json({ ok: false, error: "ano_invalido" });
    try {
      const portalIds = await empresasVisiveis(req);
      if (!portalIds.includes(companyId)) {
        return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      }
      const existente = await prisma.defisEspelho.findUnique({
        where: { portalClientId_anoCalendario: { portalClientId: companyId, anoCalendario: ano } },
      });
      // ⚠ Marcar transmitida sem espelho salvo seria registrar uma entrega sem o que foi entregue.
      if (!existente) return res.status(409).json({ ok: false, error: "espelho_nao_salvo" });

      const espelho = await prisma.defisEspelho.update({
        where: { id: existente.id },
        data: {
          transmitidaEm: new Date(),
          transmitidaPorId: req.auth?.user?.id || null,
          reciboFileId: req.body?.reciboFileId || existente.reciboFileId || null,
        },
      });
      return res.json({ ok: true, espelho });
    } catch (err) { return falhar(res, err, { companyId, ano }); }
  });

  return router;
}
