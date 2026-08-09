// ONBOARDING — regras do funil pré-cadastro.
//
// ⚠ ESCOPO MULTI-TENANT (Fase 1): NÃO HÁ ISOLAMENTO. Todo usuário FIRM enxerga todos os
// onboardings. Está escrito aqui e no cabeçalho da rota para ninguém supor um isolamento que não
// existe. As demais listagens de escritório passam por `empresasVisiveis(req)`, que se apoia em
// `CompanyFirmAccess` — vínculo que, por definição, ainda não existe para uma empresa que não foi
// criada. Fase 2 (link público) é o momento de decidir a chave de escopo, e ela não é `companyId`.
//
// ⚠ `dados` é SUBSTITUÍDO, nunca mesclado. Merge raso não deixa limpar uma lista; merge profundo
// não deixa remover um sócio. Substituição é a única semântica sem caso ambíguo — e o front já
// manda o rascunho inteiro a cada salvamento.

import { prisma } from "../../infrastructure/db/prisma.js";
import { etapasDaOrigem } from "./etapasTemplate.js";
import {
  CompanyProvisioningError,
  aplicarPosCriacao,
  provisionarEmpresa,
} from "../companies/CompanyProvisioningService.js";

export const ORIGENS = ["ABERTURA", "TRANSFERENCIA", "INATIVA"];
export const STATUS = ["RASCUNHO", "RECEBIDO", "EM_TRILHA", "CONVERTIDO", "DESISTIU"];

export class OnboardingError extends Error {
  constructor(code, message, status = 400, extra = null) {
    super(message || code);
    this.name = "OnboardingError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

/**
 * As COLUNAS derivadas de `dados`. Uma função só, usada na criação e em toda atualização — se a
 * promoção para coluna fosse escrita em dois lugares, coluna e JSON divergiriam e a busca da lista
 * passaria a mentir sobre a ficha.
 *
 * ⚠ Os nomes de campo abaixo são o CONTRATO com `apps/web/src/features/onboarding/lib/onboardingSpec.js`.
 * Renomear um descritor lá sem mexer aqui não quebra nada visivelmente: o dado continua salvo em
 * `dados`, e só a coluna (logo, a busca) fica vazia.
 */
export function extrairColunas(origem, dados) {
  const d = dados && typeof dados === "object" ? dados : {};
  const texto = (v) => {
    const s = String(v ?? "").trim();
    return s || null;
  };
  const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

  // Na ABERTURA ainda não existe CNPJ nem razão social: o campo guarda o NOME PRETENDIDO, e é o
  // que aparece no card da lista. Guardá-lo na mesma coluna é o que faz a lista ter uma linha só
  // por ficha, com um nome legível, sem um `CASE` por origem em toda tela.
  const cnpjDigitos = soDigitos(d.cnpj);
  return {
    cnpj: cnpjDigitos.length === 14 ? cnpjDigitos : null,
    razaoSocial: texto(d.razaoSocial),
    responsavelNome: texto(d.responsavelNome),
    responsavelEmail: texto(d.responsavelEmail)?.toLowerCase() || null,
    responsavelTelefone: texto(d.responsavelTelefone),
  };
}

function normalizarOrigem(valor) {
  const origem = String(valor || "").trim().toUpperCase();
  if (!ORIGENS.includes(origem)) {
    throw new OnboardingError("origem_invalida", `Origem deve ser uma de: ${ORIGENS.join(", ")}.`, 400);
  }
  return origem;
}

/** Checagem BRANDA — informa, nunca bloqueia. Uma pessoa com duas empresas é caso normal. */
async function emailTemConta(email) {
  const alvo = String(email || "").trim().toLowerCase();
  if (!alvo) return false;
  const existente = await prisma.user.findUnique({ where: { email: alvo }, select: { id: true } });
  return Boolean(existente);
}

async function carregar(id, { comEtapas = false } = {}) {
  const registro = await prisma.onboarding.findUnique({
    where: { id: String(id || "") },
    ...(comEtapas ? { include: { etapas: { orderBy: { ordem: "asc" } } } } : {}),
  });
  if (!registro) throw new OnboardingError("onboarding_nao_encontrado", "Onboarding não encontrado.", 404);
  return registro;
}

/**
 * ⚠ CONVERTIDO É SOMENTE LEITURA. A ficha vira histórico no instante da conversão: a partir dali
 * a verdade sobre a empresa mora em `PortalClient`, e deixar a ficha editável criaria uma segunda
 * versão dos mesmos dados, divergente e sem dono.
 */
function recusarSeConvertido(registro) {
  if (registro.status === "CONVERTIDO") {
    throw new OnboardingError(
      "onboarding_convertido",
      "Este onboarding já virou empresa e não pode mais ser editado.",
      409
    );
  }
}

export async function criar({ origem, criadoPorId = null } = {}) {
  const origemNormalizada = normalizarOrigem(origem);
  return prisma.onboarding.create({
    data: {
      origem: origemNormalizada,
      status: "RASCUNHO",
      origemPreenchimento: "ESCRITORIO",
      dados: {},
      criadoPorId: criadoPorId ? String(criadoPorId) : null,
    },
  });
}

/**
 * Atualiza a ficha. `dados` SUBSTITUI o que estava lá.
 *
 * @param {object}  patch
 * @param {string}  [patch.origem]      trocar a origem ZERA `dados` no servidor
 * @param {object}  [patch.dados]
 * @param {string}  [patch.ultimoPasso]
 * @param {boolean} [patch.finalizar]   `true` promove a RECEBIDO e materializa a checklist
 */
export async function atualizar(id, patch = {}, { atorId = null } = {}) {
  const atual = await carregar(id);
  recusarSeConvertido(atual);

  const data = {};

  // ⚠ TROCAR DE ORIGEM ZERA `dados` AQUI, no servidor, ignorando o que veio no body. Se só a UI
  // resetasse, um PATCH atrasado ou um retry do rascunho antigo regravaria campos da origem
  // anterior — e a ficha do escritório mostraria, por exemplo, quadro societário numa abertura que
  // já tinha virado transferência. Não é defesa contra usuário malicioso; é contra a rede.
  let origemEfetiva = atual.origem;
  let trocouOrigem = false;
  if (patch.origem !== undefined) {
    origemEfetiva = normalizarOrigem(patch.origem);
    if (origemEfetiva !== atual.origem) {
      trocouOrigem = true;
      data.origem = origemEfetiva;
      data.dados = {};
      data.ultimoPasso = null;
    }
  }

  let dadosEfetivos = trocouOrigem ? {} : (atual.dados || {});
  if (!trocouOrigem && patch.dados !== undefined) {
    if (patch.dados === null || typeof patch.dados !== "object" || Array.isArray(patch.dados)) {
      throw new OnboardingError("dados_invalidos", "`dados` deve ser um objeto.", 400);
    }
    dadosEfetivos = patch.dados;
    data.dados = patch.dados;
  }

  if (patch.ultimoPasso !== undefined && !trocouOrigem) {
    data.ultimoPasso = patch.ultimoPasso ? String(patch.ultimoPasso) : null;
  }

  // As colunas são reescritas SEMPRE que `dados` ou a origem mudam — nunca só quando o front
  // lembra de mandar. É a garantia de que a busca da lista fala do mesmo conteúdo da ficha.
  if (data.dados !== undefined) {
    Object.assign(data, extrairColunas(origemEfetiva, dadosEfetivos));
  }

  // Recalculado quando o e-mail muda (e de novo na conversão, onde o dado importa de verdade).
  const emailNovo = data.responsavelEmail ?? null;
  if (data.dados !== undefined && emailNovo !== atual.responsavelEmail) {
    data.emailJaCadastrado = await emailTemConta(emailNovo);
  }

  if (patch.finalizar === true) {
    // Idempotente: finalizar duas vezes não volta o status de EM_TRILHA para RECEBIDO nem
    // reescreve a data de envio.
    if (atual.status === "RASCUNHO") {
      data.status = "RECEBIDO";
      data.enviadoEm = new Date();
    }
  }

  const atualizado = await prisma.onboarding.update({ where: { id: atual.id }, data });

  if (patch.finalizar === true) {
    await materializarEtapas(atualizado);
  }

  return carregar(atualizado.id, { comEtapas: true });
}

/**
 * Copia o template da origem para `onboarding_etapas`.
 *
 * ⚠ `skipDuplicates` + o unique `(onboardingId, chave)` são o que tornam o "finalizar"
 * REEXECUTÁVEL. Sem os dois, clicar duas vezes (ou um retry de rede) duplicaria a checklist
 * inteira — e a segunda cópia viria com todas as caixas desmarcadas, desfazendo visualmente o
 * trabalho já feito.
 */
export async function materializarEtapas(registro) {
  const template = etapasDaOrigem(registro.origem);
  if (!template.length) return { criadas: 0 };
  const resultado = await prisma.onboardingEtapa.createMany({
    data: template.map((etapa) => ({ ...etapa, onboardingId: registro.id })),
    skipDuplicates: true,
  });
  return { criadas: resultado?.count ?? 0 };
}

export async function finalizar(id, { atorId = null } = {}) {
  return atualizar(id, { finalizar: true }, { atorId });
}

/**
 * Marca/desmarca uma etapa e escreve a observação.
 *
 * ⚠ A PRIMEIRA etapa concluída promove RECEBIDO → EM_TRILHA sozinha. Um status que só muda por
 * clique explícito num botão "iniciar" envelhece: o trabalho começa e o quadro continua dizendo
 * "recebido", que é a coluna de "alguém precisa pegar".
 */
export async function concluirEtapa(id, etapaId, { concluida, observacao, atorId = null } = {}) {
  const registro = await carregar(id);
  recusarSeConvertido(registro);

  const etapa = await prisma.onboardingEtapa.findUnique({ where: { id: String(etapaId || "") } });
  if (!etapa || etapa.onboardingId !== registro.id) {
    throw new OnboardingError("etapa_nao_encontrada", "Etapa não encontrada neste onboarding.", 404);
  }

  const data = {};
  if (concluida !== undefined) {
    data.concluidaEm = concluida === true ? new Date() : null;
    data.concluidaPorId = concluida === true ? (atorId ? String(atorId) : null) : null;
  }
  if (observacao !== undefined) {
    data.observacao = observacao ? String(observacao) : null;
  }

  const atualizada = await prisma.onboardingEtapa.update({ where: { id: etapa.id }, data });

  if (concluida === true && registro.status === "RECEBIDO") {
    await prisma.onboarding.update({ where: { id: registro.id }, data: { status: "EM_TRILHA" } });
  }

  return { etapa: atualizada, onboarding: await carregar(registro.id, { comEtapas: true }) };
}

/**
 * CONVERSÃO — a ficha vira empresa de verdade.
 *
 * Duas formas, e a segunda existe por um motivo concreto:
 *  1. `{ company: <mesmo body de POST /firm/companies> }` → provisiona e vincula.
 *  2. `{ vincularPortalClientId }` → só grava o vínculo, sem criar nada. É a RECUPERAÇÃO do caso
 *     "a empresa foi criada mas o update do onboarding falhou depois": sem esta porta, a ficha
 *     ficaria eternamente aberta ao lado de uma empresa que já existe, e a única saída seria mexer
 *     no banco à mão.
 *
 * ⚠ PRÉ-CHECK DE CNPJ: `PortalClient.cnpj` é `@unique` NOT NULL. Sem o pré-check, converter um
 * cliente que já está na carteira devolveria o 409 genérico do Prisma (`empresa_ja_cadastrada`)
 * sem dizer QUAL empresa — e o contador não teria como chegar até ela nem como vincular a ficha.
 */
export async function converter(id, payload = {}, { atorId = null, portalIds = [], log = null } = {}) {
  const registro = await carregar(id);
  if (registro.status === "CONVERTIDO") {
    throw new OnboardingError(
      "onboarding_convertido",
      "Este onboarding já foi convertido.",
      409,
      { portalClientId: registro.portalClientId }
    );
  }
  if (registro.status === "DESISTIU") {
    throw new OnboardingError(
      "onboarding_desistiu",
      "Este onboarding foi encerrado como desistência. Reabra-o antes de converter.",
      409
    );
  }

  // ── Variante de recuperação ──────────────────────────────────────────────────
  const vincular = String(payload?.vincularPortalClientId || "").trim();
  if (vincular) {
    const existente = await prisma.portalClient.findUnique({
      where: { id: vincular },
      select: { id: true, cnpj: true, razao: true },
    });
    if (!existente) {
      throw new OnboardingError("portal_client_nao_encontrado", "Empresa não encontrada.", 404);
    }
    const jaVinculado = await prisma.onboarding.findUnique({
      where: { portalClientId: existente.id },
      select: { id: true },
    });
    if (jaVinculado && jaVinculado.id !== registro.id) {
      throw new OnboardingError(
        "portal_client_ja_vinculado",
        "Esta empresa já está vinculada a outro onboarding.",
        409,
        { onboardingId: jaVinculado.id }
      );
    }
    await prisma.onboarding.update({
      where: { id: registro.id },
      data: {
        portalClientId: existente.id,
        status: "CONVERTIDO",
        convertidoEm: new Date(),
        convertidoPorId: atorId ? String(atorId) : null,
      },
    });
    return {
      vinculado: true,
      portalClientId: existente.id,
      regrasAplicadas: null,
      onboarding: await carregar(registro.id, { comEtapas: true }),
    };
  }

  // ── Conversão normal ─────────────────────────────────────────────────────────
  // ⚠ O body é REPASSADO INTEIRO. `provisionarEmpresa` já aceita os dois formatos que
  // `POST /firm/companies` aceita (aninhado `{company:{...}}` e achatado) e é ELE que decide qual
  // usar. Desembrulhar `payload.company` aqui jogaria fora `ownerEmail`/`ownerPassword`, que vivem
  // no nível de cima — e a conversão morreria em `owner_email_required` sem nenhuma pista.
  const body = payload;

  const cnpjDigitos = String(
    body?.company?.cnpj ?? body?.cnpj ?? ""
  ).replace(/\D+/g, "");
  if (cnpjDigitos.length === 14) {
    const naCarteira = await prisma.portalClient.findUnique({
      where: { cnpj: cnpjDigitos },
      select: { id: true, razao: true },
    });
    if (naCarteira) {
      throw new OnboardingError(
        "cnpj_ja_na_carteira",
        "Este CNPJ já está na carteira. Vincule esta ficha à empresa existente em vez de criar outra.",
        409,
        { portalClientId: naCarteira.id, razao: naCarteira.razao }
      );
    }
  }

  const criada = await provisionarEmpresa({ body, actorUserId: atorId, log });

  const { regrasAplicadas } = await aplicarPosCriacao({
    portalClientId: criada.portalId,
    portalIds,
    regime: criada.regime,
    log,
  });

  // ⚠ O update do onboarding vem DEPOIS da criação e não está na mesma transação — não pode
  // estar: a transação é do provisionamento e já foi encerrada. Se ESTA escrita falhar, a empresa
  // existe e a ficha continua aberta; é exatamente o buraco que `vincularPortalClientId` fecha.
  await prisma.onboarding.update({
    where: { id: registro.id },
    data: {
      portalClientId: criada.portalId,
      status: "CONVERTIDO",
      convertidoEm: new Date(),
      convertidoPorId: atorId ? String(atorId) : null,
      emailJaCadastrado: await emailTemConta(registro.responsavelEmail),
    },
  });

  return {
    vinculado: false,
    portalClientId: criada.portalId,
    ownerUserId: criada.ownerUserId,
    regrasAplicadas,
    onboarding: await carregar(registro.id, { comEtapas: true }),
  };
}

export async function desistir(id, { motivo = null, atorId = null } = {}) {
  const registro = await carregar(id);
  recusarSeConvertido(registro);
  await prisma.onboarding.update({
    where: { id: registro.id },
    data: {
      status: "DESISTIU",
      desistiuEm: new Date(),
      motivoDesistencia: motivo ? String(motivo).slice(0, 500) : null,
      convertidoPorId: registro.convertidoPorId,
    },
  });
  void atorId;
  return carregar(registro.id, { comEtapas: true });
}

/**
 * ⚠ RASCUNHO fica FORA da lista por padrão. Rascunho abandonado acumula para sempre (o wizard cria
 * a ficha no primeiro clique), e um quadro em que a maioria dos cartões nunca foi preenchida deixa
 * de ser lido. A bandeja de rascunhos fica atrás de um toggle, com um DELETE ao lado.
 */
export async function listar({ origem = null, status = null, q = null, incluirRascunhos = false } = {}) {
  const where = {};

  if (origem) where.origem = normalizarOrigem(origem);

  if (status) {
    const alvo = String(status).trim().toUpperCase();
    if (!STATUS.includes(alvo)) {
      throw new OnboardingError("status_invalido", `Status deve ser um de: ${STATUS.join(", ")}.`, 400);
    }
    where.status = alvo;
  } else if (!incluirRascunhos) {
    where.status = { not: "RASCUNHO" };
  }

  const busca = String(q || "").trim();
  if (busca) {
    const digitos = busca.replace(/\D+/g, "");
    where.OR = [
      { razaoSocial: { contains: busca, mode: "insensitive" } },
      { responsavelNome: { contains: busca, mode: "insensitive" } },
      { responsavelEmail: { contains: busca, mode: "insensitive" } },
      ...(digitos.length >= 3 ? [{ cnpj: { contains: digitos } }] : []),
    ];
  }

  const itens = await prisma.onboarding.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: { etapas: { select: { id: true, concluidaEm: true } } },
  });

  return itens.map((item) => {
    const total = item.etapas.length;
    const concluidas = item.etapas.filter((e) => e.concluidaEm).length;
    const { etapas, ...resto } = item;
    return { ...resto, progresso: { total, concluidas } };
  });
}

export async function obter(id) {
  return carregar(id, { comEtapas: true });
}

/** Só RASCUNHO pode ser descartado — o resto é rastro, e rastro não se apaga. */
export async function descartar(id) {
  const registro = await carregar(id);
  if (registro.status !== "RASCUNHO") {
    throw new OnboardingError(
      "somente_rascunho_pode_ser_descartado",
      "Só um rascunho pode ser descartado. Fichas já finalizadas viram histórico — use \"desistiu\".",
      409
    );
  }
  await prisma.onboarding.delete({ where: { id: registro.id } });
  return { ok: true };
}

export { CompanyProvisioningError };
