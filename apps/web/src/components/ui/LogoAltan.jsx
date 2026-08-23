// A LOGO DA ALTAN — SVG inline, transcrito do kit oficial.
//
// ⚠⚠ INLINE NO DOM, E NÃO `<img src="…svg">`. Esta é a decisão que sustenta o arquivo inteiro.
// O letreiro dos SVGs oficiais é `<text font-family="Inter, 'Segoe UI', Arial, sans-serif">`, e um
// SVG referenciado como imagem (`<img>`, `background-image`, favicon) é um DOCUMENTO ISOLADO: ele
// não enxerga as fontes que a página carregou, nem o CSS dela. Servido assim, o letreiro cairia em
// Segoe UI no Windows, Arial no macOS e Roboto no Android — três desenhos para a mesma marca, e o
// certo seria justamente o que aparece na máquina de quem desenvolve.
// Inline, ele herda `--font-marca` (a Inter auto-hospedada, ver `styles/tokens.css`) e as cores.
//
// ⚠⚠ A ARTE NÃO FOI REDESENHADA. Todas as coordenadas abaixo são as de
// `altan-logo-horizontal-transparente-claro.svg`, sem uma vírgula mudada. As duas únicas mudanças
// em relação ao arquivo são:
//
//   1. O `viewBox`. O oficial é `0 0 620 170`, e nele a marca ocupa só 52% da largura e 34% da
//      altura — medido na tinta do PNG @2x: `x 77..722, y 128..243` de 1240×340, ou seja **42% de
//      margem morta à direita** e 38% no topo. Posto num cabeçalho com 200px de largura, o desenho
//      visível teria ~104px e flutuaria no canto. O recorte tira a margem; não tira arte.
//   2. As cores saem de custom properties. "claro"/"escuro" no nome dos arquivos da Altan é o FUNDO
//      em que a logo se apoia, não o tema do arquivo — e os dois portais têm fundos opostos. Uma
//      cópia do desenho por paleta divergiria na primeira correção.
//
// ⚠ ESPELHO: existe uma cópia deliberada em `apps/portal-cliente-web/src/components/LogoAltan.jsx`. Os dois
// portais não compartilham código; a obrigação de sincronizar está na tabela "mudou lá, muda aqui"
// do `CLAUDE.md`.

// ⚠⚠ A CAIXA VEM DE MEDIÇÃO NO NAVEGADOR, NÃO DE CONTA DE CABEÇA — e o caminho até ela é o aviso.
// A largura do letreiro depende da fonte que DE FATO renderizar, e a raiz de um SVG recorta por
// padrão: errar para menos corta a última letra de "CONTABILIDADE". Foi medido em duas etapas:
//   1. na tinta do PNG oficial (@2x, rendido em Segoe UI): a tinta ia até `x = 361`;
//   2. com a Inter carregada, no navegador, via `getBBox()` — descontando o `letter-spacing`, que
//      em SVG sobra DEPOIS da última letra: a tinta vai até `x = 359,8`.
// Daí `x: 30` e `largura: 340` (borda direita em 370): ~8 unidades de folga de cada lado, medidas
// nas duas fontes que este letreiro pode ter. ⚠ Trocar a fonte da marca obriga a medir de novo.
//
// ⚠⚠ A SEGUNDA CAIXA É A MARCA SOZINHA — o sol e o horizonte, sem letreiro. Pedido do dono em
// 23/08/2026 para a barra do topo do portal do cliente: *"tire a 'Altan contabilidade' e deixe
// apenas o Sol no canto superior"*. AS COORDENADAS SÃO AS MESMAS (a arte não foi redesenhada nem
// duplicada); o que muda é o quanto do desenho a janela mostra. A tinta aqui vai de `x 38,75` (a
// ponta arredondada do horizonte) a `161,25`, e de `y 64` (o topo da cúpula) a `103,25` — daí
// `30 56 140 55`, com as mesmas ~8 unidades de folga em volta.
//
// ⚠ E o letreiro NÃO É ESCONDIDO por CSS: ele deixa de ser RENDERIZADO. Um `<text>` invisível
// continuaria no `textContent` e no cálculo do nome acessível — a marca "sem letras" ainda seria
// lida como tendo letras.
const CAIXAS = {
  completa: { x: 30, y: 56, largura: 340, altura: 74 },  // ~4,59:1
  marca: { x: 30, y: 56, largura: 140, altura: 55 },     // ~2,55:1
};

// ⚠ O PAR DE FUNDO CLARO, CRAVADO — é o que a impressão precisa e é a única situação em que a cor
// NÃO pode sair do tema. O papel é branco em qualquer portal, e a tinta do portal escuro
// (`#F8F8F2`) sairia invisível nele.
const TINTA_DE_PAPEL = {
  "--logo-sol": "#D9A32B",
  "--logo-horizonte": "#6272A4",
  "--logo-tinta": "#1A1B26",
  "--logo-subtitulo": "#6272A4",
  // Sem isto o navegador pode descartar as cores na impressão e a cúpula sai vazada.
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

/**
 * @param {number}   altura    altura em px; a largura sai da proporção da variante
 * @param {"completa"|"marca"} [variante]  com letreiro (padrão) ou só o sol e o horizonte
 * @param {"papel"}  [tom]     força o par de fundo claro + impressão de cor exata
 * @param {string}   [titulo]  o nome acessível — é ele que os testes procuram
 */
export function LogoAltan({
  altura = 32,
  variante = "completa",
  tom,
  className,
  titulo = "Altan Contabilidade",
}) {
  // ⚠ Variante desconhecida cai na COMPLETA, nunca num SVG vazio: um erro de digitação na prop
  // renderizaria uma caixa em branco no lugar da marca, e ausência é o que ninguém repara.
  const caixa = Object.prototype.hasOwnProperty.call(CAIXAS, variante)
    ? CAIXAS[variante]
    : CAIXAS.completa;
  const comLetreiro = caixa === CAIXAS.completa;

  return (
    <svg
      className={className}
      role="img"
      focusable="false"
      height={altura}
      width={Math.round((altura * caixa.largura) / caixa.altura)}
      viewBox={`${caixa.x} ${caixa.y} ${caixa.largura} ${caixa.altura}`}
      xmlns="http://www.w3.org/2000/svg"
      style={tom === "papel" ? TINTA_DE_PAPEL : undefined}
    >
      {/* ⚠ O nome acessível vem daqui. O texto da marca é `<text>` dentro de um `role="img"`, então
          leitor de tela não o lê como parágrafo — sem este `<title>` a logo seria um gráfico mudo,
          e ela é a única coisa que identifica o portal desde que o rótulo escrito saiu da tela. */}
      <title>{titulo}</title>
      <path d="M62 102 A38 38 0 0 1 138 102 Z" fill="var(--logo-sol)" />
      <line
        x1="40"
        y1="102"
        x2="160"
        y2="102"
        stroke="var(--logo-horizonte)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {comLetreiro ? (
        <>
          <text
            x="196"
            y="92"
            fontFamily="var(--font-marca)"
            fontWeight="500"
            fontSize="38"
            letterSpacing="9"
            fill="var(--logo-tinta)"
          >
            ALTAN
          </text>
          <text
            x="198"
            y="122"
            fontFamily="var(--font-marca)"
            fontWeight="400"
            fontSize="12.5"
            letterSpacing="5.2"
            fill="var(--logo-subtitulo)"
          >
            CONTABILIDADE
          </text>
        </>
      ) : null}
    </svg>
  );
}
