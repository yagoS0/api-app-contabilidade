// A APURAÇÃO DO LUCRO PRESUMIDO — regra PURA, sem banco e sem chamada externa.
//
// Ela nasceu de dentro de `LucroPresumidoCalculoService.js`, que carrega o Prisma no topo e por
// isso nunca teve um único teste. A separação é a da casa: a REGRA mora aqui e é medida sozinha; o
// serviço lê as notas e a guia e chama esta função. Nada aqui escreve, transmite ou declara.
//
// ── O QUE ELA ACRESCENTA AO QUE JÁ EXISTIA ───────────────────────────────────────────────────
//
//   · a ALÍQUOTA EFETIVA, com a BASE dita (mês × trimestre) e a parcialidade dita;
//   · a regra dos R$ 120.000 (Lei 9.249/1995, art. 15, § 4º), com os três estados;
//   · o que NÃO é calculado, NOMEADO — célula vazia é proibida nesta casa;
//   · ⚠⚠ o débito de IRPJ/CSLL que existe num mês que NÃO fecha trimestre.
//
// ── AS PRESUNÇÕES E AS ALÍQUOTAS (as mesmas de antes, movidas) ────────────────────────────────
//
// Presunção padrão Lei 9.249/95 (confirmada com o contador):
//   Serviços em geral: IRPJ 32% / CSLL 32%   ·   Comércio/indústria: IRPJ 8% / CSLL 12%
// PIS/COFINS cumulativo: 0,65% / 3% sobre a receita bruta, MENSAIS.
// IRPJ 15% + adicional 10% sobre o que exceder R$ 60.000 no TRIMESTRE. CSLL 9%.
// IRPJ/CSLL só fecham no último mês do trimestre (mar/jun/set/dez) — Lei 9.430/1996.

export const PRESUNCAO = Object.freeze({
  SERVICOS: Object.freeze({ irpj: 0.32, csll: 0.32 }),
  MERCADORIAS: Object.freeze({ irpj: 0.08, csll: 0.12 }),
});

export const ALIQ = Object.freeze({
  irpj: 0.15,
  irpjAdicional: 0.10,
  adicionalLimiteTrimestral: 60000,
  csll: 0.09,
  pis: 0.0065,
  cofins: 0.03,
});

/**
 * ⚠⚠ A REGRA DOS R$ 120.000 — IRPJ de 16%, CSLL de 32%. Lei 9.249/1995, art. 15, § 4º.
 *
 * ⚠ ELA REDUZ SÓ O IRPJ. A CSLL continua em 32%: o art. 20 remete ao inciso III do § 1º do art. 15,
 * e o § 4º não o alcança. Errar aqui é errar metade da conta.
 *
 * ⚠ O LIMITE É ANUAL, e esta função apura um TRIMESTRE. Ou seja: o portal **não tem como provar
 * sozinho** que a empresa cabe no limite — precisaria da receita do ano inteiro, que este cálculo
 * não vê. Por isso a resposta não é derivada: ela é CONFIRMADA pelo contador, e o default é o
 * comportamento de sempre (32%).
 */
export const PRESUNCAO_IRPJ_SERVICOS_16 = 0.16;
export const LIMITE_SERVICOS_16_PCT_ANUAL = 120_000;

/**
 * ⚠ AS EXCEÇÕES DO § 4º, NOMEADAS — cópia AMARRADA POR TESTE ao app do contador.
 *
 * A fonte é `ofertaServicos16` (`apps/web/src/features/planejamento/lib/lucroPresumido.js`), que
 * NÃO é importável daqui (cruzar os dois apps quebra o boot; o projeto já registra isso em
 * `categoriaPresumido.js`). A amarração é TEXTUAL: um teste lê o arquivo de lá e exige as mesmas
 * quatro frases. Muda lá, cai aqui.
 *
 * Elas viajam junto da confirmação porque sem elas o contador confirmaria sem saber o que afirma.
 */
export const EXCECOES_SERVICOS_16 = Object.freeze([
  "não vale para serviços hospitalares",
  "não vale para serviços de transporte",
  "não vale para sociedades de profissão legalmente regulamentada",
  "a empresa tem de ser EXCLUSIVAMENTE prestadora de serviços em geral",
]);

/** Os estados da confirmação. ⚠ `null` NÃO é `false` — ver `presuncaoIrpjDeServicos`. */
export const SERVICOS_16 = Object.freeze({
  NAO_PERGUNTADO: "nao_perguntado",
  CONFIRMADO: "confirmado",
  RECUSADO: "recusado",
  /** ⚠ Confirmado, mas a própria receita do trimestre já derruba o limite anual. */
  IMPOSSIVEL_PELA_RECEITA: "impossivel_pela_receita",
});

/**
 * A presunção de IRPJ dos SERVIÇOS, com os estados nomeados.
 *
 * ⚠⚠ `null` = "ninguém perguntou" ⇒ 32%, que é o comportamento de hoje, INTACTO. `false` = "o
 * contador disse que não" ⇒ 32% também, mas por outra razão — e a tela precisa distinguir os dois,
 * senão "não perguntamos" se lê como "conferimos e não cabe". É a família do `Number(null) === 0`.
 *
 * ⚠⚠ O QUARTO ESTADO É ARITMÉTICA, NÃO INFERÊNCIA: a receita anual é, por construção, maior ou
 * igual à do trimestre. Trimestre de serviços acima de R$ 120.000 ⇒ o ano também está acima ⇒ o
 * § 4º não pode valer. Aí a confirmação é REBAIXADA **com o motivo dito**, nunca aplicada em
 * silêncio nem recusada em silêncio.
 *
 * @param {{servicos16?: boolean|null, receitaServicosDoTrimestre?: number}} p
 */
export function presuncaoIrpjDeServicos({ servicos16 = null, receitaServicosDoTrimestre = 0 } = {}) {
  const receita = numero(receitaServicosDoTrimestre);

  if (servicos16 !== true) {
    return {
      presuncao: PRESUNCAO.SERVICOS.irpj,
      estado: servicos16 === false ? SERVICOS_16.RECUSADO : SERVICOS_16.NAO_PERGUNTADO,
      motivo: servicos16 === false
        ? "O contador informou que a empresa NÃO se enquadra no art. 15, § 4º. Presunção de IRPJ de 32%."
        : "A redução do art. 15, § 4º (IRPJ de 16%) não foi confirmada para esta empresa. "
          + "Presunção de 32%, que é o padrão dos serviços em geral.",
      excecoes: EXCECOES_SERVICOS_16,
    };
  }

  if (receita > LIMITE_SERVICOS_16_PCT_ANUAL) {
    return {
      presuncao: PRESUNCAO.SERVICOS.irpj,
      estado: SERVICOS_16.IMPOSSIVEL_PELA_RECEITA,
      motivo: "A receita de serviços SÓ DESTE TRIMESTRE (" + brl(receita) + ") já passa do limite "
        + "anual de " + brl(LIMITE_SERVICOS_16_PCT_ANUAL) + ", então o art. 15, § 4º não pode valer "
        + "no ano. A presunção volta a 32% mesmo com a confirmação.",
      excecoes: EXCECOES_SERVICOS_16,
    };
  }

  return {
    presuncao: PRESUNCAO_IRPJ_SERVICOS_16,
    estado: SERVICOS_16.CONFIRMADO,
    motivo: "IRPJ presumido a 16% POR CONFIRMAÇÃO DO CONTADOR (Lei 9.249/1995, art. 15, § 4º). "
      + "⚠ A CSLL continua em 32%. Passando de " + brl(LIMITE_SERVICOS_16_PCT_ANUAL) + " no ano, a "
      + "presunção vira 32% RETROATIVA e a diferença é recolhida (§ 5º).",
    excecoes: EXCECOES_SERVICOS_16,
  };
}

/**
 * ⚠⚠ O QUE ESTA APURAÇÃO **NÃO** CALCULA — lista FECHADA, cada item com o motivo.
 *
 * Célula vazia é proibida nesta casa (`comparativoDeRegimes.js`): branco se lê como zero, e um
 * zero aqui afirmaria que a empresa não deve o tributo. A ausência sai NOMEADA, e o total da tela
 * é o total DESTES tributos — não a carga total da empresa.
 *
 * ⚠ ISS, CPP e a majoração da LC 224/2025 estão fora POR DECISÃO DO DONO (27/08/2026), não por
 * limitação. Ligá-los é decisão dele, não consequência de alguém achar que falta.
 */
export const TRIBUTOS_NAO_CALCULADOS = Object.freeze([
  Object.freeze({
    chave: "iss",
    rotulo: "ISS",
    motivo: "A alíquota varia por município e por código de serviço, e não é calculada aqui. "
      + "O ISS devido sai da nota e da legislação municipal.",
  }),
  Object.freeze({
    chave: "cpp",
    rotulo: "CPP (INSS patronal)",
    motivo: "No Lucro Presumido a contribuição patronal é recolhida POR FORA, sobre a folha — ela "
      + "não entra nesta apuração e não está no DARF consolidado.",
  }),
  Object.freeze({
    chave: "majoracaoLc224",
    rotulo: "Majoração da LC 224/2025",
    motivo: "A majoração de 10% da presunção sobre a receita acima do limite não é aplicada aqui, "
      + "por decisão do escritório. Quem a aplica é o simulador de planejamento.",
  }),
  Object.freeze({
    chave: "icmsIpi",
    rotulo: "ICMS / IPI",
    motivo: "Tributos sobre mercadoria, apurados fora deste módulo.",
  }),
]);

/** Os meses do trimestre a que a competência pertence. */
export function mesesDoTrimestre(competencia) {
  const [y, m] = String(competencia).split("-").map(Number);
  const primeiro = Math.floor((m - 1) / 3) * 3 + 1;
  return [0, 1, 2].map((i) => `${y}-${String(primeiro + i).padStart(2, "0")}`);
}

/** O mês fecha trimestre? (mar/jun/set/dez) */
export function isFimDeTrimestre(competencia) {
  return [3, 6, 9, 12].includes(Number(String(competencia).split("-")[1]));
}

/**
 * ⚠⚠ A ALÍQUOTA EFETIVA — e a BASE dela é o que impede o número de mentir.
 *
 * IRPJ e CSLL são apurados sobre a receita do TRIMESTRE; PIS e COFINS, sobre a do MÊS. Dividir
 * imposto de trimestre por receita de mês daria um número que não descreve nada. Por isso:
 *
 *   · mês que FECHA trimestre  ⇒ base TRIMESTRE, com os quatro tributos. Carga completa.
 *   · mês que NÃO fecha        ⇒ base MÊS, só PIS/COFINS, marcada `completa: false` com o motivo —
 *                                nunca apresentada como se fosse a carga do Presumido.
 *
 * ⚠ Receita zero devolve `null`, NUNCA `0`: zero afirmaria carga tributária zero sobre uma empresa
 * que simplesmente não faturou. Mesmo critério de `comparador.js` no simulador.
 */
export function cargaEfetiva({ total, receita, base, completa, motivo = null }) {
  const r = numero(receita);
  const t = numero(total);
  return {
    valor: r > 0 ? t / r : null,
    total: r2(t),
    receita: r2(r),
    base,
    completa: Boolean(completa),
    motivo: r > 0
      ? motivo
      : "Sem receita na competência: não há alíquota efetiva a calcular (zero afirmaria carga zero).",
  };
}

/**
 * ⚠⚠ O DÉBITO DE IRPJ/CSLL NUM MÊS QUE NÃO FECHA TRIMESTRE.
 *
 * Num mês assim o cálculo NÃO apura IRPJ nem CSLL — e mesmo assim **pode existir DARF deles**,
 * porque a Lei 9.430/1996 deixa recolher o trimestre em até três quotas mensais. Sem isto, a tela
 * diria "IRPJ: não apurado neste mês" ao lado de uma DARF de IRPJ, e o contador teria de escolher
 * em qual dos dois acreditar.
 *
 * ⚠⚠ ELA NÃO DIZ DE QUAL TRIMESTRE É, e não é descuido: a composição da guia traz código, tributo
 * e valor — **não traz o período de apuração**. Afirmar "quota 2 do 1º trimestre" seria inventar
 * dado fiscal. O que ela afirma é o que se vê: existe débito destes tributos nesta competência, e
 * este mês não fecha trimestre.
 *
 * @param {{competencia: string, composicao?: Array<{tributo?: string, total?: number}>}} p
 */
export function quotaDeTrimestreAnterior({ competencia, composicao = [] } = {}) {
  if (isFimDeTrimestre(competencia)) return null;

  const trimestrais = (Array.isArray(composicao) ? composicao : [])
    .map((c) => ({ tributo: String(c?.tributo || "").toUpperCase(), valor: r2(numero(c?.total)) }))
    .filter((c) => (c.tributo === "IRPJ" || c.tributo === "CSLL") && c.valor > 0);

  if (!trimestrais.length) return null;

  const total = r2(trimestrais.reduce((s, c) => s + c.valor, 0));
  const nomes = [...new Set(trimestrais.map((c) => c.tributo))].join(" e ");
  return {
    tributos: trimestrais,
    total,
    // ⚠ FATO, não veredito. O período de apuração não está na guia.
    leitura: "Este mês não fecha trimestre, então o cálculo não apura IRPJ nem CSLL — mas há DARF de "
      + nomes + " nesta competência (" + brl(total) + "). A apuração trimestral pode ser recolhida "
      + "em até três quotas mensais (Lei 9.430/1996), então confira a que trimestre esta DARF pertence.",
  };
}

/**
 * A composição da DARF somada POR TRIBUTO — `{PIS, COFINS, IRPJ, CSLL}`.
 *
 * É o que a reconciliação compara contra o nosso motor. ⚠ Tributo ausente da composição fica
 * AUSENTE do objeto, nunca zero: `conferir` distingue `null` ("a declaração não traz este tributo",
 * status `sem_dctfweb`) de `0` ("a declaração diz que é zero"), e colapsá-los faria a tela acusar
 * divergência contra um número que ninguém declarou.
 *
 * ⚠ A composição pode trazer o MESMO tributo em mais de um código de receita — por isso soma, e
 * não sobrescreve.
 */
export function debitosPorTributo(composicao = []) {
  const out = {};
  for (const item of Array.isArray(composicao) ? composicao : []) {
    const tributo = String(item?.tributo || "").toUpperCase();
    if (!tributo) continue;
    out[tributo] = r2((out[tributo] || 0) + numero(item?.total));
  }
  return out;
}

/**
 * A APURAÇÃO DA COMPETÊNCIA, inteira e pura.
 *
 * @param {Object} p
 * @param {string} p.competencia   "YYYY-MM"
 * @param {{servicos:number, mercadorias:number}} p.receita  receita do MÊS
 * @param {Array} [p.receitasDoTrimestre]  as três receitas mensais; só usada no fechamento
 * @param {boolean|null} [p.servicos16]    a confirmação do art. 15, § 4º
 * @param {Array} [p.composicaoDaGuia]     `extracted.composicao` da DARF da competência
 */
export function apurarPresumido({
  competencia,
  receita,
  receitasDoTrimestre = [],
  servicos16 = null,
  composicaoDaGuia = [],
}) {
  const observacoes = [];
  const rec = normalizarReceita(receita);

  // PIS/COFINS — MENSAIS, sobre a receita bruta total.
  const pis = r2(rec.total * ALIQ.pis);
  const cofins = r2(rec.total * ALIQ.cofins);

  let irpj = null;
  let csll = null;
  let trimestre = null;
  let servicos16Resposta = null;

  if (isFimDeTrimestre(competencia)) {
    const meses = mesesDoTrimestre(competencia);
    const doTri = (receitasDoTrimestre || []).map(normalizarReceita);
    const servTri = r2(doTri.reduce((s, r) => s + r.servicos, 0));
    const mercTri = r2(doTri.reduce((s, r) => s + r.mercadorias, 0));
    const receitaTri = r2(servTri + mercTri);

    servicos16Resposta = presuncaoIrpjDeServicos({
      servicos16,
      receitaServicosDoTrimestre: servTri,
    });

    const baseIrpj = r2(servTri * servicos16Resposta.presuncao + mercTri * PRESUNCAO.MERCADORIAS.irpj);
    // ⚠ A CSLL NÃO acompanha a redução do § 4º — ela segue em 32% sempre.
    const baseCsll = r2(servTri * PRESUNCAO.SERVICOS.csll + mercTri * PRESUNCAO.MERCADORIAS.csll);

    const irpjNormal = r2(baseIrpj * ALIQ.irpj);
    const adicional = r2(Math.max(0, baseIrpj - ALIQ.adicionalLimiteTrimestral) * ALIQ.irpjAdicional);
    irpj = {
      base: baseIrpj,
      presuncaoAplicadaServicos: servicos16Resposta.presuncao,
      normal: irpjNormal,
      adicional,
      total: r2(irpjNormal + adicional),
    };
    csll = {
      base: baseCsll,
      presuncaoAplicadaServicos: PRESUNCAO.SERVICOS.csll,
      total: r2(baseCsll * ALIQ.csll),
    };

    const pisTri = r2(receitaTri * ALIQ.pis);
    const cofinsTri = r2(receitaTri * ALIQ.cofins);
    trimestre = {
      meses,
      receitaServicos: servTri,
      receitaMercadorias: mercTri,
      receita: receitaTri,
      pis: pisTri,
      cofins: cofinsTri,
      total: r2(pisTri + cofinsTri + irpj.total + csll.total),
    };

    if (mercTri > 0) {
      observacoes.push(
        "Há receita de mercadorias — presunção 8%/12% aplicada; confira casos especiais "
        + "(transporte/hospitalar/combustível não cobertos).",
      );
    }
    if (servicos16Resposta.estado === SERVICOS_16.IMPOSSIVEL_PELA_RECEITA) {
      observacoes.push(servicos16Resposta.motivo);
    }
  }

  // ⚠ A base da carga efetiva acompanha o que foi apurado — ver `cargaEfetiva`.
  const carga = trimestre
    ? cargaEfetiva({ total: trimestre.total, receita: trimestre.receita, base: "TRIMESTRE", completa: true })
    : cargaEfetiva({
      total: r2(pis + cofins),
      receita: rec.total,
      base: "MES",
      completa: false,
      motivo: "Só PIS e COFINS entram: IRPJ e CSLL fecham no último mês do trimestre. "
        + "A carga completa do Presumido só se lê no fechamento trimestral.",
    });

  return {
    competencia,
    receita: rec,
    presuncao: PRESUNCAO,
    pis,
    cofins,
    irpj,
    csll,
    trimestre,
    fechaTrimestre: isFimDeTrimestre(competencia),
    servicos16: servicos16Resposta,
    cargaEfetiva: carga,
    quotaDeTrimestreAnterior: quotaDeTrimestreAnterior({ competencia, composicao: composicaoDaGuia }),
    naoCalculado: TRIBUTOS_NAO_CALCULADOS,
    observacoes,
  };
}

// ── auxiliares ────────────────────────────────────────────────────────────────────────────────

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function r2(n) {
  return Math.round(numero(n) * 100) / 100;
}

function normalizarReceita(r) {
  const servicos = r2(r?.servicos);
  const mercadorias = r2(r?.mercadorias);
  return { servicos, mercadorias, total: r2(servicos + mercadorias) };
}

function brl(v) {
  return numero(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
