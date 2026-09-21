// Histórico segmentado por empresa e telefone. Vínculo novo abre outro segmento; nunca move mensagens.
// Guias usam o status da tentativa; demais saídas mantêm recibos na própria mensagem.
import { prisma } from "../../infrastructure/db/prisma.js";
import { normalizarE164 } from "./telefone.js";
import { resolverVinculoPorTelefone } from "./ContatoWhatsappService.js";
import { SITUACOES } from "./vinculoTelefone.js";
import { avaliarJanela24h, instanteQueAbreAJanela } from "./janela24h.js";
import { identidadeWhatsappV2Ativa, filtroSegmentosDoCanal, CANAL_PRINCIPAL } from "./CanalWhatsappService.js";
import { garantirIdentidadeWhatsapp, conferirIdentidadeVigente } from "./IdentidadeComunicacaoService.js";

/** Vocabulário do plano do dono, travado por CHECK no banco. */
export const DIRECAO = Object.freeze({ ENTRADA: "in", SAIDA: "out" });
// Empresa apagada pode zerar a FK, mas seu histórico não vira fila global.
export const FILTRO_FILA_WHATSAPP = Object.freeze({ portalClientId: null, OR: [
  { chaveEscopo: { startsWith: "sem-empresa:" } },
  { chaveEscopo: { startsWith: "legado:sem-empresa:" } },
] });
export const pertenceAFilaWhatsapp = (c) => !c?.portalClientId && (
  String(c?.chaveEscopo || "").startsWith("sem-empresa:") || String(c?.chaveEscopo || "").startsWith("legado:sem-empresa:")
);

export class ConversaWhatsappError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ehConflitoDeUnique = (e) => e?.code === "P2002";

/** O chamador confere a carteira antes. Nenhum conteúdo nem atribuição é apagado. */
export async function alterarExclusaoConversa({ conversaId, excluir, client = prisma }) {
  return client.$transaction(async (tx) => {
    const conversa = await tx.conversaWhatsapp.findUnique({ where: { id: String(conversaId) } });
    if (!conversa) throw new ConversaWhatsappError("CONVERSA_NAO_ENCONTRADA", "Conversa não encontrada.");
    const agora = new Date();
    if (excluir && !conversa.excluidaEm) {
      const mudou = await tx.conversaWhatsapp.updateMany({
        where: { id: conversa.id, excluidaEm: null },
        data: { excluidaEm: agora, automacaoInvalidadaEm: agora },
      });
      if (mudou.count) {
        await tx.turnoIaWhatsapp.updateMany({
          where: { conversaId: conversa.id, status: { in: ["pendente", "falhou", "processando"] } },
          data: { status: "ignorado", motivo: "CHAT_EXCLUIDO", leaseAte: null, reservaToken: null, concluidoEm: agora },
        });
        await tx.acaoPendenteWhatsapp.updateMany({ where: { conversaId: conversa.id, status: "pendente" }, data: { status: "cancelada" } });
      }
    } else if (!excluir && conversa.excluidaEm) {
      await tx.conversaWhatsapp.updateMany({ where: { id: conversa.id, excluidaEm: conversa.excluidaEm }, data: { excluidaEm: null } });
    }
    return tx.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
  });
}

/**
 * O fio de um número. Cria se não existir.
 *
 * ⚠ `portalClientId` NUNCA é adivinhado aqui — quem o passa é quem já perguntou ao vínculo e ouviu
 * `VINCULADO`. Chamada sem ele, a conversa nasce (ou continua) NÃO ATRIBUÍDA, que é a resposta
 * honesta para `DESCONHECIDO` e `AMBIGUO`.
 *
 * A chave contém o escopo: receber outro vínculo abre outro fio sem alterar a origem anterior.
 */
export async function garantirConversa({ telefone, portalClientId = null, nomePerfilProvedor = null, canalId = CANAL_PRINCIPAL, vinculoNumeroId = null, client = prisma }) {
  const e164 = normalizarE164(telefone);
  if (!e164) {
    throw new ConversaWhatsappError("TELEFONE_INVALIDO", "Não é possível abrir uma conversa sem um telefone válido.");
  }
  const atribuicao = portalClientId ? { portalClientId: String(portalClientId) } : {};
  const perfil = nomePerfilProvedor ? { nomePerfilProvedor: String(nomePerfilProvedor) } : {};
  // O número pode falar por várias empresas. Um envio nunca transfere um histórico existente.
  const v2 = identidadeWhatsappV2Ativa() || Boolean(vinculoNumeroId);
  if (v2) {
    if (vinculoNumeroId) await conferirIdentidadeVigente({ vinculoNumeroId, telefone: e164, permitirRevisao: true, client });
    else vinculoNumeroId = (await garantirIdentidadeWhatsapp({ telefone: e164, canalId, client })).vinculoNumero.id;
  }
  const contextoCanal = v2 ? { canalId, vinculoNumeroId } : {};
  const chaveEscopo = `${portalClientId ? `empresa:${portalClientId}` : "sem-empresa"}:${v2 ? `v2:${canalId}:${vinculoNumeroId}:` : ""}${e164}`;
  const atendimento = await client.atendimentoResponsavelWhatsapp?.findUnique?.({ where: v2
    ? { canalId_vinculoNumeroId: { canalId, vinculoNumeroId } }
    : { canal_telefoneE164: { canal: CANAL_PRINCIPAL, telefoneE164: e164 } } });
  const agrupamento = atendimento ? { atendimentoId: atendimento.id } : {};
  // Backfill preserva IDs/chaves históricos. Não recriar o segmento já migrado.
  const existente = v2 ? await client.conversaWhatsapp.findFirst({ where: { ...contextoCanal, telefoneE164: e164, portalClientId: portalClientId || null }, orderBy: { createdAt: "asc" } }) : null;
  if (existente) return client.conversaWhatsapp.update({ where: { id: existente.id }, data: { ...perfil, ...agrupamento } });
  return client.conversaWhatsapp.upsert({
    where: { chaveEscopo },
    create: { chaveEscopo, escopoVerificado: Boolean(portalClientId), telefoneE164: e164, ...contextoCanal, ...atribuicao, ...perfil, ...agrupamento,
      ...(atendimento ? { atendidaPor: atendimento.atendidaPor, atendidaDesde: atendimento.atendidaDesde, automacaoInvalidadaEm: atendimento.automacaoInvalidadaEm } : {}) },
    update: { ...perfil, ...agrupamento },
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
  respostaAProviderMessageId = null,
  canalId = CANAL_PRINCIPAL,
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

  let vinculo = await resolverVinculoPorTelefone(telefone);
  if (vinculo.situacao === SITUACOES.TELEFONE_INVALIDO) {
    throw new ConversaWhatsappError("TELEFONE_INVALIDO", "O remetente não é um telefone reconhecível.");
  }

  // Reentrega antiga não cria nem transfere segmento com o cadastro de hoje.
  const existente = await prisma.mensagemWhatsapp.findUnique({ where: { providerMessageId: String(providerMessageId) } });
  if (existente) {
    const conversa = await prisma.conversaWhatsapp.findUnique({ where: { id: existente.conversaId } });
    if (conversa && (conversa.canalId || CANAL_PRINCIPAL) !== canalId) throw new ConversaWhatsappError("MENSAGEM_CANAL_DIVERGENTE", "A mensagem já pertence a outro canal.");
    return { mensagem: existente, conversa, duplicada: true, vinculo };
  }

  const identidade = identidadeWhatsappV2Ativa() ? await garantirIdentidadeWhatsapp({ telefone: vinculo.e164, canalId }) : null;
  // A criação/quarentena da identidade pode invalidar aliases reconhecidos antes dela.
  if (identidade) vinculo = await resolverVinculoPorTelefone(telefone);
  const portalClientId = (!identidade || identidade.interlocutor?.estado === "ATIVO")
    && vinculo.situacao === SITUACOES.VINCULADO && vinculo.empresas.length === 1 ? vinculo.empresas[0].portalClientId : null;
  const vigencia = identidade?.vinculoNumero;
  if (vigencia && vigencia.geracao > 1 && (!ocorridaEmProvedor || new Date(ocorridaEmProvedor) < new Date(vigencia.iniciouEm))) {
    throw new ConversaWhatsappError("IDENTIDADE_EVENTO_ANTERIOR", "Mensagem anterior à identificação atual; conferir a titularidade antes de responder.");
  }
  const conversa = await garantirConversa({ telefone: vinculo.e164, portalClientId, nomePerfilProvedor, canalId, vinculoNumeroId: vigencia?.id || null });

  try {
    const resultado = await prisma.$transaction(async (tx) => {
    const mensagem = await tx.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: DIRECAO.ENTRADA,
        providerMessageId: String(providerMessageId),
        tipo: String(tipo),
        corpo: corpo ?? null,
        midiaProvedorId: midiaProvedorId ?? null,
        ocorridaEmProvedor: ocorridaEmProvedor ?? null,
        respostaAProviderMessageId: respostaAProviderMessageId || null,
      },
    });
    const atualizada = await tx.conversaWhatsapp.update({ where: { id: conversa.id }, data: { updatedAt: new Date(), excluidaEm: null } });
    return { mensagem, conversa: atualizada, duplicada: false, vinculo, identidade };
    });
    return resultado;
  } catch (e) {
    if (!ehConflitoDeUnique(e)) throw e;
    const mensagem = await prisma.mensagemWhatsapp.findUnique({ where: { providerMessageId: String(providerMessageId) } });
    if (!mensagem) throw e;
    const conversaOriginal = await prisma.conversaWhatsapp.findUnique({ where: { id: mensagem.conversaId } });
    if (!conversaOriginal) throw e;
    if ((conversaOriginal.canalId || CANAL_PRINCIPAL) !== canalId) throw new ConversaWhatsappError("MENSAGEM_CANAL_DIVERGENTE", "A mensagem já pertence a outro canal.");
    return { mensagem, conversa: conversaOriginal, duplicada: true, vinculo };
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
  envioGuiaTentativaId = null,
  conversaId = null,
  canalId = CANAL_PRINCIPAL,
  vinculoNumeroId = null,
  client = prisma,
  // QUEM escreveu (02/09/2026): `IA` | `HUMANO` | `SISTEMA`. Nulo = o envio de guia por template,
  // como sempre foi. Vocabulário travado por CHECK no banco.
  autor = null,
}) {
  const conversa = conversaId
    ? await client.conversaWhatsapp.findFirst({ where: { id: String(conversaId), portalClientId: portalClientId || null } })
    : await garantirConversa({ telefone, portalClientId, canalId, vinculoNumeroId, client });
  if (!conversa) throw new ConversaWhatsappError("CONVERSA_NAO_ENCONTRADA", "Conversa não encontrada neste escopo.");
  try {
    const mensagem = await client.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: DIRECAO.SAIDA,
        providerMessageId: providerMessageId ? String(providerMessageId) : null,
        tipo: String(tipo),
        corpo: corpo ?? null,
        envioGuiaId: envioGuiaId ? String(envioGuiaId) : null,
        envioGuiaTentativaId: envioGuiaTentativaId ? String(envioGuiaTentativaId) : null,
        statusEnvio: providerMessageId && !envioGuiaId ? "enviado" : null,
        enviadoEm: providerMessageId ? new Date() : null,
        autor: autor ? String(autor) : null,
      },
    });
    // Só uma saída efetivamente aceita reabre; reentrega do recibo não muda a lixeira.
    const atualizada = providerMessageId
      ? await client.conversaWhatsapp.update({ where: { id: conversa.id }, data: { excluidaEm: null, updatedAt: new Date() } })
      : conversa;
    return { mensagem, conversa: atualizada, duplicada: false };
  } catch (e) {
    if (!ehConflitoDeUnique(e) || !providerMessageId) throw e;
    const mensagem = await client.mensagemWhatsapp.findUnique({
      where: { providerMessageId: String(providerMessageId) },
    });
    return { mensagem, conversa, duplicada: true };
  }
}

/**
 * A ÚLTIMA MENSAGEM RECEBIDA do fio — o fato de que a janela depende.
 *
 * O webhook pode entregar mensagens fora de ordem. A maior `registradaEm` não garante
 * a entrada mais recente: uma mensagem antiga recebida com atraso não fecha uma janela aberta.
 * Cada entrada usa min(ocorridaEmProvedor, registradaEm), ou registradaEm sem timestamp.
 * Duas partições calculam o máximo dessa regra sem trazer histórico/conteúdo ou cortar
 * candidatos por um limite arbitrário. Nulos e relógio do provedor adiantado ficam na segunda.
 */
async function ultimaRecebida(conversaId) {
  const conversa = await prisma.conversaWhatsapp.findUnique({ where: { id: String(conversaId) }, select: { telefoneE164: true, canalId: true, vinculoNumeroId: true } });
  if (!conversa) return null;
  // A janela é do destinatário na Meta; somente timestamps atravessam segmentos, nunca conteúdo.
  const where = { conversa: filtroSegmentosDoCanal(conversa), direcao: DIRECAO.ENTRADA };
  const select = { ocorridaEmProvedor: true, registradaEm: true };
  const registradaEm = prisma.mensagemWhatsapp.fields.registradaEm;
  const candidatas = await Promise.all([
    prisma.mensagemWhatsapp.findFirst({
      where: { ...where, ocorridaEmProvedor: { lte: registradaEm } },
      orderBy: [{ ocorridaEmProvedor: "desc" }, { registradaEm: "desc" }, { id: "desc" }], select,
    }),
    prisma.mensagemWhatsapp.findFirst({
      where: { ...where, OR: [{ ocorridaEmProvedor: null }, { ocorridaEmProvedor: { gt: registradaEm } }] },
      orderBy: [{ registradaEm: "desc" }, { id: "desc" }], select,
    }),
  ]);
  return candidatas.filter(Boolean).reduce((maisRecente, candidata) => {
    const instante = instanteQueAbreAJanela(candidata).instante?.getTime() ?? -Infinity;
    const anterior = instanteQueAbreAJanela(maisRecente).instante?.getTime() ?? -Infinity;
    return !maisRecente || instante > anterior ? candidata : maisRecente;
  }, null);
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
export async function listarMensagens({ portalClientId, conversaId, limite = 50, cursor = null }) {
  if (!String(portalClientId || "").trim()) {
    throw new ConversaWhatsappError("SEM_ESCOPO", "Leitura de conversa exige a empresa: sem escopo não se lê mensagem.");
  }
  return prisma.mensagemWhatsapp.findMany({
    where: { conversaId: String(conversaId), conversa: { portalClientId: String(portalClientId) } },
    orderBy: [{ registradaEm: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    include: { envioGuiaTentativa: true },
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
    where: { ...FILTRO_FILA_WHATSAPP, excluidaEm: null },
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
  // Vincular inicia o segmento da empresa. Não reclassifica o que foi dito antes da decisão.
  return garantirConversa({ telefone: conversa.telefoneE164, portalClientId, nomePerfilProvedor: conversa.nomePerfilProvedor });
}
