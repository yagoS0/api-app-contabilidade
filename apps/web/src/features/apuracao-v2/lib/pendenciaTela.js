// COMO UMA PENDÊNCIA DA APURAÇÃO SE CHAMA NA TELA.
//
// ⚠ A tela imprimia `[{p.tipo}]` — ou seja, **`[ITEM_SEM_REGRA]` cru**, em caixa alta e entre
// colchetes, como cabeçalho de cada pendência. Nome de enum do banco na frente do contador, na aba
// que decide o que vai para a declaração.
//
// A forma é a mesma de `notas/lib/auditoriaTela.js` e de `lib/vocabulario.js`: objeto congelado em
// `lib/`, com teste próprio, e o componente só liga.
//
// ── ⚠ SÓ EXISTE UM ESCRITOR, E A TABELA DIZ ISSO ────────────────────────────────────────────────
//
// O comentário de `FilaPendencia` no `schema.prisma` lista quatro tipos —
// `ITEM_SEM_REGRA | DIVERGENCIA_CADASTRO | FATOR_R_AMBIGUO | CADASTRO_INCOMPLETO` — mas **um único
// ponto do backend grava em `fila_pendencias`**: `ClassificadorService`, sempre com
// `ITEM_SEM_REGRA`. Os outros três nunca foram escritos por ninguém.
//
// Por isso a tabela abaixo tem **uma** entrada. Escrever frase para os outros três seria inventar o
// significado de um estado que não existe — e a frase inventada envelheceria sozinha se algum dia
// eles passassem a ser gravados com outro sentido.
//
// ⚠ TIPO DESCONHECIDO NÃO GANHA FRASE: vira texto legível (`humanizarTipo`) e **o enum cru
// sobrevive no `title`**. É a disciplina de `rotuloGuia`/`vocabulario`, e o motivo é o mesmo — o
// valor cru precisa ser recuperável numa auditoria, sem estar na cara do contador o tempo todo.

/**
 * A única pendência que o backend cria hoje (`ClassificadorService`).
 * `resumo` já vem pronto do backend com o código e a contagem — aqui é só o CABEÇALHO.
 */
export const FRASE_PENDENCIA = Object.freeze({
  ITEM_SEM_REGRA: Object.freeze({
    rotulo: "Sem regra de classificação",
    // ⚠ Não é "item errado". A nota está como está; o que falta é a REGRA que diz em que tipo de
    // receita ela entra. Quem resolve ensina o sistema (`AprendizadoService` cria a regra da
    // empresa) — daí o botão "Classificar" ao lado.
    explicacao: "O código deste item não casa com nenhuma regra da empresa nem com as gerais. "
      + "Classificar aqui ensina o sistema: a regra vale para as próximas notas com o mesmo código.",
  }),
});

/** "FATOR_R_AMBIGUO" → "Fator r ambiguo". Último recurso — melhor que o enum, pior que uma frase. */
export function humanizarTipo(valor) {
  const t = String(valor || "").trim();
  if (!t) return "Pendência";
  const limpo = t.replace(/_/g, " ").toLowerCase();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * @returns {{rotulo: string, explicacao: string|null, titulo: string, conhecida: boolean}}
 *   `titulo` é o que vai no atributo `title` — carrega o enum cru para uma auditoria poder
 *   recuperá-lo sem que ele fique impresso na tela.
 */
export function leituraDaPendencia(tipo) {
  const chave = String(tipo || "").trim();
  const conhecida = Object.prototype.hasOwnProperty.call(FRASE_PENDENCIA, chave);
  if (conhecida) {
    const { rotulo, explicacao } = FRASE_PENDENCIA[chave];
    return { rotulo, explicacao, titulo: `${explicacao} (tipo: ${chave})`, conhecida: true };
  }
  return {
    rotulo: humanizarTipo(chave),
    // ⚠ Sem explicação inventada. A ausência dela é o que diz "este tipo é novo por aqui".
    explicacao: null,
    titulo: chave ? `Tipo de pendência não catalogado nesta tela (tipo: ${chave})` : "Pendência sem tipo",
    conhecida: false,
  };
}
