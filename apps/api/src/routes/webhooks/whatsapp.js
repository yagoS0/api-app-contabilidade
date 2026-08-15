// ⚠⚠ A ÚNICA ROTA PÚBLICA DO SISTEMA. Leia isto antes de mexer.
//
// Todo o resto do projeto autentica no ROUTER (`ensureAuthorized` em `firm/index.js`,
// `client/index.js`, `admin.js`…). Aqui não há usuário: quem chama é a Meta. O que faz o papel da
// autenticação é a **assinatura HMAC do corpo** com o `WHATSAPP_APP_SECRET`. As consequências disso
// estão tratadas uma a uma, e nenhuma delas pode ser "afrouxada por conveniência":
//
//   · **sem `WHATSAPP_APP_SECRET` → 503, NUNCA "aceita tudo"** (o erro clássico é `if (!secret)
//     next()`). Nada é processado e o log diz o que falta.
//   · **assinatura conferida em tempo constante** (`assinaturaWebhook.js`).
//   · **corpo que não casa não é processado** — nem parseado, nem logado.
//   · **`WHATSAPP_VERIFY_TOKEN` vazio → 503 no handshake**: com ele vazio, uma chamada sem token
//     seria "igual" ao esperado e qualquer app registraria este endereço.
//
// ── ⚠⚠ O CORPO RAW — POR QUE ESTE ROUTER É MONTADO ANTES DE TUDO ────────────────────────────────
// `server.js` faz `app.use(express.json())` na linha 37, **antes de todos os routers**. Um webhook
// montado depois dele receberia `req.body` já como OBJETO, e o HMAC seria calculado sobre um
// `JSON.stringify` nosso — que não é o mesmo texto que a Meta assinou. A assinatura **nunca**
// conferiria, e o sintoma (403 em tudo) não parece com a causa.
// Pior ainda: a Meta "generate[s] the signature using an *escaped unicode* version of the payload,
// with lowercase hex digits" e avisa que "If you just calculate against the decoded bytes, you will
// end up with a different signature" (Webhooks — Validating Payloads, consultado 2026-08-15). Ou
// seja, o único texto que confere é **o que chegou**, byte a byte.
// Por isso o `express.raw` está DENTRO deste router (não no `server.js`): quem montar a rota não
// tem como esquecê-lo.
//
// ── RESPONDER RÁPIDO, PROCESSAR DEPOIS — E O QUE ISSO CUSTA ─────────────────────────────────────
// "Your endpoint should respond to all Event Notifications with `200 OK HTTPS`" e, não respondendo,
// "we will retry immediately, then try a few more times with decreasing frequency over the next 36
// hours" (Webhooks, Getting Started); na página do WhatsApp, "for up to 7 days" e "These retries can
// result in duplicate webhook notifications" (Set up Webhooks). Ambas consultadas em 2026-08-15.
// Daí o desenho: **200 primeiro, processamento em `setImmediate`**.
// ⚠ E o preço, declarado: entre o 200 e o processamento há uma janela em que uma queda do processo
// perde o evento — a Meta já considerou entregue. Mitigações reais, não promessas: cada item tem o
// seu `try/catch`, toda falha sai em log `error` com o `wamid` (que é o que permite reprocessar), e
// nada aqui responde erro por evento duplicado — responder erro faria a Meta reentregar
// indefinidamente. Fila durável (BullMQ/Redis, sugerida pelo esqueleto do dono) exigiria dependência
// nova e infraestrutura que este projeto não tem.

import { Router } from "express";
import express from "express";
import {
  INTEGRACAO_WHATSAPP,
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
  log as logPadrao,
} from "../../config.js";
import {
  ASSINATURA,
  CABECALHO_ASSINATURA,
  HANDSHAKE,
  conferirAssinatura,
  conferirHandshake,
} from "../../application/whatsapp/assinaturaWebhook.js";
import { processarEventoWhatsapp } from "../../application/whatsapp/ProcessarEventoWhatsappService.js";

/** Onde ele é montado. Um lugar só — é este endereço que vai no painel da Meta. */
export const CAMINHO_WEBHOOK_WHATSAPP = "/webhooks/whatsapp";

/**
 * Teto do corpo. Payload de webhook é pequeno; o teto existe para que um corpo enorme não vire
 * trabalho de HMAC. ⚠ Estourá-lo devolve 413 e a Meta reentrega — é o comportamento certo: melhor
 * reentregar do que aceitar em silêncio o que não coube.
 */
const LIMITE_CORPO = "1mb";

/**
 * @param {object} [opcoes] tudo injetável — é o que torna a rota exercível sem credencial nenhuma.
 * @param {boolean} [opcoes.habilitada] default: `INTEGRACAO_WHATSAPP`
 * @param {string}  [opcoes.appSecret]  default: `WHATSAPP_APP_SECRET`
 * @param {string}  [opcoes.verifyToken] default: `WHATSAPP_VERIFY_TOKEN`
 * @param {Function} [opcoes.processar] default: `processarEventoWhatsapp`
 */
export function createWhatsappWebhookRouter(opcoes = {}) {
  const habilitada = opcoes.habilitada ?? INTEGRACAO_WHATSAPP;
  const appSecret = opcoes.appSecret ?? WHATSAPP_APP_SECRET;
  const verifyToken = opcoes.verifyToken ?? WHATSAPP_VERIFY_TOKEN;
  const log = opcoes.log ?? logPadrao;
  const processar = opcoes.processar ?? processarEventoWhatsapp;

  const router = Router();

  // ⚠ O parser RAW mora aqui dentro (ver o cabeçalho). `type: () => true` aceita qualquer
  // Content-Type de propósito: a assinatura é sobre os BYTES, e recusar por cabeçalho declarado
  // transformaria uma mudança de Content-Type da Meta num 403 sem explicação.
  router.use(express.raw({ type: () => true, limit: LIMITE_CORPO }));

  /**
   * A integração nasce OFF (`INTEGRACAO_WHATSAPP`). ⚠ Desligado responde de forma **declarada** —
   * 503 com nome próprio —, não com 404 nem com erro genérico: quem estiver configurando o painel da
   * Meta precisa distinguir "endereço errado" de "está aqui, e está desligado".
   */
  const recusarSeDesligada = (res) => {
    if (habilitada) return false;
    res.status(503).json({
      error: "whatsapp_webhook_desligado",
      reason:
        "A integração com o WhatsApp está desligada neste ambiente (INTEGRACAO_WHATSAPP). "
        + "O webhook existe e está montado, mas não processa eventos enquanto ela não for habilitada.",
    });
    return true;
  };

  // ── GET: o handshake do botão "Verificar e salvar" do painel da Meta ────────────────────────────
  router.get("/", (req, res) => {
    if (recusarSeDesligada(res)) return;

    const r = conferirHandshake({
      modo: req.query["hub.mode"],
      token: req.query["hub.verify_token"],
      challenge: req.query["hub.challenge"],
      verifyToken,
    });

    if (r.ok) {
      log?.info?.({}, "WhatsApp: handshake de verificação do webhook aceito");
      // ⚠ `text/plain` explícito: o valor é ECO de entrada, e servi-lo como HTML deixaria o navegador
      // interpretar o que ele contiver. A Meta espera o challenge cru.
      return res.status(200).type("text/plain").send(r.challenge);
    }

    if (r.resultado === HANDSHAKE.SEM_VERIFY_TOKEN) {
      log?.error?.({ resultado: r.resultado }, "WhatsApp: handshake recusado por falta de configuração");
      return res.status(503).json({ error: "whatsapp_webhook_sem_verify_token", reason: r.motivo });
    }
    log?.warn?.({ resultado: r.resultado }, "WhatsApp: handshake de verificação recusado");
    return res.status(403).json({ error: "whatsapp_webhook_verificacao_recusada", reason: r.motivo });
  });

  // ── POST: os eventos ───────────────────────────────────────────────────────────────────────────
  router.post("/", (req, res) => {
    if (recusarSeDesligada(res)) return;

    const assinatura = conferirAssinatura({
      corpoRaw: req.body,
      cabecalho: req.get(CABECALHO_ASSINATURA),
      appSecret,
    });

    if (!assinatura.ok) {
      // ⚠ Duas famílias, dois status, e a diferença importa para quem investiga:
      //   · defeito NOSSO (segredo ausente, corpo não-bruto) → 503, log `error`. A Meta reentrega, e
      //     é isso que se quer: o evento não se perde por causa da nossa configuração.
      //   · recusa de ORIGEM (sem header, formato torto, não confere) → 403, log `warn`.
      const defeitoNosso =
        assinatura.resultado === ASSINATURA.SEM_APP_SECRET
        || assinatura.resultado === ASSINATURA.CORPO_AUSENTE;

      if (defeitoNosso) {
        log?.error?.(
          { resultado: assinatura.resultado },
          "WhatsApp: webhook não pôde conferir a assinatura — nada foi processado",
        );
        return res.status(503).json({
          error: "whatsapp_webhook_nao_configurado",
          reason: assinatura.motivo,
        });
      }
      log?.warn?.({ resultado: assinatura.resultado }, "WhatsApp: webhook recusou uma chamada");
      return res.status(403).json({ error: "whatsapp_webhook_assinatura_invalida" });
    }

    // ⚠ Só depois de a assinatura conferir é que o corpo vira JSON. Corpo de origem não confirmada
    // não é parseado nem registrado.
    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      // ⚠ Assinatura VÁLIDA e corpo ilegível: é da Meta e não dá para ler. Responder 200 aqui
      // faria o evento sumir para sempre (a Meta o daria por entregue). 400 + log `error` deixa a
      // reentrega acontecer e a anomalia aparecer.
      log?.error?.({ err: e?.message || String(e) }, "WhatsApp: corpo assinado não é JSON — não processado");
      return res.status(400).json({ error: "whatsapp_webhook_corpo_invalido" });
    }

    // 200 PRIMEIRO. Tudo o que vem depois é assunto nosso — ver o cabeçalho.
    res.sendStatus(200);

    setImmediate(() => {
      // `processarEventoWhatsapp` não lança por contrato; o `.catch` existe para o caso de o
      // contrato ser quebrado no futuro — sem ele, viraria `unhandledRejection` e derrubaria o
      // processo depois de a resposta já ter saído.
      Promise.resolve()
        .then(() => processar(payload, { logger: log }))
        .then((resumo) => {
          if (!resumo) return;
          log?.info?.(
            { mensagens: resumo.mensagens, statuses: resumo.statuses, erros: resumo.erros?.length || 0 },
            "WhatsApp: evento do webhook processado",
          );
        })
        .catch((e) => {
          log?.error?.(
            { err: e?.message || String(e) },
            "WhatsApp: processamento do evento do webhook falhou por inteiro",
          );
        });
    });
  });

  return router;
}
