// A CONVERSA — a ligação com o banco. As REGRAS moram fora daqui:
//   `janela24h.js`        → dá para mandar texto livre, ou só cabe template?
//   `vinculoTelefone.js`  → de quem é esta mensagem, e sobre qual empresa ela fala?
//
// Este arquivo não decide nenhuma das duas. Ele carrega o dado, chama a regra e grava o FATO.
//
// ── ⚠ A FRONTEIRA COM `envios_guia` ─────────────────────────────────────────────────────────────
// `envios_guia` é o estado do ENVIO DE UMA GUIA (uma linha por guia × canal): dele saem o chip da
// listagem e o `guideCompliance`, e ele já tem a escada de status, o retry, o erro traduzido e
// `aplicarStatusDoProvedor` (que nunca rebaixa). Aqui é a CONVERSA: o que foi dito, por quem,
// quando. Por isso a mensagem não tem status — teria duas respostas para "esta guia foi enviada?".
// O que liga as duas é `MensagemWhatsapp.envioGuiaId`.
//
// ── ⚠ MULTI-TENANCY ─────────────────────────────────────────────────────────────────────────────
// O tenant mora em `conversas_whatsapp.portalClientId` — UM dono, um escritor. Toda leitura de
// mensagem passa por aqui e escopa por ele. Nenhuma cópia denormalizada na mensagem: a atribuição
// do fio muda (o ambíguo que o contador resolve; a empresa apagada que vira nulo), e uma segunda
// cópia discordaria em silêncio, a favor do vazamento.
//
// ── ⚠ NADA DE REDE ──────────────────────────────────────────────────────────────────────────────
// Nenhuma chamada à Meta aqui dentro. Quem falar com a Cloud API é o cliente HTTP do módulo
// (arquivo à parte); este serviço só persiste o que já chegou.

import { prisma } from "../../infrastructure/db/prisma.js";
import { normalizarE164 } from "./telefone.js";
import { resolverVinculoPorTelefone } from "./ContatoWhatsappService.js";
import { SITUACOES } from "./vinculoTelefone.js";
import { avaliarJanela24h } from "./janela24h.js";

/** Vocabulário do plano do dono, travado por CHECK no banco. */
export const DIRECAO = Object.freeze({ ENTRADA: "in", SAIDA: "out" });

export class ConversaWhatsappError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ehConflitoDeUnique = (e) => e?.code === "P2002";

/**
 * O fio de um número. Cria se não existir.
 *
 * ⚠ `portalClientId` NUNCA é adivinhado aqui — quem o passa é quem já perguntou ao vínculo e ouviu
 * `VINCULADO`. Chamada sem ele, a conversa nasce (ou continua) NÃO ATRIBUÍDA, que é a resposta
 * honesta para `DESCONHECIDO` e `AMBIGUO`.
 *
 * ⚠ E uma atribuição existente NÃO é sobrescrita por ausência: `portalClientId` só entra no
 * `update` quando vem preenchido. Do contrário, um evento posterior sem vínculo (contato desativado
 * no meio do caminho) desatribuiria em silêncio um fio que o contador já tinha resolvido.
 */
export async function garantirConversa({ telefone, portalClientId = null, nomePerfilProvedor = null }) {
  const e164 = normalizarE164(telefone);
  if (!e164) {
    throw new ConversaWhatsappError("TELEFONE_INVALIDO", "Não é possível abrir uma conversa sem um telefone válido.");
  }
  const atribuicao = portalClientId ? { portalClientId: String(portalClientId) } : {};
  const perfil = nomePerfilProvedor ? { nomePerfilProvedor: String(nomePerfilProvedor) } : {};
  return prisma.conversaWhatsapp.upsert({
    where: { telefoneE164: e164 },
    create: { telefoneE164: e164, ...atribuicao, ...perfil },
    update: { ...atribuicao, ...perfil },
  });
}

/**
 * GRAVA UMA MENSAGEM RECEBIDA. É o que a fase do webhook vai chamar.
 *
 * ⚠ IDEMPOTENTE, E A GARANTIA É DO BANCO. A Meta reentrega evento; o `@unique` em
 * `providerMessageId` (o `wamid`) impede que a segunda entrega vire uma segunda mensagem, aconteça
 * o que acontecer com este código. O que é de FLUXO é só o `catch` abaixo: reconhecer o conflito
 * como "já processado" em vez de deixar o webhook responder erro — e responder erro faria a Meta
 * reentregar de novo, indefinidamente.
 *
 * ⚠ A ATRIBUIÇÃO DE EMPRESA SAI DO VÍNCULO, E SÓ QUANDO ELE NÃO TEM DÚVIDA. `AMBIGUO` e
 * `DESCONHECIDO` gravam a mensagem no fio NÃO ATRIBUÍDO — nada some, e nada entra no histórico do
 * CNPJ errado. A ambiguidade de PESSOA (dois contatos da mesma empresa) não impede a atribuição: a
 * empresa é uma só, e é a empresa que define o escopo.
 *
 * @returns {{mensagem, conversa, duplicada:boolean, vinculo}}
 */
export async function registrarMensagemRecebida({
  telefone,
  providerMessageId,
  tipo,
  corpo = null,
  midiaProvedorId = null,
  ocorridaEmProvedor = null,
  nomePerfilProvedor = null,
}) {
  if (!String(providerMessageId || "").trim()) {
    // ⚠ Sem o identificador da Meta não há idempotência: a reentrega do mesmo evento viraria uma
    // segunda mensagem no fio. Recusar aqui é mais honesto do que gravar um duplicado silencioso.
    throw new ConversaWhatsappError(
      "SEM_IDENTIFICADOR_DO_PROVEDOR",
      "Mensagem recebida sem o identificador da Meta: sem ele não há como evitar duplicata na reentrega do evento.",
    );
  }
  if (!String(tipo || "").trim()) {
    throw new ConversaWhatsappError("SEM_TIPO", "Mensagem recebida sem o tipo informado pelo provedor.");
  }

  const vinculo = await resolverVinculoPorTelefone(telefone);
  if (vinculo.situacao === SITUACOES.TELEFONE_INVALIDO) {
    throw new ConversaWhatsappError("TELEFONE_INVALIDO", "O remetente não é um telefone reconhecível.");
  }

  const portalClientId =
    vinculo.situacao === SITUACOES.VINCULADO && vinculo.empresas.length === 1 ? vinculo.empresas[0].portalClientId : null;

  const conversa = await garantirConversa({ telefone: vinculo.e164, portalClientId, nomePerfilProvedor });

  try {
    const mensagem = await prisma.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: DIRECAO.ENTRADA,
        providerMessageId: String(providerMessageId),
        tipo: String(tipo),
        corpo: corpo ?? null,
        midiaProvedorId: midiaProvedorId ?? null,
        ocorridaEmProvedor: ocorridaEmProvedor ?? null,
      },
    });
    return { mensagem, conversa, duplicada: false, vinculo };
  } catch (e) {
    if (!ehConflitoDeUnique(e)) throw e;
    const mensagem = await prisma.mensagemWhatsapp.findUnique({ where: { providerMessageId: String(providerMessageId) } });
    return { mensagem, conversa, duplicada: true, vinculo };
  }
}

/**
 * GRAVA O BALÃO QUE NÓS MANDAMOS. É o que o envio de guia chama depois de a Meta aceitar.
 *
 * ⚠ **A MENSAGEM NÃO TEM STATUS, E ISTO AQUI É A RAZÃO DE ELA NÃO TER.** O estado daquele envio
 * (enviado → entregue → lido, o retry, o erro traduzido) mora em `envios_guia`, com UM escritor. O
 * que fica aqui é o ponteiro `envioGuiaId` — é por ele que o fio mostra o ✓✓ sem manter uma segunda
 * resposta para "esta guia foi enviada?".
 *
 * ⚠ **BEST-EFFORT POR CONTRATO: quem chama NÃO pode deixar a falha daqui derrubar o envio.** A
 * mensagem já saiu para o cliente quando esta linha é escrita; transformar um erro de histórico em
 * erro de envio faria o contador reenviar uma guia que o cliente recebeu.
 *
 * ⚠ `providerMessageId` é o `wamid` e é `@unique`: reexecutar com o mesmo id devolve a linha
 * existente em vez de duplicar o balão (mesmo tratamento do recebimento).
 */
export async function registrarMensagemEnviada({
  telefone,
  portalClientId = null,
  tipo = "template",
  corpo = null,
  providerMessageId = null,
  envioGuiaId = null,
  // QUEM escreveu (02/09/2026): `IA` | `HUMANO` | `SISTEMA`. Nulo = o envio de guia por template,
  // como sempre foi. Vocabulário travado por CHECK no banco.
  autor = null,
}) {
  const conversa = await garantirConversa({ telefone, portalClientId });
  try {
    const mensagem = await prisma.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: DIRECAO.SAIDA,
        providerMessageId: providerMessageId ? String(providerMessageId) : null,
        tipo: String(tipo),
        corpo: corpo ?? null,
        envioGuiaId: envioGuiaId ? String(envioGuiaId) : null,
        autor: autor ? String(autor) : null,
      },
    });
    return { mensagem, conversa, duplicada: false };
  } catch (e) {
    if (!ehConflitoDeUnique(e) || !providerMessageId) throw e;
    const mensagem = await prisma.mensagemWhatsapp.findUnique({
      where: { providerMessageId: String(providerMessageId) },
    });
    return { mensagem, conversa, duplicada: true };
  }
}

/**
 * A ÚLTIMA MENSAGEM RECEBIDA do fio — o fato de que a janela depende.
 *
 * ⚠ ORDENA POR `registradaEm`, o NOSSO instante, e não pelo do provedor. `registradaEm` nunca é
 * nulo e cresce com a ordem de gravação; `ocorridaEmProvedor` pode faltar, e ordenar por ele com
 * nulos escolheria a linha errada. Se os dois discordarem, a base fica um pouco mais ANTIGA do que
 * poderia — a janela fecha antes, que é o lado seguro do erro (ver `janela24h.js`).
 */
async function ultimaRecebida(conversaId) {
  return prisma.mensagemWhatsapp.findFirst({
    where: { conversaId: String(conversaId), direcao: DIRECAO.ENTRADA },
    orderBy: { registradaEm: "desc" },
    select: { ocorridaEmProvedor: true, registradaEm: true },
  });
}

/**
 * A JANELA DE 24H DE UM FIO. Derivada na leitura, sempre.
 *
 * ⚠ Não existe (nem pode existir) uma coluna `aberta`. Um booleano gravado envelheceria sozinho:
 * às 24h01 continuaria dizendo `true` sem ninguém ter escrito nada.
 *
 * @param {Date} [agora] injetável para teste — a regra não lê relógio escondido.
 */
export async function janelaDaConversa(conversaId, agora = new Date()) {
  return avaliarJanela24h(await ultimaRecebida(conversaId), agora);
}

/**
 * As mensagens de um fio, ESCOPADAS PELA EMPRESA.
 *
 * ⚠ `portalClientId` é obrigatório e viaja no `where` através da conversa. Um fio de outra empresa
 * — ou não atribuído — simplesmente não é alcançável por este caminho: nulo nunca casa com um
 * escopo. É a mesma correção que `salvarContato`/`removerContato` receberam, e vale pelo mesmo
 * motivo: escolher o alvo só pelo id do fio deixaria a conversa de uma empresa dentro do acesso de
 * outra.
 */
export async function listarMensagens({ portalClientId, conversaId, limite = 50 }) {
  if (!String(portalClientId || "").trim()) {
    throw new ConversaWhatsappError("SEM_ESCOPO", "Leitura de conversa exige a empresa: sem escopo não se lê mensagem.");
  }
  return prisma.mensagemWhatsapp.findMany({
    where: { conversaId: String(conversaId), conversa: { portalClientId: String(portalClientId) } },
    orderBy: { registradaEm: "desc" },
    take: limite,
  });
}

/**
 * A FILA DE NÃO VINCULADOS — uma CONSULTA, não uma tabela.
 *
 * ⚠ O motivo (`DESCONHECIDO` / `AMBIGUO`) é PERGUNTADO AO VÍNCULO na leitura, nunca gravado na
 * linha. Gravado, ele envelheceria: cadastrado o contato às 10h, a linha continuaria dizendo
 * "desconhecido" até alguém reescrevê-la. Derivado, o item sai da fila no instante em que o
 * cadastro é consertado — e quem decide continua sendo `resolverVinculoTelefone`, não uma segunda
 * regra escrita aqui.
 *
 * ⚠ Uma resolução de vínculo por fio (N+1 de propósito). A fila é pequena por construção e ENCOLHE
 * conforme o cadastro é consertado; trocar isso por um motivo gravado seria trocar exatidão por
 * velocidade num lugar em que o erro é atribuir a mensagem à empresa errada.
 */
export async function conversasNaoVinculadas({ limite = 50 } = {}) {
  const conversas = await prisma.conversaWhatsapp.findMany({
    where: { portalClientId: null },
    orderBy: { updatedAt: "desc" },
    take: limite,
  });
  return Promise.all(
    conversas.map(async (conversa) => {
      const vinculo = await resolverVinculoPorTelefone(conversa.telefoneE164);
      return {
        conversa,
        motivo: vinculo.situacao,
        empresasCandidatas: vinculo.empresas,
        divergemPeloNonoDigito: vinculo.divergemPeloNonoDigito,
      };
    }),
  );
}

/**
 * ATRIBUI UM FIO A UMA EMPRESA — a resolução humana do `AMBIGUO`.
 *
 * ⚠ SÓ ACEITA EMPRESA QUE O VÍNCULO APONTA COMO CANDIDATA. Atribuir a um CNPJ cujo cadastro não
 * contém aquele número é casar sem cadastro pela porta de trás — o mesmo que a regra recusa fazer
 * sozinha. Para um número `DESCONHECIDO` não há candidata nenhuma, e o conserto é CADASTRAR o
 * contato: feito isso, o vínculo passa a responder `VINCULADO` e a atribuição vira automática.
 */
export async function atribuirConversa({ conversaId, portalClientId }) {
  const conversa = await prisma.conversaWhatsapp.findUnique({ where: { id: String(conversaId) } });
  if (!conversa) throw new ConversaWhatsappError("CONVERSA_NAO_ENCONTRADA", "Conversa não encontrada.");

  const vinculo = await resolverVinculoPorTelefone(conversa.telefoneE164);
  const candidata = vinculo.empresas.some((e) => e.portalClientId === String(portalClientId));
  if (!candidata) {
    throw new ConversaWhatsappError(
      "EMPRESA_NAO_E_CANDIDATA",
      "Este número não está cadastrado nesta empresa. Cadastre o contato na empresa antes de atribuir a conversa.",
    );
  }
  return prisma.conversaWhatsapp.update({
    where: { id: String(conversaId) },
    data: { portalClientId: String(portalClientId) },
  });
}
