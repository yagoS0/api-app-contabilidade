// Contatos de WhatsApp da empresa — cadastro, opt-in e a decisão de canal.
//
// É o pré-requisito do envio: sem contato com opt-in não existe lote. E é aqui que mora a regra que
// protege o número do escritório.

import { prisma } from "../../infrastructure/db/prisma.js";
import { normalizarE164, variantesE164 } from "./telefone.js";
import { resolverVinculoTelefone } from "./vinculoTelefone.js";

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
export async function salvarContato({ portalClientId, id, nome, papel, telefone, optIn, optInOrigem, ativo, userId }) {
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

  // ── QUEM É A PESSOA, quando se sabe ──────────────────────────────────────────────────────────
  //
  // ⚠ O `papel` acima é RÓTULO DE TELA (texto livre: "financeiro", "sócio"). O papel que decide o
  // que a pessoa pode fazer é o do RBAC de cliente (`CompanyClientUser.role`), e ele só existe se o
  // contato apontar para um USUÁRIO. Sem esse ponteiro, o vínculo identifica a empresa e diz, com
  // todas as letras, que não identifica pessoa nenhuma — casar por nome seria exatamente a
  // adivinhação que este módulo existe para não fazer.
  //
  // ⚠ E o usuário TEM DE SER MEMBRO DESTA EMPRESA. Aceitar um `userId` qualquer criaria, pelo
  // cadastro de contato, um vínculo que o RBAC nunca concedeu.
  if (userId === null) {
    dados.userId = null;
  } else if (userId !== undefined && String(userId).trim()) {
    const membro = await prisma.companyClientUser.findUnique({
      where: { companyId_userId: { companyId: String(portalClientId), userId: String(userId).trim() } },
      select: { status: true },
    });
    if (!membro || membro.status !== "ACTIVE") {
      throw new ContatoWhatsappError(
        "USUARIO_SEM_VINCULO",
        "Este usuário não é membro ativo desta empresa. Vincule-o à empresa antes de ligá-lo a um contato.",
      );
    }
    dados.userId = String(userId).trim();
  }

  if (id) {
    // ⚠ `portalClientId` VIAJA NO `where`, e não é redundância. A rota autoriza o chamador sobre a
    // empresa do PATH (`requireFirmCompanyAccess`), mas o alvo era escolhido só pelo `id` do corpo:
    // um id de contato de OUTRA empresa era atualizado sem que nada conferisse a quem ele pertence.
    // O mesmo vale para a exclusão, abaixo. Multi-tenancy por `portalClientId` é inegociável, e no
    // vínculo ela é o próprio assunto.
    return prisma.contatoWhatsapp.update({
      where: { id: String(id), portalClientId: String(portalClientId) },
      data: dados,
    });
  }
  return prisma.contatoWhatsapp.upsert({
    where: { portalClientId_telefoneE164: { portalClientId: String(portalClientId), telefoneE164: e164 } },
    create: { portalClientId: String(portalClientId), ...dados },
    update: dados,
  });
}

/** ⚠ `portalClientId` é OBRIGATÓRIO — ver a nota do `update` acima. */
export async function removerContato(portalClientId, id) {
  return prisma.contatoWhatsapp.delete({
    where: { id: String(id), portalClientId: String(portalClientId) },
  });
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

/** Os campos que o vínculo precisa — para o `select` não arrastar a linha toda. */
export const SELECT_CONTATO_PARA_VINCULO = Object.freeze({
  id: true,
  portalClientId: true,
  nome: true,
  papel: true,
  telefoneE164: true,
  waId: true,
  optInEm: true,
  ativo: true,
  userId: true,
  portalClient: { select: { id: true, razao: true, cnpj: true } },
});

/**
 * NÚMERO → EMPRESA (→ PESSOA). A ligação com o banco; a REGRA é `vinculoTelefone.js`.
 *
 * ⚠ A BUSCA É DELIBERADAMENTE SEM ESCOPO DE TENANT, e isso é o oposto de furar a multi-tenancy: a
 * pergunta desta função É "de qual tenant se trata?". Não existe `portalClientId` para filtrar
 * ANTES de ela responder. O que a resposta faz é justamente **produzir** o escopo — e todo
 * consumidor tem de usá-lo como escopo dali em diante, nunca como permissão (ver o cabeçalho de
 * `vinculoTelefone.js`).
 *
 * ⚠ A rede é lançada SEMPRE pela leitura larga (`variantesE164`); quem estreita é a REGRA, com a
 * tolerância escolhida. Fosse a query a estreitar, a leitura alternativa ficaria invisível e
 * `divergemPeloNonoDigito` nunca poderia acender.
 */
export async function resolverVinculoPorTelefone(telefone, opcoes = {}) {
  const e164 = normalizarE164(telefone);
  if (!e164) return resolverVinculoTelefone(telefone, [], opcoes);

  const variantes = variantesE164(e164);
  const contatos = await prisma.contatoWhatsapp.findMany({
    where: { OR: [{ telefoneE164: { in: variantes } }, { waId: { in: variantes } }] },
    select: SELECT_CONTATO_PARA_VINCULO,
  });
  if (!contatos.length) return resolverVinculoTelefone(e164, [], opcoes);

  // O papel vem do RBAC que já existe — não é recalculado nem copiado para o contato.
  const comUsuario = contatos.filter((c) => c.userId);
  const vinculos = comUsuario.length
    ? await prisma.companyClientUser.findMany({
        where: { OR: comUsuario.map((c) => ({ companyId: c.portalClientId, userId: c.userId })) },
        select: { companyId: true, userId: true, role: true, status: true },
      })
    : [];
  const porChave = new Map(vinculos.map((v) => [`${v.companyId}|${v.userId}`, { role: v.role, status: v.status }]));

  return resolverVinculoTelefone(
    e164,
    contatos.map((c) => ({ ...c, vinculoRbac: c.userId ? porChave.get(`${c.portalClientId}|${c.userId}`) || null : null })),
    opcoes,
  );
}
