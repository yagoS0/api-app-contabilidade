// Q21 (spec v2) — Contrato interno do parcelamento (DTO).
//
// Toda origem (entrada manual = referência; adaptador SERPRO) produz ESTES DTOs.
// Nada a jusante (vínculo/provisão/pagamento/circular) conhece o formato do SERPRO.
//
// TributoDTO  : { codigoTributo, nomeTributo?, principal, multa, juros, total }  (juros LIDO, nunca derivado)
// ParcelaDTO  : { numeroParcela, quantidadeParcelas, anoMesParcela, vencimento?, valorTotal, tributos: TributoDTO[] }
// ParcelamentoDTO : { tipo, numeroParcelamento, valorTotal, valorPrincipal, valorMulta, valorJuros,
//                     quantidadeParcelas, parcelaInicial?, dataAdesao?, origem }

export const TIPOS_PARCELAMENTO = [
  "PARCSN", "PARCSN_ESPECIAL", "PERT_SN", "RELP_SN",
  "PARCMEI", "PARCMEI_ESPECIAL", "PERT_MEI", "RELP_MEI",
  "INSS", // Q61: parcelamento previdenciário/INSS (manual — sem auto-search SERPRO)
  "OUTRO",
];

// ─────────────────────────────────────────────────────────────────────────────
// AS DUAS FAMÍLIAS — fonte ÚNICA do backend
// ─────────────────────────────────────────────────────────────────────────────
//
// POR QUE MORA AQUI: é neste arquivo que `TIPOS_PARCELAMENTO` vive, e a família é uma
// propriedade da própria lista de tipos — separá-las faria a lista crescer num arquivo e a
// família noutro, que é exatamente como as cópias parciais nasceram. O módulo é PURO (sem
// prisma, sem express), então o service, o worker e a rota importam sem arrastar dependência.
//
// ⚠ NÃO DÁ PARA IMPORTAR A CÓPIA DO FRONT (`apps/web/src/lib/vocabulario.js`): o `Dockerfile`
// não copia `packages/`, e cruzar apps quebraria o boot em produção. Esta é a fonte do BACKEND;
// as duas dizem a mesma coisa e cada uma serve à sua camada.
//
// ⚠ A LISTA É FECHADA DE PROPÓSITO — nada de prefixo `^PARCSN`. Foi um prefixo
// (`/^PARC(SN|MEI)/`) que deixou PERT_SN, RELP_SN, PERT_MEI e RELP_MEI fora da busca automática
// do SERPRO em silêncio: as quatro não casam com ele. Lista fechada é o que separa "modalidade
// conhecida" de "modalidade nova".

export const FAMILIAS_PARCELAMENTO = Object.freeze({
  SIMPLES_NACIONAL: Object.freeze({
    // ⚠ A chave de memória de contas é a modalidade JÁ SEMEADA (`MapaContaTributoSeeds`), não um
    // rótulo novo: colapsar para uma chave inédita orfanaria as 5 linhas que já existem.
    chaveMemoria: "PARCSN",
    modalidades: Object.freeze(["PARCSN", "PARCSN_ESPECIAL", "PERT_SN", "RELP_SN"]),
  }),
  MEI: Object.freeze({
    chaveMemoria: "PARCMEI",
    modalidades: Object.freeze(["PARCMEI", "PARCMEI_ESPECIAL", "PERT_MEI", "RELP_MEI"]),
  }),
});

/** Conhecidas e SEM família — não colapsam, e isso é o desenho, não uma lacuna.
 *  INSS é parcelamento previdenciário (manual, sem auto-search); OUTRO é o balde do
 *  PGFN/estadual/municipal. Chamar qualquer um dos dois de "Simples" seria inventar natureza. */
export const MODALIDADES_SEM_FAMILIA = Object.freeze(["INSS", "OUTRO"]);

const FAMILIA_DA_MODALIDADE = new Map(
  Object.entries(FAMILIAS_PARCELAMENTO).flatMap(([familia, { modalidades }]) =>
    modalidades.map((m) => [m, familia])),
);

/** A família de uma modalidade crua, ou `null` (INSS/OUTRO e qualquer modalidade nova). */
export function familiaDaModalidade(tipoCru) {
  const cru = String(tipoCru || "").trim().toUpperCase();
  return FAMILIA_DA_MODALIDADE.get(cru) || null;
}

export const GRUPO_SN_MEI = "sn_mei";
export const GRUPO_OUTROS = "outros";

/**
 * `Parcelamento.grupo` — quem integra a busca automática do SERPRO.
 *
 * `sn_mei` = as OITO modalidades das duas famílias. `outros` = INSS, OUTRO e **modalidade
 * desconhecida**: os dois filtros de busca automática são `grupo: { not: "outros" }`
 * (`workers/serproPgdasdWorker.js` e `routes/firm/.../serpro/parcelamento/capture`), e mandar
 * uma modalidade que ninguém conhece para a captura seria supor que ela é do Simples. O front
 * levanta REVISÃO nesse caso; aqui o equivalente conservador é ficar de fora — a captura é ato
 * externo e pago, e o caminho manual continua aberto.
 */
export function grupoDoParcelamento(tipoCru) {
  return familiaDaModalidade(tipoCru) ? GRUPO_SN_MEI : GRUPO_OUTROS;
}

/**
 * A chave do `MapaContaTributo` — COLAPSADA PARA A FAMÍLIA.
 *
 * Decisão do dono: *"colapsar para 'PARC SN' está certo na camada da regra contábil e da memória
 * de contas — o tratamento é idêntico entre PARCSN, PARCSN-ESP, PERTSN e RELPSN, e fragmentar a
 * memória de padrão em nove chaves só faria o contador preencher a mesma tríade de contas nove
 * vezes."*
 *
 * ⚠ ISTO É CHAVE DE MEMÓRIA, NÃO A MODALIDADE. A modalidade CRUA continua gravada em
 * `Parcelamento.tipo` e continua alimentando `subtipo: PARC_<TIPO>` e
 * `historicoBase: PROVISÃO <TIPO>`. Colapsar na variável mudaria a FORMA e o HISTÓRICO do
 * lançamento contábil — proibido sem pedido explícito — e apagaria da contabilidade a distinção
 * entre PERT e RELP, que têm reduções de multa e juros: não mudam as contas, mudam os valores.
 *
 * Fora das duas famílias (INSS, OUTRO, modalidade nova) devolve o valor CRU: sem família não há
 * para onde colapsar, e colapsar por palpite mandaria um acordo de natureza desconhecida para o
 * padrão de contas do Simples sem que ninguém visse.
 */
export function chaveMemoriaContas(tipoCru) {
  const cru = String(tipoCru || "").trim().toUpperCase();
  const familia = familiaDaModalidade(cru);
  return familia ? FAMILIAS_PARCELAMENTO[familia].chaveMemoria : cru;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

/** Normaliza um TributoDTO. `total` é derivado de p+m+j quando ausente (conveniência manual);
 *  quando vem (SERPRO/PDF), é mantido pra os invariantes confrontarem. */
export function normalizeTributoDTO(raw = {}) {
  const principal = round2(raw.principal);
  const multa = round2(raw.multa);
  const juros = round2(raw.juros); // LIDO — nunca derivado por subtração
  const total = raw.total != null ? round2(raw.total) : round2(principal + multa + juros);
  return {
    codigoTributo: String(raw.codigoTributo || raw.codigo || "").trim(),
    nomeTributo: raw.nomeTributo || raw.denominacao || null,
    principal, multa, juros, total,
  };
}

/** Normaliza um ParcelaDTO. `valorTotal` deriva da soma dos tributos quando ausente. */
export function normalizeParcelaDTO(raw = {}) {
  const tributos = Array.isArray(raw.tributos) ? raw.tributos.map(normalizeTributoDTO) : [];
  const somaTrib = round2(tributos.reduce((s, t) => s + t.total, 0));
  return {
    numeroParcela: raw.numeroParcela != null ? Number(raw.numeroParcela) : null,
    quantidadeParcelas: raw.quantidadeParcelas != null ? Number(raw.quantidadeParcelas) : null,
    anoMesParcela: raw.anoMesParcela ? String(raw.anoMesParcela) : null, // YYYYMM
    vencimento: raw.vencimento || null,
    valorTotal: raw.valorTotal != null ? round2(raw.valorTotal) : somaTrib,
    tributos,
  };
}

/**
 * F2.3 — as duas formas de pagar um parcelamento, como VOCABULÁRIO FECHADO.
 *
 * ⚠ O terceiro estado é `null` = NÃO DECLARADO, e ele não é a mesma coisa que nenhum dos dois.
 * Valor desconhecido também cai em `null`: aceitar uma string livre aqui deixaria a coluna
 * (que tem CHECK no banco) derrubar a ingestão inteira por causa de um typo do payload.
 */
export const FORMAS_PAGAMENTO = ["DEBITO_AUTOMATICO", "GUIA_MENSAL"];

export function normalizeFormaPagamento(raw) {
  const v = String(raw || "").trim().toUpperCase();
  return FORMAS_PAGAMENTO.includes(v) ? v : null;
}

/** Normaliza o ParcelamentoDTO (cabeçalho consolidado). */
export function normalizeParcelamentoDTO(raw = {}) {
  // ⚠ `diaPagamento`: 1..31, clampado. É ele que gera o cronograma (`parcelaSync.calendarioDaParcela`)
  // e, portanto, a data que decide ATRASO quando não há guia. Ausente ⇒ `null`, e quem grava decide
  // o que fazer com a ausência — devolver 1 aqui esconderia "não informado" atrás de um dia válido,
  // que é exatamente como os 3 contratos de produção acabaram todos com vencimento no dia 1.
  const dia = raw.diaPagamento != null ? Math.trunc(Number(raw.diaPagamento)) : null;
  return {
    tipo: String(raw.tipo || "OUTRO").trim().toUpperCase(),
    numeroParcelamento: raw.numeroParcelamento != null ? String(raw.numeroParcelamento).trim() : null,
    valorTotal: raw.valorTotal != null ? round2(raw.valorTotal) : null,
    valorPrincipal: raw.valorPrincipal != null ? round2(raw.valorPrincipal) : null,
    valorMulta: raw.valorMulta != null ? round2(raw.valorMulta) : null,
    valorJuros: raw.valorJuros != null ? round2(raw.valorJuros) : null,
    quantidadeParcelas: raw.quantidadeParcelas != null ? Number(raw.quantidadeParcelas) : null,
    parcelaInicial: raw.parcelaInicial != null ? Number(raw.parcelaInicial) : null,
    dataAdesao: raw.dataAdesao || null,
    origem: String(raw.origem || "MANUAL").toUpperCase(),
    // F2.3 — o contrato passa a carregar COMO se paga e QUANTO ainda se deve.
    formaPagamento: normalizeFormaPagamento(raw.formaPagamento),
    diaPagamento: Number.isFinite(dia) ? Math.min(31, Math.max(1, dia)) : null,
    // ⚠ INFORMATIVO. Não vira lançamento em lugar nenhum — ver o comentário do campo no schema.
    // Quem vira lançamento na adesão é principal/juros/multa (`ParcelamentoV2Service.linhasProvisao`).
    saldoConsolidado: raw.saldoConsolidado != null ? round2(raw.saldoConsolidado) : null,
  };
}

export { round2 as round2Decimal, num as toNumber };
