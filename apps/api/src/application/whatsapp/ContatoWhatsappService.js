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

/**
 * E-mail em minúsculas e sem espaços, ou `null`.
 *
 * ⚠ A FORMA É A MESMA do resto do projeto (`emailValido`, `companySchemas.js`): um `@`, algo antes,
 * algo com ponto depois. Uma segunda definição de "e-mail válido" faria a tela aceitar o que o
 * cadastro da empresa recusa, no mesmo endereço.
 */
export function normalizarEmail(valor) {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
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
export async function salvarContato({ portalClientId, id, nome, papel, telefone, email, optIn, optInOrigem, ativo, userId }) {
  // ⚠ UM DOS DOIS BASTA, e nenhum dos dois é obrigatório sozinho (05/09/2026). O destinatário virou
  // "por onde esta pessoa recebe": só e-mail, só WhatsApp, ou os dois. Exigir telefone deixaria de
  // fora o financeiro que só recebe por e-mail — que é a maioria da carteira hoje.
  const temTelefone = Boolean(String(telefone || "").trim());
  const e164 = temTelefone ? normalizarE164(telefone) : null;
  if (temTelefone && !e164) {
    throw new ContatoWhatsappError(
      "TELEFONE_INVALIDO",
      "Telefone inválido. Digite DDD + número (ex.: 21 99999-8888) — o +55 entra sozinho.",
    );
  }
  const emailLimpo = normalizarEmail(email);
  if (email !== undefined && email !== null && String(email).trim() && !emailLimpo) {
    throw new ContatoWhatsappError("EMAIL_INVALIDO", "E-mail inválido. Confira o endereço.");
  }
  if (!e164 && !emailLimpo) {
    throw new ContatoWhatsappError(
      "SEM_CANAL",
      "Informe ao menos um canal: e-mail, telefone, ou os dois.",
    );
  }
  if (!String(nome || "").trim()) {
    throw new ContatoWhatsappError("NOME_OBRIGATORIO", "Informe o nome de quem recebe as mensagens.");
  }

  const dados = {
    nome: String(nome).trim(),
    papel: String(papel || "").trim() || null,
    telefoneE164: e164,
    email: emailLimpo,
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
  // ⚠ O UPSERT SÓ EXISTE COM TELEFONE: a chave única é `(portalClientId, telefoneE164)`, e com
  // `telefoneE164` nulo não há chave para casar — o Prisma recusaria. Destinatário só de e-mail é
  // sempre CRIADO; editar o dele exige o `id`, que a tela manda.
  if (!e164) {
    return prisma.contatoWhatsapp.create({ data: { portalClientId: String(portalClientId), ...dados } });
  }
  return prisma.contatoWhatsapp.upsert({
    where: { portalClientId_telefoneE164: { portalClientId: String(portalClientId), telefoneE164: e164 } },
    create: { portalClientId: String(portalClientId), ...dados },
    update: dados,
  });
}

/**
 * OS DESTINATÁRIOS DE UMA EMPRESA, por canal (05/09/2026).
 *
 * Decisão do dono: *"quando enviarmos, enviar para todos os canais cadastrados"*. Então aqui não se
 * escolhe UM destino — devolve-se a lista de cada canal, e quem envia manda para todos.
 *
 * ⚠ O OPT-IN VALE SÓ PARA O WHATSAPP. É exigência de política da Meta e é o que protege o número
 * contra denúncia; e-mail nunca dependeu dele. Um destinatário sem opt-in aparece em `emails` e não
 * aparece em `telefones` — e o motivo sobe em `semOptIn`, para a tela poder dizer por quê.
 *
 * ⚠⚠ ESTA LISTA É A ÚNICA FONTE DO DESTINATÁRIO DA GUIA desde 05/09/2026, e este parágrafo dizia o
 * CONTRÁRIO no mesmo dia: a cascata (`guideNotificationEmail` → `Company.email` → e-mail do sócio)
 * foi removida do caminho da guia por decisão do dono — *"a guia só vai para e-mail ou número
 * cadastrado na aba de guias, fora isso não sai e mostra por que não foi"*. Vazio aqui é guia que
 * não sai, com a recusa nomeada. Ver `resolveCompanyNotificationEmails`.
 *
 * @returns {Promise<{emails: string[], telefones: Array<{id, nome, telefoneE164}>, semOptIn: Array<{nome, telefoneE164}>}>}
 */
export async function destinatariosDeEnvio(portalClientId) {
  const contatos = await prisma.contatoWhatsapp.findMany({
    where: { portalClientId: String(portalClientId), ativo: true },
    select: { id: true, nome: true, email: true, telefoneE164: true, optInEm: true },
    orderBy: { createdAt: "asc" },
  });

  const emails = [];
  const vistos = new Set();
  const telefones = [];
  const semOptIn = [];
  for (const c of contatos) {
    const e = normalizarEmail(c.email);
    if (e && !vistos.has(e)) {
      vistos.add(e);
      emails.push(e);
    }
    if (c.telefoneE164) {
      if (c.optInEm) telefones.push({ id: c.id, nome: c.nome, telefoneE164: c.telefoneE164 });
      else semOptIn.push({ nome: c.nome, telefoneE164: c.telefoneE164 });
    }
  }
  return { emails, telefones, semOptIn };
}

/** ⚠ `portalClientId` é OBRIGATÓRIO — ver a nota do `update` acima. */
export async function removerContato(portalClientId, id) {
  return prisma.contatoWhatsapp.delete({
    where: { id: String(id), portalClientId: String(portalClientId) },
  });
}

/**
 * Acha o contato a partir do número que a Meta devolveu.
 *
 * ⚠ CASA DÍGITO A DÍGITO COM O CADASTRO. Ela tolerava o nono dígito (`variantesE164`), e isso
 * contraria a decisão do dono de 14/08/2026 — *"você nunca deve pressupor o número, o número de
 * comunicação com o cliente será o do cadastro"*. Ver o cabeçalho de `vinculoTelefone.js`.
 *
 * ⚠ E o `findFirst` era pior que a tolerância: sem `orderBy` e sem escopo, ele escolhia UM contato
 * entre os que casassem — possivelmente de outra empresa — e devolvia como se não houvesse dúvida.
 * O mesmo número pode legitimamente falar por mais de um CNPJ.
 *
 * ⚠ QUEM RESPONDE "DE QUEM É ESTA MENSAGEM?" É `resolverVinculoPorTelefone`, não esta função. Ela
 * sobrevive só como atalho de leitura para quem já sabe que há um contato só; o webhook (F5/F6)
 * usa o vínculo, que sabe dizer AMBIGUO e DESCONHECIDO com todas as letras.
 */
export async function acharContatoPorWaId(waIdOuTelefone) {
  const e164 = normalizarE164(waIdOuTelefone);
  if (!e164) return null;
  return prisma.contatoWhatsapp.findFirst({
    where: { OR: [{ waId: e164 }, { telefoneE164: e164 }] },
    include: { portalClient: { select: { id: true, razao: true, cnpj: true } } },
  });
}

/**
 * GRAVA O `waId` QUE A META DEVOLVEU — o único escritor desta coluna (05/09/2026).
 *
 * ⚠⚠ ATÉ HOJE `contatos_whatsapp.waId` NÃO TINHA ESCRITOR NENHUM. O `schema.prisma` afirmava que
 * ela era *"descoberta no primeiro contato"*, `vinculoTelefone.js` afirmava que o `waId` é
 * *"o identificador que a PRÓPRIA Meta já devolveu"*, e o ramo `casouPor: "WA_ID"` era **código
 * morto**: a coluna era sempre nula. Duas afirmações do código sobre um mecanismo inexistente.
 *
 * O `wa_id` vem em `contacts[0]` da resposta de envio e é o número que a META usa — que pode
 * diferir do cadastrado justamente pelo **nono dígito**. É ele que volta no webhook quando o
 * cliente responde; sem gravá-lo, a resposta cai na fila de "não vinculados" com o cadastro certo.
 *
 * ⚠ NÃO SOBRESCREVE valor já gravado e NÃO toca em `telefoneE164`: o número de comunicação continua
 * sendo o do CADASTRO (decisão do dono, 14/08/2026). Isto acrescenta um apelido conhecido, não
 * corrige o cadastro por conta própria.
 *
 * @returns {Promise<boolean>} gravou?
 */
export async function gravarWaIdDoContato({ contatoId, waId, client = prisma }) {
  const id = String(contatoId || "").trim();
  const valor = String(waId || "").trim();
  if (!id || !valor) return false;
  // ⚠ `waId: null` no `where` é a trava: quem já tem apelido conhecido não é reescrito por um envio.
  const r = await client.contatoWhatsapp.updateMany({
    where: { id, waId: null },
    data: { waId: valor },
  });
  return r.count === 1;
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
 * ⚠ A rede é lançada larga (`variantesE164`) e quem estreita é a REGRA, que casa dígito a dígito
 * com o cadastro. Isso NÃO afrouxa a decisão do dono — é o que a torna verificável: fosse a query a
 * estreitar, a leitura alternativa ficaria invisível e `divergemPeloNonoDigito` nunca poderia
 * acender para dizer que um cadastro está no formato antigo.
 */
export async function resolverVinculoPorTelefone(telefone) {
  const e164 = normalizarE164(telefone);
  if (!e164) return resolverVinculoTelefone(telefone, []);

  const variantes = variantesE164(e164);
  const contatos = await prisma.contatoWhatsapp.findMany({
    where: { OR: [{ telefoneE164: { in: variantes } }, { waId: { in: variantes } }] },
    select: SELECT_CONTATO_PARA_VINCULO,
  });
  if (!contatos.length) return resolverVinculoTelefone(e164, []);

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
  );
}
