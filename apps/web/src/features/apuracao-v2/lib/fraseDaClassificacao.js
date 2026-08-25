// O QUE A CLASSIFICAÇÃO FEZ, DITO EM UMA FRASE — e o escopo dentro dela.
//
// ⚠⚠ DUAS COISAS ERRADAS NA MESMA MENSAGEM, as duas relatadas/achadas em 25/08/2026:
//
// 1. **A frase não aparecia.** A aba montava o layout à mão e não renderizava `<Feedback>`; o
//    contador clicava em "Classificar competência" e o texto do documento não mudava um caractere.
//    Ele perguntou, literalmente: "ao clicar em classificar competência nada acontece, por que?".
//
// 2. **E quando aparecia, dizia menos do que precisava.** `Classificou 0/0. Pendências: 0.` é
//    ambíguo no pior ponto: "0 de 0" lê-se como falha tanto quanto como "não havia nada a fazer".
//    E o botão dizia COMPETÊNCIA enquanto o servidor classificava a EMPRESA INTEIRA — então nem o
//    número dizia sobre o quê ele era.
//
// ⚠ A regra mora aqui, com teste, e não dentro do hook: é a disciplina desta casa (`estadoGuia.js`,
// `cicloObrigacao.js`, `periodoRelatorio.js`). Escrita no ponto de uso, a próxima tela a consumir a
// mesma rota escreveria a sua, e as duas diriam coisas diferentes sobre o mesmo clique.

/** "2026-07" → "07/2026". Nada de `Date`: a competência é texto, e `new Date("2026-07")` é UTC. */
function competenciaBr(c) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(c || ""));
  return m ? `${m[2]}/${m[1]}` : null;
}

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

/**
 * @param {object} r — o `result` de `POST /classificar-v2`.
 * @returns {{ texto: string, houveTrabalho: boolean, alerta: string|null }}
 */
export function fraseDaClassificacao(r) {
  const processed = Number(r?.processed) || 0;
  const classified = Number(r?.classified) || 0;
  const pendentes = Number(r?.pendentes) || 0;

  const comp = competenciaBr(r?.escopo?.competencia);
  // ⚠ O escopo entra na FRASE, não só no payload. Sem ele, "classifiquei 33" não distingue o mês
  // da empresa inteira — que é exatamente a indistinção que fazia o rótulo do botão mentir.
  const onde = comp ? `de ${comp}` : "da empresa inteira";

  // ⚠ "Nada a classificar" NÃO é "0 de 0". São estados diferentes com consertos diferentes: um é o
  // trabalho já feito, o outro parece erro. Mesma família de "0 novas · N já existiam" na varredura
  // de notas — sem dizê-lo, o contador clica três vezes achando que não funcionou.
  const texto = processed === 0
    ? `Nada a classificar ${onde} — todos os itens já estavam classificados.`
    : `Classificou ${classified} de ${plural(processed, "item", "itens")} ${onde}.`
      + (pendentes > 0 ? ` ${plural(pendentes, "ficou pendente", "ficaram pendentes")} — sem regra que os resolva.` : "");

  // ⚠⚠ O QUE FICOU DE FORA APARECE. Em SQL um intervalo não casa com NULL: nota sem competência
  // gravada não entra num recorte por mês, e ficaria invisível para sempre. Ela é contada no banco
  // e dita aqui. ⚠ A saída NÃO é atribuí-la a um mês — inventar a competência decide em qual
  // apuração a receita entra.
  const semComp = Number(r?.foraDoEscopo?.semCompetencia) || 0;
  const alerta = semComp > 0
    ? `⚠ ${plural(semComp, "item ficou", "itens ficaram")} de fora: a nota deles está sem competência gravada, `
      + "e por isso não entra em nenhum mês. Confira na aba Auditoria."
    : null;

  return { texto, houveTrabalho: processed > 0, alerta };
}
