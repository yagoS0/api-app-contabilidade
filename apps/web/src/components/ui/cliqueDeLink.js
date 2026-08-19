/**
 * QUANDO O CLIQUE NUM LINK É DO NAVEGADOR, E NÃO DO APP.
 *
 * ⚠ POR QUE ISTO É UMA FUNÇÃO, e não duas linhas repetidas em cada lugar. O pedido do dono
 * (19/08/2026) foi *"ao apertar control + uma das abas, abrir em uma nova guia do navegador"*, e a
 * resposta certa foi transformar a aba num `<a href>` de verdade em vez de interceptar a tecla —
 * assim o clique do MEIO, o "abrir em nova aba" do botão direito, o Cmd do Mac, a URL ao passar o
 * mouse e o "copiar endereço do link" vêm todos de graça.
 *
 * Isso vale para QUALQUER elemento que seja um link e navegue por dentro do app: as abas
 * (`components/ui/Tabs.jsx`) e a engrenagem de configuração da aba Notas Fiscais. Duas cópias desta
 * regra divergiriam na primeira correção — e a divergência apareceria como "Ctrl+clique funciona na
 * aba e não na engrenagem", que é o tipo de defeito que ninguém reporta, só desconfia.
 *
 * Devolve `true` quando o navegador deve assumir: NÃO chame `preventDefault`, deixe o `href` valer.
 * Devolve `false` no clique simples (botão esquerdo, sem modificador) — aí o app navega por dentro
 * (SPA) e o `preventDefault` é obrigatório, inclusive no destino já aberto: sem ele, clicar no
 * link da tela atual recarregaria a página inteira.
 */
export function oNavegadorAssumeOClique(event) {
  // Alguém já tratou este clique — não o disputamos, e também não o transformamos em navegação.
  if (event.defaultPrevented) return true;
  // Botão do meio (1) abre em nova guia; o direito (2) abre o menu de contexto. Nenhum é nosso.
  if (event.button !== 0) return true;
  // Ctrl/Cmd = nova guia · Shift = nova janela · Alt = baixar. Todos do navegador.
  return Boolean(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}
