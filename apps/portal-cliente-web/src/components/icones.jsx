// OS ÍCONES DA NAVEGAÇÃO — SVG inline, nunca emoji, nunca biblioteca.
//
// ⚠ POR QUE NÃO EMOJI. O motivo já está escrito no repositório, no único precedente de ícone
// vetorial que ele tem (o hambúrguer da carteira, em `apps/web`): *"o caractere ☰ some em fonte sem
// o glifo e não escala com a cor do botão"*. Emoji não herda `currentColor` — ele é colorido pela
// fonte do sistema — e muda de desenho entre Windows, Android e iOS. Numa barra que é SÓ ícone,
// isso não é detalhe: é o desenho inteiro.
//
// ⚠ POR QUE NÃO UMA BIBLIOTECA. `CLAUDE.md` deste app: *"Router, Redux/Zustand, Tailwind, CSS por
// componente — nenhum deles. Não introduza sem discutir."* Ele tem exatamente TRÊS dependências de
// produção (`react`, `react-dom`, `@contabilidade/shared`), e isso já foi usado como argumento para
// recusar o SheetJS. Seis paths não valem a quarta.
//
// ⚠ TODOS SÃO `aria-hidden`. Quem carrega o nome acessível é o link, com o rótulo em `.sr-only` —
// o ícone é a marca VISUAL do destino, nunca a única. É a regra que `apps/web/.../Aviso.jsx` fixa
// para estado ("nunca a única marca") e que aqui vale para navegação.
//
// ⚠ `stroke` e não `fill`: com traço, o mesmo desenho serve a 20px e a 24px sem virar mancha, e
// `currentColor` faz o ícone acompanhar a cor do link — inclusive no estado ativo.

const BASE = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
};

/** Painel — fluxo de caixa. Metáfora herdada do app do cliente no celular (`trending-up`). */
export function IconePainel(props) {
  return (
    <svg {...BASE} {...props}>
      <path d="M3 14.5 8 9.5l3 3 6-6" />
      <path d="M13 6.5h4v4" />
    </svg>
  );
}

/** Notas — o recibo. Também herdado do celular (`receipt`), pelo mesmo motivo. */
export function IconeNotas(props) {
  return (
    <svg {...BASE} {...props}>
      <path d="M5 2.5h10v15l-2.5-1.5L10 17.5 7.5 16 5 17.5v-15Z" />
      <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />
    </svg>
  );
}

/**
 * Guias — documento com código de barras.
 * ⚠ Esta metáfora não existia em lugar nenhum (nem no celular, que não tem tela de guias). Foi
 * escolhida pelo que a pessoa faz com a guia: ler a linha e pagar.
 */
export function IconeGuias(props) {
  return (
    <svg {...BASE} {...props}>
      <rect x="3.5" y="2.5" width="13" height="15" rx="1.5" />
      <path d="M6.5 6h7M6.5 8.5h7" />
      <path d="M6.5 12v3M8.5 12v3M10.5 12v3M13.5 12v3" />
    </svg>
  );
}

/**
 * Situação fiscal — escudo com conferência.
 * ⚠ Também inédita. ⚠ E o desenho NÃO afirma "está tudo certo": o escudo é o assunto (a situação
 * perante o fisco), não o veredito. O estado quem diz é a tela, e ela não afirma nada sem consulta.
 */
export function IconeSituacaoFiscal(props) {
  return (
    <svg {...BASE} {...props}>
      <path d="M10 2.5 4 5v4.6c0 3.4 2.4 6.2 6 7.4 3.6-1.2 6-4 6-7.4V5l-6-2.5Z" />
      <path d="M7.6 9.8 9.4 11.6 12.9 8" />
    </svg>
  );
}

/**
 * ⚠⚠ O MAPA É FECHADO, E A FALHA É VISÍVEL.
 *
 * Chave sem ícone **não pode render um link vazio** — numa barra só de ícones isso é um destino
 * invisível, e o `.sr-only` do rótulo não aparece para quem enxerga. É o mesmo modo de falhar que
 * `chipDaGuia` já tem nomeado neste app: valor fora da lista renderizando *"sem cor nenhuma, em
 * silêncio"*. Aqui a reserva é um ponto de interrogação **com o rótulo visível ao lado** (ver
 * `AppShell`), para que a ausência apareça em vez de se esconder.
 */
export const ICONE_POR_ROTA = Object.freeze({
  home: IconePainel,
  notas: IconeNotas,
  guias: IconeGuias,
  fiscal: IconeSituacaoFiscal,
});

export function IconeDeReserva(props) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8 7.8a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.6" />
      <path d="M10 14.2h.01" />
    </svg>
  );
}

/** `undefined` nunca vira link vazio: quem não tem desenho ganha a reserva, e o rótulo aparece. */
export function iconeDaRota(chave) {
  return Object.prototype.hasOwnProperty.call(ICONE_POR_ROTA, chave)
    ? ICONE_POR_ROTA[chave]
    : IconeDeReserva;
}

/** Quem cai na reserva mostra o rótulo em tela — a barra deixa de ser só ícone naquele item. */
export function temIconePropio(chave) {
  return Object.prototype.hasOwnProperty.call(ICONE_POR_ROTA, chave);
}
