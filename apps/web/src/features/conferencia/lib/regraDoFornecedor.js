// A REGRA DO FORNECEDOR, DO LADO DA TELA (29/08/2026).
//
// > Dono: *"o contador deve poder colocar o código de débito e crédito nessa despesa, e todo mês
// > que essa nota aparecer ela já é lançada em despesa."*
//
// ⚠⚠ **A AUTORIDADE É O SERVIDOR** (`application/declarados/RegraService.js`). Isto aqui é ESPELHO,
// e existe por um motivo só: desabilitar o botão COM O MOTIVO em vez de oferecer um clique que vai
// voltar recusado. Quem decide se a regra pode nascer, e se ela pode lançar sozinha, continua sendo
// o servidor — um `curl` bate lá, não aqui.
//
// ⚠ Os códigos são os MESMOS de `RECUSA_DA_REGRA` no backend, de propósito: quando a recusa vier do
// servidor, a tela mostra a frase pelo mesmo caminho, e não há dois vocabulários para o mesmo erro.

const texto = (v) => (typeof v === "string" ? v.trim() : "");
const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/** ⚠ Espelho de `RECUSA_DA_REGRA` (api). Mudou lá, muda aqui. */
export const RECUSA_DA_REGRA = Object.freeze({
  SEM_ANCORA: "regra_sem_ancora",
  CONTA_FORA_DO_PLANO: "conta_fora_do_plano",
  CONTA_SINTETICA: "conta_sintetica",
  CREDITO_NAO_E_DISPONIBILIDADE: "credito_nao_e_disponibilidade",
  FAIXA_INVALIDA: "faixa_invalida",
  SEM_DIA_DO_LANCAMENTO: "regra_sem_dia_de_lancamento",
  AUTOMATICO_SEM_CNPJ: "automatico_sem_cnpj",
  INDISPONIVEL: "regras_indisponiveis",
  NAO_ENCONTRADA: "regra_nao_encontrada",
});

export const FRASE_DA_RECUSA = Object.freeze({
  [RECUSA_DA_REGRA.SEM_ANCORA]:
    "A regra precisa de um CNPJ de fornecedor ou de um padrão de descrição — sem âncora ela casaria com qualquer despesa.",
  [RECUSA_DA_REGRA.CONTA_FORA_DO_PLANO]:
    "Escolha a conta de débito (a despesa) no plano desta empresa.",
  [RECUSA_DA_REGRA.CONTA_SINTETICA]:
    "Esta conta é sintética (de agregação) e não recebe lançamento.",
  [RECUSA_DA_REGRA.CREDITO_NAO_E_DISPONIBILIDADE]:
    "O crédito precisa ser uma conta de disponibilidade (caixa, banco ou aplicação). O lançamento afirma de onde o dinheiro saiu.",
  [RECUSA_DA_REGRA.FAIXA_INVALIDA]:
    "A faixa de valor precisa ter mínimo e máximo maiores que zero, com o mínimo menor ou igual ao máximo.",
  [RECUSA_DA_REGRA.SEM_DIA_DO_LANCAMENTO]:
    "Para lançar sozinha, a regra precisa dizer em que dia do mês (1 a 31). A data não se arbitra.",
  [RECUSA_DA_REGRA.AUTOMATICO_SEM_CNPJ]:
    "Só uma regra ancorada no CNPJ do fornecedor pode lançar sozinha. A descrição se parece, não identifica.",
  [RECUSA_DA_REGRA.INDISPONIVEL]:
    "A tabela de regras ainda não existe neste banco.",
  [RECUSA_DA_REGRA.NAO_ENCONTRADA]:
    "Regra não encontrada nesta empresa.",
});

/**
 * ⚠⚠ O PREFIXO QUE DIZ O QUE É CAIXA/BANCO — cópia DECLARADA de
 * `api: application/accounting/lib/disponibilidades.js` (`ANCORAS_DISPONIBILIDADE.DISPONIVEL`).
 *
 * O backend não é importável do front. **Mudou lá, muda aqui** — senão a tela oferece um crédito
 * que o servidor nega, que é o pior dos dois mundos: o contador preenche tudo e o clique volta.
 *
 * ⚠ É PREFIXO do `codigoCompleto`, nunca o nome da conta. "BANCO" no nome não faz uma conta ser
 * disponibilidade, e uma conta de disponibilidade pode não ter "banco" no nome nenhum.
 */
export const PREFIXO_DISPONIBILIDADE = "111";

const ehSintetica = (c) => c?.analitica === false;

/**
 * As contas que o seletor do **DÉBITO** oferece: a despesa.
 *
 * ⚠ Mesmo critério de `contasOferecidas` — sai o que o servidor recusaria (sintética, sem
 * `codigoCompleto`). ⚠ E a despesa **nunca** precisa ser disponibilidade: só o crédito precisa.
 */
export function contasDeDebitoOferecidas(contas) {
  return (Array.isArray(contas) ? contas : []).filter(
    (c) => !ehSintetica(c) && texto(c?.codigoCompleto),
  );
}

/**
 * ⚠⚠ As contas que o seletor do **CRÉDITO** oferece — só disponibilidade.
 *
 * Resposta do dono: *"continua sendo disponibilidade (caixa/banco)"*. O seletor mostrar a carteira
 * inteira convidaria a escolher uma conta de despesa como contrapartida, e o lançamento afirmaria
 * que o dinheiro saiu de um lugar que não é caixa.
 */
export function contasDeCreditoOferecidas(contas) {
  return contasDeDebitoOferecidas(contas).filter(
    (c) => texto(c.codigoCompleto).startsWith(PREFIXO_DISPONIBILIDADE),
  );
}

/**
 * ⚠⚠ ESTE FORMULÁRIO PODE VIRAR REGRA? — e a resposta é sempre NOMEADA.
 *
 * Devolve `{ pode, motivo, frase }`, nunca um booleano nu: um botão desabilitado sem motivo faz a
 * pessoa tentar preencher tudo de novo, sem saber o que falta.
 *
 * ⚠ A ordem das conferências é a MESMA do servidor (âncora → faixa → contas → automático), para a
 * primeira coisa que a tela reclama ser a primeira que ele reclamaria.
 */
export function validarRegra(campos = {}, contas = []) {
  const nao = (motivo) => ({ pode: false, motivo, frase: FRASE_DA_RECUSA[motivo] });

  const cnpj = soDigitos(campos.cnpjFornecedor);
  const padrao = texto(campos.padraoDescricao);
  if (!cnpj && !padrao) return nao(RECUSA_DA_REGRA.SEM_ANCORA);

  const min = Number(campos.valorMin);
  const max = Number(campos.valorMax);
  // ⚠ Por TIPO: `Number(null)` é 0 e 0 é finito. Faixa que começa em zero casa com toda nota — e
  // ela é o portão do lançamento automático.
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || min > max) {
    return nao(RECUSA_DA_REGRA.FAIXA_INVALIDA);
  }

  const porCompleto = new Map(
    (Array.isArray(contas) ? contas : [])
      .filter((c) => texto(c?.codigoCompleto))
      .map((c) => [texto(c.codigoCompleto), c]),
  );

  const debito = porCompleto.get(texto(campos.contaDestino));
  if (!debito) return nao(RECUSA_DA_REGRA.CONTA_FORA_DO_PLANO);
  if (ehSintetica(debito)) return nao(RECUSA_DA_REGRA.CONTA_SINTETICA);

  // ⚠⚠ CRÉDITO VAZIO CONTINUA VALENDO: é "esta regra não escolheu crédito", e o caixa cravado de
  // hoje segue para ela. A ausência não é recusada; o que é recusado é a escolha ERRADA.
  const credito = texto(campos.contaCredito);
  if (credito) {
    const c = porCompleto.get(credito);
    if (!c) return nao(RECUSA_DA_REGRA.CONTA_FORA_DO_PLANO);
    if (ehSintetica(c)) return nao(RECUSA_DA_REGRA.CONTA_SINTETICA);
    if (!texto(c.codigoCompleto).startsWith(PREFIXO_DISPONIBILIDADE)) {
      return nao(RECUSA_DA_REGRA.CREDITO_NAO_E_DISPONIBILIDADE);
    }
  }

  // ⚠⚠ `=== true` EXATO. Uma string de formulário é verdadeira em JS, e ligaria a automação por um
  // campo mal tipado — a mesma disciplina do servidor.
  if (campos.lancaSozinha === true) {
    if (!cnpj) return nao(RECUSA_DA_REGRA.AUTOMATICO_SEM_CNPJ);
    const dia = Number(campos.diaDoLancamento);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) return nao(RECUSA_DA_REGRA.SEM_DIA_DO_LANCAMENTO);
  }

  return { pode: true, motivo: null, frase: null };
}

/**
 * ⚠⚠ COMO ESTA REGRA SE COMPORTA HOJE — a frase que a lista mostra.
 *
 * ⚠ Ela distingue TRÊS coisas que a tela precisa não confundir: a regra que lança sozinha, a que só
 * sugere, e a que **nem poderia** lançar (sem CNPJ). Um rótulo só faria a terceira parecer uma
 * escolha do contador, quando é um impedimento.
 */
export const COMPORTAMENTO = Object.freeze({
  LANCA_SOZINHA: "lanca_sozinha",
  SO_SUGERE: "so_sugere",
  NAO_PODE_LANCAR: "nao_pode_lancar",
  DESLIGADA: "desligada",
});

export const FRASE_DO_COMPORTAMENTO = Object.freeze({
  [COMPORTAMENTO.LANCA_SOZINHA]:
    "Lança sozinha, todo dia {dia}, sem ninguém clicar. A data é presumida — o extrato a corrige quando o débito chegar.",
  [COMPORTAMENTO.SO_SUGERE]:
    "Só sugere a conta. Cada nota continua esperando o seu clique.",
  [COMPORTAMENTO.NAO_PODE_LANCAR]:
    "Esta regra é ancorada na descrição, e por isso não pode lançar sozinha — a descrição se parece, não identifica.",
  [COMPORTAMENTO.DESLIGADA]:
    "Desligada. Ela não sugere e não lança.",
});

export function comportamentoDaRegra(regra) {
  if (regra?.ativa === false || regra?.suspensaEm) return COMPORTAMENTO.DESLIGADA;
  if (regra?.lancaSozinha === true) return COMPORTAMENTO.LANCA_SOZINHA;
  if (!soDigitos(regra?.cnpjFornecedor)) return COMPORTAMENTO.NAO_PODE_LANCAR;
  return COMPORTAMENTO.SO_SUGERE;
}

export function fraseDaRegra(regra) {
  const c = comportamentoDaRegra(regra);
  return FRASE_DO_COMPORTAMENTO[c].replace("{dia}", String(regra?.diaDoLancamento ?? "—"));
}
