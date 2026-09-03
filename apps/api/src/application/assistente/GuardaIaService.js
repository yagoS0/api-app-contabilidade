// A GUARDA DE CUSTO DO ASSISTENTE — registro de toda chamada ao modelo e o teto mensal.
//
// Molde: `fiscal/serpro/SerproCallGuard.js` + `serpro_chamadas`. As diferenças são decisão, e estão
// escritas:
//
// ⚠⚠ FALHA FECHADO. A guarda do SERPRO falha ABERTO porque derrubar o fechamento do mês por erro no
// contador de orçamento seria pior que o gasto que ela evita. Aqui é o contrário: o assistente é
// conveniência, o cliente tem o portal, e um laço fora de controle gasta dinheiro EM SILÊNCIO —
// ninguém está olhando uma conversa de WhatsApp às 3h da manhã. Sem conseguir contar, não se chama.
//
// ⚠ DOIS TETOS, os dois em CENTAVOS DE DÓLAR (a API cobra em USD): por EMPRESA no mês e do
// ESCRITÓRIO no mês. O custo é ESTIMADO pela tabela versionada de `precosIa.js`; o que se protege é
// a ordem de grandeza, não o centavo.
//
// ⚠ Sem `ANTHROPIC_API_KEY` a recusa é `recusada_config`, registrada — ausência silenciosa é o que
// faz o dono descobrir no piloto que "a IA não responde".

import { prisma } from "../../infrastructure/db/prisma.js";
import {
  ANTHROPIC_API_KEY,
  IA_MODELO,
  IA_TETO_MENSAL_EMPRESA_CENTAVOS,
  IA_TETO_MENSAL_ESCRITORIO_CENTAVOS,
  IA_ALERTA_FRACAO,
  log as logPadrao,
} from "../../config.js";
import { custoEstimadoCentavos } from "./precosIa.js";

export const STATUS_CHAMADA = Object.freeze({
  OK: "ok",
  ERRO: "erro",
  RECUSADA_TETO: "recusada_teto",
  RECUSADA_CONFIG: "recusada_config",
});

export const MOTIVOS_RECUSA = Object.freeze({
  SEM_CHAVE: "SEM_CHAVE",
  TETO_EMPRESA: "TETO_EMPRESA",
  TETO_ESCRITORIO: "TETO_ESCRITORIO",
  CONTAGEM_FALHOU: "CONTAGEM_FALHOU",
});

/** A frase que o cliente lê quando a guarda recusa — nunca o orçamento, nunca o número. */
export const FRASE_TETO = "O assistente atingiu o limite de uso deste mês. Sua mensagem foi registrada e o escritório responde por aqui.";
export const FRASE_CONFIG = "O assistente não está disponível agora. Sua mensagem foi registrada e o escritório responde por aqui.";

/** Início do MÊS civil em São Paulo, em UTC — o teto acompanha o mês do contador (o mesmo cálculo do SERPRO). */
export function inicioDoMesSaoPaulo(agora = new Date()) {
  const emSp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const deslocamentoMs = agora.getTime() - emSp.getTime();
  const primeiroDiaSp = new Date(emSp.getFullYear(), emSp.getMonth(), 1, 0, 0, 0, 0);
  return new Date(primeiroDiaSp.getTime() + deslocamentoMs);
}

async function somaDoMes(where, client) {
  const r = await client.chamadaIa.aggregate({
    _sum: { custoEstimadoCentavos: true },
    _count: { _all: true },
    where: { ...where, status: { in: [STATUS_CHAMADA.OK, STATUS_CHAMADA.ERRO] } },
  });
  return { centavos: Number(r?._sum?.custoEstimadoCentavos || 0), chamadas: Number(r?._count?._all || 0) };
}

/**
 * O consumo do mês — do escritório e, se pedido, de uma empresa. É o que a tela de conversas mostra.
 * ⚠ AQUI pode falhar aberto (é leitura de tela): devolve `null` no erro e a tela diz que não sabe.
 */
export async function consumoIaDoMes({ portalClientId = null, agora = new Date(), client = prisma } = {}) {
  const desde = inicioDoMesSaoPaulo(agora);
  try {
    const escritorio = await somaDoMes({ createdAt: { gte: desde } }, client);
    const empresa = portalClientId ? await somaDoMes({ portalClientId: String(portalClientId), createdAt: { gte: desde } }, client) : null;
    const fracao = IA_TETO_MENSAL_ESCRITORIO_CENTAVOS > 0 ? escritorio.centavos / IA_TETO_MENSAL_ESCRITORIO_CENTAVOS : 0;
    return {
      desde,
      moeda: "USD",
      estimativa: true,
      escritorio: {
        centavos: escritorio.centavos,
        chamadas: escritorio.chamadas,
        teto: IA_TETO_MENSAL_ESCRITORIO_CENTAVOS,
        restantes: Math.max(0, IA_TETO_MENSAL_ESCRITORIO_CENTAVOS - escritorio.centavos),
        fracao: Math.round(fracao * 100) / 100,
        alerta: fracao >= IA_ALERTA_FRACAO && fracao < 1,
        estourado: IA_TETO_MENSAL_ESCRITORIO_CENTAVOS > 0 && escritorio.centavos >= IA_TETO_MENSAL_ESCRITORIO_CENTAVOS,
      },
      empresa: empresa
        ? {
          portalClientId: String(portalClientId),
          centavos: empresa.centavos,
          chamadas: empresa.chamadas,
          teto: IA_TETO_MENSAL_EMPRESA_CENTAVOS,
          estourado: IA_TETO_MENSAL_EMPRESA_CENTAVOS > 0 && empresa.centavos >= IA_TETO_MENSAL_EMPRESA_CENTAVOS,
        }
        : null,
    };
  } catch {
    return null;
  }
}

async function registrar(dados, client, log) {
  try {
    await client.chamadaIa.create({ data: dados });
  } catch (err) {
    // ⚠ Aqui NÃO se engole em silêncio como no SERPRO: uma chamada que aconteceu e não foi
    // registrada é exatamente o buraco pelo qual o teto deixa de valer.
    log?.error?.({ err: err?.message, status: dados?.status }, "assistente: falha ao registrar chamada_ia");
  }
}

/**
 * AUTORIZA (ou recusa) uma chamada ao modelo. Devolve o contexto que `concluirChamadaIa` fecha.
 *
 * @returns {Promise<{ok:true, contexto:object}|{ok:false, motivo:string, mensagem:string}>}
 */
/**
 * ⚠⚠ `finalidade` ENTROU EM 02/09/2026, quando a IA passou a ter DUAS finalidades (o assistente do
 * WhatsApp e a classificação de lançamentos). Sem ela o teto mensal do escritório mistura as duas, e
 * ninguém consegue dizer para onde o dinheiro foi — nem desligar uma sem desligar a outra.
 * ⚠ `null` = chamada anterior à coluna, ou o assistente (que ainda não a informa). Não se inventa
 * finalidade para o que já está gravado.
 */
export const FINALIDADE_IA = Object.freeze({
  ASSISTENTE_WHATSAPP: "assistente_whatsapp",
  CLASSIFICACAO_LANCAMENTOS: "classificacao_lancamentos",
});

export async function autorizarChamadaIa({ portalClientId, conversaId, mensagemId, finalidade = null, agora = new Date(), client = prisma, log = logPadrao, chave = ANTHROPIC_API_KEY } = {}) {
  const base = {
    conversaId: conversaId ? String(conversaId) : null,
    portalClientId: portalClientId ? String(portalClientId) : null,
    mensagemId: mensagemId ? String(mensagemId) : null,
    finalidade: finalidade ? String(finalidade) : null,
    modelo: IA_MODELO,
  };

  if (!chave) {
    await registrar({ ...base, status: STATUS_CHAMADA.RECUSADA_CONFIG, erroCodigo: MOTIVOS_RECUSA.SEM_CHAVE }, client, log);
    log?.warn?.({ conversaId: base.conversaId }, "assistente: ANTHROPIC_API_KEY ausente — recusado");
    return { ok: false, motivo: MOTIVOS_RECUSA.SEM_CHAVE, mensagem: FRASE_CONFIG };
  }

  let consumo;
  try {
    const desde = inicioDoMesSaoPaulo(agora);
    consumo = {
      empresa: base.portalClientId ? await somaDoMes({ portalClientId: base.portalClientId, createdAt: { gte: desde } }, client) : { centavos: 0 },
      escritorio: await somaDoMes({ createdAt: { gte: desde } }, client),
    };
  } catch (err) {
    // ⚠⚠ FALHA FECHADO — ver o cabeçalho.
    log?.error?.({ err: err?.message }, "assistente: não consegui contar o consumo do mês — recusado (falha fechado)");
    await registrar({ ...base, status: STATUS_CHAMADA.RECUSADA_CONFIG, erroCodigo: MOTIVOS_RECUSA.CONTAGEM_FALHOU, erroMensagem: String(err?.message || "").slice(0, 300) }, client, log);
    return { ok: false, motivo: MOTIVOS_RECUSA.CONTAGEM_FALHOU, mensagem: FRASE_CONFIG };
  }

  if (IA_TETO_MENSAL_EMPRESA_CENTAVOS > 0 && consumo.empresa.centavos >= IA_TETO_MENSAL_EMPRESA_CENTAVOS) {
    await registrar({ ...base, status: STATUS_CHAMADA.RECUSADA_TETO, erroCodigo: MOTIVOS_RECUSA.TETO_EMPRESA }, client, log);
    log?.warn?.({ portalClientId: base.portalClientId, centavos: consumo.empresa.centavos, teto: IA_TETO_MENSAL_EMPRESA_CENTAVOS }, "assistente: teto mensal da EMPRESA atingido");
    return { ok: false, motivo: MOTIVOS_RECUSA.TETO_EMPRESA, mensagem: FRASE_TETO };
  }
  if (IA_TETO_MENSAL_ESCRITORIO_CENTAVOS > 0 && consumo.escritorio.centavos >= IA_TETO_MENSAL_ESCRITORIO_CENTAVOS) {
    await registrar({ ...base, status: STATUS_CHAMADA.RECUSADA_TETO, erroCodigo: MOTIVOS_RECUSA.TETO_ESCRITORIO }, client, log);
    log?.warn?.({ centavos: consumo.escritorio.centavos, teto: IA_TETO_MENSAL_ESCRITORIO_CENTAVOS }, "assistente: teto mensal do ESCRITÓRIO atingido");
    return { ok: false, motivo: MOTIVOS_RECUSA.TETO_ESCRITORIO, mensagem: FRASE_TETO };
  }
  const fracao = IA_TETO_MENSAL_ESCRITORIO_CENTAVOS > 0 ? consumo.escritorio.centavos / IA_TETO_MENSAL_ESCRITORIO_CENTAVOS : 0;
  if (fracao >= IA_ALERTA_FRACAO) {
    log?.warn?.({ fracao: Math.round(fracao * 100) / 100 }, "assistente: consumo do mês acima da fração de alerta");
  }
  return { ok: true, contexto: { ...base, inicio: Date.now() } };
}

/**
 * FECHA o registro de uma chamada autorizada, com o desfecho e o custo estimado.
 * @param {object} contexto  o de `autorizarChamadaIa`
 * @param {object} desfecho  `{ usage, iteracoes, ferramentas, stopReason, erroCodigo, erroMensagem }`
 */
export async function concluirChamadaIa(contexto, { usage = null, iteracoes = 0, ferramentas = [], stopReason = null, erroCodigo = null, erroMensagem = null } = {}, { client = prisma, log = logPadrao } = {}) {
  if (!contexto) return;
  const { inicio, ...base } = contexto;
  const u = usage || {};
  await registrar({
    ...base,
    status: erroCodigo ? STATUS_CHAMADA.ERRO : STATUS_CHAMADA.OK,
    inputTokens: Number(u.input_tokens || 0),
    outputTokens: Number(u.output_tokens || 0),
    cacheReadTokens: Number(u.cache_read_input_tokens || 0),
    cacheCreationTokens: Number(u.cache_creation_input_tokens || 0),
    custoEstimadoCentavos: custoEstimadoCentavos(u, base.modelo),
    duracaoMs: inicio ? Date.now() - inicio : null,
    iteracoes: Number(iteracoes || 0),
    ferramentas: Array.isArray(ferramentas) ? ferramentas : [],
    stopReason: stopReason ? String(stopReason) : null,
    erroCodigo: erroCodigo ? String(erroCodigo) : null,
    erroMensagem: erroMensagem ? String(erroMensagem).slice(0, 300) : null,
  }, client, log);
}
