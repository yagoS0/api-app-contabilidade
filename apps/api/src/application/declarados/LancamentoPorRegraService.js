/**
 * ⚠⚠ O LANÇAMENTO CONTÁBIL QUE NASCE SEM NINGUÉM CLICAR — o "nível 1" (29/08/2026).
 *
 * > Dono: *"o contador deve poder colocar o código de débito e crédito nessa despesa, e todo mês
 * > que essa nota aparecer ela já é lançada em despesa."*
 *
 * ⚠⚠ **O QUE `motorDeSugestao.js` ESCREVEU SOBRE ISTO, ANTES DE EXISTIR:** *"um lançamento contábil
 * nascido sozinho, numa conta errada, erra EM SÉRIE e em silêncio — e o dono é contador. (…) O que
 * falta é a DECISÃO DO DONO de ligar, e o extrato mensal 'lançados por regra' para ele poder
 * desfazer em lote."* A decisão veio; o extrato está em `extratoDeLancadosPorRegra` abaixo, e ele
 * foi construído JUNTO porque o próprio módulo o nomeia como pré-requisito.
 *
 * ## ⚠⚠ AS TRÊS TRAVAS, E NENHUMA É DISPENSÁVEL
 *
 *   1. **a FLAG do ambiente** (`INTEGRACAO_LANCAMENTO_POR_REGRA`) — quem recusa é o SERVIDOR, não a
 *      tela: um `curl` passaria por cima de um botão escondido;
 *   2. **`regra.lancaSozinha`** daquele fornecedor — fornecedor a fornecedor, nunca a carteira
 *      inteira. O primeiro mês roda com um só, e o dono confere no extrato;
 *   3. **a FAIXA `valorMin`/`valorMax`** que o contador digitou — nota fora dela **cai na fila**,
 *      com a nota do motivo. Ela nunca lança e nunca some.
 *
 * ## ⚠⚠ A DATA É PRESUMIDA, E ISSO ESTÁ ESCRITO NO DADO
 *
 * `origemPagamento: PRESUMIDO_POR_REGRA` — declaração, nunca prova (`ehProvaDePagamento` devolve
 * `false`). **Eu recomendei contra a data fixa e o dono decidiu**; o que torna a decisão reversível:
 * a origem própria (que não se disfarça de afirmação do contador), o extrato com desfazer em lote,
 * e o débito do OFX que CORRIGE a data quando chegar — sem criar um segundo lançamento.
 *
 * ⚠ **NADA AQUI REESCREVE A MÁQUINA DE ESTADOS.** Quem contabiliza continua sendo
 * `DeclaradoService.aplicarTransicao`, com as guardas dela (mês fechado, forma do lançamento, conta
 * sintética). Este módulo decide QUEM passa e chama aquela — uma segunda contabilização aqui
 * divergiria da primeira na correção seguinte.
 */

import { prisma } from "../../infrastructure/db/prisma.js";
import { INTEGRACAO_LANCAMENTO_POR_REGRA } from "../../config.js";
import { aplicarTransicao } from "./DeclaradoService.js";
import { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO } from "./lib/estadosDeclarado.js";

/** ⚠ Por que uma nota NÃO foi lançada sozinha. Vocabulário FECHADO — vai para a fila e para o log. */
export const FORA_DO_AUTOMATICO = Object.freeze({
  DESLIGADO: "automatico_desligado",
  REGRA_NAO_LANCA: "regra_nao_lanca_sozinha",
  SEM_REGRA: "sem_regra_para_este_fornecedor",
  FORA_DA_FAIXA: "valor_fora_da_faixa_da_regra",
  SEM_DIA: "regra_sem_dia_de_lancamento",
  ESTADO_NAO_PERMITE: "estado_nao_permite",
});

export const FRASE_DO_FORA = Object.freeze({
  [FORA_DO_AUTOMATICO.DESLIGADO]:
    "O lançamento automático está desligado neste ambiente.",
  [FORA_DO_AUTOMATICO.REGRA_NAO_LANCA]:
    "Existe regra para este fornecedor, mas ela não está marcada para lançar sozinha.",
  [FORA_DO_AUTOMATICO.SEM_REGRA]:
    "Não há regra ativa para este fornecedor.",
  [FORA_DO_AUTOMATICO.FORA_DA_FAIXA]:
    "O valor desta nota ficou fora da faixa que a regra deste fornecedor aceita — ela continua na fila, esperando você.",
  [FORA_DO_AUTOMATICO.SEM_DIA]:
    "A regra está marcada para lançar sozinha, mas não diz em que dia do mês. A data não se arbitra.",
  [FORA_DO_AUTOMATICO.ESTADO_NAO_PERMITE]:
    "Esta linha não está num estado em que o lançamento possa acontecer.",
});

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
};

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/**
 * ⚠⚠ A DATA PRESUMIDA — `AAAA-MM-DD` na competência da nota, no dia que o contador configurou.
 *
 * ⚠ **Dia maior que o mês tem** (31 em fevereiro) **vira o ÚLTIMO dia do mês**, nunca o primeiro do
 * mês seguinte: a competência do lançamento tem de continuar sendo a da nota, senão a despesa
 * migraria de mês sozinha.
 * ⚠ Aritmética de STRING, nunca `new Date` com fuso: às 22h de Brasília o ISO devolveria outro dia.
 */
export function dataPresumida(competencia, dia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || "").trim());
  const d = Number(dia);
  if (!m || !Number.isInteger(d) || d < 1 || d > 31) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  // ⚠ `Date.UTC(ano, mes, 0)` devolve o último dia do mês `mes` — é aritmética de calendário, não
  // de fuso: nada aqui depende do relógio da máquina.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const escolhido = Math.min(d, ultimo);
  return `${m[1]}-${m[2]}-${String(escolhido).padStart(2, "0")}`;
}

/**
 * ⚠⚠ ESTA NOTA PODE SER LANÇADA SOZINHA? — e a resposta é sempre NOMEADA.
 *
 * ⚠ Regra PURA: sem banco, sem relógio. Ela devolve `{ pode, motivo, frase, regra }` — nunca um
 * booleano nu. O motivo é o que a fila mostra quando a nota FICA, e sem ele *"continua pendente"*
 * seria indistinguível de *"o sistema não olhou"*.
 */
export function podeLancarSozinho({ declarado, regras, ligado = INTEGRACAO_LANCAMENTO_POR_REGRA } = {}) {
  const nao = (motivo, regra = null) => ({ pode: false, motivo, frase: FRASE_DO_FORA[motivo], regra });

  if (!ligado) return nao(FORA_DO_AUTOMATICO.DESLIGADO);

  // ⚠ Só o que espera pagamento ou conferência. `CONTABILIZADO` já está no razão; `RECUSADO` foi uma
  // decisão do contador, e ressuscitá-lo por regra desfaria essa decisão.
  const estado = String(declarado?.estado || "");
  if (estado !== ESTADO.AGUARDANDO_PAGAMENTO && estado !== ESTADO.A_CONFERIR) {
    return nao(FORA_DO_AUTOMATICO.ESTADO_NAO_PERMITE);
  }

  const cnpj = soDigitos(declarado?.cnpjFornecedor);
  // ⚠⚠ A ÂNCORA AQUI É SÓ O CNPJ. A de descrição *se parece*; não identifica — e o que está em jogo
  // é um lançamento sem clique. O motor de SUGESTÃO usa as duas porque lá o contador confere.
  if (!cnpj) return nao(FORA_DO_AUTOMATICO.SEM_REGRA);

  const daEmpresa = (Array.isArray(regras) ? regras : []).filter((r) =>
    r && r.ativa !== false && !r.suspensaEm && soDigitos(r.cnpjFornecedor) === cnpj);
  if (!daEmpresa.length) return nao(FORA_DO_AUTOMATICO.SEM_REGRA);

  const lancadoras = daEmpresa.filter((r) => r.lancaSozinha === true);
  if (!lancadoras.length) return nao(FORA_DO_AUTOMATICO.REGRA_NAO_LANCA, daEmpresa[0]);

  const valor = numero(declarado?.valorAjustado) ?? numero(declarado?.valor);
  // ⚠ Sem valor não há faixa a conferir — e "não sei quanto é" nunca pode virar "pode lançar".
  if (valor == null) return nao(FORA_DO_AUTOMATICO.FORA_DA_FAIXA, lancadoras[0]);

  const naFaixa = lancadoras.find((r) => {
    const min = numero(r.valorMin);
    const max = numero(r.valorMax);
    return min != null && max != null && valor >= min && valor <= max;
  });
  // ⚠⚠ FORA DA FAIXA: a nota CAI NA FILA, com o motivo. Ela nunca lança e nunca some — e o motivo
  // diz que existe regra, para o contador saber que o sistema olhou.
  if (!naFaixa) return nao(FORA_DO_AUTOMATICO.FORA_DA_FAIXA, lancadoras[0]);

  // ⚠⚠ SEM DIA a regra não lança: a data não se arbitra. Um dia escolhido pelo sistema afirmaria
  // uma saída de caixa numa data que ninguém decidiu.
  const dia = Number(naFaixa.diaDoLancamento);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return nao(FORA_DO_AUTOMATICO.SEM_DIA, naFaixa);
  }

  return { pode: true, motivo: null, frase: null, regra: naFaixa };
}

/**
 * ⚠⚠ LANÇA — e só isto escreve.
 *
 * ⚠ Ele NÃO reescreve a contabilização: chama `aplicarTransicao(CONFIRMAR)`, que já tem as guardas
 * de mês fechado, forma do lançamento e conta sintética. Uma segunda contabilização aqui divergiria
 * da primeira na correção seguinte — e a divergência sairia como lançamento errado no razão.
 *
 * ⚠⚠ **A DATA VAI PRESUMIDA, e a ORIGEM diz isso.** `PRESUMIDO_POR_REGRA` não é prova; o extrato do
 * banco a corrige quando chegar.
 */
export async function lancarPorRegra({
  portalClientId, declarado, regras, agora, client = prisma, ligado = INTEGRACAO_LANCAMENTO_POR_REGRA,
}) {
  const veredito = podeLancarSozinho({ declarado, regras, ligado });
  if (!veredito.pode) return { lancou: false, ...veredito };

  const dataPagamento = dataPresumida(declarado.competencia, veredito.regra.diaDoLancamento);
  if (!dataPagamento) {
    return { lancou: false, pode: false, motivo: FORA_DO_AUTOMATICO.SEM_DIA, frase: FRASE_DO_FORA[FORA_DO_AUTOMATICO.SEM_DIA], regra: veredito.regra };
  }

  const atualizado = await aplicarTransicao({
    portalClientId,
    declaradoId: declarado.id,
    transicao: TRANSICAO.CONFIRMAR,
    dados: {
      contaAplicada: veredito.regra.contaDestino,
      // ⚠ O crédito da regra, quando ela escolheu um. `null` mantém o caixa de hoje — a coluna
      // guarda "não escolheu", e o caminho antigo continua para ela.
      contaCredito: veredito.regra.contaCredito || undefined,
      dataPagamento,
      origemPagamento: ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA,
      regraId: veredito.regra.id,
    },
    // ⚠⚠ `usuarioId` NOMEIA A AUTOMAÇÃO, e não pode ser o id de uma pessoa: quem lançou foi a regra,
    // e atribuí-lo ao contador diria que ele praticou um ato que não praticou naquele mês.
    usuarioId: "regra_automatica",
    agora,
    client,
  });

  return { lancou: true, declarado: atualizado, regra: veredito.regra, dataPagamento };
}

/**
 * ⚠⚠ O EXTRATO DE "LANÇADOS POR REGRA" — o pré-requisito que o próprio `motorDeSugestao.js` nomeou.
 *
 * Sem ele, ligar a automação é ligar algo que ninguém consegue auditar: o contador veria os
 * lançamentos misturados no razão, sem saber quais nasceram sozinhos.
 *
 * ⚠ A pergunta que ele responde é *"o que entrou sem eu clicar neste mês?"* — por isso o recorte é
 * a COMPETÊNCIA, e o critério é a ORIGEM do pagamento (`PRESUMIDO_POR_REGRA`), nunca o `regraId`:
 * um lançamento que o contador confirmou À MÃO sobre uma nota com regra também tem `regraId`, e ele
 * não nasceu sozinho.
 */
export async function extratoDeLancadosPorRegra({ portalClientId, competencia, client = prisma }) {
  const linhas = await client.lancamentoDeclarado.findMany({
    where: {
      portalClientId: String(portalClientId),
      competencia: String(competencia),
      estado: ESTADO.CONTABILIZADO,
      origemPagamento: ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA,
    },
    select: {
      id: true, descricaoOriginal: true, cnpjFornecedor: true,
      valor: true, valorAjustado: true, competencia: true,
      dataPagamento: true, contaAplicada: true, regraId: true,
      accountingEntryId: true, decididoEm: true,
    },
    orderBy: { dataPagamento: "asc" },
  });
  return {
    competencia: String(competencia),
    total: linhas.length,
    // ⚠ A soma viaja porque é o número que o contador confere contra o razão. Ela é do que ESTE
    // extrato mostra — nunca "o total do mês", que seria outra coisa.
    valor: linhas.reduce((s, l) => s + (numero(l.valorAjustado) ?? numero(l.valor) ?? 0), 0),
    linhas,
  };
}

/**
 * ⚠⚠ DESFAZER EM LOTE — e ele desfaz UM A UM, por dentro da máquina de estados.
 *
 * ⚠ Nada de `deleteMany` nem de SQL cru: cada linha volta por `aplicarTransicao(DESFAZER)`, que já
 * apaga o `AccountingEntry` na MESMA transação e recusa mês fechado. Um caminho próprio aqui
 * deixaria lançamento órfão no razão — o estrago que o desfazer transacional existe para impedir.
 *
 * ⚠⚠ **O QUE FALHA VOLTA NOMEADO, e o lote NÃO PARA.** Uma linha em mês fechado não pode impedir o
 * contador de desfazer as outras vinte; e um lote que só dissesse "desfiz 19" faria a vigésima
 * sumir sem ninguém saber por quê.
 */
export async function desfazerLancadosPorRegra({
  portalClientId, ids, usuarioId, agora, client = prisma,
}) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map((i) => String(i || "").trim()).filter(Boolean))];
  const desfeitos = [];
  const recusados = [];

  for (const id of lista) {
    try {
      await aplicarTransicao({
        portalClientId,
        declaradoId: id,
        transicao: TRANSICAO.DESFAZER,
        usuarioId,
        agora,
        client,
      });
      desfeitos.push(id);
    } catch (e) {
      recusados.push({ id, motivo: e?.codigo || e?.code || "falhou", frase: e?.frase || null });
    }
  }

  return { pedidos: lista.length, desfeitos: desfeitos.length, ids: desfeitos, recusados };
}
