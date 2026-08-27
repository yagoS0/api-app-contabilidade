/**
 * A CONTA DA CONFERÊNCIA — a ponte entre o que o contador DIGITA e o que o servidor EXIGE.
 *
 * ⚠⚠ SÃO DOIS VOCABULÁRIOS PARA A MESMA CONTA, e confundi-los é o defeito mais caro deste caminho:
 *
 *   · o **REDUZIDO** (`464`) é o que o contador lê, digita e reconhece. É **MUTÁVEL**.
 *   · o **`codigoCompleto`** (`411020008`) é a âncora desta casa — *"eles são imutáveis enquanto os
 *     reduzidos mutáveis"*. É ele que `LancamentoDeclarado.contaAplicada` guarda, por contrato do
 *     model, e é ele que `montarLancamento` procura no plano.
 *
 * A tradução acontece AQUI, no submit da tela, e não no servidor. Três razões estruturais:
 *
 * 1. `contaAplicada`/`contaSugerida`/`contaDestino` são `codigoCompleto` por contrato do model;
 * 2. ⚠⚠ `aprendizado.js` compara `contaAplicada` por **igualdade de string** e SUSPENDE a regra
 *    quando `contas.size > 1`. O mesmo fornecedor gravado ora `"411020008"` ora `"464"` seria lido
 *    como divergência e **suspenderia uma regra correta, em silêncio**;
 * 3. a tela já alcança o plano com os dois códigos (`getChartOfAccounts` devolve a linha inteira).
 *
 * ⚠ Isto NÃO viola a decisão do dono (*"só colocamos código reduzido, o código mãe é apenas para
 * análise do software"*): ele digita e lê **`464`**; o corpo do POST leva **`411020008`**.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ AUSÊNCIA NUNCA É RESPOSTA — cada recusa tem NOME, e nunca se devolve string vazia.
 *
 * Mandar `contaAplicada: ""` faria o servidor recusar com `sem_conta`, e a tela descobriria a regra
 * pelo erro — exatamente o que o pré-voo existe para impedir. Por isso toda tradução devolve
 * `{ valor, motivo }`: ou o valor, ou o motivo, nunca o silêncio.
 */

// ⚠⚠ O PREDICADO DE CONTA SINTÉTICA É IMPORTADO, NUNCA REESCRITO.
//
// `ehSintetica` já existe em `accounting/entries/lib/contaSintetica.js`, e o backend faz questão de
// importá-lo em vez de reescrever (`declarados/lib/formaDoLancamento.js` importa de
// `accounting/lib/gateContaSintetica.js`). Uma segunda cópia aqui divergiria na primeira correção,
// e a divergência apareceria como "a tela ofereceu e o servidor recusou".
import { ehSintetica } from "../../accounting/entries/lib/contaSintetica.js";

/** ⚠ Vocabulário FECHADO. Cada motivo aponta um conserto DIFERENTE. */
export const MOTIVO_DA_CONTA = Object.freeze({
  /** O reduzido digitado não existe no plano desta empresa. Conserto: cadastrar, ou digitar outro. */
  NAO_EXISTE: "nao_existe",
  /**
   * ⚠ A conta existe e **não tem `codigoCompleto`** — o terceiro estado. Medido em produção: 13
   * contas assim. Ela não é traduzível, e o conserto é do PLANO, não da linha.
   */
  SEM_CODIGO_COMPLETO: "sem_codigo_completo",
  /** ⚠⚠ Dois reduzidos iguais no mesmo plano. O sistema NÃO escolhe — escolher poria a despesa
   * num código que o contador não escolheu. */
  REDUZIDO_AMBIGUO: "reduzido_ambiguo",
  /** O `codigoCompleto` que veio da sugestão não está no plano desta empresa. */
  FORA_DO_PLANO: "fora_do_plano",
  /** ⚠⚠ Dois `codigoCompleto` iguais. Mesma recusa que `montarLancamento` aplica no servidor. */
  COMPLETO_AMBIGUO: "completo_ambiguo",
  /** ⚠ A conta é SINTÉTICA (de agregação). O servidor recusa; a tela antecipa. */
  SINTETICA: "sintetica",
});

export const FRASE_DO_MOTIVO_DA_CONTA = Object.freeze({
  [MOTIVO_DA_CONTA.NAO_EXISTE]:
    "Esta conta não existe no plano desta empresa. Confira o código, ou cadastre a conta antes de lançar.",
  [MOTIVO_DA_CONTA.SEM_CODIGO_COMPLETO]:
    "Esta conta ainda não tem código completo no plano, e por isso não pode receber lançamento por aqui. "
    + "Quem resolve é a reimportação do plano de contas.",
  [MOTIVO_DA_CONTA.REDUZIDO_AMBIGUO]:
    "Duas contas do plano desta empresa têm este mesmo código reduzido. O sistema não escolhe entre elas.",
  [MOTIVO_DA_CONTA.FORA_DO_PLANO]:
    "A conta conhecida para esta despesa não está no plano desta empresa.",
  [MOTIVO_DA_CONTA.COMPLETO_AMBIGUO]:
    "Duas contas do plano desta empresa têm o mesmo código completo. O sistema não escolhe entre elas.",
  [MOTIVO_DA_CONTA.SINTETICA]:
    "Esta conta é sintética (de agregação): ela existe para somar as filhas e não recebe lançamento. "
    + "Escolha uma conta analítica abaixo dela.",
});

const texto = (v) => String(v ?? "").trim();

/**
 * O que o contador DIGITOU (reduzido) → o que o servidor EXIGE (`codigoCompleto`).
 *
 * ⚠ A ordem das recusas é resposta, não arrumação: primeiro *"existe?"*, depois *"é uma só?"*,
 * depois *"tem âncora?"*, e só então *"ela recebe lançamento?"*. Sem saber QUAL é a conta, não há
 * o que afirmar sobre ela.
 *
 * @param {string} reduzido o código que o contador digitou
 * @param {Array<{codigo?: string, codigoCompleto?: string|null, nome?: string, analitica?: boolean|null}>} contas
 * @returns {{valor: string|null, motivo: string|null, conta: object|null}}
 */
export function completoDoReduzido(reduzido, contas) {
  const alvo = texto(reduzido);
  if (!alvo) return { valor: null, motivo: null, conta: null };

  const achadas = (Array.isArray(contas) ? contas : []).filter((c) => texto(c?.codigo) === alvo);
  if (!achadas.length) return { valor: null, motivo: MOTIVO_DA_CONTA.NAO_EXISTE, conta: null };
  // ⚠⚠ `getChartOfAccounts` já deduplica por código (empresa vence global), então isto não deveria
  // acontecer hoje. Fica porque a dedup é do SERVIDOR e esta função não pode depender dela: o dia
  // em que a rota mudar, quem escolheria por conta própria seria a tela.
  if (achadas.length > 1) return { valor: null, motivo: MOTIVO_DA_CONTA.REDUZIDO_AMBIGUO, conta: null };

  const conta = achadas[0];
  const completo = texto(conta.codigoCompleto);
  if (!completo) return { valor: null, motivo: MOTIVO_DA_CONTA.SEM_CODIGO_COMPLETO, conta };

  // ⚠⚠ O COMPLETO TAMBÉM PODE SER AMBÍGUO, E ESTE RAMO FALTAVA — achado por agente adversarial em
  // 26/08/2026, e era assimetria minha: `COMPLETO_AMBIGUO` existia e só estava ligado no sentido da
  // SUGESTÃO (`reduzidoDoCompleto`), nunca no do SUBMIT.
  //
  // O reduzido identifica UMA conta; o `codigoCompleto` dela pode ser compartilhado por outra. É
  // exatamente isso que `indicePorCodigoCompleto` marca como `ambiguo`, e `montarLancamento` recusa
  // com `CONTA_AMBIGUA` — ou seja, o campo ficava verde, o botão habilitado, e o POST voltava
  // recusado. A tela oferecendo o que o clique nega, que é o defeito que este arquivo existe para
  // impedir.
  //
  // ⚠ Alcançável sem esforço: `codigoCompleto` NÃO tem índice único nenhum, e `POST`/`PATCH
  // /chart-of-accounts` aceitam qualquer valor. O caso mais provável é ENTRE ESCOPOS — uma global e
  // uma conta própria da empresa com o mesmo completo e reduzidos diferentes: as duas dedups casam
  // por `codigo`, nunca por `codigoCompleto`, então nada as compara.
  if (compartilhamCompleto(completo, contas)) {
    return { valor: null, motivo: MOTIVO_DA_CONTA.COMPLETO_AMBIGUO, conta };
  }

  if (ehSintetica(conta)) return { valor: null, motivo: MOTIVO_DA_CONTA.SINTETICA, conta };

  return { valor: completo, motivo: null, conta };
}

/** ⚠ Duas ou mais contas do plano com o MESMO `codigoCompleto` — a ambiguidade que o servidor recusa. */
function compartilhamCompleto(completo, contas) {
  const alvo = texto(completo);
  if (!alvo) return false;
  let vistas = 0;
  for (const c of Array.isArray(contas) ? contas : []) {
    if (texto(c?.codigoCompleto) === alvo) vistas += 1;
    if (vistas > 1) return true;
  }
  return false;
}

/**
 * O que o servidor GUARDA (`codigoCompleto`) → o que a tela MOSTRA (reduzido).
 *
 * ⚠ É o sentido da SUGESTÃO: ela chega em `codigoCompleto` e o contador não reconhece esse número.
 * Devolver o completo cru na tela seria mostrar a âncora interna a quem nunca a viu.
 */
export function reduzidoDoCompleto(completo, contas) {
  const alvo = texto(completo);
  if (!alvo) return { valor: null, motivo: null, conta: null };

  const achadas = (Array.isArray(contas) ? contas : []).filter((c) => texto(c?.codigoCompleto) === alvo);
  if (!achadas.length) return { valor: null, motivo: MOTIVO_DA_CONTA.FORA_DO_PLANO, conta: null };
  if (achadas.length > 1) return { valor: null, motivo: MOTIVO_DA_CONTA.COMPLETO_AMBIGUO, conta: null };

  const conta = achadas[0];
  const reduzido = texto(conta.codigo);
  // ⚠ Conta sem reduzido não é traduzível para a tela. Não existe hoje (o reduzido é NOT NULL), e
  // devolver o completo cru como se fosse reduzido seria a tela mentindo sobre o que ela mostra.
  if (!reduzido) return { valor: null, motivo: MOTIVO_DA_CONTA.NAO_EXISTE, conta };

  return { valor: reduzido, motivo: null, conta };
}

/**
 * As contas que o seletor OFERECE.
 *
 * ⚠⚠ Sai quem o servidor recusaria: SINTÉTICA (`montarLancamento` → `CONTA_SINTETICA`) e conta
 * **sem `codigoCompleto`** (ela não entra no `indicePorCodigoCompleto`, então viraria
 * `CONTA_FORA_DO_PLANO`). Oferecer qualquer uma das duas é a tela propondo o que o clique nega.
 *
 * ⚠ `analitica: null` CONTINUA SENDO OFERECIDA se tiver `codigoCompleto` — ela não é sintética, é
 * desconhecida, e recusá-la esvaziaria o dropdown de todo plano ainda não reimportado.
 */
export function contasOferecidas(contas) {
  const lista = Array.isArray(contas) ? contas : [];
  return lista.filter(
    (c) =>
      !ehSintetica(c)
      && texto(c?.codigoCompleto)
      // ⚠ Conta sem REDUZIDO não é oferecível: o `<option value="">` viraria uma linha em branco no
      // dropdown, e `indicePorCodigoCompleto` a pula (ela não tem como ser traduzida de volta).
      && texto(c?.codigo)
      // ⚠⚠ E conta cujo `codigoCompleto` é COMPARTILHADO sai da oferta — o servidor a recusaria com
      // `CONTA_AMBIGUA`. Oferecer as duas e recusar as duas no clique é o pior dos dois mundos.
      && !compartilhamCompleto(c?.codigoCompleto, lista),
  );
}

/**
 * ⚠⚠ O CAIXA É CRAVADO, E A TELA NUNCA O CONFERIA — achado por agente adversarial em 26/08/2026.
 *
 * `montarLancamento` credita SEMPRE `111010001` e recusa quando ele não está no plano, está
 * duplicado, ou é sintético (`CAIXA_FORA_DO_PLANO` · `CAIXA_AMBIGUO` · `CAIXA_SINTETICO`). São três
 * recusas que derrubam **TODA** confirmação daquela empresa — e o seletor ficava cheio e alegre,
 * porque a conta que o contador escolhe está certa; quem está torto é a contrapartida.
 *
 * ⚠ O gatilho é silencioso: basta a empresa ter conta PRÓPRIA `codigo: "5"` com `codigoCompleto`
 * nulo (plano não reimportado). Ela vence a global na dedup, o caixa some do índice, e toda linha
 * volta `caixa_fora_do_plano`.
 *
 * ⚠ `111010001` é CÓPIA DECLARADA de `CAIXA_CODIGO_COMPLETO`
 * (`api: application/declarados/lib/formaDoLancamento.js`) — o backend não é importável do front.
 * Mudou lá, muda aqui: senão a tela libera o que o servidor nega.
 */
export const CAIXA_CODIGO_COMPLETO = "111010001";

export function problemaDoCaixa(contas) {
  const lista = Array.isArray(contas) ? contas : [];
  const achadas = lista.filter((c) => texto(c?.codigoCompleto) === CAIXA_CODIGO_COMPLETO);
  if (!achadas.length) {
    return "Esta empresa não tem a conta de caixa (1.1.1.01.0001) no plano, e é ela que recebe o "
      + "crédito de toda despesa. Nenhum lançamento pode ser feito por aqui até isso ser corrigido.";
  }
  if (achadas.length > 1) {
    return "Duas contas do plano desta empresa apontam para a conta de caixa (1.1.1.01.0001). O "
      + "sistema não escolhe entre elas.";
  }
  if (ehSintetica(achadas[0])) {
    return "A conta de caixa (1.1.1.01.0001) desta empresa está marcada como sintética (de "
      + "agregação) e não recebe lançamento. Corrija o plano de contas.";
  }
  return null;
}

/** ⚠ Estados do carregamento do plano. Vocabulário FECHADO. */
export const ESTADO_DO_PLANO = Object.freeze({
  CARREGANDO: "carregando",
  OK: "ok",
  FALHOU: "falhou",
});

/**
 * ⚠⚠ POR QUE O SELETOR NÃO SERVE — e "não sei" NÃO pode se parecer com "não tem".
 *
 * A versão anterior recebia só a lista, e lista vazia virava **"Esta empresa ainda não tem plano de
 * contas"** — uma AFIRMAÇÃO sobre o cadastro, dita quando a verdade era *"a consulta falhou"* ou
 * *"ainda estou perguntando"*. É a distinção ausência × afirmação que o resto do projeto respeita
 * (o tri-estado de `analitica`, `folhaAusenteNaoEZero`, o `dinheiro()` que não inventa zero),
 * invertida. Achado por agente adversarial em 26/08/2026.
 *
 * ⚠ Medido em 26/08/2026 num banco local: **1186 de 1186 contas sem `codigoCompleto`** — o ramo do
 * plano sem âncora não é hipotético.
 *
 * @returns {string|null} a frase, ou `null` quando o seletor serve
 */
export function motivoDoSeletorVazio(contas, estado = ESTADO_DO_PLANO.OK) {
  if (estado === ESTADO_DO_PLANO.CARREGANDO) return "Carregando o plano de contas…";
  if (estado === ESTADO_DO_PLANO.FALHOU) {
    // ⚠ Diz o que houve e o que fazer — e NÃO afirma nada sobre o cadastro da empresa.
    return "Não foi possível carregar o plano de contas desta empresa. Recarregue a página; se "
      + "persistir, o problema é da conexão com o servidor, não do cadastro.";
  }

  const lista = Array.isArray(contas) ? contas : [];
  if (!lista.length) return "Esta empresa ainda não tem plano de contas.";
  if (contasOferecidas(lista).length) return null;
  if (lista.every((c) => !texto(c?.codigoCompleto))) {
    return "Nenhuma conta do plano desta empresa tem código completo. Reimporte o plano de contas — "
      + "sem ele nenhuma conta pode receber lançamento por aqui.";
  }
  return "Nenhuma conta do plano desta empresa pode receber lançamento: as que existem são "
    + "sintéticas (de agregação) ou têm código completo repetido.";
}
