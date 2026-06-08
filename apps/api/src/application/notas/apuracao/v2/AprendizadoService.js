// Q14.2.c — Aprendizado a partir de resolução de pendência.
//
// Quando contador resolve uma FilaPendencia(ITEM_SEM_REGRA) escolhendo
// um TipoReceita, opcionalmente cria:
//   - RegraClassificacao escopo EMPRESA com fonte=APRENDIZADO (vale só pra essa empresa)
//     OU
//   - ProdutoServico cadastrado da empresa (se contador preferir um cadastro nomeado)
//
// Depois reclassifica TODAS as ocorrências do mesmo código pra essa empresa,
// pra resolver de uma vez as N notas que estavam paradas.

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { classificarItensV2 } from "./ClassificadorService.js";

const TIPOS_RECEITA_VALIDOS = new Set([
  "REVENDA_MERCADORIA",
  "INDUSTRIALIZACAO",
  "SERVICO_ANEXO_III",
  "SERVICO_ANEXO_IV",
  "SERVICO_ANEXO_V",
  "SERVICO_FATOR_R",
]);

/**
 * Resolve uma pendência ITEM_SEM_REGRA.
 *
 * @param {Object} opts
 * @param {string} opts.pendenciaId
 * @param {string} opts.tipoReceita — TipoReceita escolhido pelo contador
 * @param {boolean} [opts.criarRegra=true] — se true, cria RegraClassificacao escopo EMPRESA
 * @param {string} [opts.nomeProduto] — se preenchido, também cria ProdutoServico nomeado
 * @param {string} opts.userId
 * @returns {Promise<{ok, regraCriada, produtoCriado, reclassificacao}>}
 */
export async function resolverPendenciaItemSemRegra({
  pendenciaId, tipoReceita, criarRegra = true, nomeProduto, userId,
}) {
  if (!TIPOS_RECEITA_VALIDOS.has(tipoReceita)) {
    throw new Error(`tipoReceita inválido: ${tipoReceita}`);
  }
  const pend = await prisma.filaPendencia.findUnique({ where: { id: pendenciaId } });
  if (!pend) throw new Error("pendencia_not_found");
  if (pend.resolvida) throw new Error("pendencia_ja_resolvida");
  if (pend.tipo !== "ITEM_SEM_REGRA") throw new Error("tipo_pendencia_invalido");

  const codigo = pend.detalhes?.codigo;
  const tipoCodigoRaw = pend.detalhes?.tipoCodigo;
  if (!codigo) throw new Error("pendencia_sem_codigo");

  // Normaliza tipoCodigo (pendência guarda "LC116/CTRIBNAC" — escolhe LC116 por default)
  const tipoCodigo = String(tipoCodigoRaw || "").includes("LC")
    ? "LC116"
    : String(tipoCodigoRaw || "").includes("NCM")
      ? "NCM"
      : String(tipoCodigoRaw || "").includes("CFOP")
        ? "CFOP"
        : "LC116";

  let regraCriada = null;
  let produtoCriado = null;

  if (criarRegra) {
    // Idempotente: se já existir regra empresa pro mesmo código, atualiza
    const existing = await prisma.regraClassificacao.findFirst({
      where: {
        escopo: "EMPRESA",
        portalClientId: pend.portalClientId,
        tipoCodigo, codigo,
        vigenciaFim: null,
      },
    });
    if (existing) {
      regraCriada = await prisma.regraClassificacao.update({
        where: { id: existing.id },
        data: { tipoReceita, fonte: "APRENDIZADO", createdByUserId: userId },
      });
    } else {
      regraCriada = await prisma.regraClassificacao.create({
        data: {
          escopo: "EMPRESA",
          portalClientId: pend.portalClientId,
          tipoCodigo, codigo, tipoReceita,
          prioridade: 100, // EMPRESA bate global
          fonte: "APRENDIZADO",
          descricao: `Aprendido em resolução de pendência ${pendenciaId.slice(0, 8)}`,
          createdByUserId: userId,
        },
      });
    }
  }

  if (nomeProduto && nomeProduto.trim()) {
    produtoCriado = await prisma.produtoServico.create({
      data: {
        portalClientId: pend.portalClientId,
        nome: nomeProduto.trim(),
        tipoReceita,
        codigoServico: tipoCodigo === "LC116" ? codigo : null,
        ncm: tipoCodigo === "NCM" ? codigo : null,
        cfop: tipoCodigo === "CFOP" ? codigo : null,
        origem: "APRENDIDO_DA_NOTA",
        createdByUserId: userId,
      },
    });
  }

  // Marca pendência como resolvida
  await prisma.filaPendencia.update({
    where: { id: pendenciaId },
    data: {
      resolvida: true,
      resolvidaEm: new Date(),
      resolvidaPor: userId || null,
      acaoResolucao: criarRegra ? (nomeProduto ? "CRIOU_PRODUTO" : "CRIOU_REGRA") : "REENQUADROU",
    },
  });

  // Reclassifica TODAS as ocorrências do mesmo código pra essa empresa
  // (notas que estavam paradas viram classificadas em batch)
  let reclassificacao = null;
  if (criarRegra || produtoCriado) {
    reclassificacao = await classificarItensV2({
      portalClientId: pend.portalClientId,
      force: true,
    });
  }

  return {
    ok: true,
    regraCriada: regraCriada ? { id: regraCriada.id, tipoReceita: regraCriada.tipoReceita } : null,
    produtoCriado: produtoCriado ? { id: produtoCriado.id, nome: produtoCriado.nome } : null,
    reclassificacao,
  };
}

/**
 * Resolve uma pendência DIVERGENCIA_CADASTRO.
 * Contador escolhe se quer atualizar o cadastro (mudar CNAE/regime) ou ignorar.
 */
export async function resolverPendenciaDivergencia({ pendenciaId, acao, userId }) {
  const pend = await prisma.filaPendencia.findUnique({ where: { id: pendenciaId } });
  if (!pend) throw new Error("pendencia_not_found");
  if (pend.resolvida) throw new Error("pendencia_ja_resolvida");
  if (pend.tipo !== "DIVERGENCIA_CADASTRO") throw new Error("tipo_pendencia_invalido");

  await prisma.filaPendencia.update({
    where: { id: pendenciaId },
    data: {
      resolvida: true,
      resolvidaEm: new Date(),
      resolvidaPor: userId || null,
      acaoResolucao: acao === "atualizar_cadastro" ? "REENQUADROU" : "IGNOROU",
    },
  });
  return { ok: true };
}

export { TIPOS_RECEITA_VALIDOS };
