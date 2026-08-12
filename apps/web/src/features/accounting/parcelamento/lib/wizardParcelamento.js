// F2.3 (front) — AS REGRAS DO WIZARD "NOVO PARCELAMENTO", fora do componente.
//
// O parcelamento é um CONTRATO de dívida de até 60 meses; a guia é evidência MENSAL e OPCIONAL —
// ela não existe em débito automático nem nas prestações de um acordo migrado de outra
// contabilidade. Este arquivo é a parte do wizard que dá para testar sem montar tela: validação de
// cada passo, as derivações que o rodapé mostra e a montagem do payload de
// `POST /parcelamentos/ingestao`.
//
// ⚠ POR QUE A COMPETÊNCIA DA 1ª PARCELA É COLETADA. O backend grava
// `competenciaInicial = header.anoMesParcela` e deriva TODO o cronograma dela
// (`parcelaSync.calendarioDaParcela`: parcela n vence em `addMonths(competenciaInicial, n-1)` no dia
// `diaPagamento`). Mandar ali a competência da parcela ATUAL — que é o que o caminho guia-first faz —
// desloca o cronograma inteiro pelo número de prestações já pagas: num contrato migrado na 23ª de 60
// seriam 22 meses de erro em toda data de vencimento, e é o vencimento que decide atraso quando não
// há guia. Sem ela e sem guia o backend grava a sentinela `1970-01` e o cronograma nasce SEM DATAS.
//
// ⚠ `saldoConsolidado` É INFORMATIVO E NÃO VIRA LANÇAMENTO — nem aqui nem no backend. Ele é exibido
// para CONFERÊNCIA ao lado do valor que de fato será provisionado, e a divergência entre os dois é
// um aviso, nunca um bloqueio (juros embutidos na parcela são normais).

import { avaliarValor } from "../../entries/lib/valorFormula";

/** Modalidades aceitas pelo backend (`contracts.js: TIPOS_PARCELAMENTO`) + rótulo de tela. */
export const MODALIDADES = Object.freeze([
  ["PARCSN", "Simples Nacional (PARCSN)"],
  ["PARCSN_ESPECIAL", "Simples Nacional Especial"],
  ["PERT_SN", "PERT-SN"],
  ["RELP_SN", "RELP-SN"],
  ["PARCMEI", "MEI (PARCMEI)"],
  ["PARCMEI_ESPECIAL", "MEI Especial"],
  ["PERT_MEI", "PERT-MEI"],
  ["RELP_MEI", "RELP-MEI"],
  ["INSS", "INSS / Previdenciário"],
  ["OUTRO", "Outro"],
]);

export function rotuloModalidade(tipo) {
  const achado = MODALIDADES.find(([v]) => v === tipo);
  return achado ? achado[1] : (tipo || "—");
}

/**
 * ⚠ O TERCEIRO ESTADO É `null` = NÃO DECLARADO, e ele não é nenhum dos outros dois.
 * O backend faz `formaPagamento` nascer NULL de propósito (`normalizeFormaPagamento` devolve null
 * para qualquer coisa fora da lista). Oferecer só duas opções obrigaria o contador a declarar algo
 * que ele pode não saber — e uma declaração errada aqui vira a explicação errada para "por que esta
 * prestação não tem guia".
 */
export const FORMAS_PAGAMENTO = Object.freeze([
  ["DEBITO_AUTOMATICO", "Débito automático em conta", "As prestações não geram guia. A evidência de pagamento vem do extrato/comprovante."],
  ["GUIA_MENSAL", "Guia mensal (DAS/DARF)", "Cada prestação tem uma guia, que pode ser anexada mês a mês."],
  ["", "Ainda não sei", "Fica registrado como não declarado. Não muda o cálculo de atraso — quem decide atraso é a evidência de pagamento."],
]);

export const SITUACOES = Object.freeze([
  ["NOVO", "Parcelamento novo", "A adesão está sendo feita agora; nenhuma prestação foi paga ainda."],
  ["EM_ANDAMENTO", "Em andamento", "O contrato já existe (migrado ou antigo) e algumas prestações já foram pagas."],
]);

export const PASSOS = Object.freeze([
  { id: 1, titulo: "Identificação" },
  { id: 2, titulo: "Valores e parcelas" },
  { id: 3, titulo: "Contabilização" },
]);

/**
 * Linhas-padrão da provisão da adesão. Espelha `ParcelamentoV2Service.linhasProvisao`:
 *
 *     D principal · D juros · D multa · C parcelamento a pagar (= principal + juros + multa)
 *
 * ⚠ A REGRA MUDOU EM 2026-08-12, E A ANTERIOR ESTÁ REGISTRADA DE PROPÓSITO. Até essa data a lista
 * tinha só PRINCIPAL + PARC, porque a adesão reconhecia **só o principal** (decisão anterior do
 * dono: juros e multa vinham da confirmação do pagamento). A decisão nova vence — *"o juros da
 * provisão precisa ser escrito"*, *"o parcelamento deve ter valor principal, juros, e valor juros +
 * principal fechando a contrapartida"* — e a multa entra junto (*"nós geralmente lançamos juros e
 * multa na mesma CONTA, mas podemos separar também, opcional"*).
 *
 * ⚠ "MESMA CONTA" É SOBRE A CONTA, NUNCA SOBRE O PAPEL. JUROS e MULTA são duas linhas com papéis
 * distintos que PODEM apontar para a mesma conta — colapsá-las num papel só apagaria a multa como
 * fato, que é o mesmo colapso que este trabalho está desfazendo.
 *
 * ⚠ COMPONENTE ZERADO NÃO VIRA LINHA: as linhas nascem aqui para dar onde digitar, e
 * `montarPayloadIngestao` descarta as que ficarem sem valor. Contrato sem multa fecha em
 * `principal + juros`.
 *
 * ⚠ O CRÉDITO DA CONTRAPARTIDA É **UM SÓ** — não são três créditos. Ele espelha a soma dos débitos
 * (ver `setLinhaProvisao` no componente).
 */
export const PROVISAO_PADRAO = Object.freeze([
  { tipoLinha: "PRINCIPAL", label: "Principal a provisionar", tipo: "D", conta: "", valor: "" },
  { tipoLinha: "JUROS", label: "Juros", tipo: "D", conta: "", valor: "" },
  { tipoLinha: "MULTA", label: "Multa", tipo: "D", conta: "", valor: "" },
  { tipoLinha: "PARC", label: "Parcelamento a pagar (passivo)", tipo: "C", conta: "", valor: "" },
]);

/**
 * ⚠ O PAPEL PASSOU A TER CASA NA TELA — e esta é a lista fechada do que se pode dizer.
 *
 * A causa raiz da provisão torta da SINTROPIA foi não existir COMO DIZER que uma linha era juros: a
 * tabela tinha `Descrição · D/C · Conta · Valor` e `addLinhaProvisao` cravava `PRINCIPAL` em toda
 * linha nova. O contador escolheu a conta 501 (juros) e digitou 7.034,32, e o papel gravado
 * continuou `PRINCIPAL` — `configProvisao` prova: `{D 265 PRINCIPAL}, {C 553 PARC}, {D 501 PRINCIPAL}`.
 *
 * ⚠ `CAIXA` NÃO ESTÁ AQUI, e a ausência é deliberada: a provisão da adesão **não credita caixa** —
 * o passivo é debitado depois, a cada parcela paga. Creditar caixa aqui foi o bug original da Q28
 * (provisão e pagamento compartilhando o mesmo papel de conta).
 */
export const PAPEIS_PROVISAO = Object.freeze(["PRINCIPAL", "JUROS", "MULTA", "CONTRAPARTIDA", "PARC"]);

/**
 * ⚠ O LADO DE CADA PAPEL NA PROVISÃO — é isto que faz D↔C e papel PARAREM DE DIVERGIR.
 *
 * O segundo caso medido em produção (`OUTRO nº 3`) é um **CRÉDITO marcado `PRINCIPAL`**: trocar D↔C
 * na tela não atualizava o papel, porque `setLinhaProvisao` só escreve a chave editada. Agora:
 *
 *   · escolher o PAPEL ajusta o lado (derivação determinística de uma escolha explícita);
 *   · mudar o LADO para o lado errado do papel é **recusado** por `validarPasso3`, com o motivo e a
 *     saída — nada é reescrito por baixo do contador.
 */
export const LADO_DO_PAPEL = Object.freeze({
  PRINCIPAL: "D", JUROS: "D", MULTA: "D", CONTRAPARTIDA: "D", PARC: "C",
});

/** Aplica um papel à linha e leva o lado junto. Pura — o componente só liga. */
export function linhaComPapel(linha, papel) {
  const p = String(papel || "");
  return { ...linha, tipoLinha: p, tipo: LADO_DO_PAPEL[p] || linha?.tipo || "D" };
}

/** A linha diverge quando tem papel conhecido e está no lado errado dele. */
export function papelDivergeDoLado(linha) {
  const esperado = LADO_DO_PAPEL[String(linha?.tipoLinha || "")];
  return Boolean(esperado) && linha?.tipo !== esperado;
}

/** Config de COMO cada parcela será baixada. Sem valores — eles saem da baixa. */
export const PAGAMENTO_PADRAO = Object.freeze([
  { tipoLinha: "PARC", label: "Parcelamento a pagar (baixa do principal)", tipo: "D", conta: "" },
  { tipoLinha: "JUROS", label: "Juros", tipo: "D", conta: "" },
  { tipoLinha: "CAIXA", label: "Caixa / Banco", tipo: "C", conta: "" },
]);

export const ROLE_LABEL = Object.freeze({
  PRINCIPAL: "Principal",
  JUROS: "Juros",
  MULTA: "Multa",
  PARC: "Parcelamento a pagar (passivo)",
  CAIXA: "Caixa / Banco",
  CONTRAPARTIDA: "Contrapartida (despesa/reclasse)",
});

/**
 * "1.234,56" | "1234,56" | "1234.56" | 1234.56 → Number (0 quando ilegível).
 *
 * ⚠ REUSA `avaliarValor` DA CÉLULA DE LANÇAMENTO, e não é conveniência. A regra do separador
 * decimal deste projeto é uma GRAMÁTICA ESTRITA (`entries/lib/valorFormula.js`, 48 testes
 * próprios): em pt-BR `,` é decimal e `.` é milhar, mas quem usa teclado numérico digita `.` como
 * decimal, e ler errado não dá um valor um pouco diferente — dá um valor 1000× maior ou menor.
 * Um `String(v).replace(",", ".")` escrito aqui à mão lê "1.234,56" como NaN e "1234,56" como
 * 1234,56: o Σ Débito e o Σ Crédito da mesma provisão passariam a discordar por causa de um ponto.
 */
export function numero(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const r = avaliarValor(v);
  return r.ok && !r.vazio && Number.isFinite(r.valor) ? r.valor : 0;
}

export function inteiro(v) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : 0;
}

/** "2026-05" + n → "2026-08" (n pode ser negativo). */
export function somarMeses(competencia, n) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + Number(n || 0), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Data do dia `dia` na competência, clampada ao último dia do mês. "dd/mm/aaaa" ou "—". */
export function vencimentoDaCompetencia(competencia, dia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "—";
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const ultimo = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  const d = Math.min(Math.max(1, inteiro(dia) || 1), ultimo);
  return `${String(d).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yyyy}`;
}

export const estadoInicial = () => ({
  // passo 1
  tipo: "PARCSN",
  numeroParcelamento: "",
  dataAdesao: "",
  situacao: "NOVO",
  descricao: "",
  // passo 2
  saldoConsolidado: "",
  valorParcela: "",
  totalParcelas: "",
  parcelasJaPagas: "",
  competenciaPrimeiraParcela: "",
  diaVencimento: "",
  formaPagamento: "",
  // passo 3
  modeloContas: "PARCSN",
  provisaoLines: PROVISAO_PADRAO.map((l) => ({ ...l })),
  pagamentoLines: PAGAMENTO_PADRAO.map((l) => ({ ...l })),
  tributos: [],
  // Quantas contas o CONTADOR digitou (as pré-preenchidas pela memória não contam) — alimenta
  // `oQueSePerdeAoFechar`.
  contasEditadas: 0,
});

/** Quantas prestações o sistema passa a gerenciar. Nunca negativo. */
export function parcelasRestantes(dados) {
  const total = inteiro(dados?.totalParcelas);
  const pagas = dados?.situacao === "EM_ANDAMENTO" ? inteiro(dados?.parcelasJaPagas) : 0;
  return Math.max(0, total - pagas);
}

/** O número da prestação que este contrato passa a acompanhar (a 1ª ainda não paga). */
export function proximaParcela(dados) {
  const pagas = dados?.situacao === "EM_ANDAMENTO" ? inteiro(dados?.parcelasJaPagas) : 0;
  return pagas + 1;
}

/** Competência da próxima prestação, derivada da 1ª + quantas já foram pagas. */
export function competenciaProximaParcela(dados) {
  return somarMeses(dados?.competenciaPrimeiraParcela, proximaParcela(dados) - 1);
}

// ─── Validação por passo ────────────────────────────────────────────────────────────────────────
// Cada uma devolve `{ ok, erros: {campo: motivo}, alertas: [texto] }`.
// ⚠ ALERTA NÃO É ERRO. Alerta descreve algo que costuma ser normal e merece um segundo olhar
// (juros embutidos na parcela); erro impede o avanço. Misturar os dois é o que faz o contador
// aprender a ignorar os dois.

export function validarPasso1(dados) {
  const erros = {};
  if (!String(dados?.tipo || "").trim()) erros.tipo = "Escolha a modalidade.";
  if (!String(dados?.numeroParcelamento || "").trim()) {
    erros.numeroParcelamento = "O nº do parcelamento é obrigatório — é por ele que o SERPRO é consultado.";
  }
  // A data de adesão é a DATA DO LANÇAMENTO da provisão. Sem ela o backend usa "hoje", e a adesão
  // de um contrato migrado cairia na competência errada sem ninguém ver.
  if (!String(dados?.dataAdesao || "").trim()) erros.dataAdesao = "Informe a data de adesão — é a data do lançamento da provisão.";
  if (!["NOVO", "EM_ANDAMENTO"].includes(dados?.situacao)) erros.situacao = "Escolha a situação do parcelamento.";
  return { ok: Object.keys(erros).length === 0, erros, alertas: [] };
}

export function validarPasso2(dados) {
  const erros = {};
  const alertas = [];

  const saldo = numero(dados?.saldoConsolidado);
  if (saldo <= 0) erros.saldoConsolidado = "Informe o saldo consolidado atual (maior que zero).";

  const parcela = numero(dados?.valorParcela);
  if (parcela <= 0) erros.valorParcela = "Informe o valor da parcela (maior que zero).";

  const total = inteiro(dados?.totalParcelas);
  if (total < 1) erros.totalParcelas = "Informe o total de parcelas do acordo.";
  else if (total > 60) alertas.push(`${total} parcelas é acima do teto usual de 60 meses — confira o contrato.`);

  if (dados?.situacao === "EM_ANDAMENTO") {
    const pagas = inteiro(dados?.parcelasJaPagas);
    if (pagas < 1) erros.parcelasJaPagas = "Em andamento: informe quantas prestações já foram pagas.";
    else if (total >= 1 && pagas >= total) {
      erros.parcelasJaPagas = `Já pagas (${pagas}) tem de ser MENOR que o total (${total}) — senão não sobra prestação para gerenciar.`;
    }
  }

  if (!/^\d{4}-\d{2}$/.test(String(dados?.competenciaPrimeiraParcela || ""))) {
    erros.competenciaPrimeiraParcela = "Informe a competência da 1ª parcela — é dela que sai o cronograma inteiro.";
  }

  // ⚠ O CAMPO QUE MAIS IMPORTA. É o dia do cronograma, e é ele que decide atraso quando não há
  // guia. Os contratos que já estão em produção nasceram todos no dia 1 porque ninguém o coletava.
  const dia = inteiro(dados?.diaVencimento);
  if (dia < 1 || dia > 31) erros.diaVencimento = "Informe o dia do vencimento mensal (1 a 31).";

  const restantes = parcelasRestantes(dados);
  if (parcela > 0 && restantes > 0 && saldo > 0) {
    const projetado = Math.round(parcela * restantes * 100) / 100;
    const diferenca = Math.round((projetado - saldo) * 100) / 100;
    // 1% de folga: arredondamento de centavos não é divergência.
    if (Math.abs(diferenca) > Math.max(1, saldo * 0.01)) {
      alertas.push(
        `Valor da parcela × ${restantes} restantes = R$ ${formatarMoeda(projetado)}, `
        + `e o saldo declarado é R$ ${formatarMoeda(saldo)} `
        + `(${diferenca > 0 ? "+" : "−"} R$ ${formatarMoeda(Math.abs(diferenca))}). `
        + "Juros embutidos nas prestações explicam a diferença — confira, mas não impede continuar.",
      );
    }
  }

  return { ok: Object.keys(erros).length === 0, erros, alertas };
}

/** Σ D e Σ C das linhas da provisão. */
export function somasProvisao(linhas) {
  const lista = Array.isArray(linhas) ? linhas : [];
  const debito = lista.filter((l) => l.tipo === "D").reduce((s, l) => s + numero(l.valor), 0);
  const credito = lista.filter((l) => l.tipo === "C").reduce((s, l) => s + numero(l.valor), 0);
  return { debito: round2(debito), credito: round2(credito), balanceado: Math.abs(debito - credito) < 0.01 };
}

/**
 * As linhas da provisão que de fato viram lançamento.
 *
 * ⚠ COMPONENTE ZERADO NÃO VIRA LINHA — a mesma regra da baixa. As linhas de JUROS e MULTA nascem na
 * tabela para dar ONDE digitar, e a memória de contas do escritório pré-preenche a conta delas: sem
 * este corte, um contrato sem multa gravaria um lançamento de **R$ 0,00** só porque a conta veio
 * preenchida sozinha.
 */
export function linhasQueViramLancamento(provisaoLines) {
  return (Array.isArray(provisaoLines) ? provisaoLines : []).filter((l) => numero(l.valor) > 0);
}

export function validarPasso3(dados) {
  const erros = {};
  const alertas = [];
  const linhas = Array.isArray(dados?.provisaoLines) ? dados.provisaoLines : [];

  const comAlgo = linhas.filter((l) => numero(l.valor) > 0 || String(l.conta || "").trim());
  if (!comAlgo.length) erros.provisao = "Preencha ao menos uma linha da provisão.";

  // ⚠ PAPEL AUSENTE É RECUSA, NÃO CHUTE — o mesmo contrato do backend
  // (`ParcelamentoV2Service.exigirPapel`, 400 `PAPEL_DE_LINHA_AUSENTE`). O papel decide quanto do
  // contrato é principal: chutá-lo faz `principalTotal == totalValue`, que é o defeito da SINTROPIA.
  const lancaveis = linhasQueViramLancamento(linhas);
  const semPapel = lancaveis.filter((l) => !String(l.tipoLinha || "").trim());
  if (semPapel.length) {
    erros.provisaoPapel = `${semPapel.length === 1 ? "1 linha com valor está" : `${semPapel.length} linhas com valor estão`} `
      + "sem PAPEL. O papel é o que diz quanto do contrato é principal, quanto é juros e quanto é multa — "
      + "e é o principal que o passivo promete amortizar. Escolha o papel na coluna \"Papel\".";
  }

  // ⚠ D↔C E PAPEL NÃO PODEM DIVERGIR. Já aconteceu em produção: um CRÉDITO marcado `PRINCIPAL`.
  const divergentes = lancaveis.filter(papelDivergeDoLado);
  if (divergentes.length) {
    const nomes = divergentes.map((l) => `${ROLE_LABEL[l.tipoLinha] || l.tipoLinha} como ${l.tipo}`).join(" · ");
    erros.provisaoLado = `Papel e lado discordam: ${nomes}. `
      + "Na provisão da adesão principal, juros, multa e contrapartida são DÉBITO, e o parcelamento a pagar "
      + "(passivo) é o CRÉDITO. Corrija o papel ou o lado da linha.";
  }

  const { debito, credito, balanceado } = somasProvisao(linhas);
  if (debito <= 0) erros.provisaoValor = "A provisão está sem valor — informe o principal a provisionar.";
  // ⚠ BLOQUEIA. Provisão desbalanceada trava o fechamento do mês depois (`fechamentoBlockers`), e
  // descobrir isso no cadeado, semanas depois, é o pior lugar possível.
  else if (!balanceado) {
    erros.provisaoBalanco = `Σ Débito (R$ ${formatarMoeda(debito)}) ≠ Σ Crédito (R$ ${formatarMoeda(credito)}). Um lançamento desbalanceado trava o fechamento do mês.`;
  }

  const semConta = comAlgo.filter((l) => !String(l.conta || "").trim());
  if (semConta.length) {
    // Não bloqueia: conta em branco no 1º parcelamento de uma modalidade é o estado esperado
    // (a memória só aprende depois do 1º preenchimento). Mas o cadeado do mês vai cobrar.
    alertas.push(
      `${semConta.length === 1 ? "1 linha está" : `${semConta.length} linhas estão`} sem conta. `
      + "O lançamento é criado assim mesmo, mas o fechamento do mês fica bloqueado até as contas serem preenchidas.",
    );
  }

  return { ok: Object.keys(erros).length === 0, erros, alertas };
}

export function validarPasso(passo, dados) {
  if (passo === 1) return validarPasso1(dados);
  if (passo === 2) return validarPasso2(dados);
  return validarPasso3(dados);
}

// ─── Saída ──────────────────────────────────────────────────────────────────────────────────────

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

export function formatarMoeda(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Monta o corpo de `POST /firm/companies/:id/parcelamentos/ingestao`.
 *
 * ⚠ `guideId` VAI AUSENTE DE PROPÓSITO — é o coração do parcelamento-first. A rota, o
 * `buildDTOsFromManual` e o `ingestParcelamentoFromGuide` já aceitavam a ausência; o que faltava era
 * a tela.
 *
 * ⚠ `valorPrincipal`/`valorTotal` saem das LINHAS da provisão, não do saldo declarado — é o valor
 * que de fato vira lançamento que precisa bater com o cabeçalho do contrato.
 */
export function montarPayloadIngestao(dados) {
  // ⚠ SÓ AS LINHAS COM VALOR — componente zerado não vira linha (ver `linhasQueViramLancamento`).
  const lancaveis = linhasQueViramLancamento(dados?.provisaoLines);

  // ⚠ O DEFAULT SILENCIOSO `|| (tipo === "C" ? "PARC" : "PRINCIPAL")` MORREU AQUI.
  // Ele era o gêmeo do que existia em `linhasProvisaoFromOverride`/`configFromLines` no backend, e
  // é o que produziu `principalTotal == totalValue` na SINTROPIA: um débito de JUROS que chegou sem
  // papel virava `PRINCIPAL` sem ninguém ver. Papel ausente é RECUSA — e o backend recusa também
  // (400 `PAPEL_DE_LINHA_AUSENTE`), então esta guarda é antecipação, não a trava.
  const semPapel = lancaveis.filter((l) => !String(l.tipoLinha || "").trim());
  if (semPapel.length) {
    throw new Error(
      `${semPapel.length === 1 ? "1 linha da provisão está" : `${semPapel.length} linhas da provisão estão`} `
      + "sem papel. Escolha o papel de cada linha (Principal · Juros · Multa · Parcelamento a pagar) "
      + "na coluna \"Papel\" antes de criar o parcelamento.",
    );
  }

  const linhas = lancaveis.map((l) => ({
    tipoLinha: String(l.tipoLinha).trim(),
    tipo: l.tipo === "C" ? "C" : "D",
    conta: String(l.conta || "").trim(),
    valor: round2(numero(l.valor)),
  }));

  const pagamento = (Array.isArray(dados?.pagamentoLines) ? dados.pagamentoLines : [])
    .filter((l) => l.tipoLinha || String(l.conta || "").trim())
    .map((l) => ({
      tipoLinha: l.tipoLinha || (l.tipo === "C" ? "CAIXA" : "PARC"),
      tipo: l.tipo === "C" ? "C" : "D",
      conta: String(l.conta || "").trim(),
    }));

  const somaPorPapel = (papel) => round2(
    linhas.filter((l) => l.tipoLinha === papel && l.tipo === "D").reduce((s, l) => s + l.valor, 0),
  );
  const { credito } = somasProvisao(dados?.provisaoLines);

  const tributos = (Array.isArray(dados?.tributos) ? dados.tributos : [])
    .filter((t) => String(t.codigoTributo || "").trim())
    .map((t) => {
      const principal = round2(numero(t.principal));
      const multa = round2(numero(t.multa));
      const juros = round2(numero(t.juros));
      return { codigoTributo: String(t.codigoTributo).trim(), principal, multa, juros, total: round2(principal + multa + juros) };
    })
    .filter((t) => t.total > 0);

  const pagas = dados?.situacao === "EM_ANDAMENTO" ? inteiro(dados?.parcelasJaPagas) : 0;

  return {
    // ⚠ AUSENTE: sem guia. Não é omissão — é a entrega.
    guideId: null,
    parcelasJaPagas: pagas > 0 ? pagas : undefined,
    header: {
      tipo: dados?.tipo,
      numeroParcelamento: String(dados?.numeroParcelamento || "").trim(),
      numeroParcela: pagas + 1,
      quantidadeParcelas: inteiro(dados?.totalParcelas) || null,
      valorPrincipal: somaPorPapel("PRINCIPAL") || null,
      valorMulta: somaPorPapel("MULTA") || null,
      valorJuros: somaPorPapel("JUROS") || null,
      valorTotal: credito || null,
      dataAdesao: dados?.dataAdesao || null,
      // ⚠ O VALOR DA PARCELA PASSOU A SUBIR — ele era VALIDADO no passo 2 (`validarPasso2` recusa
      // avançar sem ele, "maior que zero") e DESCARTADO na montagem do payload. O contador digitava
      // um campo obrigatório que nunca chegava ao servidor.
      //
      // A consequência não era cosmética: sem guia e sem composição por tributo,
      // `buildDTOsFromManual` derivava o valor da parcela da SOMA DOS TRIBUTOS — zero. Daí saíam
      // `valorParcelaReferencia = 0` e `principalPerParcela = 0` no cabeçalho, e `parcelaSync`
      // materializava as N prestações com `valorPrevisto = 0`: a SINTROPIA nº 1 de produção tem
      // exatamente essa forma, com `principalPago` preso em zero para sempre e a fila de baixa
      // recusando todas as prestações com `sem_valor_previsto`.
      //
      // ⚠ ELE É O VALOR CHEIO DA PRESTAÇÃO, não o principal — o principal do contrato continua
      // saindo do papel `PRINCIPAL` das linhas da provisão (`valorPrincipal`, acima).
      valorParcela: numero(dados?.valorParcela) || null,
      // ⚠ A COMPETÊNCIA DA 1ª PARCELA, não a da atual — ver o cabeçalho deste arquivo.
      anoMesParcela: String(dados?.competenciaPrimeiraParcela || "").replace("-", "") || null,
      descricao: String(dados?.descricao || "").trim() || null,
      formaPagamento: dados?.formaPagamento || undefined,
      diaPagamento: inteiro(dados?.diaVencimento) || undefined,
      saldoConsolidado: numero(dados?.saldoConsolidado) || undefined,
    },
    provisaoLines: linhas,
    pagamentoLines: pagamento,
    ...(tributos.length ? { tributos } : {}),
  };
}

/**
 * ⚠ FECHAR COM DADOS PREENCHIDOS NOMEIA O QUE SE PERDE. "Descartar alterações?" não diz nada a quem
 * digitou 60 parcelas e um saldo de seis dígitos; a lista abaixo diz.
 */
export function oQueSePerdeAoFechar(dados) {
  const perde = [];
  const inicial = estadoInicial();
  if (String(dados?.numeroParcelamento || "").trim()) perde.push(`nº do parcelamento ${String(dados.numeroParcelamento).trim()}`);
  if (dados?.tipo && dados.tipo !== inicial.tipo) perde.push(`modalidade ${rotuloModalidade(dados.tipo)}`);
  if (dados?.dataAdesao) perde.push("data de adesão");
  if (numero(dados?.saldoConsolidado) > 0) perde.push(`saldo consolidado de R$ ${formatarMoeda(numero(dados.saldoConsolidado))}`);
  if (numero(dados?.valorParcela) > 0) perde.push(`valor da parcela de R$ ${formatarMoeda(numero(dados.valorParcela))}`);
  if (inteiro(dados?.totalParcelas) > 0) perde.push(`${inteiro(dados.totalParcelas)} parcelas`);
  if (inteiro(dados?.parcelasJaPagas) > 0) perde.push(`${inteiro(dados.parcelasJaPagas)} prestações já pagas`);
  if (inteiro(dados?.diaVencimento) > 0) perde.push(`vencimento no dia ${inteiro(dados.diaVencimento)}`);
  // ⚠ SÓ AS CONTAS QUE O CONTADOR DIGITOU. As linhas nascem pré-preenchidas pela memória do
  // escritório; contá-las faria um wizard recém-aberto — em que ninguém escreveu nada — pedir
  // confirmação para fechar. Uma confirmação que aparece sempre é a que se aprende a dispensar sem
  // ler, e aí ela deixa de proteger o formulário longo que ela existe para proteger.
  const contas = inteiro(dados?.contasEditadas);
  if (contas > 0) perde.push(`${contas} conta${contas === 1 ? "" : "s"} de lançamento preenchida${contas === 1 ? "" : "s"} à mão`);
  return perde;
}

/** O rodapé do passo 2, recalculado a cada tecla. */
export function textoDoRodapePasso2(dados) {
  const restantes = parcelasRestantes(dados);
  const total = inteiro(dados?.totalParcelas);
  if (!total) return "O sistema vai gerenciar: informe o total de parcelas.";
  const pagas = dados?.situacao === "EM_ANDAMENTO" ? inteiro(dados?.parcelasJaPagas) : 0;
  const sufixo = pagas > 0
    ? ` (${total} contratadas − ${pagas} já pagas, que entram como histórico e não geram lançamento)`
    : "";
  return `O sistema vai gerenciar: ${restantes} parcela${restantes === 1 ? "" : "s"} restante${restantes === 1 ? "" : "s"}${sufixo}`;
}
