// R4 — A GUIA COMO ANEXO DE UM PARCELAMENTO: as regras, fora da tela.
//
// ⚠ A INVERSÃO. Antes, subir uma guia PODIA CRIAR um parcelamento ("esta guia é a abertura de um
// novo parcelamento?"). Agora o contrato já existe — ele nasce no wizard, sem documento nenhum — e
// a guia é EVIDÊNCIA MENSAL de UMA prestação dele. Por isso o parcelamento vem primeiro no modal, e
// tudo o mais (competência, vencimento, valor) é derivado DO CONTRATO.

/**
 * ⚠ A MODALIDADE ERA FORÇADA A "SIMPLES" NOS DOIS CAMINHOS DO MODAL ANTIGO
 * (`renderCompanyGuidesTable`: `handleStartUpload("SIMPLES", true)` tanto no "anexar a existente"
 * quanto no "subir guia manualmente"). Uma parcela de parcelamento de **INSS** era gravada como
 * `tipo: "SIMPLES"` — o mesmo tipo do DAS do mês — porque o tipo nem chegava a ser perguntado.
 *
 * A correção não é uma tabela de-para fixa: é uma SUGESTÃO, com o select à vista para o contador
 * discordar. O que se sabe com segurança é só isto:
 *   · parcelamento de INSS/previdenciário é pago em guia de INSS;
 *   · parcelamento do Simples/MEI (PARCSN·PERT_SN·RELP_SN·PARCMEI·PERT_MEI·RELP_MEI) é pago em DAS,
 *     que é o `tipo: "SIMPLES"` deste sistema — é assim que `CaptureSerproParcelaService` grava a
 *     parcela capturada do SERPRO;
 *   · "OUTRO" não diz qual documento é, então cai em "OUTRA" e o contador escolhe.
 */
export function tipoGuiaSugerido(modalidade) {
  const m = String(modalidade || "").trim().toUpperCase();
  if (!m) return "OUTRA";
  if (m === "INSS") return "INSS";
  if (/^(PARCSN|PERT_SN|RELP_SN|PARCMEI|PERT_MEI|RELP_MEI)/.test(m)) return "SIMPLES";
  return "OUTRA";
}

/**
 * ⚠ A PARCELA NÃO TRAZ `competencia` — E ISSO NÃO É ESQUECIMENTO DO BACKEND.
 * `SELECT_PARCELA_PARA_QUADRO` (`recalculoParcelamento.js`) seleciona `id`, `numeroParcela`,
 * `vencimento`, `origemBaixa` e a guia. É essa lista que alimenta `parcelasContratadas`, então ler
 * `parcela.competencia` devolve `undefined` em produção — e o campo Competência do modal nasceria
 * vazio, obrigando a redigitar exatamente o dado que o contrato já conhece.
 *
 * A derivação é exata para o cronograma contratado: `parcelaSync.calendarioDaParcela` calcula o
 * vencimento COMO `buildDateOfMonth(competencia, diaPagamento)` — o vencimento está, por
 * construção, DENTRO do mês da competência.
 *
 * ⚠ Usa o vencimento DA PARCELA, nunca o da guia: o da guia é o real (pode ter sido recalculado
 * pelo SERPRO e cair no mês seguinte), e a competência é do contrato.
 */
export function competenciaDaParcela(parcela) {
  if (parcela?.competencia) return normalizarCompetencia(parcela.competencia);
  const v = parcela?.vencimento;
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function quitada(parcela) {
  if (parcela?.origemBaixa) return true;
  const g = parcela?.guia;
  if (!g) return false;
  return Boolean(g.baixada) || String(g.paymentStatus || "").toUpperCase() === "PAID";
}

/**
 * A prestação a que a guia SERÁ vinculada, por padrão: a de menor número entre as que ainda não
 * estão quitadas e ainda não têm guia. É o "Será vinculada à parcela {n} de {total}" do modal — e é
 * uma SUGESTÃO, com "alterar" ao lado, porque reemissão e pagamento fora de ordem existem.
 */
export function parcelaSugerida(parcelamento) {
  const linhas = Array.isArray(parcelamento?.parcelasContratadas) ? parcelamento.parcelasContratadas : [];
  const candidatas = linhas
    .filter((p) => !quitada(p) && !p.guia)
    .sort((a, b) => (Number(a?.numeroParcela) || Infinity) - (Number(b?.numeroParcela) || Infinity));
  const p = candidatas[0] || null;
  if (!p) return null;
  return {
    numeroParcela: p.numeroParcela ?? null,
    competencia: competenciaDaParcela(p) || null,
    vencimento: p.vencimento || null,
  };
}

/** As opções do seletor "alterar" — todas as prestações contratadas, dizendo o estado de cada uma. */
export function opcoesDeParcela(parcelamento) {
  const linhas = Array.isArray(parcelamento?.parcelasContratadas) ? parcelamento.parcelasContratadas : [];
  return linhas
    .filter((p) => p.numeroParcela != null)
    .sort((a, b) => Number(a.numeroParcela) - Number(b.numeroParcela))
    .map((p) => ({
      numeroParcela: Number(p.numeroParcela),
      competencia: competenciaDaParcela(p) || null,
      vencimento: p.vencimento || null,
      jaTemGuia: Boolean(p.guia),
      quitada: quitada(p),
      // ⚠ `origemBaixa === "HISTORICO"` = quitada ANTES de o contrato entrar no sistema. Anexar guia
      // a ela é possível (reemissão de comprovante antigo) mas merece o aviso.
      historica: String(p.origemBaixa || "").toUpperCase() === "HISTORICO",
    }));
}

/** "YYYY-MM" a partir de "YYYY-MM" ou "YYYYMM". */
export function normalizarCompetencia(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  return "";
}

/** "2026-08-20" a partir de Date/ISO. */
export function dataParaInput(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * ⚠ AVISO DE DUPLICIDADE — E ELE NÃO BLOQUEIA. Reemissão é legítima (guia vencida, recálculo com
 * juros novos), então a resposta certa é AVISAR e exigir confirmação explícita, não recusar.
 *
 * Duas leituras, porque são dois erros diferentes:
 *   · a prestação escolhida JÁ TEM guia → é reemissão ou é a guia errada;
 *   · já existe guia deste parcelamento na MESMA competência → duplicata provável.
 *
 * @param {Array}  guias  as guias da empresa já carregadas na tela
 */
export function avisosDeDuplicidade({ guias, parcelamentoId, numeroParcela, competencia }) {
  const lista = Array.isArray(guias) ? guias : [];
  const doContrato = lista.filter((g) => g && g.parcelamentoId && String(g.parcelamentoId) === String(parcelamentoId));
  const avisos = [];

  const mesmaParcela = doContrato.filter((g) => numeroParcela != null && Number(g.numeroParcela) === Number(numeroParcela));
  if (mesmaParcela.length) {
    avisos.push(
      `Já existe ${mesmaParcela.length === 1 ? "uma guia" : `${mesmaParcela.length} guias`} vinculada à parcela `
      + `${numeroParcela} deste parcelamento. Se for reemissão, siga; se não, escolha outra parcela.`,
    );
  }

  const comp = normalizarCompetencia(competencia);
  const mesmaComp = doContrato.filter((g) => comp && normalizarCompetencia(g.competencia) === comp
    && !(numeroParcela != null && Number(g.numeroParcela) === Number(numeroParcela)));
  if (mesmaComp.length) {
    avisos.push(`Já existe guia deste parcelamento na competência ${comp} (parcela ${mesmaComp.map((g) => g.numeroParcela ?? "?").join(", ")}).`);
  }

  return avisos;
}

/** Os parcelamentos que podem receber guia: os ATIVOS. */
export function parcelamentosSelecionaveis(lista) {
  return (Array.isArray(lista) ? lista : []).filter((p) => String(p?.status || "").toUpperCase() === "ATIVO");
}

/** Rótulo de uma opção do select de parcelamento. */
export function rotuloDoParcelamento(p) {
  const cabeca = `${p?.tipo || "Parcelamento"}${p?.numeroParcelamento ? ` Nº ${p.numeroParcelamento}` : ""}`;
  const progresso = p?.parcelasTotal ? ` · ${p.parcelasPagas ?? 0}/${p.parcelasTotal} pagas` : "";
  return `${cabeca}${progresso}`;
}
