// O QUE SE FAZ COM O EVENTO DEPOIS DE ELE SER ACEITO — a ligação, não a regra.
//
// A regra pura vive em `eventoWebhookMeta.js` (a leitura do payload) e em `assinaturaWebhook.js`
// (a porta). Aqui é a costura com o que JÁ EXISTE no projeto, e a lista é curta de propósito:
//
//   `messages[]` → `ConversaWhatsappService.registrarMensagemRecebida`
//                  (que por dentro pergunta a `resolverVinculoPorTelefone` de quem é a mensagem)
//   `statuses[]` → `EnvioGuiaService.aplicarStatusDoProvedor`  (sent/delivered/read)
//                  `EnvioGuiaService.aplicarFalhaDoProvedor`   (failed)
//
// ⚠ **NÃO SE MISTURAM OS DOIS CAMINHOS.** `statuses[]` é o eco do que NÓS mandamos e alimenta
// `envios_guia`; `messages[]` é o que o CLIENTE escreveu e alimenta a conversa. A mensagem não tem
// coluna de status — a fronteira foi decidida no commit `7234a383`, e juntá-las daria duas
// respostas para "esta guia foi enviada?".
//
// ── ⚠ IDEMPOTÊNCIA: A GARANTIA É DO BANCO, E ESTE ARQUIVO NÃO ACRESCENTA UMA SEGUNDA ────────────
// A Meta reentrega: "we will retry immediately, then try a few more times with decreasing frequency
// over the next 36 hours" (Webhooks, Getting Started, consultado 2026-08-15) e, na página do
// WhatsApp, "Meta retries delivery with decreasing frequency until the request succeeds, for up to
// 7 days" + "These retries can result in duplicate webhook notifications" (Set up Webhooks,
// consultado 2026-08-15). Quem impede a segunda entrega de virar uma segunda mensagem é
// `UNIQUE(providerMessageId)` mais o CHECK `direcao <> 'in' OR providerMessageId IS NOT NULL` da
// migration `20260814180000`. Do FLUXO é só LER o conflito como "já processado" — e isso
// `registrarMensagemRecebida` já faz, devolvendo `duplicada: true`. Nenhum cache em memória aqui:
// ele seria uma segunda garantia, mais fraca (morre no deploy, não vale entre instâncias) e capaz de
// discordar da primeira.
//
// ── ⚠ NADA É ENGOLIDO ───────────────────────────────────────────────────────────────────────────
// Cada item é processado dentro do SEU try/catch: um evento malformado no meio do lote não pode
// levar junto a mensagem do cliente que veio depois dele. Toda falha entra em `erros[]` do resumo
// **e** sai no log em nível `error`, com o `wamid` — que é o que permite reprocessar depois. O
// resumo é devolvido para que a rota (ou um script de reprocesso) possa registrá-lo.
//
// ── ⚠ LGPD ──────────────────────────────────────────────────────────────────────────────────────
// **O corpo da mensagem NUNCA vai para o log.** Telefone sai mascarado, pelo mesmo critério que o
// `WhatsappCloudClient` já adota (`mascararTelefone`, `+55…8888`). O que se registra é o wamid, o
// tipo e o desfecho — o suficiente para investigar sem transcrever a conversa do cliente no log da
// aplicação.

import { log as logPadrao } from "../../config.js";
import { registrarMensagemRecebida } from "./ConversaWhatsappService.js";
import { aplicarStatusDoProvedor, aplicarFalhaDoProvedor } from "../guides/EnvioGuiaService.js";
import { traduzirErroMeta } from "./errosMeta.js";
import { mascararTelefone } from "./WhatsappCloudClient.js";
import { lerEventoWebhook, STATUS_DOCUMENTADOS, STATUS_FALHA } from "./eventoWebhookMeta.js";

/** Por que um item do evento não virou nada. Nomes, nunca silêncio. */
export const DESFECHOS = Object.freeze({
  GRAVADA: "GRAVADA",
  /** Já estava gravada — reentrega da Meta. É sucesso, não erro. */
  DUPLICADA: "DUPLICADA",
  /** O evento não trouxe o que o banco exige (wamid, tipo ou remetente reconhecível). */
  RECUSADA: "RECUSADA",
  /** O status foi aplicado ao envio da guia. */
  APLICADO: "APLICADO",
  /**
   * Não há envio de guia com esse `wamid`. ⚠ CASO NORMAL, não erro: o status pode ser de uma
   * mensagem de conversa (texto livre), que não é envio de guia nenhum.
   */
  SEM_ENVIO_DE_GUIA: "SEM_ENVIO_DE_GUIA",
  /** `failed` chegou depois de `entregue`/`lido` — contradição, e a entrega comprovada fica. */
  CHEGADA_JA_CONFIRMADA: "CHEGADA_JA_CONFIRMADA",
  /** Valor de `status` fora dos que conhecemos. Não se adivinha o que ele significa. */
  STATUS_DESCONHECIDO: "STATUS_DESCONHECIDO",
  /** Estourou no meio. Vai para `erros[]` e para o log em nível `error`. */
  ERRO: "ERRO",
});

/**
 * A falha de um `statuses[].status === "failed"`, traduzida.
 *
 * ⚠ O objeto de erro do webhook é PASSADO como veio para `traduzirErroMeta`, que já aceita o objeto
 * `error` direto e devolve **código cru e nomeado** (`META_131099`) quando não conhece a linha.
 * Nenhuma suposição nova sobre a forma do `errors[]` do status — que, essa sim, não foi encontrada
 * enumerada na documentação (ver `eventoWebhookMeta.js`).
 */
function traduzirFalhaDeStatus(erros) {
  const primeiro = Array.isArray(erros) && erros.length ? erros[0] : null;
  // Sem `httpStatus`: o webhook não é uma resposta HTTP nossa, e inventar um status faria a
  // tradução afirmar algo que não aconteceu.
  return traduzirErroMeta(primeiro, {});
}

async function processarStatus(item, { logger }) {
  const { providerMessageId, status } = item;
  if (!providerMessageId || !status) {
    return { desfecho: DESFECHOS.RECUSADA, motivo: "status sem `id` ou sem `status`" };
  }

  if (STATUS_DOCUMENTADOS.includes(status)) {
    const envio = await aplicarStatusDoProvedor({ providerMessageId, status });
    return { desfecho: envio ? DESFECHOS.APLICADO : DESFECHOS.SEM_ENVIO_DE_GUIA, motivo: null };
  }

  if (status === STATUS_FALHA) {
    const traducao = traduzirFalhaDeStatus(item.erros);
    const r = await aplicarFalhaDoProvedor({
      providerMessageId,
      codigo: traducao.codigo,
      mensagemUsuario: traducao.mensagemUsuario,
    });
    if (!r) return { desfecho: DESFECHOS.SEM_ENVIO_DE_GUIA, motivo: null, codigo: traducao.codigo };
    if (!r.aplicada) {
      // ⚠ Sobe em `warn` porque é contradição de fato: a Meta confirmou a chegada e depois disse que
      // falhou. Não se apaga a entrega comprovada; registra-se a discordância.
      logger?.warn?.(
        { providerMessageId, codigo: traducao.codigo, motivo: r.motivo },
        "WhatsApp: falha reportada depois de entrega/leitura já confirmada — estado preservado",
      );
      return { desfecho: DESFECHOS.CHEGADA_JA_CONFIRMADA, motivo: r.motivo, codigo: traducao.codigo };
    }
    logger?.warn?.(
      { providerMessageId, codigo: traducao.codigo, retentativa: traducao.retentativa },
      "WhatsApp: envio de guia falhou segundo o provedor",
    );
    return { desfecho: DESFECHOS.APLICADO, motivo: null, codigo: traducao.codigo };
  }

  // ⚠ Valor fora da lista: NUNCA adivinhado. `aplicarStatusDoProvedor` mapeia tudo que não é
  // `read`/`delivered` para `enviado` — passar-lhe um valor novo (ou `failed`) promoveria a
  // mensagem em vez de registrar o que aconteceu.
  logger?.warn?.({ providerMessageId, status }, "WhatsApp: valor de status não reconhecido — ignorado");
  return { desfecho: DESFECHOS.STATUS_DESCONHECIDO, motivo: `status "${status}"` };
}

async function processarMensagem(item, { logger }) {
  const r = await registrarMensagemRecebida({
    telefone: item.telefone,
    providerMessageId: item.providerMessageId,
    tipo: item.tipo,
    corpo: item.corpo,
    midiaProvedorId: item.midiaProvedorId,
    // ⚠ Já convertido para `Date` em `eventoWebhookMeta.instanteDoProvedor` — `janela24h` recusa
    // número cru de propósito, e a conversão (segundos, [E] esqueleto do dono) mora num lugar só.
    ocorridaEmProvedor: item.ocorridaEmProvedor,
    nomePerfilProvedor: item.nomePerfilProvedor,
  });

  // ⚠ **`DESCONHECIDO` E `AMBIGUO` NÃO SOMEM, E TAMBÉM NÃO ESCOLHEM EMPRESA.** Quem decide isso é
  // `registrarMensagemRecebida`, que grava no fio NÃO ATRIBUÍDO (`portalClientId` nulo = a fila de
  // não-vinculados). Este arquivo não contorna: ele só REGISTRA a situação no log, para que o
  // contador saiba que há mensagem esperando cadastro.
  const situacao = r?.vinculo?.situacao || null;
  logger?.info?.(
    {
      providerMessageId: item.providerMessageId,
      tipo: item.tipo,
      de: mascararTelefone(item.telefone),
      vinculo: situacao,
      duplicada: Boolean(r?.duplicada),
      // ⚠ "este cadastro está no formato antigo — conserte o CADASTRO". O vínculo NÃO casa por
      // aí (decisão do dono, 14/08/2026); o sinal existe para o contador ver, não para afrouxar.
      divergemPeloNonoDigito: Boolean(r?.vinculo?.divergemPeloNonoDigito),
    },
    // ⚠ O CORPO DA MENSAGEM NÃO ENTRA AQUI (LGPD).
    "WhatsApp: mensagem recebida registrada",
  );
  return { desfecho: r?.duplicada ? DESFECHOS.DUPLICADA : DESFECHOS.GRAVADA, motivo: null, vinculo: situacao };
}

/**
 * PROCESSA UM EVENTO DO WEBHOOK. Chamada depois de a assinatura conferir e de o 200 já ter saído.
 *
 * ⚠ **NÃO LANÇA.** Ela é chamada de dentro de um `setImmediate`, depois da resposta — uma exceção
 * ali não teria quem a pegasse e derrubaria o processo (`unhandledRejection`). Tudo o que der errado
 * vira linha em `erros[]` e log em nível `error`. É por isso que ela devolve um resumo em vez de
 * "ok".
 *
 * @param {object} payload  o JSON já parseado.
 * @param {object} [opcoes]
 * @param {Date}   [opcoes.agora]   injetável (a leitura do timestamp não lê relógio escondido)
 * @param {object} [opcoes.logger]
 */
export async function processarEventoWhatsapp(payload, { agora = new Date(), logger = logPadrao } = {}) {
  const resumo = {
    mensagens: { total: 0, gravadas: 0, duplicadas: 0, recusadas: 0 },
    statuses: { total: 0, aplicados: 0, semEnvio: 0, desconhecidos: 0, contradicoes: 0, recusados: 0 },
    erros: [],
    avisos: [],
  };

  let leitura;
  try {
    leitura = lerEventoWebhook(payload, agora);
  } catch (e) {
    // Leitura é pura e não deveria estourar; se estourar, é defeito NOSSO e tem de aparecer.
    logger?.error?.({ err: e?.message || String(e) }, "WhatsApp: falha ao ler o payload do webhook");
    resumo.erros.push({ onde: "leitura", erro: e?.message || String(e) });
    return resumo;
  }

  resumo.avisos = leitura.avisos;
  if (leitura.camposIgnorados.length) {
    logger?.warn?.(
      { campos: leitura.camposIgnorados },
      "WhatsApp: chegou evento de um campo que este webhook não trata",
    );
  }

  // Os status vêm primeiro por serem o caminho barato e sem vínculo; a ordem entre as duas listas
  // não tem efeito colateral (são tabelas diferentes, chaves diferentes).
  resumo.statuses.total = leitura.statuses.length;
  for (const item of leitura.statuses) {
    try {
      const r = await processarStatus(item, { logger });
      if (r.desfecho === DESFECHOS.APLICADO) resumo.statuses.aplicados += 1;
      else if (r.desfecho === DESFECHOS.SEM_ENVIO_DE_GUIA) resumo.statuses.semEnvio += 1;
      else if (r.desfecho === DESFECHOS.STATUS_DESCONHECIDO) resumo.statuses.desconhecidos += 1;
      else if (r.desfecho === DESFECHOS.CHEGADA_JA_CONFIRMADA) resumo.statuses.contradicoes += 1;
      else if (r.desfecho === DESFECHOS.RECUSADA) resumo.statuses.recusados += 1;
    } catch (e) {
      resumo.statuses.recusados += 1;
      resumo.erros.push({
        onde: "status",
        providerMessageId: item.providerMessageId,
        erro: e?.message || String(e),
      });
      logger?.error?.(
        { providerMessageId: item.providerMessageId, status: item.status, err: e?.message || String(e) },
        "WhatsApp: falha ao aplicar status do provedor",
      );
    }
  }

  resumo.mensagens.total = leitura.mensagens.length;
  for (const item of leitura.mensagens) {
    try {
      const r = await processarMensagem(item, { logger });
      if (r.desfecho === DESFECHOS.DUPLICADA) resumo.mensagens.duplicadas += 1;
      else resumo.mensagens.gravadas += 1;
    } catch (e) {
      resumo.mensagens.recusadas += 1;
      resumo.erros.push({
        onde: "mensagem",
        providerMessageId: item.providerMessageId,
        // `code` nomeado quando vem de `ConversaWhatsappError`; a mensagem nunca traz o corpo.
        codigo: e?.code || null,
        erro: e?.message || String(e),
      });
      // ⚠ NÍVEL `error`, SEMPRE. Uma mensagem de cliente que não foi gravada é o pior desfecho
      // possível deste webhook: o 200 já saiu, a Meta não vai reentregar, e sem esta linha no log
      // ninguém saberia que ela existiu. O `wamid` é o que permite reprocessar.
      logger?.error?.(
        {
          providerMessageId: item.providerMessageId,
          tipo: item.tipo,
          de: mascararTelefone(item.telefone),
          codigo: e?.code || null,
          err: e?.message || String(e),
        },
        "WhatsApp: MENSAGEM RECEBIDA NÃO FOI GRAVADA",
      );
    }
  }

  return resumo;
}
