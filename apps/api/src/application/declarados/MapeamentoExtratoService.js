// O MAPEAMENTO DE EXTRATO EM EXCEL — a ligação com o banco. **O único caminho de escrita.**
//
// ⚠ A REGRA NÃO É REIMPLEMENTADA AQUI. Quem diz se um mapeamento é válido é `validarMapeamento`
// (`lib/mapeamentoDoExtrato.js`, puro, com teste próprio); quem propõe é `proporMapeamento`. Este
// arquivo lê, grava e traduz recusa — nada mais.
//
// ⚠⚠ CONFIRMAR É ATO DE UMA PESSOA, E É A ÚNICA PORTA QUE LIGA `confirmado`. Nenhum outro caminho
// de código o vira: o import grava PROPOSTA (`confirmado: false`) e para aí. Sem isso a trava da
// fase seria uma convenção, não um fato.

import { prisma } from "../../infrastructure/db/prisma.js";
import { DeclaradoRecusado } from "./DeclaradoService.js";
import {
  fraseDoErroDeMapeamento,
  proporMapeamento,
  validarMapeamento,
} from "./lib/mapeamentoDoExtrato.js";

export const RECUSA_DO_MAPEAMENTO = Object.freeze({
  SEM_ASSINATURA: "mapeamento_sem_assinatura",
  NAO_ENCONTRADO: "mapeamento_nao_encontrado",
  /** ⚠ Confirmar um mapeamento incompleto ou ambíguo é o que a trava existe para impedir. */
  INVALIDO: "mapeamento_invalido",
  INDISPONIVEL: "mapeamento_indisponivel",
});

export const FRASE_DO_MAPEAMENTO = Object.freeze({
  [RECUSA_DO_MAPEAMENTO.SEM_ASSINATURA]: "Não foi informado de qual formato de planilha é este mapeamento.",
  [RECUSA_DO_MAPEAMENTO.NAO_ENCONTRADO]: "Este mapeamento não existe para esta empresa.",
  [RECUSA_DO_MAPEAMENTO.INVALIDO]:
    "Este mapeamento não pode ser confirmado como está — confira as colunas indicadas.",
  [RECUSA_DO_MAPEAMENTO.INDISPONIVEL]:
    "O mapeamento de extrato em Excel ainda não está disponível neste ambiente.",
});

const recusar = (codigo, extra = {}) => {
  const err = new DeclaradoRecusado(codigo, FRASE_DO_MAPEAMENTO[codigo] || "");
  Object.assign(err, extra);
  throw err;
};

const indisponivel = (client) => !client?.mapeamentoExtrato;

/**
 * Os mapeamentos desta empresa.
 *
 * ⚠ Sem a migration aplicada, devolve lista vazia com `indisponivel: true` — **nunca 500**. É o
 * mesmo tratamento de `GET /conferencia/regras` para o P2021: a tela diz o que houve em vez de
 * quebrar, e "não há mapeamento" e "a tabela não existe" são respostas diferentes.
 */
export async function listarMapeamentos(portalClientId, client = prisma) {
  if (indisponivel(client)) return { mapeamentos: [], indisponivel: true };
  try {
    const linhas = await client.mapeamentoExtrato.findMany({
      where: { portalClientId: String(portalClientId) },
      orderBy: { atualizadoEm: "desc" },
    });
    return {
      mapeamentos: linhas.map((m) => ({
        ...m,
        // ⚠ A VALIDADE É DERIVADA NA LEITURA, nunca coluna. Um mapeamento gravado antes de a regra
        // mudar continuaria dizendo "válido" numa coluna congelada — o defeito de
        // `divergenciaDeFonte.js`, e o motivo de `contaSugerida` não ser lida da coluna.
        validacao: validarMapeamento({ colunas: m.colunas, sinal: m.sinal, confirmado: m.confirmado }),
      })),
      indisponivel: false,
    };
  } catch (e) {
    if (e?.code === "P2021") return { mapeamentos: [], indisponivel: true };
    throw e;
  }
}

/**
 * Grava (ou atualiza) um mapeamento — e, com `confirmar`, o CONFIRMA.
 *
 * ⚠⚠ A VALIDAÇÃO RODA ANTES DE CONFIRMAR, e a recusa NOMEIA cada erro com a frase pronta. Sem isso
 * o contador descobriria o problema no próximo envio, com o extrato inteiro recusado e sem saber
 * qual coluna faltava.
 *
 * ⚠ Salvar SEM confirmar é permitido (o contador ajusta em duas sessões) e **nunca liga** o
 * `confirmado`: mexer no mapeamento não é reafirmá-lo.
 *
 * @param {boolean} args.confirmar quando `true`, exige mapeamento válido e grava quem/quando
 * @param {Date} args.agora ⚠ injetado — este serviço não lê o relógio
 */
export async function salvarMapeamento({
  portalClientId,
  assinatura,
  colunas,
  sinal,
  rotulo,
  cabecalhoVisto = null,
  confirmar = false,
  confirmadoPor = null,
  agora = null,
  client = prisma,
}) {
  if (indisponivel(client)) recusar(RECUSA_DO_MAPEAMENTO.INDISPONIVEL);

  const chave = String(assinatura || "").trim();
  if (!chave) recusar(RECUSA_DO_MAPEAMENTO.SEM_ASSINATURA);

  let existente;
  try {
    existente = await client.mapeamentoExtrato.findUnique({
      where: { portalClientId_assinatura: { portalClientId: String(portalClientId), assinatura: chave } },
    });
  } catch (e) {
    if (e?.code === "P2021") recusar(RECUSA_DO_MAPEAMENTO.INDISPONIVEL);
    throw e;
  }

  // ⚠ Campo ausente NÃO apaga o que já estava: `undefined` é "não mexer", e é a regra do
  // `PATCH /emissao-nfse`. Um `data` com todos os campos sempre apagaria o rótulo a cada salvar.
  const colunasFinais = colunas === undefined ? existente?.colunas : colunas;
  const sinalFinal = sinal === undefined ? existente?.sinal : sinal;

  if (confirmar) {
    // ⚠⚠ A validação é feita sobre o que VAI FICAR GRAVADO, com `confirmado: true` — é exatamente o
    // estado que o import vai encontrar. Validar o que veio no corpo deixaria passar a confirmação
    // de um mapeamento cujo campo ausente veio do registro antigo e está incompleto.
    const v = validarMapeamento({ colunas: colunasFinais, sinal: sinalFinal, confirmado: true });
    if (!v.ok) {
      recusar(RECUSA_DO_MAPEAMENTO.INVALIDO, {
        erros: v.erros.map((e) => ({ ...e, frase: fraseDoErroDeMapeamento(e.motivo) })),
      });
    }
  }

  const carimbo = agora instanceof Date && !Number.isNaN(agora.getTime()) ? agora : new Date();
  const dados = {
    ...(colunas === undefined ? {} : { colunas }),
    ...(sinal === undefined ? {} : { sinal }),
    ...(rotulo === undefined ? {} : { rotulo: rotulo === null ? null : String(rotulo).trim() || null }),
    ...(cabecalhoVisto === null ? {} : { cabecalhoVisto }),
    ...(confirmar
      ? { confirmado: true, confirmadoEm: carimbo, confirmadoPor: String(confirmadoPor || "") || null }
      : {}),
  };

  if (!existente) {
    // ⚠ Sem registro anterior, criar exige as duas colunas — não há de onde herdá-las, e gravar um
    // mapeamento sem `colunas` produziria uma linha que o import lê como inválida sem explicação.
    if (colunasFinais === undefined || sinalFinal === undefined) {
      recusar(RECUSA_DO_MAPEAMENTO.NAO_ENCONTRADO);
    }
    return client.mapeamentoExtrato.create({
      data: {
        portalClientId: String(portalClientId),
        assinatura: chave,
        colunas: colunasFinais,
        sinal: sinalFinal,
        cabecalhoVisto,
        confirmado: false,
        ...dados,
      },
    });
  }

  return client.mapeamentoExtrato.update({ where: { id: existente.id }, data: dados });
}

export { proporMapeamento, validarMapeamento };
