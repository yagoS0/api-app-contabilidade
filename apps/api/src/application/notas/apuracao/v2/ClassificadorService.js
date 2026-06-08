// Q14.2.a — Classificador v2 (cadastro = autoridade, nota = sinal).
//
// Princípio inegociável: nunca chuta. Sem regra → fila de pendência.
//
// Ordem de tentativa por item de nota:
//   1. ProdutoServico cadastrado da empresa (match exato em codigoServico/ncm/cfop)
//   2. RegraClassificacao escopo EMPRESA com vigência ativa
//   3. RegraClassificacao escopo GLOBAL com vigência ativa, match exato
//   4. RegraClassificacao escopo GLOBAL — capítulo LC116 (fallback)
//   5. Conferência contra CadastroFiscal (CNAE da empresa sugere tipoReceita?)
//   6. → cria FilaPendencia(ITEM_SEM_REGRA) e MARCA tipoReceita = RECEITA_NAO_CLASSIFICADA
//
// Adicional: se a empresa tem cadastro e o tipoReceita resolvido diverge
// do que o CnaeAnexo do CNAE principal sugere, cria FilaPendencia(DIVERGENCIA_CADASTRO)
// como WARN (não bloqueia, mas avisa). Item segue classificado.

import { prisma } from "../../../../infrastructure/db/prisma.js";

// cTribNac (NFS-e Nacional) → LC116 (ex: "010801" → "1.08")
// Pra reutilizar regras LC116 quando a nota vem com cTribNac.
function cTribNacToLc116(codigo) {
  const digits = String(codigo || "").replace(/\D+/g, "");
  if (digits.length !== 6) return null;
  const cap = parseInt(digits.slice(0, 2), 10);
  const item = parseInt(digits.slice(2, 4), 10);
  if (!cap || !item) return null;
  return `${cap}.${String(item).padStart(2, "0")}`;
}

// Extrai capítulo (prefixo) de um código LC116 ou cTribNac
function extractCapitulo(codigo) {
  const s = String(codigo || "");
  if (s.includes(".")) return s.split(".")[0];
  const digits = s.replace(/\D+/g, "");
  if (digits.length >= 2) return String(parseInt(digits.slice(0, 2), 10));
  return null;
}

/**
 * Pré-carrega tudo que o classificador precisa pra uma empresa,
 * pra evitar N queries em loop. Retorna mapas indexados.
 */
async function loadContextoEmpresa(portalClientId, dataReferencia = new Date()) {
  const [produtos, regrasEmpresa, regrasGlobais, cadastro] = await Promise.all([
    prisma.produtoServico.findMany({
      where: { portalClientId, ativo: true },
      select: { codigoServico: true, ncm: true, cfop: true, tipoReceita: true, nome: true },
    }),
    prisma.regraClassificacao.findMany({
      where: {
        escopo: "EMPRESA",
        portalClientId,
        OR: [
          { vigenciaInicio: null },
          { vigenciaInicio: { lte: dataReferencia } },
        ],
        AND: [
          { OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: dataReferencia } }] },
        ],
      },
      select: { tipoCodigo: true, codigo: true, tipoReceita: true, prioridade: true },
    }),
    prisma.regraClassificacao.findMany({
      where: {
        escopo: "GLOBAL",
        OR: [
          { vigenciaInicio: null },
          { vigenciaInicio: { lte: dataReferencia } },
        ],
        AND: [
          { OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: dataReferencia } }] },
        ],
      },
      select: { tipoCodigo: true, codigo: true, tipoReceita: true, prioridade: true },
    }),
    prisma.cadastroFiscal.findUnique({
      where: { portalClientId },
      select: { cnaePrincipal: true, regime: true, forcarTipoReceitaPorCnae: true },
    }),
  ]);

  // Index produtos por código pra lookup O(1)
  const produtosMap = new Map();
  for (const p of produtos) {
    if (p.codigoServico) produtosMap.set(`codigoServico:${p.codigoServico}`, p);
    if (p.ncm) produtosMap.set(`ncm:${p.ncm}`, p);
    if (p.cfop) produtosMap.set(`cfop:${p.cfop}`, p);
  }

  // Index regras: priorizar EMPRESA > GLOBAL. Dentro de cada escopo, item exato > capítulo.
  function indexRegras(regras) {
    const map = new Map();
    for (const r of regras) {
      const key = `${r.tipoCodigo}:${r.codigo}`;
      const existing = map.get(key);
      if (!existing || (r.prioridade || 0) > (existing.prioridade || 0)) {
        map.set(key, r);
      }
    }
    return map;
  }
  const regrasEmpresaMap = indexRegras(regrasEmpresa);
  const regrasGlobaisMap = indexRegras(regrasGlobais);

  // CNAE da empresa: usado pra sugestão de divergência OU (se flag ligada) override total.
  let tipoReceitaPorCnae = null;
  if (cadastro?.cnaePrincipal) {
    const cnaeRef = await prisma.cnaeAnexo.findUnique({
      where: { cnae: cadastro.cnaePrincipal },
      select: { tipoReceitaSugerido: true, ambiguo: true },
    });
    if (cnaeRef) {
      tipoReceitaPorCnae = {
        tipoReceita: cnaeRef.tipoReceitaSugerido,
        ambiguo: cnaeRef.ambiguo,
      };
    }
  }

  return {
    produtosMap, regrasEmpresaMap, regrasGlobaisMap, cadastro, tipoReceitaPorCnae,
    forcarCnae: !!cadastro?.forcarTipoReceitaPorCnae,
  };
}

/**
 * Tenta classificar 1 item dado o contexto pré-carregado.
 * @returns { tipoReceita, source, hint? }
 *   source: PRODUTO | REGRA_EMPRESA | REGRA_GLOBAL_ITEM | REGRA_GLOBAL_CAPITULO | NONE
 */
function classifyItem(item, ctx) {
  // Q14.4.d: override total por CNAE — cadastro vence todas as outras regras.
  // Usar com cautela; viola "nota é sinal", mas útil pra mono-atividade.
  if (ctx.forcarCnae && ctx.tipoReceitaPorCnae && !ctx.tipoReceitaPorCnae.ambiguo) {
    return { tipoReceita: ctx.tipoReceitaPorCnae.tipoReceita, source: "CNAE_OVERRIDE" };
  }

  // 1. Match em ProdutoServico cadastrado
  if (item.codigoServico) {
    const p = ctx.produtosMap.get(`codigoServico:${item.codigoServico}`);
    if (p) return { tipoReceita: p.tipoReceita, source: "PRODUTO" };
  }
  if (item.ncm) {
    const p = ctx.produtosMap.get(`ncm:${item.ncm}`);
    if (p) return { tipoReceita: p.tipoReceita, source: "PRODUTO" };
  }
  if (item.cfop) {
    const p = ctx.produtosMap.get(`cfop:${item.cfop}`);
    if (p) return { tipoReceita: p.tipoReceita, source: "PRODUTO" };
  }

  // 2/3/4. Regras EMPRESA → GLOBAL → capítulo
  // Constrói candidatos por tipoCodigo+codigo: exato + capítulo
  const candidatos = [];
  if (item.codigoServico) {
    const raw = String(item.codigoServico);
    candidatos.push({ tipoCodigo: "LC116", codigo: raw }); // se já for LC116
    const lc = cTribNacToLc116(raw);
    if (lc && lc !== raw) candidatos.push({ tipoCodigo: "LC116", codigo: lc });
    candidatos.push({ tipoCodigo: "CTRIBNAC", codigo: raw });
    // capítulo (fallback)
    const cap = extractCapitulo(lc || raw);
    if (cap) candidatos.push({ tipoCodigo: "LC116", codigo: cap, isFallback: true });
  }
  if (item.ncm) candidatos.push({ tipoCodigo: "NCM", codigo: String(item.ncm) });
  if (item.cfop) candidatos.push({ tipoCodigo: "CFOP", codigo: String(item.cfop) });

  // Tenta EMPRESA primeiro (exatos antes de capítulo)
  for (const c of candidatos.filter((x) => !x.isFallback)) {
    const r = ctx.regrasEmpresaMap.get(`${c.tipoCodigo}:${c.codigo}`);
    if (r) return { tipoReceita: r.tipoReceita, source: "REGRA_EMPRESA" };
  }
  // GLOBAL exatos
  for (const c of candidatos.filter((x) => !x.isFallback)) {
    const r = ctx.regrasGlobaisMap.get(`${c.tipoCodigo}:${c.codigo}`);
    if (r) return { tipoReceita: r.tipoReceita, source: "REGRA_GLOBAL_ITEM" };
  }
  // GLOBAL capítulo (último recurso antes da pendência)
  for (const c of candidatos.filter((x) => x.isFallback)) {
    const r = ctx.regrasGlobaisMap.get(`${c.tipoCodigo}:${c.codigo}`);
    if (r) return { tipoReceita: r.tipoReceita, source: "REGRA_GLOBAL_CAPITULO" };
  }

  // 5. Sem match — NUNCA chuta
  return { tipoReceita: "RECEITA_NAO_CLASSIFICADA", source: "NONE" };
}

/**
 * Classifica TODOS os itens não-classificados (ou força reprocessamento) de uma empresa.
 * Cria pendências quando não consegue resolver.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {boolean} [opts.force=false] — reclassifica até os já classificados
 * @param {string} [opts.competencia] — YYYY-MM (apenas pra metadata da pendência)
 * @returns {Promise<{processed, classified, pendentes, byTipo, byFonte}>}
 */
export async function classificarItensV2({ portalClientId, force = false, competencia } = {}) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");

  const ctx = await loadContextoEmpresa(portalClientId);

  const items = await prisma.notaItem.findMany({
    where: {
      nota: { clientId: portalClientId },
      ...(force ? {} : { tipoReceita: null }),
    },
    select: {
      id: true, codigoServico: true, ncm: true, cfop: true, valor: true,
      notaId: true, nota: { select: { competencia: true } },
    },
  });

  const byTipo = {};
  const byFonte = {};
  let pendentes = 0;
  const pendenciasNovas = new Map(); // key=codigo único → 1 pendência apenas

  // Batches de update por (tipoReceita) — mais barato que 1 update por item
  const grupos = new Map(); // tipoReceita → [ids]

  for (const item of items) {
    const result = classifyItem(item, ctx);
    byTipo[result.tipoReceita] = (byTipo[result.tipoReceita] || 0) + 1;
    byFonte[result.source] = (byFonte[result.source] || 0) + 1;

    if (!grupos.has(result.tipoReceita)) grupos.set(result.tipoReceita, []);
    grupos.get(result.tipoReceita).push(item.id);

    if (result.source === "NONE") {
      pendentes++;
      // Agrupa por código pra não criar N pendências do mesmo código
      const codigoUnico = item.codigoServico || item.ncm || item.cfop || "(sem-codigo)";
      const key = `${codigoUnico}`;
      if (!pendenciasNovas.has(key)) {
        pendenciasNovas.set(key, {
          codigo: codigoUnico,
          tipoCodigo: item.codigoServico ? "LC116/CTRIBNAC" : item.ncm ? "NCM" : item.cfop ? "CFOP" : "?",
          notaId: item.notaId,
          itemId: item.id,
          competencia: item.nota?.competencia
            ? `${new Date(item.nota.competencia).getUTCFullYear()}-${String(new Date(item.nota.competencia).getUTCMonth() + 1).padStart(2, "0")}`
            : competencia || null,
          ocorrencias: 1,
        });
      } else {
        pendenciasNovas.get(key).ocorrencias++;
      }
    }
  }

  // Batch updates
  const agora = new Date();
  for (const [tipoReceita, ids] of grupos.entries()) {
    await prisma.notaItem.updateMany({
      where: { id: { in: ids } },
      data: { tipoReceita, classificadoEm: agora },
    });
  }

  // Cria pendências agrupadas (1 por código distinto)
  for (const pend of pendenciasNovas.values()) {
    // Idempotente: se já existe pendência aberta pro mesmo código, pula
    const existing = await prisma.filaPendencia.findFirst({
      where: {
        portalClientId,
        tipo: "ITEM_SEM_REGRA",
        resolvida: false,
        detalhes: { path: ["codigo"], equals: pend.codigo },
      },
    });
    if (existing) continue;
    await prisma.filaPendencia.create({
      data: {
        portalClientId,
        tipo: "ITEM_SEM_REGRA",
        notaId: pend.notaId,
        itemId: pend.itemId,
        competencia: pend.competencia,
        resumo: `Código ${pend.tipoCodigo}:${pend.codigo} sem classificação (${pend.ocorrencias} ocorrência(s))`,
        detalhes: {
          codigo: pend.codigo,
          tipoCodigo: pend.tipoCodigo,
          ocorrencias: pend.ocorrencias,
        },
      },
    });
  }

  return {
    processed: items.length,
    classified: items.length - pendentes,
    pendentes,
    pendenciasNovas: pendenciasNovas.size,
    byTipo,
    byFonte,
  };
}
