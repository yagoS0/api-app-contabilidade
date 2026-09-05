// ENVIO DE GUIAS POR WHATSAPP — as rotas do escritório. Mount: `/firm`.
//
// ⚠ ESTE É O LADO DE SAÍDA. O webhook (entrada, eventos de status e mensagens recebidas) é outro
// arquivo e outro roteador — o único público do sistema. Aqui tudo está atrás de
// `requireAuth`/`requireAccountType("FIRM")` (aplicados no roteador pai) e do escopo por empresa.
//
// ── ⚠ MULTI-TENANCY ────────────────────────────────────────────────────────────────────────────
// Individual: `requireFirmCompanyAccess()` sobre a empresa do PATH, e a guia é buscada com
// `portalClientId` no `where` (nunca só pelo id — foi assim que os dois furos da F1 aconteceram).
// Lote: não há empresa no path, então o escopo é `empresasVisiveis(req)` — o mesmo critério do
// calendário e das obrigações — e o que o corpo pedir é INTERSECTADO com ele, nunca somado.
//
// ── ⚠ ATO DE CONSEQUÊNCIA ──────────────────────────────────────────────────────────────────────
// Enviar guia ao cliente é irreversível. O lote exige `conferencia` repetindo os números da prévia
// (`CONFERENCIA_OBRIGATORIA` / `CONFERENCIA_DIVERGENTE`), no mesmo padrão do `totalConferido` da
// baixa de parcela e do estorno.

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { empresasVisiveis } from "./empresasVisiveis.js";
import {
  EnvioGuiaWhatsappError,
  SELECT_GUIA_PARA_ENVIO,
  carregarCanal,
  enviarGuiaPorWhatsapp,
  executarLote,
  preverLote,
} from "../../application/whatsapp/EnvioGuiaWhatsappService.js";
import { avaliarLinha } from "../../application/whatsapp/elegibilidadeEnvioGuia.js";
import { destinatarioWhatsapp } from "../../application/whatsapp/ContatoWhatsappService.js";
import { enviosPorGuia, foiEnviadaComLegado } from "../../application/guides/EnvioGuiaService.js";
import { runGuideEmailWorkerSelected } from "../../workers/guideEmailWorker.js";
import { destinatariosDeEnvio } from "../../application/whatsapp/ContatoWhatsappService.js";

export function createWhatsappGuiasRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  function falhar(res, err, contexto) {
    const conhecido = err instanceof EnvioGuiaWhatsappError;
    if (!conhecido) log?.error?.({ err: err?.message || err, ...contexto }, "Falha no envio de guia por WhatsApp");
    return res.status(conhecido ? err.status : 500).json({
      ok: false,
      error: conhecido ? err.code : "erro_interno",
      message: conhecido ? err.message : "Erro interno.",
      ...(conhecido && err.resumo ? { resumo: err.resumo } : {}),
      ...(conhecido && err.conferencia ? { conferencia: err.conferencia } : {}),
    });
  }

  function somenteAdminOuContador(req, res) {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (["admin", "contador"].includes(appRole)) return true;
    res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
    return false;
  }

  /**
   * O ESTADO DO CANAL — uma pergunta só, respondida antes de a tela oferecer o botão.
   *
   * ⚠ Serve para a interface dizer POR QUE o WhatsApp não está disponível (flag desligada, template
   * ainda não aprovado na Meta) em vez de oferecer um botão que sempre recusa.
   */
  router.get("/guides/whatsapp/canal", async (_req, res) => {
    try {
      return res.json({ ok: true, canal: await carregarCanal() });
    } catch (err) {
      return falhar(res, err, {});
    }
  });

  /**
   * ENVIO INDIVIDUAL — a guia de UMA empresa.
   *
   * ⚠ A recusa é 422 COM MOTIVO NOMEADO, nunca 500 nem "não foi possível". Sem contato, sem opt-in,
   * template não aprovado e integração desligada são consertos diferentes, e a tela precisa dizer
   * qual é. E a guia continua podendo ir por e-mail — a resposta traz `canalSugerido`.
   */
  router.post(
    "/companies/:companyId/guides/:guideId/enviar-whatsapp",
    requireFirmCompanyAccess(),
    async (req, res) => {
      if (!somenteAdminOuContador(req, res)) return undefined;
      const { companyId, guideId } = req.params || {};
      try {
        const guide = await prisma.guide.findFirst({
          // ⚠ `portalClientId` no `where`: escolher a guia só pelo id deixaria a guia de outra
          // empresa dentro do acesso do chamador.
          where: { id: String(guideId), portalClientId: String(companyId) },
          select: SELECT_GUIA_PARA_ENVIO,
        });
        if (!guide) return res.status(404).json({ ok: false, error: "guide_not_found" });

        const canal = await carregarCanal();
        const envios = (await enviosPorGuia([guide.id])).get(guide.id) || [];
        const jaEnviada = foiEnviadaComLegado(envios, guide);
        // ⚠ REENVIAR É PEDIDO EXPLÍCITO (decisão do dono, 05/09/2026): a tela avisa que a guia já foi
        // enviada, e só com o `reenviar` no corpo é que a recusa `GUIA_JA_ENVIADA` deixa de valer.
        // ⚠ O LOTE NÃO TEM ESTA PORTA — lá a recusa continua sendo o primeiro corte, e é o que
        // impede a carteira inteira de sair duas vezes num clique.
        const reenviar = req.body?.reenviar === true;
        const destinatario = await destinatarioWhatsapp(companyId);
        const avaliacao = avaliarLinha({ canal, guide, destinatario, envios, jaEnviada: jaEnviada && !reenviar });

        if (!avaliacao.pode) {
          return res.status(422).json({
            ok: false,
            error: avaliacao.motivo,
            message: avaliacao.mensagem,
            canalSugerido: avaliacao.canalSugerido,
            guideId: guide.id,
          });
        }

        // ⚠ TODOS OS TELEFONES CADASTRADOS, um envio por destinatário (decisão do dono). Sem
        // destinatário com opt-in, cai no contato que a avaliação escolheu — o caminho de antes.
        const { telefones } = await destinatariosDeEnvio(companyId);
        const alvos = telefones.length ? telefones : [avaliacao.contato];
        const resultados = [];
        for (const contato of alvos) {
          // Sequencial de propósito: cada mensagem é uma chamada à Meta, e o espaçamento importa.
          // eslint-disable-next-line no-await-in-loop
          resultados.push(await enviarGuiaPorWhatsapp({ guide, contato, canal, log, reenviar }));
        }
        const enviadas = resultados.filter((r) => r.ok && r.enviada !== false).length;
        const algumOk = resultados.some((r) => r.ok);
        const resultado = { ...resultados[0], destinatarios: resultados.length, enviadas, resultados };
        return res.status(algumOk ? 200 : 422).json({ ...resultado, error: algumOk ? undefined : resultados[0]?.motivo });
      } catch (err) {
        return falhar(res, err, { companyId, guideId });
      }
    },
  );

  /**
   * A PRÉVIA DO LOTE — a tabela que o contador confere. NÃO ENVIA NADA.
   *
   * Body: `{ competencia, portalClientIds?, guideIds? }`.
   */
  router.post("/guides/whatsapp/lote/previa", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    try {
      const escopo = await escopoDoLote(req);
      const previa = await preverLote({
        portalClientIds: escopo,
        competencia: req.body?.competencia,
        guideIds: Array.isArray(req.body?.guideIds) ? req.body.guideIds : null,
      });
      return res.json({ ok: true, ...previa });
    } catch (err) {
      return falhar(res, err, { competencia: req.body?.competencia });
    }
  });

  /**
   * O LOTE. Body: `{ competencia, portalClientIds?, guideIds?, conferencia: { total, porWhatsapp,
   * porEmail }, enviarPorEmail? }`.
   *
   * ⚠ AS QUE NÃO PUDERAM IR POR WHATSAPP VÃO POR E-MAIL, pelo caminho de e-mail que já existe
   * (`runGuideEmailWorkerSelected`) — a mesma função que o "liberar ao cliente" usa. Elas não somem
   * do lote e não viram uma segunda implementação de envio de e-mail aqui dentro.
   * `enviarPorEmail: false` desliga essa parte (o contador quis só o canal novo).
   */
  router.post("/guides/whatsapp/lote", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    try {
      const escopo = await escopoDoLote(req);
      const resultado = await executarLote({
        portalClientIds: escopo,
        competencia: req.body?.competencia,
        guideIds: Array.isArray(req.body?.guideIds) ? req.body.guideIds : null,
        conferencia: req.body?.conferencia || null,
        log,
      });

      let email = { ...resultado.email, executado: false };
      if (req.body?.enviarPorEmail !== false && resultado.email.guideIds.length) {
        const r = await runGuideEmailWorkerSelected({ guideIds: resultado.email.guideIds });
        email = {
          ...resultado.email,
          executado: !r?.skipped,
          // `skipped` = o lock global do envio de e-mail está preso. Não há fila que retome: dizer
          // que "ficará em fila" é a promessa falsa que `guideEmailCopy` documenta.
          motivo: r?.skipped ? r.reason : null,
          enviadas: Number(r?.sent || 0),
          erros: Number(r?.errors || 0),
          resultados: r?.results || [],
        };
      }

      return res.json({ ok: true, ...resultado, email });
    } catch (err) {
      return falhar(res, err, { competencia: req.body?.competencia });
    }
  });

  /**
   * ⚠ O ESCOPO É INTERSEÇÃO, NUNCA UNIÃO. O corpo pode PEDIR empresas; quem decide quais existem
   * para este usuário é `empresasVisiveis`. Pedir uma empresa fora do escopo simplesmente não a
   * traz — e pedir nenhuma significa "a carteira que eu enxergo".
   */
  async function escopoDoLote(req) {
    const visiveis = await empresasVisiveis(req);
    const pedidas = Array.isArray(req.body?.portalClientIds)
      ? req.body.portalClientIds.map((v) => String(v || "").trim()).filter(Boolean)
      : [];
    if (!pedidas.length) return visiveis;
    const permitidas = new Set(visiveis);
    return pedidas.filter((id) => permitidas.has(id));
  }

  return router;
}
