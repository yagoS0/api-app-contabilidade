// Contatos de WhatsApp da empresa — cadastro, opt-in e a decisão de canal.
//
// É o pré-requisito do envio: sem contato com opt-in não existe lote. E é aqui que mora a regra que
// protege o número do escritório.

import { prisma } from "../../infrastructure/db/prisma.js";
import { normalizarE164, variantesE164 } from "./telefone.js";

export const CANAIS = Object.freeze(["EMAIL", "WHATSAPP"]);
export const CANAL_PADRAO = Object.freeze(["EMAIL", "WHATSAPP", "PERGUNTAR"]);

export class ContatoWhatsappError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function listarContatos(portalClientId) {
  return prisma.contatoWhatsapp.findMany({
    where: { portalClientId: String(portalClientId) },
    orderBy: [{ ativo: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Cria ou atualiza um contato.
 *
 * ⚠ O telefone é validado AQUI, no cadastro — não na hora do envio. Número inválido descoberto no
 * disparo do lote significa uma empresa que fica sem a guia no dia do vencimento, e o contador só
 * descobre pelo painel de falhas. Validar cedo é o que transforma isso num campo vermelho na tela
 * de cadastro.
 */
export async function salvarContato({ portalClientId, id, nome, papel, telefone, optIn, optInOrigem, ativo }) {
  const e164 = normalizarE164(telefone);
  if (!e164) {
    throw new ContatoWhatsappError(
      "TELEFONE_INVALIDO",
      "Telefone inválido. Use DDD + número (ex.: (21) 99999-8888) ou o formato internacional com +.",
    );
  }
  if (!String(nome || "").trim()) {
    throw new ContatoWhatsappError("NOME_OBRIGATORIO", "Informe o nome de quem recebe as mensagens.");
  }

  const dados = {
    nome: String(nome).trim(),
    papel: String(papel || "").trim() || null,
    telefoneE164: e164,
    ativo: ativo === undefined ? true : Boolean(ativo),
  };

  // O opt-in é gravado com DATA e ORIGEM porque ele é o que se apresenta se a Meta questionar o
  // envio. "Marcamos a caixinha" não é registro de consentimento; quando e de onde, é.
  if (optIn === true) {
    dados.optInEm = new Date();
    dados.optInOrigem = String(optInOrigem || "").trim() || "nao_informado";
  } else if (optIn === false) {
    dados.optInEm = null;
    dados.optInOrigem = null;
  }

  if (id) {
    return prisma.contatoWhatsapp.update({ where: { id: String(id) }, data: dados });
  }
  return prisma.contatoWhatsapp.upsert({
    where: { portalClientId_telefoneE164: { portalClientId: String(portalClientId), telefoneE164: e164 } },
    create: { portalClientId: String(portalClientId), ...dados },
    update: dados,
  });
}

export async function removerContato(id) {
  return prisma.contatoWhatsapp.delete({ where: { id: String(id) } });
}

/** Acha o contato a partir do número que a Meta devolveu (tolerando o nono dígito). */
export async function acharContatoPorWaId(waIdOuTelefone) {
  const variantes = variantesE164(waIdOuTelefone);
  if (!variantes.length) return null;
  return prisma.contatoWhatsapp.findFirst({
    where: { OR: [{ waId: { in: variantes } }, { telefoneE164: { in: variantes } }] },
    include: { portalClient: { select: { id: true, razao: true, cnpj: true } } },
  });
}

/**
 * O contato que RECEBE — e o motivo, quando não há nenhum.
 *
 * ⚠ Devolve o motivo em vez de só `null`. Quem chama precisa dizer ao contador POR QUE aquela
 * empresa caiu para e-mail; "sem contato" e "sem opt-in" são problemas diferentes, com consertos
 * diferentes, e some-los num `null` faria a empresa desaparecer do lote em silêncio.
 */
export async function destinatarioWhatsapp(portalClientId) {
  const contatos = await prisma.contatoWhatsapp.findMany({
    where: { portalClientId: String(portalClientId), ativo: true },
    orderBy: { createdAt: "asc" },
  });

  if (!contatos.length) {
    return { contato: null, motivo: "sem contato de WhatsApp cadastrado" };
  }
  const comOptIn = contatos.find((c) => c.optInEm);
  if (!comOptIn) {
    // ⚠ NÃO É FORMALIDADE. Sem opt-in, o cliente pode denunciar a mensagem como spam; denúncia
    // derruba a qualidade do número, e número derrubado tira o canal de TODOS os clientes de uma
    // vez. Por isso bloqueia em vez de avisar.
    return { contato: null, motivo: "contato sem opt-in registrado" };
  }
  return { contato: comOptIn, motivo: null };
}

/**
 * Por onde a guia desta empresa deve sair.
 *
 * `PERGUNTAR` não é resolvido aqui: ele sobe para a tela, que pergunta. Escolher um canal por
 * conta própria quando o cadastro diz "pergunte" seria decidir no lugar do contador.
 */
export async function canaisParaEnvio(portalClientId, escolhaExplicita) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
    select: { canalPadraoEnvio: true, guideNotificationEmail: true },
  });
  const padrao = portal?.canalPadraoEnvio || "EMAIL";
  const escolha = escolhaExplicita || (padrao === "PERGUNTAR" ? null : padrao);
  return { padrao, escolha, emailDestino: portal?.guideNotificationEmail || null };
}
