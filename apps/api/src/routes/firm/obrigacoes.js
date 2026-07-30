// Controle de Obrigações.
// Mount: /firm/obrigacoes e /firm/ocorrencias
//
// A listagem NÃO exige empresa: no portal do escritório o contador sempre tem várias, e a pergunta
// que a tela responde é "o que EU preciso entregar", em toda a carteira. O filtro por empresa é
// opcional — mesma decisão já tomada no calendário.

import { Router } from "express";
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

  return router;
}
