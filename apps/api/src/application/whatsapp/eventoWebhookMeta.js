// A LEITURA DO PAYLOAD DO WEBHOOK — pura, e com a procedência de CADA campo.
//
// Regra pura: sem prisma, sem rede, sem express, sem relógio escondido (o `agora` entra por
// parâmetro). Mesma disciplina de `janela24h.js` e `vinculoTelefone.js` — o webhook é a rota mais
// difícil de exercer deste projeto (depende de credencial da Meta que ainda não existe), e é
// justamente por isso que a parte que PODE ser afirmada por teste tem de morar fora da rota.
//
// ⚠ NADA AQUI FOI INVENTADO. Todo nome de campo abaixo carrega a marca de onde veio:
//   [W3] documentação oficial da Meta, componentes do webhook de mensagens (consultado 2026-08-15):
//        https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
//        De lá: `object` = "whatsapp_business_account"; `entry[]` com `id` e `changes[]`; cada
//        change com `value` e `field` ("messages"); dentro de `value`: `messaging_product`,
//        `metadata` (`display_phone_number`, `phone_number_id`), `contacts[]`, `messages[]`,
//        `statuses[]` e `errors[]`. Objeto de mensagem: `from`, `id`, `timestamp`, `type`,
//        `text.body`, `image`/`document`/`audio`/`video` com `id`, `button`, `interactive`.
//        Objeto de status: `id`, `status`, `timestamp`, `recipient_id`, `conversation`, `pricing`,
//        `errors[]`.
//   [W4] exemplos de payload (consultado 2026-08-15):
//        https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
//        De lá, o exemplo completo de mensagem de texto recebida — inclusive
//        `contacts[0].profile.name` + `contacts[0].wa_id`, o `id` no formato `wamid.…` e o
//        `timestamp` como STRING de dígitos ("1749416383"); e a frase de que uma mensagem enviada
//        pode gerar "up to three separate webhooks (one for a status of sent, one for delivered,
//        and one for read)".
//   [E]  **esqueleto do dono** (`src/whatsapp/processarEvento.js`, entregue em 2026-08-14) — de
//        onde saem: o status `failed` no mesmo mapa dos outros três; a UNIDADE do `timestamp`
//        (segundos, via `to_timestamp($3)`); e a lista de lugares onde o texto da mensagem pode
//        estar (`text.body`, `button.text`, `interactive.button_reply.title`, `document.caption`).
//
// ⚠ O QUE A FONTE **NÃO** DIZ, e continua marcado:
//   1. **A unidade do `timestamp`.** A página de exemplos mostra `"1749416383"` e não descreve o
//      campo. Segundos é afirmação do ESQUELETO DO DONO, não da Meta — ver `instanteDoProvedor`,
//      que carrega a marca e um aviso quando o resultado fica implausível.
//   2. **A lista fechada de valores de `status`.** A documentação enumera `sent`/`delivered`/`read`
//      no texto; `failed` aparece no esqueleto do dono e é coerente com "outgoing message errors
//      appear in the statuses array" [W3], mas não foi lido numa lista oficial. Por isso valor de
//      status desconhecido NÃO é adivinhado: sai nomeado em `desconhecidos[]`.
//   3. **A forma do `errors[]` dentro de um status.** Não foi encontrada enumerada; o que se faz
//      aqui é PASSAR o objeto adiante para `errosMeta.traduzirErroMeta`, que já aceita o objeto de
//      erro direto e devolve o código CRU E NOMEADO quando não conhece — nenhuma suposição nova.

/** Os valores de `status` que a documentação enumera. [W3][W4] */
export const STATUS_DOCUMENTADOS = Object.freeze(["sent", "delivered", "read"]);

/**
 * O status de falha. ⚠ **PROCEDÊNCIA: esqueleto do dono [E]**, não uma lista oficial lida por nós.
 * Fica separado dos três de cima de propósito — ele NÃO entra na escada de
 * `EnvioGuiaService.aplicarStatusDoProvedor` (ver `ProcessarEventoWhatsappService`).
 */
export const STATUS_FALHA = "failed";

/** O `field` do change que assinamos no painel da Meta. [W3] */
export const CAMPO_MENSAGENS = "messages";

export const AVISOS_EVENTO = Object.freeze({
  SEM_TIMESTAMP: "o evento não trouxe `timestamp`",
  TIMESTAMP_ILEGIVEL: "o `timestamp` do evento não é uma sequência de dígitos",
  UNIDADE_SUSPEITA:
    "o `timestamp` lido como SEGUNDOS cai fora de qualquer janela plausível — a unidade do campo não "
    + "é descrita pela Meta, e esta leitura vem do esqueleto do dono",
  SEM_REMETENTE: "mensagem sem `from`",
  SEM_IDENTIFICADOR: "evento sem `id` (o wamid)",
  SEM_TIPO: "mensagem sem `type`",
  CAMPO_NAO_ASSINADO: "chegou um `change.field` que não é `messages`",
});

/**
 * ⚠ Faixa de plausibilidade da leitura em segundos. NÃO é validação de payload — é o detector da
 * única suposição desta camada. Lido como segundos, um timestamp em MILISSEGUNDOS cai no ano ~57000;
 * lido como segundos um valor em segundos cai em 2025/2026. O piso é 2016 porque a WhatsApp Business
 * API não existia antes disso; o teto é o `agora` + 1 dia (relógios discordam, mas não em anos).
 *
 * ⚠ O aviso NÃO descarta o instante: quem consome é `janela24h`, que já escolhe o instante MAIS
 * ANTIGO entre o do provedor e o do nosso registro. Um instante absurdamente futuro, portanto, já é
 * neutralizado lá — e é neutralizado para o lado seguro (a janela fecha antes, manda-se template a
 * mais). O aviso existe para que a suposição apareça no log em vez de ficar invisível.
 */
const PISO_PLAUSIVEL_MS = Date.UTC(2016, 0, 1);
const FOLGA_FUTURA_MS = 24 * 60 * 60 * 1000;

/**
 * O `timestamp` do evento → `Date`.
 *
 * ⚠ **A UNIDADE (segundos) É DO ESQUELETO DO DONO [E], NÃO DA META.** `janela24h.js` recusa número
 * cru de propósito ("segundos e milissegundos são indistinguíveis aqui, e a conversão é de quem lê o
 * payload") — este é o "quem lê o payload", e a conversão acontece aqui, num lugar só, marcada.
 *
 * @param {string|number|null|undefined} timestamp
 * @param {Date} [agora] injetável — a regra não lê relógio escondido.
 * @returns {{instante: Date|null, avisos: string[]}}
 */
export function instanteDoProvedor(timestamp, agora = new Date()) {
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return { instante: null, avisos: [AVISOS_EVENTO.SEM_TIMESTAMP] };
  }
  const texto = String(timestamp).trim();
  if (!/^\d+$/.test(texto)) {
    return { instante: null, avisos: [AVISOS_EVENTO.TIMESTAMP_ILEGIVEL] };
  }
  const segundos = Number(texto);
  if (!Number.isFinite(segundos)) {
    return { instante: null, avisos: [AVISOS_EVENTO.TIMESTAMP_ILEGIVEL] };
  }
  const ms = segundos * 1000;
  const instante = new Date(ms);
  if (Number.isNaN(instante.getTime())) {
    return { instante: null, avisos: [AVISOS_EVENTO.TIMESTAMP_ILEGIVEL] };
  }
  const avisos = [];
  if (ms < PISO_PLAUSIVEL_MS || ms > agora.getTime() + FOLGA_FUTURA_MS) {
    avisos.push(AVISOS_EVENTO.UNIDADE_SUSPEITA);
  }
  return { instante, avisos };
}

/**
 * O TEXTO da mensagem, quando existe.
 *
 * `text.body` é documentado [W3]. Os outros três lugares vêm do esqueleto do dono [E] e são
 * tratados como o que são: tentativas nomeadas, não contrato. Nenhum deles inventa campo — quando
 * nada casa, o corpo é `null` e a mensagem é gravada assim mesmo, com o `type` copiado. Uma
 * figurinha, uma localização ou um áudio são mensagens de verdade; sumir com elas porque não têm
 * texto seria perder a mensagem do cliente, que é o que este webhook existe para não fazer.
 */
export function extrairCorpo(mensagem) {
  const texto = mensagem?.text?.body;                            // [W3]
  if (typeof texto === "string") return texto;
  const botao = mensagem?.button?.text;                          // [E]
  if (typeof botao === "string") return botao;
  const interativo = mensagem?.interactive?.button_reply?.title  // [E]
    ?? mensagem?.interactive?.list_reply?.title;                 // [E] — mesma forma do button_reply
  if (typeof interativo === "string") return interativo;
  const legenda = mensagem?.document?.caption                    // [E]
    ?? mensagem?.image?.caption
    ?? mensagem?.video?.caption;
  if (typeof legenda === "string") return legenda;
  return null;
}

/**
 * O ID DA MÍDIA, quando a mensagem tem uma.
 *
 * ⚠ **ID, NUNCA URL** — a URL que a Meta devolve expira, e a coluna se chama `midiaProvedorId` por
 * causa disso (migration `20260814180000`). Baixar o arquivo é outra fase (F6, que exige decisão de
 * storage); sem o id registrado, a mídia fica irrecuperável.
 *
 * Os quatro tipos com `id` são documentados [W3]. O caminho genérico (`mensagem[type].id`) não
 * inventa nome de campo: ele usa o `type` que a própria mensagem declara e só aceita o resultado se
 * ali houver um `id` em texto — é como uma figurinha ou um tipo novo da Meta chega inteiro sem que
 * este arquivo finja conhecer a lista fechada.
 */
export function extrairMidiaProvedorId(mensagem) {
  const documentados = [mensagem?.image, mensagem?.document, mensagem?.audio, mensagem?.video]; // [W3]
  for (const midia of documentados) {
    if (midia && typeof midia.id === "string" && midia.id.trim()) return midia.id.trim();
  }
  const tipo = typeof mensagem?.type === "string" ? mensagem.type : null;
  const objeto = tipo ? mensagem[tipo] : null;
  if (objeto && typeof objeto === "object" && typeof objeto.id === "string" && objeto.id.trim()) {
    return objeto.id.trim();
  }
  return null;
}

/** `contacts[]` → o nome de perfil de quem mandou. [W4] */
function nomeDePerfil(value, de) {
  const contatos = Array.isArray(value?.contacts) ? value.contacts : [];
  const achado = contatos.find((c) => c?.wa_id === de) || null;
  const nome = achado?.profile?.name;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

/**
 * LÊ O PAYLOAD INTEIRO e devolve as duas listas, já separadas.
 *
 * ⚠ **`messages[]` e `statuses[]` SÃO CAMINHOS DIFERENTES, e a separação começa aqui.**
 * `statuses[]` é o eco do que NÓS mandamos (alimenta `envios_guia`); `messages[]` é o que o CLIENTE
 * escreveu (alimenta a conversa). A fronteira foi decidida no commit `7234a383`: a mensagem não tem
 * coluna de status, senão haveria duas respostas para "esta guia foi enviada?".
 *
 * ⚠ Este módulo NÃO decide nada sobre empresa, vínculo ou janela. Ele traduz forma, e só.
 *
 * @param {object} payload  o JSON do corpo, já parseado.
 * @param {Date} [agora]
 */
export function lerEventoWebhook(payload, agora = new Date()) {
  const mensagens = [];
  const statuses = [];
  const camposIgnorados = [];
  const avisos = [];

  const entradas = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entrada of entradas) {
    const mudancas = Array.isArray(entrada?.changes) ? entrada.changes : [];
    for (const mudanca of mudancas) {
      const value = mudanca?.value;
      if (!value || typeof value !== "object") continue;
      if (mudanca?.field && mudanca.field !== CAMPO_MENSAGENS) {
        // ⚠ Não é erro: outros campos podem chegar se alguém assinar mais coisas no painel. Sai
        // NOMEADO para o log — "chegou algo que não sabemos ler" é informação, silêncio não é.
        camposIgnorados.push(String(mudanca.field));
        avisos.push(AVISOS_EVENTO.CAMPO_NAO_ASSINADO);
      }

      for (const st of Array.isArray(value.statuses) ? value.statuses : []) {
        const { instante, avisos: avisosTs } = instanteDoProvedor(st?.timestamp, agora);
        const proprios = [...avisosTs];
        if (!st?.id) proprios.push(AVISOS_EVENTO.SEM_IDENTIFICADOR);
        statuses.push({
          providerMessageId: st?.id ? String(st.id) : null,
          status: typeof st?.status === "string" ? st.status : null,
          destinatario: st?.recipient_id ? String(st.recipient_id) : null,
          ocorridaEmProvedor: instante,
          // Repassado como veio — quem traduz é `errosMeta`, que já sabe recusar o que não conhece.
          erros: Array.isArray(st?.errors) ? st.errors : [],
          avisos: proprios,
        });
      }

      for (const msg of Array.isArray(value.messages) ? value.messages : []) {
        const { instante, avisos: avisosTs } = instanteDoProvedor(msg?.timestamp, agora);
        const proprios = [...avisosTs];
        if (!msg?.from) proprios.push(AVISOS_EVENTO.SEM_REMETENTE);
        if (!msg?.id) proprios.push(AVISOS_EVENTO.SEM_IDENTIFICADOR);
        if (!msg?.type) proprios.push(AVISOS_EVENTO.SEM_TIPO);
        mensagens.push({
          telefone: msg?.from ? String(msg.from) : null,
          providerMessageId: msg?.id ? String(msg.id) : null,
          // ⚠ O `type` é COPIADO como veio, sem de-para para vocabulário nosso (migration
          // `20260814180000`): traduzir sem nunca ter visto um payload real seria inventar o mapa.
          tipo: typeof msg?.type === "string" ? msg.type : null,
          corpo: extrairCorpo(msg),
          midiaProvedorId: extrairMidiaProvedorId(msg),
          ocorridaEmProvedor: instante,
          nomePerfilProvedor: nomeDePerfil(value, msg?.from),
          avisos: proprios,
        });
      }
    }
  }

  return {
    objeto: typeof payload?.object === "string" ? payload.object : null,
    entradas: entradas.length,
    mensagens,
    statuses,
    camposIgnorados,
    avisos,
  };
}
