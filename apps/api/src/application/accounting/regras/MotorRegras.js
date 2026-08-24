/**
 * O MOTOR DE VERIFICAÇÃO DE LANÇAMENTOS. Módulo PURO — sem prisma, sem rede, sem relógio.
 *
 * Responde uma pergunta: **este lançamento vai para as contas certas?** — para o contador conferir
 * ANTES de importar no sistema contábil, que é o pedido do dono.
 *
 * ## ⚠⚠ A REGRA VEIO DO DONO E ESTÁ PROVADA NO BALANCETE DO SISTEMA DE DESTINO
 *
 * Balancete de Verificação (Nasajon), fornecido por ele. Os pares batem **centavo a centavo**:
 *
 * | provisão | débito | crédito |
 * |---|---|---|
 * | ISS | `3.3.1.03.0004 (-) ISS` D 51.048,16 | `2.1.1.05.0004 ISS A RECOLHER` C 51.048,16 |
 * | PIS | `3.3.1.03.0005 (-) PIS` D 16.523,41 | `2.1.1.05.0005` C 16.523,41 |
 * | COFINS | `3.3.1.03.0006 (-) COFINS` D 76.261,92 | `2.1.1.05.0006` C 76.261,92 |
 * | **IRPJ** | **`4.1.1.03.0006 IRPJ` D 221.551,10** | `2.1.1.05.0001` C 221.551,10 |
 * | **CSLL** | **`4.1.1.03.0005 CONTRIBUICAO SOCIAL` D 73.706,14** | `2.1.1.05.0007` C 73.706,14 |
 * | DAS | `3.3.1.03.0009 (-) DAS` | `2.1.1.05.0016 DAS A RECOLHER` |
 * | pagamento | a mesma `2.1.1.05.*` | `1.1.1.*` disponibilidades |
 *
 * **O fundamento:** ISS, PIS, COFINS e DAS incidem sobre o **faturamento** ⇒ são deduções da
 * receita bruta (o rodapé prova: 2.540.865,52 − 143.833,49 = 2.397.032,03, a linha RECEITAS). IRPJ
 * e CSLL incidem sobre o **lucro** ⇒ são despesa (`DESPESAS TRIBUTARIAS 295.257,24` = 221.551,10 +
 * 73.706,14).
 *
 * ⚠⚠ **E a linha que decide contra o plano externo:** o resumo do balancete traz
 * **`(-) IRPJ/CSLL ....... 0,00`**. O ramo `5` existe no plano e o sistema de destino **não o usa**.
 * O plano externo mandava sugerir `RESULTADO_POS_LAIR` (= ramo 5) — segui-lo **recriaria o erro de
 * importação que este motor existe para evitar**. Decisão do dono: `4.1.1.03`.
 *
 * ## ⚠⚠ DUAS REGRAS DO PLANO EXTERNO NÃO FORAM IMPLEMENTADAS — elas quebrariam este sistema
 *
 * - **`F1.01` (Σ D ≠ Σ C ⇒ ERRO, por lançamento).** Medido: **623 de 632 lançamentos não fecham
 *   isoladamente**, porque desde a Q52 **cada perna é um lançamento próprio** (o front declara:
 *   *"lançamento de 1 perna é válido (em aberto)"*). Por COMPETÊNCIA é **143 de 143, diferença
 *   R$ 0,00**. A conferência certa já existe em `lib/../fechamentoBlockers.js:92`, que agrupa por
 *   `parcelamentoId`/`loteImportacao` exatamente por isso e **bloqueia o fechamento, não a
 *   gravação**. Duplicá-la aqui poria a base inteira em quarentena.
 * - **`F1.06` (falta conta D ou C ⇒ ERRO).** Há **76 linhas com conta vazia** e 31 provisões com as
 *   duas em branco. Aqui isso é `INDETERMINADO`, contado, nunca acusado.
 *
 * ## ⚠ O que este motor NÃO faz
 *
 * Não escreve, não chama rede, não decide contabilidade. **Nenhuma regra é `ERRO`** — ver
 * `contratos.js`. E ele não julga lançamento de PARCELAMENTO: aquele subsistema tem regra própria
 * (`MapaContaTributo`, `ParcelamentoV2Service`), e julgar por cima produziria falso positivo.
 */

import { FAMILIA, classificarFamilia, pontuarCodigoCompleto } from "./familiaDaConta.js";
import { REGRA, SEVERIDADE, SITUACAO, montarAchado } from "./contratos.js";

/**
 * De que tributo é este lançamento, e sobre o que ele incide.
 *
 * ⚠ Lê `eventType` primeiro e `subtipo` depois — `eventType` é o que os geradores automáticos
 * escrevem (`GuideToProvisionService`, `AccountingEntryGeneratorService`); `subtipo` é a linha da
 * Circular e sobrevive em lançamento manual.
 * ⚠ `PIS_COFINS` está aqui porque é o subtipo LEGADO (11 registros medidos em produção), de quando
 * PIS e COFINS compartilhavam uma linha só. Ele incide sobre a receita como os dois.
 */
const SOBRE_A_RECEITA = new Set([
  "DARF_PIS", "DARF_COFINS", "DARF_ISS",
  "PIS", "COFINS", "ISS", "PIS_COFINS",
  "DAS_SIMPLES", "SIMPLES", "DAS",
]);
const SOBRE_O_LUCRO = new Set(["DARF_IRPJ", "DARF_CSLL", "IRPJ", "CSLL"]);

/** `"RECEITA"` · `"LUCRO"` · `null` quando não dá para saber. ⚠ `null` NÃO é acusação. */
export function baseDeIncidencia(lancamento) {
  for (const bruto of [lancamento?.eventType, lancamento?.subtipo]) {
    const chave = String(bruto ?? "").trim().toUpperCase();
    if (!chave) continue;
    if (SOBRE_A_RECEITA.has(chave)) return "RECEITA";
    if (SOBRE_O_LUCRO.has(chave)) return "LUCRO";
  }
  return null;
}

const ESPERADO = Object.freeze({
  RETIFICADORA: "3.3.1.03.*",
  DESPESA_TRIBUTARIA: "4.1.1.03.*",
  OBRIGACAO: "2.1.1.05.*",
  OBRIGACAO_OU_TRABALHISTA: "2.1.1.05.* ou 2.1.1.04.*",
  BAIXA_DEBITO: "a obrigacao (2.1.1.05.* ou 2.1.1.04.*) ou o acrescimo (4.1.1.04.*)",
  DISPONIBILIDADE: "1.1.1.*",
});

// ⚠⚠ AS DUAS LISTAS ABAIXO NASCERAM DE FALSO POSITIVO MEDIDO EM PRODUÇÃO, e estão aqui em vez de
// espalhadas nos `if` justamente para não voltarem a ficar estreitas. A primeira versão deste motor
// exigia débito de pagamento em `21105*` e acusou **31 lançamentos corretos** — todo pagamento de
// INSS da carteira, mais as pernas de juros e multa.
//
// - **INSS é obrigação TRABALHISTA**, não tributária: `2.1.1.04.0009 INSS A PAGAR`.
// - **A baixa é TRÊS lançamentos** neste projeto (`D principal / C caixa` · `D juros / C caixa` ·
//   `D multa / C caixa`), decisão do dono registrada no `CLAUDE.md` desta pasta. As pernas de
//   acréscimo debitam `4.1.1.04` (as mesmas contas de `contasAcrescimo.js`).
const DEBITOS_DE_PAGAMENTO = new Set([
  FAMILIA.OBRIGACAO_TRIBUTARIA,
  FAMILIA.OBRIGACAO_TRABALHISTA,
  FAMILIA.PASSIVO_PARCELAMENTO,
  FAMILIA.DESPESA_FINANCEIRA,
]);
/** O crédito de uma provisão cujo tributo NÃO foi identificado — pode ser tributária ou trabalhista. */
const CREDITOS_DE_PROVISAO_GENERICA = new Set([
  FAMILIA.OBRIGACAO_TRIBUTARIA,
  FAMILIA.OBRIGACAO_TRABALHISTA,
]);

const BASE_RECEITA = "Lei 6.404/76 art. 187 I-II; ITG 1000 item 23; balancete do sistema de destino";
const BASE_LUCRO = "Lei 6.404/76 art. 187 V-VI; CPC 32; balancete do sistema de destino";

/** A perna `D` ou `C`, com a conta já resolvida no plano. `null` quando não existe ou está vazia. */
function lerPerna(lancamento, tipo, resolverConta) {
  const linha = (lancamento?.lines || []).find((l) => l?.tipo === tipo);
  if (!linha) return null;
  const codigo = String(linha.conta ?? "").trim();
  if (!codigo) return { codigo: null, conta: null, familia: FAMILIA.INDETERMINADO };
  const conta = resolverConta ? resolverConta(codigo) : null;
  return { codigo, conta, familia: classificarFamilia(conta) };
}

const rotulo = (perna) => {
  if (!perna?.conta) return perna?.codigo ? `conta ${perna.codigo}` : "conta em branco";
  const pontuado = pontuarCodigoCompleto(perna.conta.codigoCompleto);
  const nome = String(perna.conta.nome ?? "").trim();
  return nome ? `${pontuado} ${nome}` : pontuado;
};

/**
 * Verifica UM lançamento.
 *
 * @param lancamento `{ tipo, eventType, subtipo, parcelamentoId, lines: [{conta, tipo, valor}] }`
 * @param resolverConta `(codigoReduzido) => { codigo, nome, codigoCompleto } | null`
 *
 * ⚠ `resolverConta` é INJETADO, e é o que mantém este módulo puro e testável sem banco. Ele também
 * é o que garante a instrução do dono: a classificação sai do `codigoCompleto` LIDO AGORA no plano,
 * nunca de algo gravado — reduzido renumerado se conserta sozinho.
 */
export function verificarLancamento({ lancamento, resolverConta, empresaId = null }) {
  const achados = [];
  const tipo = String(lancamento?.tipo ?? "").trim().toUpperCase();

  // ⚠ PARCELAMENTO TEM REGRA PRÓPRIA, EM OUTRO LUGAR. `ParcelamentoV2Service` + `MapaContaTributo`
  // decidem as contas dele, com linhas de juros, multa e principal que não têm a forma de uma
  // provisão comum. Julgá-lo aqui produziria acusação em cima de lançamento correto.
  if (lancamento?.parcelamentoId) {
    return { achados, situacao: SITUACAO.INDETERMINADO, motivo: "lancamento_de_parcelamento" };
  }
  if (tipo !== "PROVISAO" && tipo !== "BAIXA") {
    return { achados, situacao: SITUACAO.INDETERMINADO, motivo: "tipo_fora_do_catalogo" };
  }

  const d = lerPerna(lancamento, "D", resolverConta);
  const c = lerPerna(lancamento, "C", resolverConta);
  const temD = d && d.familia !== FAMILIA.INDETERMINADO;
  const temC = c && c.familia !== FAMILIA.INDETERMINADO;
  if (!temD && !temC) {
    return { achados, situacao: SITUACAO.INDETERMINADO, motivo: "sem_conta_resolvida" };
  }

  const novo = (p) => montarAchado({ ...p, empresaId });

  if (tipo === "BAIXA") {
    // ── PAGAMENTO: baixa a obrigação contra o disponível ──────────────────────────────────────
    // ⚠⚠ A FORMA INVERTIDA VEM PRIMEIRO. `D caixa / C obrigação` marcado como BAIXA não é
    // "pagamento com duas contas erradas" — é a forma de um ESTORNO (este projeto tem
    // `tipo: "ESTORNO"` para isso). Dizer isso vale mais que duas acusações genéricas, e foi um
    // caso REAL medido em produção.
    if (temD && temC && d.familia === FAMILIA.DISPONIBILIDADE
        && (d.familia !== c.familia)
        && (c.familia === FAMILIA.OBRIGACAO_TRIBUTARIA || c.familia === FAMILIA.OBRIGACAO_TRABALHISTA
            || c.familia === FAMILIA.PASSIVO_PARCELAMENTO)) {
      achados.push(novo({
        regraId: REGRA.PAGAMENTO_FORMA,
        mensagem: `Está marcado como pagamento, mas tem a forma invertida (debita ${rotulo(d)} e credita ${rotulo(c)}) — parece um estorno.`,
        perna: null, contaCulpada: d.codigo, esperado: null, baseNormativa: BASE_RECEITA,
      }));
      return { achados, situacao: SITUACAO.VIOLA };
    }

    const debitoOk = !temD || DEBITOS_DE_PAGAMENTO.has(d.familia);
    const creditoOk = !temC || c.familia === FAMILIA.DISPONIBILIDADE;
    if (!debitoOk) {
      achados.push(novo({
        regraId: REGRA.PAGAMENTO_FORMA,
        mensagem: `Pagamento debitando ${rotulo(d)} — esperado ${ESPERADO.BAIXA_DEBITO}.`,
        perna: "D", contaCulpada: d.codigo, esperado: ESPERADO.BAIXA_DEBITO, baseNormativa: BASE_RECEITA,
      }));
    }
    if (!creditoOk) {
      achados.push(novo({
        regraId: REGRA.PAGAMENTO_FORMA,
        mensagem: `Pagamento creditando ${rotulo(c)} — esperado caixa ou banco (${ESPERADO.DISPONIBILIDADE}).`,
        perna: "C", contaCulpada: c.codigo, esperado: ESPERADO.DISPONIBILIDADE, baseNormativa: BASE_RECEITA,
      }));
    }
    return { achados, situacao: achados.length ? SITUACAO.VIOLA : SITUACAO.OK };
  }

  // ── PROVISÃO ────────────────────────────────────────────────────────────────────────────────

  // ⚠ AS FORMAS TROCADAS VÊM PRIMEIRO. Um lançamento tipado PROVISAO que tem a forma de um
  // PAGAMENTO não é "provisão com conta errada" — é outra coisa no lugar errado, e dizer isso é
  // mais útil que apontar duas pernas erradas.
  if (temD && temC && d.familia === FAMILIA.OBRIGACAO_TRIBUTARIA && c.familia === FAMILIA.DISPONIBILIDADE) {
    achados.push(novo({
      regraId: REGRA.PROVISAO_COM_FORMA_DE_PAGAMENTO,
      mensagem: `Está marcado como provisão, mas tem a forma de um pagamento (debita ${rotulo(d)} e credita ${rotulo(c)}).`,
      perna: null, contaCulpada: d.codigo, esperado: null, baseNormativa: BASE_RECEITA,
    }));
    return { achados, situacao: SITUACAO.VIOLA };
  }

  // ⚠ CONFERIR, NUNCA VIOLA. Transferir dívida para um parcelamento é ato legítimo com forma de
  // provisão (medido: 7 casos, `553 → 265`). Acusá-lo treinaria o contador a ignorar a lista;
  // escondê-lo perderia o caso real.
  if (temD && temC
      && (d.familia === FAMILIA.PASSIVO_PARCELAMENTO || c.familia === FAMILIA.PASSIVO_PARCELAMENTO)
      && (d.familia === FAMILIA.OBRIGACAO_TRIBUTARIA || d.familia === FAMILIA.PASSIVO_PARCELAMENTO)
      && (c.familia === FAMILIA.OBRIGACAO_TRIBUTARIA || c.familia === FAMILIA.PASSIVO_PARCELAMENTO)) {
    achados.push(novo({
      regraId: REGRA.PARCELAMENTO_COM_FORMA_DE_PROVISAO,
      severidade: SEVERIDADE.SUGESTAO,
      mensagem: `Move dívida entre passivos (${rotulo(d)} → ${rotulo(c)}). Costuma ser inclusão em parcelamento — confira se é isso.`,
      perna: null, contaCulpada: d.codigo, esperado: null, baseNormativa: null,
    }));
    return { achados, situacao: SITUACAO.CONFERIR };
  }

  const base = baseDeIncidencia(lancamento);
  const ehDas = String(lancamento?.eventType ?? lancamento?.subtipo ?? "").toUpperCase().includes("DAS")
    || String(lancamento?.eventType ?? "").toUpperCase() === "DAS_SIMPLES";

  // ── o DÉBITO ───────────────────────────────────────────────────────────────────────────────
  if (temD) {
    if (base === "LUCRO" && d.familia !== FAMILIA.DESPESA_TRIBUTARIA) {
      // ⚠⚠ Pega tanto a retificadora (IRPJ não é dedução de receita) quanto o ramo `5`, que é o
      // de-para errado do import — o ramo `5` cai aqui por INCLUSÃO, sem regra escrita contra ele.
      achados.push(novo({
        regraId: REGRA.IRPJ_CSLL_DEBITO,
        mensagem: `IRPJ/CSLL incide sobre o lucro, não sobre a receita: debitando ${rotulo(d)} — esperado despesa tributária (${ESPERADO.DESPESA_TRIBUTARIA}).`,
        perna: "D", contaCulpada: d.codigo, esperado: ESPERADO.DESPESA_TRIBUTARIA, baseNormativa: BASE_LUCRO,
      }));
    } else if (base === "RECEITA" && d.familia !== FAMILIA.RETIFICADORA_DE_RECEITA) {
      achados.push(novo({
        regraId: ehDas ? REGRA.DAS_DEBITO : REGRA.TRIBUTO_RECEITA_DEBITO,
        mensagem: `Tributo sobre o faturamento é dedução da receita bruta: debitando ${rotulo(d)} — esperado ${ESPERADO.RETIFICADORA}.`,
        perna: "D", contaCulpada: d.codigo, esperado: ESPERADO.RETIFICADORA, baseNormativa: BASE_RECEITA,
      }));
    } else if (base === null
        && d.familia !== FAMILIA.RETIFICADORA_DE_RECEITA
        && d.familia !== FAMILIA.DESPESA_TRIBUTARIA) {
      // ⚠ Tributo não identificado: a regra genérica ainda vale, e é mais frouxa DE PROPÓSITO —
      // sem saber qual tributo é, não dá para escolher entre retificadora e despesa.
      achados.push(novo({
        regraId: REGRA.TRIBUTO_RECEITA_DEBITO,
        mensagem: `Provisão debitando ${rotulo(d)} — esperado ${ESPERADO.RETIFICADORA} ou ${ESPERADO.DESPESA_TRIBUTARIA}.`,
        perna: "D", contaCulpada: d.codigo, esperado: `${ESPERADO.RETIFICADORA} ou ${ESPERADO.DESPESA_TRIBUTARIA}`,
        baseNormativa: BASE_RECEITA,
      }));
    }
  }

  // ── o CRÉDITO ──────────────────────────────────────────────────────────────────────────────
  // ⚠ Tributo IDENTIFICADO credita `21105*` (obrigação tributária). Tributo desconhecido aceita
  // também `21104*`: sem saber qual é, não dá para descartar INSS/FGTS, que são trabalhistas.
  const creditoEsperado = base === null ? CREDITOS_DE_PROVISAO_GENERICA
    : new Set([FAMILIA.OBRIGACAO_TRIBUTARIA]);
  if (temC && !creditoEsperado.has(c.familia)) {
    // ⚠⚠ ESTE É O CASO RELATADO PELO DONO: a provisão de CSLL creditando `1.2.1.06.0003`, que é
    // ATIVO, sob INCENTIVOS FISCAIS — nunca foi conta de imposto a recolher.
    achados.push(novo({
      regraId: base === "LUCRO" ? REGRA.IRPJ_CSLL_CONTRAPARTIDA_PASSIVO
        : ehDas ? REGRA.DAS_CONTRAPARTIDA : REGRA.TRIBUTO_CONTRAPARTIDA_PASSIVO,
      mensagem: `Provisão creditando ${rotulo(c)} — esperado a obrigação a recolher (${ESPERADO.OBRIGACAO}).`,
      perna: "C", contaCulpada: c.codigo,
      esperado: base === null ? ESPERADO.OBRIGACAO_OU_TRABALHISTA : ESPERADO.OBRIGACAO,
      baseNormativa: base === "LUCRO" ? BASE_LUCRO : BASE_RECEITA,
    }));
  }

  return { achados, situacao: achados.length ? SITUACAO.VIOLA : SITUACAO.OK };
}

/**
 * Verifica um LOTE, e devolve o relatório **agrupado por REGRA**.
 *
 * ⚠⚠ `porRegra` É REQUISITO, NÃO CONVENIÊNCIA — é a melhor ideia do plano externo. O contador não
 * quer 134 linhas: quer *"F3.01 — 6 provisões de IRPJ/CSLL debitando o ramo 5"*, e corrigir as seis
 * de uma vez. Agrupado por lançamento, a lista é longa demais para alguém ler antes de importar.
 *
 * ⚠ O motor **roda tudo e coleta tudo** — nunca para no primeiro achado.
 */
export function verificarLote({ lancamentos, resolverConta, empresaId = null, overrides = null }) {
  const suprimidos = overrides instanceof Set ? overrides : new Set(overrides || []);
  const porRegra = new Map();
  const porLancamento = [];
  const resumo = { total: 0, ok: 0, viola: 0, conferir: 0, indeterminado: 0, suprimidos: 0 };

  for (const lancamento of Array.isArray(lancamentos) ? lancamentos : []) {
    resumo.total += 1;
    const r = verificarLancamento({ lancamento, resolverConta, empresaId });

    const visiveis = r.achados.filter((a) => {
      if (!suprimidos.has(a.hash)) return true;
      resumo.suprimidos += 1;
      return false;
    });
    // ⚠ Suprimir TODOS os achados devolve o lançamento a OK — o override existe para isso. Mas o
    // contador precisa ver quantos foram suprimidos, senão a lista limpa esconde a decisão.
    const situacao = visiveis.length ? r.situacao : (r.situacao === SITUACAO.INDETERMINADO ? r.situacao : SITUACAO.OK);

    if (situacao === SITUACAO.OK) resumo.ok += 1;
    else if (situacao === SITUACAO.VIOLA) resumo.viola += 1;
    else if (situacao === SITUACAO.CONFERIR) resumo.conferir += 1;
    else resumo.indeterminado += 1;

    porLancamento.push({ id: lancamento?.id ?? null, situacao, motivo: r.motivo ?? null, achados: visiveis });

    for (const a of visiveis) {
      const g = porRegra.get(a.regraId) || { regraId: a.regraId, severidade: a.severidade, n: 0, exemplos: [], lancamentos: [] };
      g.n += 1;
      if (g.exemplos.length < 3) g.exemplos.push(a.mensagem);
      if (lancamento?.id) g.lancamentos.push(lancamento.id);
      porRegra.set(a.regraId, g);
    }
  }

  return {
    resumo,
    porRegra: [...porRegra.values()].sort((a, b) => b.n - a.n),
    porLancamento,
  };
}
