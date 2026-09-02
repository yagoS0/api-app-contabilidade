// O ANEXO VIII — leitura, e nada além disso.
//
// ⚠⚠ **ELE OFERECE, NUNCA ELEGE.** É a regra que decide o módulo inteiro. A tabela responde
// *"quais combinações de `cIndOp` e `cClassTrib` a norma autoriza para este serviço?"* — e para
// **118 dos 208 itens ela devolve mais de uma**. Escolher entre "situações tributadas
// integralmente" e "fornecimento à administração pública" depende de QUEM é o tomador daquela
// nota, não do serviço prestado. Quem declara é o **contador**, no perfil de emissão; este módulo
// existe para OFERECER a lista e para RECUSAR o que a fonte não autoriza.
//
// É a mesma disciplina de `codigoServicoDaNota.js` (*"encontra, nunca escolhe"*) e de
// `escolherCodigoServicoNacional` (*"o cadastro é a autoridade, nunca o payload"*).
//
// ⚠⚠ **A COMBINAÇÃO É O PAR.** Não existe "a lista de cIndOp" e "a lista de cClassTrib" deste
// módulo, de propósito: em 7 itens o produto cartesiano das duas contém combinações que a planilha
// **não autoriza** (o `10.05` traz só `(020301,200046)` e `(100301,000001)`). Há teste travando isso.
//
// ⚠ **ESTE MÓDULO NÃO ESCREVE XML.** Ele não conhece a DPS, não monta tag nenhuma e não decide se
// o bloco `IBSCBS` sai na nota. Montar aquele grupo muda documento fiscal em produção e está atrás
// da flag `INTEGRACAO_NFSE_IBSCBS`.
//
// Fonte, hash e as armadilhas da extração: `apps/api/scripts/gerar-anexo-viii.mjs` e o cabeçalho
// de `anexoViii.data.js`.

import { ANEXO_VIII } from "./anexoViii.data.js";

export { ANEXO_VIII };

/**
 * As quatro respostas. ⚠ `SEM_ITEM` é fato sobre a PERGUNTA (código que não está na tabela);
 * `SEM_CORRELACAO` é fato sobre a TABELA (o item existe e a norma não correlaciona nada).
 * Colapsá-las faria "não sei do que você está falando" e "a norma não diz" virarem a mesma coisa.
 */
export const RESPOSTA = Object.freeze({
  SEM_ITEM: "sem_item",
  SEM_CORRELACAO: "sem_correlacao",
  UMA: "uma",
  VARIAS: "varias",
});

const POR_ITEM = new Map(ANEXO_VIII.map((i) => [i.item, i]));

/**
 * Normaliza o código do item para a grafia do ANEXO VIII (`01.01`).
 *
 * ⚠ A LC 116 escreve `1.01` e o ANEXO VIII escreve `01.01` — **só o item ganha o zero, o subitem
 * já vem com dois dígitos**. Zerar as duas metades produz `01.01` a partir de `1.1`, que é outro
 * subitem. Devolve `null` para o que não tem a forma, nunca um palpite.
 */
export function normalizarItemLc116(codigo) {
  // ⚠⚠ SÓ STRING, e a guarda é por TIPO ACEITO — nunca por lista de recusas. Um NÚMERO não carrega
  // zero à esquerda, e a aceitação sairia incoerente: `1.01` viraria `"1.01"` e passaria, mas
  // `01.10` chega como `1.1` e seria recusado. Código fiscal que às vezes aceita número é pior que
  // um que nunca aceita. Mesma lição de `dispensadaPeloPiso` (`fiscal/retencao/`), onde enumerar
  // as ausências deixou o `[]` escapar.
  if (typeof codigo !== "string") return null;
  const bruto = codigo.trim();
  if (!/^\d{1,2}(\.\d{2})+$/.test(bruto)) return null;
  const [item, ...resto] = bruto.split(".");
  return [item.padStart(2, "0"), ...resto].join(".");
}

/**
 * O item da LC 116 embutido num `cTribNac`.
 *
 * ⚠ O `cTribNac` é `item(2) + subitem(2) + desdobro nacional(2)` — estrutura já registrada neste
 * projeto (`docs/lista-servico-nacional/`, e o cabeçalho de `codigoServicoDaNota.js`). Os quatro
 * primeiros dígitos SÃO o item; o desdobro é granularidade nacional que o ANEXO VIII não usa.
 * ⚠ Forma, nunca conteúdo: 6 dígitos ou `null`. **Sem `padStart`** — completar um código de cinco
 * dígitos fabricaria um item plausível e errado, que é a classe do `cLocEmi="0000000"`.
 */
export function itemLc116DoCodigoNacional(cTribNac) {
  // ⚠ Mesma guarda por TIPO da `normalizarItemLc116`, pelo mesmo motivo: `010101` como número é
  // `10101`, e aceitar número faria o zero à esquerda sumir em silêncio.
  if (typeof cTribNac !== "string") return null;
  const digitos = cTribNac.trim();
  if (!/^\d{6}$/.test(digitos)) return null;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 4)}`;
}

/**
 * A correlação de um item da LC 116.
 *
 * Aceita `01.01` e `1.01`. Devolve SEMPRE a lista inteira de combinações — nunca uma escolhida,
 * nem quando há só uma: `UMA` quer dizer *"a norma correlaciona uma coisa só"*, e é o consumidor
 * que decide se isso basta para dispensar a pergunta ao contador.
 */
export function correlacaoDoItem(codigo) {
  const item = normalizarItemLc116(codigo);
  const achado = item ? POR_ITEM.get(item) : null;
  if (!achado) return { resposta: RESPOSTA.SEM_ITEM, item, nbs: [], combinacoes: [] };

  const { nbs, combinacoes, descricao } = achado;
  if (!combinacoes.length) {
    return { resposta: RESPOSTA.SEM_CORRELACAO, item, descricao, nbs, combinacoes: [] };
  }
  return {
    resposta: combinacoes.length === 1 ? RESPOSTA.UMA : RESPOSTA.VARIAS,
    item,
    descricao,
    nbs,
    combinacoes,
  };
}

/**
 * ⚠⚠ A GUARDA: este par `(cIndOp, cClassTrib)` é autorizado pela fonte para este item?
 *
 * É o que impede o perfil de emissão de guardar uma combinação que a planilha não traz — o
 * defeito que "duas listas soltas" produziria em 7 itens. Recusa **nomeando**, no espírito de
 * `NFSE_CODIGO_SERVICO_FORA_DA_LISTA`.
 *
 * ⚠ Item sem correlação (`99.01.01`) recusa TUDO, e isso é resposta, não buraco: a norma não
 * correlaciona nada para o "não classificado", então não há par a autorizar.
 */
export function conferirCombinacao(codigo, { cIndOp, cClassTrib } = {}) {
  const r = correlacaoDoItem(codigo);
  if (r.resposta === RESPOSTA.SEM_ITEM) {
    return { ok: false, motivo: "ITEM_FORA_DO_ANEXO_VIII", item: r.item };
  }
  if (r.resposta === RESPOSTA.SEM_CORRELACAO) {
    return { ok: false, motivo: "ITEM_SEM_CORRELACAO", item: r.item };
  }
  const ind = String(cIndOp ?? "").trim();
  const cct = String(cClassTrib ?? "").trim();
  const achada = r.combinacoes.find((c) => c.cIndOp === ind && c.cClassTrib === cct);
  if (!achada) {
    return {
      ok: false,
      motivo: "COMBINACAO_NAO_AUTORIZADA",
      item: r.item,
      autorizadas: r.combinacoes.map((c) => ({ cIndOp: c.cIndOp, cClassTrib: c.cClassTrib })),
    };
  }
  return { ok: true, combinacao: achada };
}

/**
 * Os códigos NBS que a norma correlaciona a este item.
 *
 * ⚠ **Isto NÃO é o `cNBS` da DPS.** O `TSCodNBS` do XSD é `[0-9]{9}` — nove dígitos, sem ponto —
 * e a tabela NBS deste projeto guarda a forma pontuada (`1.1502.10.00`), da qual **918 dos 1.210
 * códigos** têm nove dígitos e 292 são níveis intermediários da hierarquia, que não cabem na DPS.
 * A conversão é assunto de `nbsParaDps`, que ainda não existe. Aqui é só a correlação.
 */
export function nbsDoItem(codigo) {
  return correlacaoDoItem(codigo).nbs;
}
