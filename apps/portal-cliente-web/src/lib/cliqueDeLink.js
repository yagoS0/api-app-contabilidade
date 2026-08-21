/**
 * QUEM ASSUME O CLIQUE: nós (SPA) ou o navegador.
 *
 * ⚠ A TECLA NÃO É INTERCEPTADA. Um `onClick` que olhasse `event.ctrlKey` para chamar
 * `window.open` resolveria o caso pedido e quebraria outros: clique do MEIO, "abrir em nova aba"
 * do botão direito, **Cmd** no Mac, a URL ao passar o mouse e "copiar endereço do link". Com
 * `<a href>` o navegador faz todas de graça — desde que a gente não chame `preventDefault` nelas.
 *
 * ⚠ Gêmeo de `apps/web/src/components/ui/cliqueDeLink.js` (portal do escritório). Mesma regra,
 * apps separados — **mudou lá, muda aqui**. Ver a tabela dos espelhos no `CLAUDE.md`.
 *
 * ⚠ Isto existe como FUNÇÃO, e não como três linhas dentro do `onClick`, por uma razão de teste: o
 * jsdom não implementa "Ctrl+clique abre em outra guia" — para ele o modificador não muda nada e a
 * navegação acontece igual. Medir o EFEITO lá dentro é medir uma emulação errada; medir esta
 * DECISÃO é medir o nosso código.
 *
 * @param {{metaKey?:boolean, ctrlKey?:boolean, shiftKey?:boolean, altKey?:boolean, button?:number}} evento
 * @returns {boolean} true quando o navegador deve assumir — e o app NÃO deve chamar `preventDefault`
 */
export function oNavegadorAssumeOClique(evento) {
  if (!evento) return false;
  if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return true;
  // ⚠ O clique do MEIO e o botão direito, em navegador moderno, nem chegam como `click`
  // (`auxclick`/`contextmenu`). Esta linha cobre o residual; quem faz os dois funcionarem é o
  // `href`, não ela. Registrado para ninguém creditar a ela o que ela não faz.
  return typeof evento.button === "number" && evento.button !== 0;
}

export default oNavegadorAssumeOClique;
