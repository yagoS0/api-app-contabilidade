// A LISTA DE SERVIÇOS DA LC 116/2003 — leitura, e nada além disso.
//
// ⚠⚠ O QUE ESTE MÓDULO **NÃO** FAZ, e é a parte que importa: ele **não diz o anexo do Simples**, não
// diz a presunção do Lucro Presumido e não classifica receita. A LC 116 é a lista de serviços
// sujeitos ao **ISS** — outra lei, outro tributo. O de-para "item da LC 116 → tipo de receita" é
// julgamento fiscal que não está em norma nenhuma, e inventá-lo aqui poria receita no anexo errado
// em série. Isso é decisão do contador, e é assunto à parte.
//
// O que ele entrega, e que hoje não existia: **o nome do serviço a partir do código**. A tela do
// contador mostra `17.06` cru; com isto ela pode mostrar "17.06 — Propaganda e publicidade,
// inclusive promoção de vendas…". Zero inferência: é o texto da lei.
//
// Fonte, hash e as armadilhas da extração: `docs/lc116/README.md` e o cabeçalho de `lc116.data.js`.

import { ITENS_LC116, SUBITENS_LC116 } from "./lc116.data.js";

export { ITENS_LC116, SUBITENS_LC116 };

const POR_CODIGO = new Map(SUBITENS_LC116.map((s) => [s.codigo, s]));

/**
 * Normaliza o que veio da tela/banco para a forma da lei: `N.NN`.
 *
 * ⚠ NENHUM `padStart` NO ITEM. `"1.06"` e `"01.06"` são o mesmo serviço, e aceitar os dois é
 * tolerância de ENTRADA; já fabricar um item a partir de um dígito a menos seria inventar código —
 * a classe de defeito do `cLocEmi="0000000"`. Fora do formato, devolve `null`.
 */
export function normalizarCodigoLc116(bruto) {
  const t = String(bruto ?? "").trim();
  const m = /^(\d{1,2})\s*\.\s*(\d{1,2})$/.exec(t);
  if (!m) return null;
  const item = Number(m[1]);
  if (!Number.isInteger(item) || item < 1 || item > 40) return null;
  return `${item}.${m[2].padStart(2, "0")}`;
}

/**
 * O subitem, ou `null` quando o código não existe na lista.
 *
 * ⚠ `null` E NÃO UM OBJETO VAZIO. Código fora da lista é fato — ele pode ser um código municipal
 * confundido com o da LC 116, ou um erro de digitação. Devolver algo com `descricao: ""` faria a
 * tela imprimir um serviço sem nome como se fosse serviço sem nome NA LEI.
 */
export function subitemLc116(codigo) {
  const n = normalizarCodigoLc116(codigo);
  return n ? (POR_CODIGO.get(n) || null) : null;
}

/**
 * A descrição pronta para a tela: `"17.06 — Propaganda e publicidade, …"`.
 *
 * ⚠ TRÊS RESPOSTAS, e a do meio é a que impede a mentira. Código inexistente devolve `null` (a tela
 * mostra o código cru e diz que não o reconhece); código VETADO devolve a frase do veto, porque
 * aquele subitem existe na numeração e NÃO é serviço tributável — mostrar o número sozinho ali
 * sugeriria um serviço que a lei recusou.
 */
export function descricaoLc116(codigo) {
  const s = subitemLc116(codigo);
  if (!s) return null;
  if (s.vetado) return `${s.codigo} — (VETADO na Lei Complementar 116/2003)`;
  return `${s.codigo} — ${s.descricao}`;
}

/** O rótulo do item (o "capítulo"), ou `null`. */
export function descricaoItemLc116(item) {
  const n = Number(item);
  return Number.isInteger(n) ? (ITENS_LC116[n] || null) : null;
}

/**
 * Os subitens de um item, na ordem da lei.
 *
 * ⚠ Os VETADOS vêm junto, marcados. Some com eles e a numeração ganha buraco — e quem olhar vai
 * achar que a extração perdeu entrada, que é exatamente a dúvida que o gerador existe para fechar.
 */
export function subitensDoItem(item) {
  const n = Number(item);
  return SUBITENS_LC116.filter((s) => s.item === n);
}
