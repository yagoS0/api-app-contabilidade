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
import { resolverCnaesDaEmpresa } from "./CnaesDaEmpresaService.js";
import { carregarAtividades } from "./AtividadeResolver.js";

// Q20: grau de confiança da classificação, derivado da fonte (sem schema novo).
//  alta  = match de código (produto/regra empresa/regra global item) → auto-classifica
//  média = capítulo LC116 / override por CNAE
//  baixa = sugestão por CNAE ou sem regra (vai pra fila — nunca auto)
function confiancaFromSource(source) {
  if (source === "PRODUTO" || source === "REGRA_EMPRESA" || source === "REGRA_GLOBAL_ITEM") return "alta";
  if (source === "REGRA_GLOBAL_CAPITULO" || source === "CNAE_OVERRIDE") return "media";
  return "baixa";
}

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
      select: { cnaePrincipal: true, cnaesSecundarios: true, regime: true, forcarTipoReceitaPorCnae: true },
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

  // CNAEs da empresa (principal + secundários): sugestão de divergência, override total
  // (flag) e — Q20 — recomendação na fila de pendência (ancorada na tabela SERPRO).
  //
  // Resolvido por `resolverCnaesDaEmpresa`, que cai no cadastro da EMPRESA quando não há
  // CadastroFiscal. Antes lia só o CadastroFiscal e, como ele só nasce ao salvar a aba fiscal,
  // 15 das 19 empresas em produção ficavam sem CNAE nenhum aqui — sem divergência, sem
  // recomendação — com o cadastro aparentemente completo na tela.
  const cnaesEmpresa = await resolverCnaesDaEmpresa(portalClientId, { cadastroFiscal: cadastro });
  const cnaes = cnaesEmpresa.todos;
  const cnaePrincipalNorm = cnaesEmpresa.principal;
  let tipoReceitaPorCnae = null; // do CNAE PRINCIPAL (mantém compat com override/divergência)
  let recomendacaoCnae = null;   // Q20: consolidado dos CNAEs pra recomendação na fila
  if (cnaes.length) {
    const refs = await prisma.cnaeAnexo.findMany({
      where: { cnae: { in: cnaes } },
      select: { cnae: true, tipoReceitaSugerido: true, ambiguo: true },
    });
    const byCnae = new Map(refs.map((r) => [r.cnae, r]));
    const principalRef = cnaePrincipalNorm ? byCnae.get(cnaePrincipalNorm) : null;
    if (principalRef) {
      tipoReceitaPorCnae = { tipoReceita: principalRef.tipoReceitaSugerido, ambiguo: principalRef.ambiguo };
    }
    // Consolida sugestões não-ambíguas e distintas dos CNAEs conhecidos.
    const naoAmbiguos = [...new Set(refs.filter((r) => !r.ambiguo).map((r) => r.tipoReceitaSugerido))];
    const temAmbiguo = refs.some((r) => r.ambiguo);
    if (naoAmbiguos.length === 1 && !temAmbiguo) {
      recomendacaoCnae = { tipoReceita: naoAmbiguos[0], ambiguo: false };
    } else if (naoAmbiguos.length > 1 || temAmbiguo) {
      recomendacaoCnae = { ambiguo: true, candidatos: naoAmbiguos };
    }
  }

  // Catálogo oficial de atividades SERPRO (idAtividade), indexado por tipoReceita|mercado.
  // Carregado 1x — usado só pra montar a recomendação na fila (não classifica).
  const { map: atividadesMap } = await carregarAtividades(dataReferencia);

  return {
    produtosMap, regrasEmpresaMap, regrasGlobaisMap, cadastro, tipoReceitaPorCnae,
    recomendacaoCnae, atividadesMap,
    forcarCnae: !!cadastro?.forcarTipoReceitaPorCnae,
  };
}

// Q20: monta a recomendação de atividade SERPRO pra uma pendência (sem chutar — só sugere).
// Ancora no CNAE da empresa → tipoReceitaSugerido → atividade SERPRO (anexo embutido).
function buildRecomendacao(ctx) {
  const rec = ctx.recomendacaoCnae;
  if (!rec) {
    return { confianca: "baixa", motivo: "Sem CNAE de referência — defina o enquadramento manualmente." };
  }
  if (rec.ambiguo) {
    return {
      confianca: "baixa", ambiguo: true, candidatos: rec.candidatos || [],
      motivo: "CNAE(s) da empresa sugerem mais de um enquadramento — escolha manualmente.",
    };
  }
  const tipoReceita = rec.tipoReceita;
  const atv = ctx.atividadesMap.get(`${tipoReceita}|INTERNO`) || null;
  return {
    confianca: "baixa",
    tipoReceitaSugerido: tipoReceita,
    motivo: "Sugerido pelo CNAE da empresa — não houve regra de código da nota. Confirme.",
    atividade: atv
      ? { idAtividade: atv.idAtividade, descricao: atv.descricao, anexoImplicito: atv.anexoImplicito, sujeitoFatorR: atv.sujeitoFatorR }
      : null,
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

/** O mês civil, em UTC. ⚠ Mesma forma de `MotorApuracaoService.rangeMes` — o mês é o mesmo mês. */
function rangeMes(competencia) {
  const [y, m] = String(competencia).split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

/**
 * Classifica os itens de nota de uma empresa. Cria pendências quando não consegue resolver.
 *
 * ⚠⚠ O BOTÃO DIZ "CLASSIFICAR COMPETÊNCIA" E ATÉ 25/08/2026 ELE CLASSIFICAVA A EMPRESA INTEIRA.
 * A query não filtrava por competência em lugar nenhum — o parâmetro só virava metadado da
 * pendência, e o próprio JSDoc dizia isso ("apenas pra metadata"). O rótulo prometia um escopo que
 * o servidor não aplicava.
 *
 * ⚠ E não era inofensivo: com `force: true` o mesmo clique RECLASSIFICARIA todo o histórico da
 * empresa, meses fechados e transmitidos inclusive. Achado ao mapear a aba a pedido do dono.
 *
 * Hoje: **competência informada ⇒ só aquele mês**. Sem competência, a empresa inteira — que é o que
 * a rota de lote e o worker querem, e continua intacto. O escopo aplicado volta no resultado, para
 * a tela dizer o que aconteceu em vez de o contador deduzir.
 *
 * ⚠⚠ NOTA SEM COMPETÊNCIA NÃO SOME EM SILÊNCIO. Em SQL, `competencia BETWEEN a AND b` **não casa
 * com NULL** — filtrar por mês tornaria invisível para sempre a nota que chegou sem competência, e
 * é literalmente o defeito que a auditoria de notas já pagou nesta base ("a consulta que fabricava
 * buraco"). Elas são CONTADAS e devolvidas em `foraDoEscopo`, nomeadas. ⚠ A saída não é atribuí-las
 * a um mês: inventar a competência decide em qual apuração a receita entra.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {boolean} [opts.force=false] — reclassifica até os já classificados
 * @param {string} [opts.competencia] — YYYY-MM. **Presente ⇒ restringe o escopo.**
 * @returns {Promise<{processed, classified, pendentes, byTipo, byFonte, escopo, foraDoEscopo}>}
 */
export async function classificarItensV2({ portalClientId, force = false, competencia } = {}) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");

  const ctx = await loadContextoEmpresa(portalClientId);

  // ⚠ Competência malformada NÃO vira "a empresa inteira" em silêncio: seria o pior dos dois
  // mundos, com a tela dizendo "competência" e o servidor varrendo tudo. Ou é um mês válido, ou o
  // escopo é declaradamente a empresa.
  const mes = /^\d{4}-\d{2}$/.test(String(competencia || "")) ? String(competencia) : null;
  const escopo = mes ? { tipo: "COMPETENCIA", competencia: mes } : { tipo: "EMPRESA", competencia: null };

  const ondeItem = {
    nota: { clientId: portalClientId, ...(mes ? { competencia: rangeMes(mes) } : {}) },
    ...(force ? {} : { tipoReceita: null }),
  };

  const items = await prisma.notaItem.findMany({
    where: ondeItem,
    select: {
      id: true, codigoServico: true, ncm: true, cfop: true, valor: true,
      notaId: true, nota: { select: { competencia: true } },
    },
  });

  // ⚠ O QUE FICOU DE FORA POR NÃO TER COMPETÊNCIA — contado no banco, nunca deduzido da lista.
  // Só faz sentido perguntar quando há recorte por mês.
  const semCompetencia = mes
    ? await prisma.notaItem.count({
      where: {
        nota: { clientId: portalClientId, competencia: null },
        ...(force ? {} : { tipoReceita: null }),
      },
    }).catch(() => null)
    : null;

  const byTipo = {};
  const byFonte = {};
  const byConfianca = {}; // Q20: alta | media | baixa
  let pendentes = 0;
  const pendenciasNovas = new Map(); // key=codigo único → 1 pendência apenas

  // Batches de update por (tipoReceita) — mais barato que 1 update por item
  const grupos = new Map(); // tipoReceita → [ids]

  for (const item of items) {
    const result = classifyItem(item, ctx);
    byTipo[result.tipoReceita] = (byTipo[result.tipoReceita] || 0) + 1;
    byFonte[result.source] = (byFonte[result.source] || 0) + 1;
    const confianca = confiancaFromSource(result.source);
    byConfianca[confianca] = (byConfianca[confianca] || 0) + 1;

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

  // Q20: recomendação (ancorada no CNAE → atividade SERPRO) — mesma p/ a empresa.
  const recomendacao = buildRecomendacao(ctx);

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
          recomendacao, // Q20: atividade SERPRO sugerida + confiança (não chuta — só sugere)
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
    byConfianca,
    // ⚠ O ESCOPO APLICADO VOLTA. Sem ele, "classifiquei 33 itens" não distingue "o mês" de "a
    // empresa inteira" — e era essa indistinção que fazia o rótulo do botão mentir.
    escopo,
    // ⚠ `null` quando não há recorte por mês (nada ficou de fora) OU quando a contagem falhou.
    // Zero é uma afirmação ("conferi, não há nenhuma"); ausência não é.
    foraDoEscopo: escopo.tipo === "COMPETENCIA" && semCompetencia != null
      ? { semCompetencia, motivo: "SEM_COMPETENCIA_GRAVADA" }
      : null,
  };
}
