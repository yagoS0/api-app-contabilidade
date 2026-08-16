// Regras do escritório: cadastrar uma obrigação UMA vez e aplicá-la a várias empresas.
//
// É isto que substitui o catálogo pré-carregado. O documento original queria uma lista embutida de
// obrigações com datas; datas são dado fiscal que muda por ato normativo, e uma lista nossa
// colocaria prazo desatualizado na tela de todas as empresas de uma vez. A regra resolve a mesma
// dor — não redigitar 38 vezes — com o contador dizendo o prazo.
//
// A obrigação gerada por regra continua sendo uma `Obrigacao` normal na empresa, com `regraId`
// preenchido. Não existe "obrigação virtual": o calendário, a aba e as ocorrências não precisam
// saber que a regra existe.

import { prisma } from "../../infrastructure/db/prisma.js";
import { ObrigacaoError, normalizarEntrada, sincronizarOcorrencias } from "./ObrigacoesService.js";

export const ESCOPOS = ["TODAS", "POR_FILTRO", "SELECAO_MANUAL"];
export const REGIMES = ["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL"];

const asTexto = (v) => String(v ?? "").trim();

function normalizarRegra(dados = {}) {
  // Reusa a validação da obrigação: os campos de configuração são os MESMOS, e ter duas validações
  // é ter duas que divergem — a regra aceitaria o que a obrigação recusa.
  const base = normalizarEntrada(dados);

  const escopo = asTexto(dados.escopo).toUpperCase();
  if (!ESCOPOS.includes(escopo)) {
    throw new ObrigacaoError("escopo_invalido", "Escolha a quem a regra se aplica.");
  }

  let filtros = null;
  if (escopo === "POR_FILTRO") {
    const regimes = Array.isArray(dados.filtros?.regimes)
      ? dados.filtros.regimes.map((r) => asTexto(r).toUpperCase()).filter((r) => REGIMES.includes(r))
      : [];
    const temFolha = dados.filtros?.temFolha === true ? true : null;
    if (!regimes.length && temFolha === null) {
      throw new ObrigacaoError(
        "filtro_vazio",
        "Escolha ao menos um regime ou marque \"somente com folha\" — senão a regra vale para todas, e aí o escopo é \"Todas\".",
      );
    }
    filtros = { regimes, temFolha };
  } else if (escopo === "SELECAO_MANUAL") {
    const empresasIds = Array.isArray(dados.filtros?.empresasIds)
      ? [...new Set(dados.filtros.empresasIds.map(asTexto).filter(Boolean))]
      : [];
    if (!empresasIds.length) {
      throw new ObrigacaoError("selecao_vazia", "Selecione pelo menos uma empresa.");
    }
    filtros = { empresasIds };
  }

  return {
    ...base,
    escopo,
    filtros,
    aplicarANovas: dados.aplicarANovas === undefined ? escopo !== "SELECAO_MANUAL" : Boolean(dados.aplicarANovas),
  };
}

/**
 * Empresas que a regra alcança, dentro do que o usuário pode ver.
 *
 * O regime mora em `Company.regimeTributario` (cadastro legado) e `temFolha` em `PortalClient`:
 * por isso a resolução junta os dois em vez de filtrar só de um lado.
 */
export async function empresasDoEscopo({ portalIds, escopo, filtros, excecoesIds = [] }) {
  const excluidas = new Set(excecoesIds);

  if (escopo === "SELECAO_MANUAL") {
    const ids = (filtros?.empresasIds || []).filter((id) => portalIds.includes(id) && !excluidas.has(id));
    return prisma.portalClient.findMany({
      where: { id: { in: ids } },
      select: { id: true, razao: true, cnpj: true, temFolha: true, companyId: true },
      orderBy: { razao: "asc" },
    });
  }

  const candidatas = await prisma.portalClient.findMany({
    where: {
      id: { in: portalIds },
      status: "ATIVA",
      ...(escopo === "POR_FILTRO" && filtros?.temFolha === true ? { temFolha: true } : {}),
    },
    select: { id: true, razao: true, cnpj: true, temFolha: true, companyId: true },
    orderBy: { razao: "asc" },
  });

  const regimes = escopo === "POR_FILTRO" ? filtros?.regimes || [] : [];
  if (!regimes.length) return candidatas.filter((c) => !excluidas.has(c.id));

  const legacyIds = candidatas.map((c) => c.companyId).filter(Boolean);
  const legadas = legacyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: legacyIds } },
        select: { id: true, regimeTributario: true },
      })
    : [];
  const regimePorLegacy = new Map(legadas.map((l) => [l.id, l.regimeTributario]));

  return candidatas.filter((c) => {
    if (excluidas.has(c.id)) return false;
    // Empresa sem cadastro legado não tem regime conhecido. NÃO entra num filtro por regime:
    // incluir seria afirmar um regime que ninguém declarou.
    const regime = c.companyId ? regimePorLegacy.get(c.companyId) : null;
    return regime ? regimes.includes(regime) : false;
  });
}

/** Prévia do wizard: quem entra, sem gravar nada. */
export async function preverEscopo({ portalIds, escopo, filtros }) {
  const empresas = await empresasDoEscopo({ portalIds, escopo, filtros });
  return {
    total: empresas.length,
    empresas: empresas.map((e) => ({ companyId: e.id, razao: e.razao, cnpj: e.cnpj, temFolha: e.temFolha })),
  };
}

/**
 * Cria/atualiza a obrigação da regra em cada empresa do escopo e remove de quem saiu.
 *
 * Empresa com `sobrescritaLocal` é PULADA: alguém editou a obrigação lá dentro, e a regra
 * sobrescrever apagaria essa escolha sem avisar. É o mesmo princípio da exceção, só que declarado
 * pelo ato de editar em vez de por um botão.
 */
export async function propagar({ regraId, portalIds }) {
  const regra = await prisma.regraObrigacao.findUnique({
    where: { id: regraId },
    include: { excecoes: { select: { portalClientId: true } } },
  });
  if (!regra) throw new ObrigacaoError("regra_nao_encontrada", "Regra não encontrada.", 404);

  const excecoesIds = regra.excecoes.map((e) => e.portalClientId);
  const alvo = regra.ativa
    ? await empresasDoEscopo({ portalIds, escopo: regra.escopo, filtros: regra.filtros, excecoesIds })
    : [];
  const alvoIds = new Set(alvo.map((e) => e.id));

  const existentes = await prisma.obrigacao.findMany({
    where: { regraId },
    select: { id: true, portalClientId: true, sobrescritaLocal: true },
  });
  const existentesPorEmpresa = new Map(existentes.map((o) => [o.portalClientId, o]));

  const config = {
    nome: regra.nome,
    categoria: regra.categoria,
    periodicidade: regra.periodicidade,
    diaVencimento: regra.diaVencimento,
    mesReferencia: regra.mesReferencia,
    defasagemMeses: regra.defasagemMeses,
    antecedenciaLembreteDias: regra.antecedenciaLembreteDias,
    ajusteDiaUtil: regra.ajusteDiaUtil,
    cor: regra.cor,
    verificador: regra.verificador,
    ativa: regra.ativa,
  };

  let criadas = 0;
  let atualizadas = 0;
  let puladas = 0;
  const tocadas = [];

  for (const empresa of alvo) {
    const atual = existentesPorEmpresa.get(empresa.id);
    if (atual?.sobrescritaLocal) { puladas += 1; continue; }
    if (atual) {
      await prisma.obrigacao.update({ where: { id: atual.id }, data: config });
      atualizadas += 1;
      tocadas.push(atual.id);
    } else {
      const nova = await prisma.obrigacao.create({
        data: { ...config, portalClientId: empresa.id, regraId },
      });
      criadas += 1;
      tocadas.push(nova.id);
    }
  }

  // Saiu do escopo (ou a regra foi inativada): a obrigação da regra vai junto. Sobrescrita local
  // fica — virou obrigação daquela empresa no momento em que alguém a editou.
  //
  // ⚠ **QUEM TEM ENTREGA CONCLUÍDA NÃO É APAGADO, É DESVINCULADO.** O `deleteMany` daqui leva as
  // ocorrências junto por `onDelete: Cascade` — INCLUSIVE as CONCLUÍDAS. "Tirar da regra" é um
  // clique sem volta em cima de histórico: o vencimento que o escritório entregou e marcou sumia,
  // e ao devolver a empresa à regra a obrigação voltava como VENCIDA na data original, como se a
  // entrega nunca tivesse acontecido. Sair da regra é uma afirmação sobre o FUTURO ("esta empresa
  // não segue mais este prazo"), nunca sobre o que já foi feito.
  //
  // Desvincular é exatamente o que `removerRegra({ modo: "desvincular" })` já faz com a regra
  // inteira: `regraId: null` e a obrigação continua na empresa, avulsa, com as ocorrências.
  // Apagar de verdade continua existindo — mas só onde não há nada a perder (nenhuma concluída) ou
  // pela exclusão da obrigação/regra, que pergunta antes e diz que não dá para desfazer.
  const aSair = existentes.filter((o) => !alvoIds.has(o.portalClientId) && !o.sobrescritaLocal);
  let desvinculadas = 0;
  let removidas = 0;
  if (aSair.length) {
    const idsQueSaem = aSair.map((o) => o.id);
    const comHistorico = new Set(
      (await prisma.ocorrenciaObrigacao.findMany({
        where: { obrigacaoId: { in: idsQueSaem }, status: "CONCLUIDA" },
        select: { obrigacaoId: true },
      })).map((oc) => oc.obrigacaoId),
    );
    const aDesvincular = idsQueSaem.filter((id) => comHistorico.has(id));
    const aApagar = idsQueSaem.filter((id) => !comHistorico.has(id));
    if (aDesvincular.length) {
      const r = await prisma.obrigacao.updateMany({
        where: { id: { in: aDesvincular } },
        data: { regraId: null, sobrescritaLocal: false },
      });
      desvinculadas = r.count ?? aDesvincular.length;
    }
    if (aApagar.length) {
      const r = await prisma.obrigacao.deleteMany({ where: { id: { in: aApagar } } });
      removidas = r.count ?? aApagar.length;
    }
  }

  // Ocorrências só depois que todas as obrigações existem: cada uma consulta feriado e empresa.
  for (const id of tocadas) await sincronizarOcorrencias(id);

  return { criadas, atualizadas, puladas, removidas, desvinculadas, empresasNoEscopo: alvo.length };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────────────────────

export async function criarRegra({ portalIds, dados, criadoPorId = null }) {
  const limpo = normalizarRegra(dados);
  const regra = await prisma.regraObrigacao.create({ data: { ...limpo, criadoPorId } });
  const efeito = await propagar({ regraId: regra.id, portalIds });
  return { regra, ...efeito };
}

export async function atualizarRegra({ portalIds, regraId, dados }) {
  const atual = await prisma.regraObrigacao.findUnique({ where: { id: regraId } });
  if (!atual) throw new ObrigacaoError("regra_nao_encontrada", "Regra não encontrada.", 404);
  const limpo = normalizarRegra({
    ...atual,
    ...dados,
    // `filtros` é Json: mesclar parcialmente confundiria regimes antigos com novos. Ou vem inteiro
    // no patch, ou fica o que estava.
    filtros: dados.filtros === undefined ? atual.filtros : dados.filtros,
  });
  const regra = await prisma.regraObrigacao.update({ where: { id: regraId }, data: limpo });
  const efeito = await propagar({ regraId, portalIds });
  return { regra, ...efeito };
}

/**
 * @param {"remover"|"desvincular"} modo  remover apaga as obrigações nas empresas; desvincular as
 *   deixa como obrigações avulsas daquela empresa.
 */
export async function removerRegra({ regraId, modo = "remover" }) {
  const regra = await prisma.regraObrigacao.findUnique({ where: { id: regraId } });
  if (!regra) throw new ObrigacaoError("regra_nao_encontrada", "Regra não encontrada.", 404);

  if (modo === "desvincular") {
    const r = await prisma.obrigacao.updateMany({
      where: { regraId },
      data: { regraId: null, sobrescritaLocal: false },
    });
    await prisma.regraObrigacao.delete({ where: { id: regraId } });
    return { nome: regra.nome, desvinculadas: r.count, removidas: 0 };
  }

  const r = await prisma.obrigacao.deleteMany({ where: { regraId } });
  await prisma.regraObrigacao.delete({ where: { id: regraId } });
  return { nome: regra.nome, desvinculadas: 0, removidas: r.count };
}

// ── Exceções ─────────────────────────────────────────────────────────────────────────────────

export async function adicionarExcecao({ portalIds, regraId, companyId, motivo = null }) {
  if (!portalIds.includes(companyId)) {
    throw new ObrigacaoError("empresa_nao_encontrada", "Empresa não encontrada.", 404);
  }
  await prisma.regraObrigacaoExcecao.upsert({
    where: { regraId_portalClientId: { regraId, portalClientId: companyId } },
    create: { regraId, portalClientId: companyId, motivo },
    update: { motivo },
  });
  return propagar({ regraId, portalIds });
}

/**
 * A volta do desvínculo: "devolver à regra" reencontra a obrigação que "tirar da regra" deixou na
 * empresa, em vez de criar uma segunda igual.
 *
 * ⚠ Sem isto, o par de botões produziria DUAS obrigações de mesmo nome na mesma empresa (a avulsa
 * com o histórico e a nova da regra) — o `@@unique([regraId, portalClientId])` não impede, porque o
 * Postgres não compara NULLs. Duas linhas iguais no calendário é o defeito que aquela constraint
 * existe para evitar.
 *
 * O casamento é ESTREITO de propósito — mesma empresa, `regraId` nulo, **nome exato** da regra — e
 * acontece só neste momento, que é o inverso exato do que desvinculou. Nome diferente (a regra foi
 * renomeada no meio, ou a obrigação é outra) não casa: nasce uma nova e a avulsa fica visível na
 * tela, com outro nome. Adivinhar por semelhança seria a regra absorver obrigação que não é dela.
 */
async function readotarObrigacaoDesvinculada({ regraId, companyId }) {
  const regra = await prisma.regraObrigacao.findUnique({
    where: { id: regraId },
    select: { nome: true },
  });
  if (!regra) return null;

  // Sobrescrita local mantém a obrigação ligada mesmo fora do escopo: nesse caso já existe a linha
  // do par (regra, empresa) e adotar outra violaria o unique.
  const jaLigada = await prisma.obrigacao.findFirst({
    where: { regraId, portalClientId: companyId },
    select: { id: true },
  });
  if (jaLigada) return null;

  const orfa = await prisma.obrigacao.findFirst({
    where: { portalClientId: companyId, regraId: null, nome: regra.nome },
    select: { id: true },
  });
  if (!orfa) return null;

  await prisma.obrigacao.update({
    where: { id: orfa.id },
    data: { regraId, sobrescritaLocal: false },
  });
  return orfa.id;
}

export async function removerExcecao({ portalIds, regraId, companyId }) {
  await prisma.regraObrigacaoExcecao.deleteMany({ where: { regraId, portalClientId: companyId } });
  const readotada = await readotarObrigacaoDesvinculada({ regraId, companyId });
  const efeito = await propagar({ regraId, portalIds });
  return { ...efeito, readotada: Boolean(readotada) };
}

// ── Leitura ──────────────────────────────────────────────────────────────────────────────────

export async function listarRegras({ portalIds }) {
  const regras = await prisma.regraObrigacao.findMany({
    orderBy: { nome: "asc" },
    include: {
      excecoes: { select: { portalClientId: true, motivo: true } },
      obrigacoes: {
        select: {
          id: true,
          portalClientId: true,
          sobrescritaLocal: true,
          portalClient: { select: { razao: true } },
          // ⚠ É este número que a confirmação de "tirar da regra" repete de volta ao contador. Sem
          // ele a pergunta viraria um "tem certeza?" genérico — e ato de consequência confirma
          // repetindo os dados, não pedindo fé. Só as CONCLUÍDAS: são elas que representam trabalho
          // entregue, e é por elas que a obrigação é desvinculada em vez de apagada.
          ocorrencias: { where: { status: "CONCLUIDA" }, select: { id: true } },
        },
      },
    },
  });

  return regras.map((r) => {
    const aplicadas = r.obrigacoes.filter((o) => portalIds.includes(o.portalClientId));
    const sobrescritas = aplicadas.filter((o) => o.sobrescritaLocal);
    return {
      regraId: r.id,
      nome: r.nome,
      categoria: r.categoria,
      periodicidade: r.periodicidade,
      diaVencimento: r.diaVencimento,
      mesReferencia: r.mesReferencia,
      defasagemMeses: r.defasagemMeses,
      antecedenciaLembreteDias: r.antecedenciaLembreteDias,
      ajusteDiaUtil: r.ajusteDiaUtil,
      cor: r.cor,
      verificador: r.verificador,
      ativa: r.ativa,
      escopo: r.escopo,
      filtros: r.filtros,
      aplicarANovas: r.aplicarANovas,
      // Resumo em linguagem natural — o card não obriga ninguém a decodificar `{regimes:[...]}`.
      resumoEscopo: resumoDoEscopo(r, aplicadas.length),
      totalEmpresas: aplicadas.length,
      totalExcecoes: r.excecoes.length,
      totalSobrescritas: sobrescritas.length,
      empresas: aplicadas.map((o) => ({
        companyId: o.portalClientId,
        razao: o.portalClient?.razao || null,
        obrigacaoId: o.id,
        sobrescritaLocal: o.sobrescritaLocal,
        ocorrenciasConcluidas: o.ocorrencias?.length ?? 0,
      })),
      excecoes: r.excecoes.map((e) => ({ companyId: e.portalClientId, motivo: e.motivo })),
    };
  });
}

const ROTULO_REGIME = {
  SIMPLES: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};

export function resumoDoEscopo(regra, total) {
  const sufixo = `${total} empresa${total === 1 ? "" : "s"}`;
  if (regra.escopo === "TODAS") return `Todas as empresas · ${sufixo}`;
  if (regra.escopo === "SELECAO_MANUAL") return `Empresas escolhidas à mão · ${sufixo}`;
  const partes = [];
  const regimes = regra.filtros?.regimes || [];
  if (regimes.length) partes.push(regimes.map((r) => ROTULO_REGIME[r] || r).join(", "));
  if (regra.filtros?.temFolha === true) partes.push("somente com folha");
  return `${partes.join(" · ") || "Todas"} · ${sufixo}`;
}

/**
 * Empresa NOVA que se encaixe numa regra com `aplicarANovas` recebe a obrigação sozinha.
 *
 * Best-effort por definição: é chamado depois da empresa já estar criada, então falhar aqui não
 * pode desfazer o cadastro — no pior caso a obrigação entra na próxima edição da regra.
 */
export async function aplicarRegrasAEmpresaNova({ portalClientId, portalIds }) {
  const regras = await prisma.regraObrigacao.findMany({
    where: { ativa: true, aplicarANovas: true, escopo: { in: ["TODAS", "POR_FILTRO"] } },
    select: { id: true },
  });
  let aplicadas = 0;
  for (const r of regras) {
    const efeito = await propagar({ regraId: r.id, portalIds: [...new Set([...portalIds, portalClientId])] });
    if (efeito.criadas) aplicadas += efeito.criadas;
  }
  return { regrasAvaliadas: regras.length, obrigacoesCriadas: aplicadas };
}
