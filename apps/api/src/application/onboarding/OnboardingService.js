import { validarDadosOnboarding } from "@contabilidade/shared/onboarding-dados";
import { projetarContratacao, contratoAptoPagamento } from '../../../../../packages/shared/src/onboarding/contratacaoComercial.js';
// ONBOARDING — regras do funil pré-cadastro.
//
// ESCOPO: admin/contador gerenciam o escritório; demais usuários FIRM veem somente fichas
// cujo criadoPorId é o próprio usuário. A rota aplica o escopo antes de todo acesso por id.
//
// ⚠ `dados` é SUBSTITUÍDO, nunca mesclado. Merge raso não deixa limpar uma lista; merge profundo
// não deixa remover um sócio. Substituição é a única semântica sem caso ambíguo — e o front já
// manda o rascunho inteiro a cada salvamento.

import { prisma } from "../../infrastructure/db/prisma.js";
import { projetarComercial, projetarComerciais, etapasComEvidencias } from './ProjecaoComercialService.js';
import { etapasDaOrigem } from "./etapasTemplate.js";
import { prepararArquivoConversao, conferirFontesDoArquivo } from "./ArquivoConversaoService.js";
import { normalizarE164 } from "../whatsapp/telefone.js";
import { normalizarEmail } from "../whatsapp/ContatoWhatsappService.js";
import { identidadeWhatsappV2Ativa } from "../whatsapp/CanalWhatsappService.js";
import { garantirIdentidadeWhatsapp } from "../whatsapp/IdentidadeComunicacaoService.js";
import {
  CompanyProvisioningError,
  aplicarPosCriacao,
  provisionarEmpresa,
} from "../companies/CompanyProvisioningService.js";

export const ORIGENS = ["ABERTURA", "TRANSFERENCIA", "INATIVA", "PESSOA_FISICA"];
export const STATUS = ["RASCUNHO", "RECEBIDO", "EM_TRILHA", "CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"];

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
    razaoSocial: texto(origem === "PESSOA_FISICA" ? d.responsavelNome : d.razaoSocial),
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
  if (["CONVERTIDO", "CONCLUIDO_AVULSO"].includes(registro.status)) {
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
  if (!Number.isInteger(patch.versao) || patch.versao !== atual.versao) {
    throw new OnboardingError("formulario_alterado", "A ficha mudou. Recarregue antes de salvar para preservar o atendimento.", 409);
  }

  const data = { versao: { increment: 1 }, eventos: { create: { tipo: "FICHA_ATUALIZADA", atorId, dados: { campos: Object.keys(patch) } } } };

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
    const validacao = validarDadosOnboarding(origemEfetiva, patch.dados);
    if (!validacao.ok) throw Object.assign(new OnboardingError("dados_invalidos", Object.values(validacao.erros)[0], 400), { erros: validacao.erros });
    dadosEfetivos = validacao.dados;
    data.dados = dadosEfetivos;
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

  if (data.dados) {
    data.fontesDados = { ...(atual.fontesDados || {}) };
    for (const campo of new Set([...Object.keys(atual.dados || {}), ...Object.keys(data.dados)])) {
      if (JSON.stringify(atual.dados?.[campo]) !== JSON.stringify(data.dados[campo])) data.fontesDados[campo] = { fonte: "ESCRITORIO", atorId, conferido: true, em: new Date().toISOString() };
    }
  }
  const atualizado = await prisma.$transaction(async tx => {
    const salvo = await tx.onboarding.update({ where: { id: atual.id, versao: patch.versao, status: atual.status }, data }).catch((e) => { if (e.code === "P2025") throw new OnboardingError("formulario_alterado", "A ficha mudou. Recarregue antes de salvar.", 409); throw e; });
    if (data.dados && salvo.cnpj !== atual.cnpj) await tx.atendimentoLead.updateMany({ where: { onboardingId: id }, data: { autorizacao: {}, representanteVerificadoEm: null, representanteVerificadoPor: null, evidenciaRepresentante: null } });
    return salvo;
  });

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
  const r = await carregar(id);
  return atualizar(id, { finalizar: true, versao: r.versao }, { atorId });
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

  return prisma.$transaction(async tx => {
    // Serializa com conversão/desistência antes de alterar a etapa. Falha na
    // etapa ou auditoria desfaz também a reserva e a promoção do estado.
    const reserva = await tx.onboarding.updateMany({
      where: { id: registro.id, versao: registro.versao, status: registro.status },
      // Checklist/observação não altera o conteúdo material da proposta. O UPDATE
      // mantém o lock até o commit sem invalidar sua fichaVersao.
      data: { updatedAt: new Date(), ...(concluida === true && registro.status === "RECEBIDO" ? { status: "EM_TRILHA" } : {}) },
    });
    if (reserva.count !== 1) throw new OnboardingError("formulario_alterado", "A ficha mudou. Recarregue antes de alterar a etapa.", 409);
    const atualizada = await tx.onboardingEtapa.update({ where: { id: etapa.id }, data });
    await tx.onboardingEvento.create({ data: { onboardingId: registro.id, tipo: "ETAPA_ATUALIZADA", atorId, dados: { etapaId: etapa.id, ...data, ...(data.concluidaEm ? { concluidaEm: data.concluidaEm.toISOString() } : {}) } } });
    return { etapa: atualizada, onboarding: await tx.onboarding.findUnique({ where: { id: registro.id }, include: { etapas: { orderBy: { ordem: "asc" } } } }) };
  });
}

/**
 * CONVERSÃO — a ficha vira empresa de verdade.
 *
 * Duas formas, e a segunda existe por um motivo concreto:
 *  1. `{ company: <mesmo body de POST /firm/companies> }` → provisiona e vincula.
 *  2. `{ vincularPortalClientId, cnpjDefinitivo }` → recupera vínculos antigos com a empresa
 *     existente, conferindo o CNPJ e arquivando os documentos sem recriar ou alterar seu cadastro.
 * Criação, documentos, contato e vínculo são confirmados na mesma transação. Os arquivos são
 * preparados antes dela; o onboarding original e seus PDFs cifrados permanecem como histórico.
 *
 * ⚠ PRÉ-CHECK DE CNPJ: `PortalClient.cnpj` é `@unique` NOT NULL. Sem o pré-check, converter um
 * cliente que já está na carteira devolveria o 409 genérico do Prisma (`empresa_ja_cadastrada`)
 * sem dizer QUAL empresa — e o contador não teria como chegar até ela nem como vincular a ficha.
 */
export async function converter(id, payload = {}, { atorId = null, portalIds = [], log = null } = {}) {
  const registro = await carregar(id);
  if (registro.origem === "PESSOA_FISICA") throw new OnboardingError("pessoa_fisica_sem_empresa", "Conclua o serviço pessoal ou adicione uma demanda empresarial vinculada.", 409);
  if (registro.status === "CONVERTIDO") {
    throw new OnboardingError(
      "onboarding_convertido",
      "Este onboarding já foi convertido.",
      409,
      { portalClientId: registro.portalClientId }
    );
  }
  if (["DESISTIU", "CONCLUIDO_AVULSO"].includes(registro.status)) {
    throw new OnboardingError(
      "onboarding_desistiu",
      "Este onboarding foi encerrado. Inicie um novo atendimento antes de converter.",
      409
    );
  }

  const contexto = { externa: payload.contratacaoExterna, atorId, registro };
  const comercial = await conferirContratoDeConversao(prisma, id, contexto);
  let arquivo;
  const concluir = async (tx, criada, { recuperacao = false } = {}) => {
    const reserva = await tx.onboarding.updateMany({ where: { id, versao: registro.versao, status: registro.status, portalClientId: null }, data: { versao: registro.versao + 1 } });
    if (reserva.count !== 1) throw new OnboardingError("formulario_alterado", "A ficha mudou durante a conversão. Recarregue antes de continuar.", 409);
    const atual = await conferirContratoDeConversao(tx, id, contexto);
    if (atual.contrato?.id !== comercial.contrato?.id || atual.proposta?.id !== comercial.proposta?.id) throw new OnboardingError("contrato_alterado", "A contratação mudou. Recarregue antes de converter.", 409);
    await conferirFontesDoArquivo(tx, id, arquivo);
    if (arquivo.documentos.length) await tx.companyDocument.createMany({ data: arquivo.documentos.map(d => ({ ...d, portalClientId: criada.portalId })) });
    if (!recuperacao) await salvarContatoDaConversao(tx, registro, payload, criada);
    await tx.onboarding.update({ where: { id }, data: {
      portalClientId: criada.portalId, status: "CONVERTIDO", convertidoEm: new Date(), convertidoPorId: atorId,
      emailJaCadastrado: true,
      eventos: { create: { tipo: "CONVERTIDO", atorId, dados: { portalClientId: criada.portalId, documentos: arquivo.documentos.map(d => d.id), contratacao: comercial.externa ? { ...comercial.externa, portalClientId: criada.portalId, registradaEm: new Date().toISOString() } : { origem: "INTERNA", propostaId: comercial.proposta.id, contratoId: comercial.contrato.id } } } },
    } });
    await tx.atendimentoLead.updateMany({ where: { onboardingId: id, encerradoEm: null }, data: { encerradoEm: new Date() } });
    await tx.onboardingEtapa.updateMany({ where: { onboardingId: id, acao: "CONVERSAO" }, data: { concluidaEm: new Date(), concluidaPorId: atorId } });
  };

  // ── Variante de recuperação ──────────────────────────────────────────────────
  const vincular = String(payload?.vincularPortalClientId || "").trim();
  if (vincular) {
    if (!Array.isArray(portalIds) || !portalIds.includes(vincular)) {
      throw new OnboardingError("portal_client_nao_encontrado", "Empresa não encontrada.", 404);
    }
    const existente = await prisma.portalClient.findUnique({
      where: { id: vincular },
      select: { id: true, cnpj: true, razao: true },
    });
    if (!existente) {
      throw new OnboardingError("portal_client_nao_encontrado", "Empresa não encontrada.", 404);
    }
    const cnpjConferido = String(registro.cnpj || payload.cnpjDefinitivo || "").replace(/\D/g, "");
    if (cnpjConferido !== existente.cnpj) throw new OnboardingError("cnpj_divergente", "Confira o CNPJ definitivo: ele deve ser o mesmo da empresa que receberá a ficha e os documentos.", 409);
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
    arquivo = await prepararArquivoConversao({ db: prisma, onboardingId: id, ...comercial });
    await prisma.$transaction(tx => concluir(tx, { portalId: existente.id }, { recuperacao: true }));
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

  arquivo = await prepararArquivoConversao({ db: prisma, onboardingId: id, ...comercial });
  let criada;
  try {
    criada = await provisionarEmpresa({ body, actorUserId: atorId, log, concluirNaTransacao: concluir });
  } catch (erro) {
    if (erro.cause instanceof OnboardingError) throw erro.cause;
    throw erro;
  }

  const { regrasAplicadas } = await aplicarPosCriacao({
    portalClientId: criada.portalId,
    portalIds,
    regime: criada.regime,
    log,
  });

  return {
    vinculado: false,
    portalClientId: criada.portalId,
    ownerUserId: criada.ownerUserId,
    regrasAplicadas,
    onboarding: await carregar(registro.id, { comEtapas: true }),
  };
}

async function conferirContratoDeConversao(db, onboardingId, { externa, atorId, registro } = {}) {
  const proposta = await db.propostaComercial.findFirst({ where: { onboardingId, status: "ACEITA", revogadaEm: null }, orderBy: { versao: "desc" } })
    || await db.propostaComercial.findFirst({ where: { onboardingId }, orderBy: { versao: "desc" } });
  if (externa !== undefined) {
    if (proposta || await db.contratoComercial.findFirst({ where: { onboardingId } })) throw new OnboardingError("excecao_inaplicavel", "Há contratação interna registrada. Confira a proposta, assinatura e pagamento correspondentes; a exceção externa não substitui essas etapas.", 409);
    const usuario = atorId && await db.user.findUnique({ where: { id: atorId }, select: { id: true, role: true, status: true, accountType: true } });
    if (!usuario || !["admin", "contador"].includes(String(usuario.role).toLowerCase()) || usuario.status !== "active" || usuario.accountType !== "FIRM") throw new OnboardingError("forbidden", "Contratação externa exige contador ou administrador ativo do escritório.", 403);
    const { exigirEscopo } = await import("./ComercialService.js");
    const { validarContratacaoExterna } = await import("../../../../../packages/shared/src/onboarding/contratacaoComercial.js");
    await exigirEscopo(onboardingId, usuario, db);
    const invalida = validarContratacaoExterna(externa, registro.versao);
    if (invalida) throw new OnboardingError("contratacao_externa_invalida", invalida, 409);
    return { externa: { origem: "EXTERNA", justificativa: externa.justificativa.trim(), evidencia: externa.evidencia.trim(), atorId: usuario.id, onboardingId, versao: registro.versao } };
  }
  if (!proposta) throw new OnboardingError("contratacao_necessaria", "Confirme a contratação antes de adicionar à carteira. Para cliente já contratado fora da Altan, registre a exceção com justificativa e evidência.", 409);
  const contrato = await db.contratoComercial.findFirst({ where: { onboardingId, propostaId: proposta.id } });
  if (!contratoAptoPagamento(proposta, contrato) || contrato.dados?.opcao?.recorrente !== true) throw new OnboardingError("contrato_recorrente_necessario", "Confira o contrato recorrente aprovado da proposta aceita antes de criar a empresa.", 409);
  const pagamento = await db.onboardingEvento.findFirst({ where: { onboardingId, tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { path: ["contratoId"], equals: contrato.id } } });
  const projecao = projetarContratacao({ onboarding: registro || {}, propostas: [proposta], contratos: [contrato], marcos: pagamento ? [pagamento] : [] });
  if (!projecao.carteiraPermitida) throw new OnboardingError("pagamento_pendente", "Confira o pagamento deste contrato na jornada antes de criar a empresa.", 409);
  return { proposta, contrato };
}

async function salvarContatoDaConversao(tx, registro, payload, criada) {
  const fonte = payload.contato || { nome: registro.responsavelNome, email: registro.responsavelEmail, telefone: registro.responsavelTelefone };
  const email = normalizarEmail(fonte.email), telefoneE164 = normalizarE164(fonte.telefone);
  if ((fonte.email && !email) || (fonte.telefone && !telefoneE164)) throw new OnboardingError("contato_invalido", "Confira o e-mail e o WhatsApp do responsável antes de converter.", 400);
  if (!email && !telefoneE164) return;
  const identidade = telefoneE164 && identidadeWhatsappV2Ativa() ? await garantirIdentidadeWhatsapp({ telefone: telefoneE164, client: tx }) : null;
  await tx.contatoWhatsapp.create({ data: {
    portalClientId: criada.portalId, nome: String(fonte.nome || registro.responsavelNome || "Responsável").trim(), email, telefoneE164,
    ...(identidade ? { vinculoNumeroId: identidade.vinculoNumero.id } : {}),
    userId: email && email === String(payload.ownerEmail || "").trim().toLowerCase() ? criada.ownerUserId : null,
    optInEm: telefoneE164 && fonte.whatsappAutorizado === true ? new Date() : null,
    optInOrigem: telefoneE164 && fonte.whatsappAutorizado === true ? "conferencia_onboarding" : null,
    permissoesAssistente: [],
  } });
}

export async function desistir(id, { motivo = null, atorId = null, versao } = {}) {
  const registro = await carregar(id);
  recusarSeConvertido(registro);
  if (registro.status === "DESISTIU") return carregar(id, { comEtapas: true });
  // Chamadores internos legados não têm confirmação visual; a rota exige versão.
  // Mesmo nesses casos o CAS abaixo protege a revisão carregada pelo serviço.
  if (versao !== undefined) conferirVersao(registro, versao);
  await prisma.onboarding.update({
    where: { id: registro.id, versao: registro.versao, status: registro.status },
    data: {
      versao: { increment: 1 },
      status: "DESISTIU",
      desistiuEm: new Date(),
      motivoDesistencia: motivo ? String(motivo).slice(0, 500) : null,
      convertidoPorId: registro.convertidoPorId,
      eventos: { create: { tipo: "DESISTIU", atorId, dados: { motivo: motivo ? String(motivo).slice(0, 500) : null, statusAnterior: registro.status } } },
    },
  }).catch(e => { if (e.code === "P2025") throw new OnboardingError("formulario_alterado", "A ficha mudou. Recarregue antes de desistir.", 409); throw e; });
  return carregar(registro.id, { comEtapas: true });
}

// Não deduz contratação, assinatura ou pagamento da situação operacional da ficha.
export function statusAntesDaDesistencia(registro, eventos) {
  const desistencia = eventos.find(e => e.tipo === "DESISTIU");
  const anterior = desistencia?.dados?.statusAnterior;
  if (["RASCUNHO", "RECEBIDO", "EM_TRILHA"].includes(anterior)) return anterior;
  // Legado: etapa concluída não comprova promoção. O fallback é conservador e auditado.
  return registro.enviadoEm ? "RECEBIDO" : "RASCUNHO";
}

export async function retomarAtendimento(id, { motivo, versao, user } = {}, db = prisma) {
  if (!user?.id || !["admin", "contador"].includes(String(user.role).toLowerCase()) || user.accountType !== "FIRM") {
    throw new OnboardingError("forbidden_admin_or_contador_only", "A retomada exige administrador ou contador.", 403);
  }
  if (typeof motivo !== "string" || !motivo.trim() || motivo.trim().length > 500) {
    throw new OnboardingError("motivo_obrigatorio", "Informe o motivo da retomada (até 500 caracteres).");
  }
  if (!Number.isInteger(versao) || versao < 0) throw new OnboardingError("formulario_alterado", "Confira a versão atual da ficha.", 409);
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM onboardings WHERE id = ${id} FOR UPDATE`;
      const registro = await tx.onboarding.findUnique({ where: { id } });
      if (!registro) throw new OnboardingError("onboarding_nao_encontrado", "Onboarding não encontrado.", 404);
      const eventos = await tx.onboardingEvento.findMany({ where: { onboardingId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const repetido = eventos.find(e => e.tipo === "ATENDIMENTO_RETOMADO" && e.dados?.versaoAnterior === versao);
      if (repetido && registro.versao === versao + 1 && repetido.atorId === user.id && repetido.dados.motivo === motivo.trim() && registro.status === repetido.dados.statusRestaurado) {
        return tx.onboarding.findUnique({ where: { id }, include: { etapas: { orderBy: { ordem: "asc" } } } });
      }
      conferirVersao(registro, versao);
      if (registro.status !== "DESISTIU" || registro.portalClientId || registro.convertidoEm) throw new OnboardingError("retomada_indisponivel", "Somente uma ficha em desistência, ainda não convertida, pode ser retomada.", 409);
      const status = statusAntesDaDesistencia(registro, eventos);
      const agora = new Date();
      const links = await tx.onboardingLink.updateMany({ where: { onboardingId: id, revokedAt: null }, data: { revokedAt: agora } });
      const casos = await tx.atendimentoLead.findMany({ where: { onboardingId: id } });
      for (const caso of casos) {
        await tx.atendimentoLead.update({ where: { id: caso.id }, data: { versao: { increment: 1 }, triagem: {
          ...caso.triagem, retomadaManual: { bloqueiaAutomacao: true, em: agora.toISOString(), atorId: user.id, versaoAnterior: versao },
        } } });
      }
      // Não retomar trabalho antigo nem repetir chamada cujo resultado pode ser incerto.
      await tx.trabalhoFiscalLead.updateMany({ where: { onboardingId: id, status: { in: ["PENDENTE", "AGUARDANDO"] } },
        data: { status: "EXIGE_REVISAO", resultado: { codigo: "RETOMADA_MANUAL", mensagem: "Solicite novamente após conferir a ficha retomada." } } });
      await tx.trabalhoFiscalLead.updateMany({ where: { onboardingId: id, status: "PROCESSANDO" },
        data: { status: "INDETERMINADO", resultado: { codigo: "RETOMADA_MANUAL", mensagem: "Confira o resultado anterior antes de uma nova consulta." } } });
      return tx.onboarding.update({
        where: { id, versao, status: "DESISTIU" },
        data: { status, versao: { increment: 1 }, desistiuEm: null, motivoDesistencia: null,
          eventos: { create: { tipo: "ATENDIMENTO_RETOMADO", atorId: user.id, dados: {
            linksRevogados: links.count, restauracao: ["RASCUNHO", "RECEBIDO", "EM_TRILHA"].includes(eventos.find(e => e.tipo === "DESISTIU")?.dados?.statusAnterior) ? "STATUS_AUDITADO" : registro.enviadoEm ? "ENVIO_REGISTRADO" : "RASCUNHO_CONSERVADOR", motivo: motivo.trim(), versaoAnterior: versao, statusAnterior: "DESISTIU", statusRestaurado: status,
            desistenciaAnterior: { motivo: registro.motivoDesistencia, em: registro.desistiuEm ? new Date(registro.desistiuEm).toISOString() : null },
          } } } },
        include: { etapas: { orderBy: { ordem: "asc" } } },
      });
    });
  } catch (e) {
    if (["P2025", "P2034"].includes(e.code)) throw new OnboardingError("formulario_alterado", "A ficha mudou. Confira novamente antes de retomar.", 409);
    throw e;
  }
}

/**
 * ⚠ RASCUNHO fica FORA da lista por padrão. Rascunho abandonado acumula para sempre (o wizard cria
 * a ficha no primeiro clique), e um quadro em que a maioria dos cartões nunca foi preenchida deixa
 * de ser lido. A bandeja de rascunhos fica atrás de um toggle, com um DELETE ao lado.
 */
export async function listar({ origem = null, status = null, q = null, incluirRascunhos = false, escopo = {} } = {}, db = prisma) {
  const where = { ...escopo };

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

  const itens = await db.onboarding.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: { etapas: { select: { id: true, chave: true, concluidaEm: true } }, eventos: { where: { tipo: 'RETORNO_COMERCIAL' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
  });

  const projecoes = await projetarComerciais(itens, db);
  const saida = [];
  for (const item of itens) {
    const total = item.etapas.length;
    const { etapas, eventos, ...resto } = item;
    const { evidencias, ...comercial } = projecoes.get(item.id);
    const concluidas = etapasComEvidencias(etapas, evidencias).filter(e => e.concluidaEm || e.evidencias.some(prova => prova.satisfaz)).length;
    saida.push({ ...resto, comercial, retornoComercial: eventos?.[0] || null, progresso: { total, concluidas } });
  }
  return saida;
}

export async function obter(id, user = null) {
  const registro = await carregar(id, { comEtapas: true });
  const comercial = await projetarComercial(registro);
  let conversao;
  try {
    const contrato = await conferirContratoDeConversao(prisma, id);
    conversao = { contratoConferido: true, semProposta: !contrato.proposta };
  } catch (e) {
    if (!(e instanceof OnboardingError)) throw e;
    conversao = { contratoConferido: false, motivo: e.message, excecaoAplicavel: e.code === "contratacao_necessaria" && comercial.contratacao?.excecaoAplicavel === true && ["admin", "contador"].includes(String(user?.role).toLowerCase()) };
  }
  const vinculos = await prisma.onboardingEvento.findMany({ where: { onboardingId: id, tipo: { in: ["DEMANDA_ORIGEM", "DEMANDA_RELACIONADA_CRIADA"] } }, orderBy: { createdAt: "asc" } });
  return { ...registro, comercial, conversao, etapas: etapasComEvidencias(registro.etapas, comercial.evidencias), demandasRelacionadas: (vinculos || []).map(e => ({ id: e.dados.onboardingId, origem: e.dados.origem || null, anterior: e.tipo === "DEMANDA_ORIGEM" })) };
}

function conferirVersao(registro, versao) {
  if (!Number.isInteger(versao) || versao !== registro.versao) {
    throw new OnboardingError("formulario_alterado", "A ficha mudou ou a confirmação não tem versão. Confira novamente antes de confirmar.", 409);
  }
}

// Inventário de TODAS as relações de Onboarding, inclusive as que usam Cascade.
// A criação simples não grava evento. Qualquer evento existente é histórico preservado.
export const VINCULOS_DESCARTE = [
  ["atendimentoLead", "Conversa vinculada"],
  ["propostaComercial", "Proposta comercial"],
  ["contratoComercial", "Contrato comercial"],
  ["documentoOnboarding", "Documento recebido"],
  ["trabalhoFiscalLead", "Trabalho fiscal"],
  ["fichaEmpresaAvulsa", "Ficha de serviço avulso"],
  ["onboardingAnalise", "Análise registrada"],
  ["onboardingLink", "Link de preenchimento"],
  ["onboardingEtapa", "Etapas de implantação"],
];

export async function elegibilidadeDescarte(id, db = prisma) {
  const registro = await db.onboarding.findUnique({ where: { id } });
  if (!registro) throw new OnboardingError("onboarding_nao_encontrado", "Onboarding não encontrado.", 404);
  const impedimentos = [];
  if (registro.status !== "RASCUNHO") impedimentos.push("A ficha não está em rascunho");
  if (registro.portalClientId || registro.convertidoEm) impedimentos.push("Empresa vinculada ou conversão registrada");
  if (registro.proposta || registro.enviadoEm || registro.origemPreenchimento === "CLIENTE") impedimentos.push("Proposta ou preenchimento recebido");
  if (registro.desistiuEm || (registro.faseComercial && registro.faseComercial !== "LEAD") || Object.keys(registro.fontesDados || {}).length) impedimentos.push("Marcos ou origem dos dados registrados");
  for (const [modelo, rotulo] of VINCULOS_DESCARTE) {
    if (await db[modelo].findFirst({ where: { onboardingId: id }, select: { id: true } })) impedimentos.push(rotulo);
  }
  if (await db.onboardingEvento.findFirst({ where: { onboardingId: id }, select: { id: true } })) {
    impedimentos.push("Histórico do atendimento");
  }
  return { id, versao: registro.versao, status: registro.status, podeExcluir: impedimentos.length === 0,
    podeEncerrar: !["CONVERTIDO", "CONCLUIDO_AVULSO", "DESISTIU"].includes(registro.status), impedimentos };
}

/** A trava FOR UPDATE também serializa os inserts por FK, inclusive em relações Cascade. */
export async function descartar(id, { versao } = {}) {
  const registro = await carregar(id);
  if (registro.status !== "RASCUNHO") {
    throw new OnboardingError(
      "somente_rascunho_pode_ser_descartado",
      "Só um rascunho pode ser descartado. Fichas já finalizadas viram histórico — use \"desistiu\".",
      409
    );
  }
  conferirVersao(registro, versao);
  try { await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM onboardings WHERE id = ${registro.id} FOR UPDATE`;
    // Serializa descarte e criação de demanda na mesma ficha antes de ler os vínculos.
    const trava = await tx.onboarding.updateMany({ where: { id: registro.id, versao: registro.versao, status: "RASCUNHO" }, data: { updatedAt: new Date() } });
    if (trava.count !== 1) throw new OnboardingError("formulario_alterado", "A ficha mudou. Atualize antes de descartar.", 409);
    const elegibilidade = await elegibilidadeDescarte(id, tx);
    if (!elegibilidade.podeExcluir) throw new OnboardingError("atendimento_tem_historico", "Esta ficha possui histórico. Encerre a oportunidade como desistência para preservá-lo.", 409, { impedimentos: elegibilidade.impedimentos });
    await tx.onboarding.delete({ where: { id: registro.id } });
  }, { isolationLevel: "ReadCommitted" }); } catch (e) {
    if (["P2003", "P2034"].includes(e.code)) throw new OnboardingError("atendimento_tem_historico", "Os vínculos mudaram. Confira a ficha antes de confirmar novamente.", 409);
    throw e;
  }
  return { ok: true };
}

export { CompanyProvisioningError };
