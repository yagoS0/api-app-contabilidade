// DE QUEM É O IMPEDIMENTO — e é isto que decide se a frase aparece na TELA.
//
// ⚠⚠ POR QUE ISTO EXISTE (19/08/2026). A linha da lista tem três ações (DANFSe, Cancelar, Usar
// como modelo) e várias delas chegam à MESMA conclusão sobre a MESMA nota. Quando cada botão
// escrevia o seu próprio motivo, a linha dizia *"Ainda não confirmada."* duas vezes, lado a lado —
// e o dono passou o dia cortando ruído exatamente desse tipo.
//
//   `NOTA` — o fato é da NOTA, não deste botão. A linha inteira já o carrega: a coluna "Tipo", o
//            chip da situação e o `title`/`aria-label` dele. Os outros botões chegariam à mesma
//            conclusão, então a frase seria repetida tantas vezes quantas forem as ações.
//   `ACAO` — o fato é só deste botão (a nota está boa; ESTA ação não dá). Nada mais na linha diz
//            isso, então a frase aparece ao lado dele.
//
// ⚠ O BOTÃO CONTINUA DESABILITADO E CONTINUA COM `title` NOS DOIS CASOS. O que muda é só o texto
// VISÍVEL — a regra "botão impossível não some, e diz por quê" segue de pé, e o `title` não é
// texto na tela.
export const ESCOPO = Object.freeze({ NOTA: "nota", ACAO: "acao" });
