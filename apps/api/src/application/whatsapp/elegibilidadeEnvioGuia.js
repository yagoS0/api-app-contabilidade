// POSSO MANDAR ESTA GUIA POR WHATSAPP? — a regra, PURA.
//
// Sem prisma, sem rede, sem relógio escondido. Recebe os FATOS já carregados (a flag, o template, o
// destinatário, os envios da guia) e devolve a resposta NOMEADA. Mesma disciplina de
// `janela24h.js`, `vinculoTelefone.js`, `obrigatoriedadeEfd.js` — para que a prévia do lote, o
// envio individual e o teste respondam exatamente a mesma coisa.
//
// ── ⚠ O PRINCÍPIO QUE DESENHA ESTE ARQUIVO: NADA SOME EM SILÊNCIO ───────────────────────────────
// Toda recusa devolve `motivo` + `mensagem` + `canalSugerido`. A empresa que não pode receber por
// WhatsApp **continua no lote**, com o aviso, e cai para e-mail (plano, P0.1: *"empresas sem contato
// WhatsApp cadastrado ou sem opt-in aparecem com aviso âmbar e caem para e-mail — nunca somem
// silenciosamente"*). Uma recusa que apenas remove a linha faria o contador entregar 19 guias
// achando que entregou 23.
//
// ── ⚠ POR QUE SÃO DUAS FUNÇÕES, E NÃO UMA ──────────────────────────────────────────────────────
// `avaliarCanal` responde uma vez por LOTE (a flag e o template valem para todo mundo);
// `avaliarLinha` responde por GUIA. Colapsá-las faria o painel repetir 23 vezes "a integração está
// desligada" e esconder, atrás dessa repetição, quais empresas estão sem opt-in — que é a
// informação acionável. O motivo global aparece uma vez, em cima; o local, por linha.
//
// ── ⚠ A JANELA DE 24H NÃO ENTRA AQUI, E ISSO É DECISÃO ─────────────────────────────────────────
// `janela24h.js` decide **texto livre × template**. O envio de guia é SEMPRE template (é o header
// de documento que carrega o PDF), e template é permitido nos dois estados da janela — dentro dela
// e fora dela (`PERMISSOES.SOMENTE_TEMPLATE` é o pior caso, e ele ainda permite template). Chamar a
// janela aqui só poderia produzir uma recusa que a Meta não faria.

import { STATUS_TERMINAL } from "../guides/EnvioGuiaService.js";

/** Vocabulário das recusas. Nome próprio para cada uma — "não deu" não é resposta. */
export const MOTIVOS = Object.freeze({
  // ── globais (uma vez por lote) ──
  INTEGRACAO_DESLIGADA: "INTEGRACAO_DESLIGADA",
  TEMPLATE_NAO_CADASTRADO: "TEMPLATE_NAO_CADASTRADO",
  TEMPLATE_NAO_APROVADO: "TEMPLATE_NAO_APROVADO",
  TEMPLATE_SEM_DOCUMENTO: "TEMPLATE_SEM_DOCUMENTO",
  TEMPLATE_SEM_NOME_META: "TEMPLATE_SEM_NOME_META",
  // ── por guia ──
  CANAL_INDISPONIVEL: "CANAL_INDISPONIVEL",
  GUIA_NAO_PROCESSADA: "GUIA_NAO_PROCESSADA",
  GUIA_JA_ENVIADA: "GUIA_JA_ENVIADA",
  SEM_CONTATO: "SEM_CONTATO",
  SEM_OPT_IN: "SEM_OPT_IN",
});

export const CANAIS = Object.freeze({ WHATSAPP: "WHATSAPP", EMAIL: "EMAIL" });

/** O único estado de aprovação que autoriza o uso do template. Espelha o CHECK do banco. */
export const APROVADO = "APROVADO";

/**
 * O CANAL ESTÁ UTILIZÁVEL? Uma resposta por lote.
 *
 * ⚠ A FLAG DESLIGADA É RECUSA **DECLARADA**, NÃO ERRO GENÉRICO. `INTEGRACAO_WHATSAPP` nasce OFF e
 * nada sai em ambiente nenhum enquanto ela estiver assim. O contador tem de ler *por que* nada
 * aconteceu — "erro ao enviar" mandaria ele investigar o número do cliente.
 *
 * ⚠ **TEMPLATE NÃO APROVADO É O ESTADO REAL DE HOJE, E RECUSAR É O CERTO.**
 * `TemplateWhatsapp.statusAprovacao` nasce `DECLARADO` e **nenhum template foi submetido à Meta** —
 * o cadastro está parado à espera do número. `DECLARADO` significa "consta do nosso plano e nunca
 * foi conferido na Meta". Enviar assim faria a Meta recusar (132001) com o contador achando que a
 * guia saiu; tratar `DECLARADO` como aprovado seria inventar aprovação (regra 1 do projeto).
 *
 * ⚠ E `nomeMeta` NULO também recusa. O nome EXATO do template só existe depois da aprovação; usar a
 * chave interna no lugar dele seria supor que a Meta aprovou com o nome que nós escolhemos.
 *
 * @param {object} p
 * @param {boolean} p.integracaoLigada  `INTEGRACAO_WHATSAPP`
 * @param {object|null} p.template  a linha de `templates_whatsapp` (ou null se não houver)
 * @param {string} p.chaveTemplate  a chave pedida, só para a mensagem
 */
export function avaliarCanal({ integracaoLigada, template, chaveTemplate = "guia_disponivel" }) {
  if (!integracaoLigada) {
    return {
      disponivel: false,
      motivo: MOTIVOS.INTEGRACAO_DESLIGADA,
      mensagem:
        "O envio por WhatsApp está desligado neste ambiente (INTEGRACAO_WHATSAPP). Nenhuma mensagem "
        + "sai enquanto a integração não for habilitada — as guias podem ser enviadas por e-mail.",
    };
  }
  if (!template) {
    return {
      disponivel: false,
      motivo: MOTIVOS.TEMPLATE_NAO_CADASTRADO,
      mensagem: `O template "${chaveTemplate}" não está cadastrado. Sem ele não há mensagem a enviar.`,
    };
  }
  const status = String(template.statusAprovacao || "").toUpperCase();
  if (status !== APROVADO) {
    return {
      disponivel: false,
      motivo: MOTIVOS.TEMPLATE_NAO_APROVADO,
      statusAprovacao: status || null,
      motivoRejeicao: template.motivoRejeicao || null,
      mensagem:
        `O template "${chaveTemplate}" ainda não está aprovado na Meta (situação: ${status || "sem situação"}). `
        + "A Meta só entrega mensagem iniciada pelo escritório com template aprovado — submeta o modelo "
        + "e volte aqui. Até lá, as guias saem por e-mail."
        + (template.motivoRejeicao ? ` Motivo registrado: ${template.motivoRejeicao}.` : ""),
    };
  }
  if (!template.temDocumento) {
    // Sem header de documento o template manda só texto — e a Entrega 1 É o PDF da guia chegando ao
    // cliente. Mandar o texto sozinho entregaria um aviso sem a guia, parecendo sucesso.
    return {
      disponivel: false,
      motivo: MOTIVOS.TEMPLATE_SEM_DOCUMENTO,
      mensagem:
        `O template "${chaveTemplate}" está aprovado SEM cabeçalho de documento, então ele não pode `
        + "levar o PDF da guia. Submeta o modelo com header de documento.",
    };
  }
  if (!String(template.nomeMeta || "").trim()) {
    return {
      disponivel: false,
      motivo: MOTIVOS.TEMPLATE_SEM_NOME_META,
      mensagem:
        `O template "${chaveTemplate}" consta como aprovado, mas o nome exato dele na Meta não foi `
        + "registrado. Sem esse nome não há como pedir o modelo certo — preencha `nomeMeta`.",
    };
  }
  return { disponivel: true, motivo: null, mensagem: null, nomeMeta: String(template.nomeMeta).trim() };
}

/**
 * ESTA GUIA, PARA ESTA EMPRESA — pode ir por WhatsApp?
 *
 * @param {object} p
 * @param {{disponivel:boolean, motivo:string|null, mensagem:string|null}} p.canal  o retorno de `avaliarCanal`
 * @param {{status:string}} p.guide
 * @param {{contato:object|null, motivo:string|null}} p.destinatario  o retorno de
 *   `ContatoWhatsappService.destinatarioWhatsapp` — ele já distingue "sem contato" de "sem opt-in"
 * @param {Array} p.envios  os `envios_guia` DESTA guia
 * @param {boolean} p.jaEnviada  a resposta de `foiEnviadaComLegado` (envios + legado do e-mail)
 */
export function avaliarLinha({ canal, guide, destinatario, envios = [], jaEnviada = false }) {
  const recusa = (motivo, mensagem, extra = {}) => ({
    pode: false, motivo, mensagem, canalSugerido: CANAIS.EMAIL, ...extra,
  });

  // ⚠ A GUIA JÁ ENVIADA É O PRIMEIRO CORTE, e ela NÃO cai para e-mail: não há canal de queda para
  // trabalho que já está feito. Reenviar por outro canal mandaria a mesma guia duas vezes ao
  // cliente, que é exatamente o que a idempotência do lote existe para impedir.
  if (jaEnviada) {
    return {
      pode: false,
      motivo: MOTIVOS.GUIA_JA_ENVIADA,
      mensagem: "Esta guia já foi enviada ao cliente — o lote não a manda de novo.",
      canalSugerido: null,
      canalDoEnvioAnterior: (envios.find((e) => STATUS_TERMINAL.includes(String(e.status))) || {}).canal || null,
    };
  }
  if (String(guide?.status || "").toUpperCase() !== "PROCESSED") {
    // `VAZIO` é ausência confirmada (não há PDF); `ERROR`/`NEEDS_REVIEW` não têm documento válido.
    return recusa(
      MOTIVOS.GUIA_NAO_PROCESSADA,
      "Esta guia não está processada — não há PDF para enviar.",
      { canalSugerido: null },
    );
  }
  if (!canal?.disponivel) {
    return recusa(canal?.motivo || MOTIVOS.CANAL_INDISPONIVEL, canal?.mensagem || "O canal WhatsApp não está disponível.");
  }
  if (!destinatario?.contato) {
    // ⚠ DUAS FALTAS DIFERENTES, DOIS CONSERTOS DIFERENTES. `destinatarioWhatsapp` já as separa; o
    // que se faz aqui é preservar a distinção até a tela. "Sem contato" pede cadastro; "sem opt-in"
    // pede consentimento registrado — e opt-in é BLOQUEIO, não aviso: sem ele o cliente pode
    // denunciar a mensagem como spam, e número denunciado derruba o canal de TODOS os clientes.
    const semOptIn = String(destinatario?.motivo || "").includes("opt-in");
    return recusa(
      semOptIn ? MOTIVOS.SEM_OPT_IN : MOTIVOS.SEM_CONTATO,
      semOptIn
        ? "Contato de WhatsApp sem opt-in registrado: registre o consentimento (data e origem) antes de enviar. Esta guia vai por e-mail."
        : "Esta empresa não tem contato de WhatsApp cadastrado. Cadastre o número (com opt-in) para usar o canal. Esta guia vai por e-mail.",
    );
  }
  return {
    pode: true,
    motivo: null,
    mensagem: null,
    canalSugerido: CANAIS.WHATSAPP,
    contato: destinatario.contato,
  };
}
