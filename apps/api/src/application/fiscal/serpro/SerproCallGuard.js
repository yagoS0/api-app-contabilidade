// Guarda de custo das chamadas ao SERPRO: registra todas e recusa as que não deveriam sair.
//
// POR QUE EXISTE
// As chamadas do Integra Contador são pagas e não havia NEM registro NEM teto. Duas coisas reais
// aconteceram por causa disso:
//  - o ajuste de "período desnecessário" da folha removia da lista errada e nunca convergia,
//    queimando até 14 consultas por clique sem entregar resultado — e ninguém viu, porque o erro
//    era engolido pelo front e não havia contador de chamadas;
//  - as rotas manuais de busca (extrato do Simples, tributos do Presumido) repetiam a cobrança a
//    cada clique; só o worker se protegia.
//
// AS DUAS TRAVAS
//  1. COOLDOWN por chamada idêntica — mesma empresa + mesmo serviço + MESMO PAYLOAD dentro da
//     janela. O payload entra no hash de propósito: corrigir um valor e recalcular não é repetição,
//     é trabalho. Isto mata o duplo clique e o laço que reenvia a mesma coisa.
//  2. TETO DIÁRIO por empresa — somando todos os serviços, no dia civil de São Paulo. É o que pega
//     laço defeituoso concentrado numa empresa, que foi o caso acima.
//
// O QUE ELA NÃO FAZ
// Não conhece limite comercial do SERPRO — isso é contrato, não código, e não se inventa. Os
// números são o orçamento que NÓS impomos (`config.js`), folgados por padrão.
//
// COMO ESCAPAR
// `comContextoSerpro({ forcar: true }, …)` passa por cima do teto (não do cooldown: repetir a mesma
// chamada idêntica em segundos nunca é o que se quer). O escape fica REGISTRADO com usuário.

import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { SERPRO_GUARDA_ATIVA, SERPRO_COOLDOWN_SEGUNDOS, SERPRO_TETO_DIARIO_EMPRESA } from "../../../config.js";
import { contextoSerproAtual } from "./serproCallContext.js";

export class SerproGuardError extends Error {
  constructor(code, message, detalhe = {}) {
    super(message);
    this.name = "SerproGuardError";
    this.code = code;
    this.detalhe = detalhe;
  }
}

/**
 * Identifica a chamada a partir do PRÓPRIO envelope do Integra Contador.
 *
 * Extrair daqui, e não de um parâmetro do chamador, é o que torna a guarda infalível: uma chamada
 * nova escrita amanhã é registrada e travada sem ninguém precisar lembrar de nada.
 */
export function identificarChamada(payload, rota) {
  const p = payload && typeof payload === "object" ? payload : {};
  const cnpj = String(p?.contribuinte?.numero || "").replace(/\D+/g, "");
  const pedido = p?.pedidoDados || {};
  return {
    cnpj,
    idSistema: pedido.idSistema ? String(pedido.idSistema) : null,
    idServico: pedido.idServico ? String(pedido.idServico) : null,
    rota: String(rota || ""),
    // O payload inteiro entra no hash: é ele que separa "cliquei de novo" de "mudei e recalculei".
    assinatura: crypto.createHash("sha256")
      .update(`${rota}|${JSON.stringify(payload ?? null)}`)
      .digest("hex"),
  };
}

/** Início do dia civil em São Paulo, em UTC — o teto é diário para o contador, não para o servidor. */
function inicioDoDiaSaoPaulo(agora = new Date()) {
  const emSp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const deslocamentoMs = agora.getTime() - emSp.getTime();
  const meiaNoiteSp = new Date(emSp.getFullYear(), emSp.getMonth(), emSp.getDate(), 0, 0, 0, 0);
  return new Date(meiaNoiteSp.getTime() + deslocamentoMs);
}

async function resolverPortalClientId(cnpj) {
  if (!cnpj) return null;
  const empresa = await prisma.portalClient.findFirst({
    where: { cnpj: { contains: cnpj } },
    select: { id: true },
  }).catch(() => null);
  return empresa?.id || null;
}

async function registrar(dados) {
  // Best-effort: a guarda existe para proteger o bolso, não para derrubar o fechamento se o log
  // falhar. Uma exceção aqui não pode impedir uma chamada que já foi autorizada.
  try { await prisma.serproChamada.create({ data: dados }); } catch { /* ignora */ }
}

/**
 * Autoriza (ou não) a chamada. Devolve o contexto que `concluir` usa para fechar o registro.
 * @throws {SerproGuardError} quando o cooldown ou o teto barram
 */
export async function autorizarChamada({ payload, rota }) {
  const id = identificarChamada(payload, rota);
  const ctx = contextoSerproAtual();
  const base = {
    cnpj: id.cnpj,
    idSistema: id.idSistema,
    idServico: id.idServico,
    rota: id.rota,
    assinatura: id.assinatura,
    origem: ctx.origem || null,
    userId: ctx.userId || null,
  };

  if (!SERPRO_GUARDA_ATIVA || !id.cnpj) {
    // Sem CNPJ de contribuinte (autenticação, apoio) não há empresa a quem imputar o teto — só
    // registra. Desligar a guarda pela env também mantém o registro: medir nunca atrapalha.
    return { ...base, portalClientId: await resolverPortalClientId(id.cnpj), inicio: Date.now(), forcado: false };
  }

  const portalClientId = await resolverPortalClientId(id.cnpj);

  // 1) Cooldown por chamada idêntica.
  if (SERPRO_COOLDOWN_SEGUNDOS > 0) {
    const desde = new Date(Date.now() - SERPRO_COOLDOWN_SEGUNDOS * 1000);
    const igual = await prisma.serproChamada.findFirst({
      where: { assinatura: id.assinatura, status: "ok", createdAt: { gte: desde } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }).catch(() => null);
    if (igual) {
      const segundos = Math.max(1, Math.ceil((igual.createdAt.getTime() + SERPRO_COOLDOWN_SEGUNDOS * 1000 - Date.now()) / 1000));
      await registrar({ ...base, portalClientId, status: "recusada_cooldown" });
      throw new SerproGuardError(
        "SERPRO_CHAMADA_REPETIDA",
        `Esta mesma consulta ao SERPRO (${id.idServico || id.rota}) foi feita há pouco e é paga. Aguarde ${segundos}s ou mude algo antes de repetir.`,
        { idServico: id.idServico, segundosRestantes: segundos },
      );
    }
  }

  // 2) Teto diário por empresa.
  // ⚠ Conta "ok" E "erro": chamada que chegou ao SERPRO e voltou com rejeição de negócio foi
  // cobrada do mesmo jeito. Contar só o sucesso deixaria de fora exatamente o laço defeituoso que
  // este teto existe para pegar — ele falhava 14 vezes seguidas.
  if (SERPRO_TETO_DIARIO_EMPRESA > 0) {
    const usadas = await prisma.serproChamada.count({
      where: { cnpj: id.cnpj, status: { in: ["ok", "erro"] }, createdAt: { gte: inicioDoDiaSaoPaulo() } },
    }).catch(() => 0);
    if (usadas >= SERPRO_TETO_DIARIO_EMPRESA) {
      if (!ctx.forcar) {
        await registrar({ ...base, portalClientId, status: "recusada_teto" });
        throw new SerproGuardError(
          "SERPRO_TETO_DIARIO",
          `Esta empresa já consumiu ${usadas} consultas pagas ao SERPRO hoje (teto ${SERPRO_TETO_DIARIO_EMPRESA}). Um ADMIN pode liberar, ou tente amanhã.`,
          { usadas, teto: SERPRO_TETO_DIARIO_EMPRESA },
        );
      }
      return { ...base, portalClientId, inicio: Date.now(), forcado: true };
    }
  }

  return { ...base, portalClientId, inicio: Date.now(), forcado: false };
}

/** Fecha o registro da chamada autorizada, com o desfecho. */
export async function concluirChamada(autorizacao, { httpStatus = null, erroCodigo = null } = {}) {
  if (!autorizacao) return;
  const { inicio, ...base } = autorizacao;
  await registrar({
    ...base,
    status: erroCodigo ? "erro" : "ok",
    httpStatus,
    erroCodigo,
    duracaoMs: inicio ? Date.now() - inicio : null,
  });
}
