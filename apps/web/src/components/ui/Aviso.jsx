// ⚠ CAIXA DE RECADO — `tom` e `titulo` são OBRIGATÓRIOS, e isso é o conserto, não burocracia.
//
// Nasceu de um defeito real no `FechamentoModal`: duas caixas âmbar coladas uma na outra, escritas
// à mão com os MESMOS `rgba(255,179,71,0.10)` / `#FFB347` / `0.75rem`. Uma dizia a conferência da
// folha, a outra o risco de Anexo V — indistinguíveis, e com folha 0×0 a de cima ficava VERDE
// afirmando "✓ Confere (R$ 0,00)" enquanto a de baixo, âmbar, afirmava "mas há folha lançada no
// período". Duas caixas se contradizendo no mesmo scroll, numa tela que transmite ato fiscal.
//
// `titulo` obrigatório é o que impede duas caixas de mesmo tom colarem sem se distinguir.
// `tom` obrigatório é o que impede escolher a cor por acidente.
//
// ⚠ TOM INVÁLIDO CAI EM `neutro`, NUNCA EM `ok`. O oposto da trava do `Button` (que cai em
// `primary` de propósito): aqui o risco não é estético, é a caixa CONCLUIR o que não foi feito.
// O projeto já pagou por isso duas vezes — `renderApuracaoV2Tab.jsx` ("'✓ Nenhuma pendência
// aberta' EM VERDE CONCLUÍA O QUE NÃO FOI FEITO") e o 0×0 acima. Verde é conclusão: só sai quando
// quem chama pediu verde com todas as letras.
const TONS = {
  ok: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  atencao: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  erro: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
  neutro: { cor: "var(--text-muted)", fundo: "var(--state-neutral-surface)" },
};

export const TONS_VALIDOS = Object.freeze(Object.keys(TONS));

export function tomDoAviso(tom) {
  return Object.prototype.hasOwnProperty.call(TONS, tom) ? tom : "neutro";
}

/**
 * @param {"ok"|"atencao"|"erro"|"neutro"} tom  Obrigatório. Inválido/ausente vira `neutro`.
 * @param {string} titulo  Obrigatório. É o que distingue duas caixas de mesmo tom.
 * @param {boolean} [compacto]  Caixa de rodapé de campo (0.75rem) em vez de bloco de resultado.
 * @param {string}  [icone]  ⚠ DECORATIVO (`aria-hidden`), nunca a única marca do estado — a cor e
 *   o título já dizem o que é, e um leitor de tela não lê emoji como significado. Existe porque as
 *   cópias locais desta caixa tinham ícone e, sem ele aqui, elas não teriam como ser apagadas.
 * @param {import("react").ReactNode} [acao]  Um botão dentro do aviso ("Tentar de novo"). Fica
 *   ABAIXO do corpo, nunca ao lado do título: a caixa diz o que houve antes de oferecer o que fazer.
 *
 * ⚠ `role` NÃO é prop própria — vai pelo spread, como qualquer atributo. Aviso que aparece por
 * causa de uma ação passageira quer `role="status"`; erro que bloqueia quer `role="alert"`. Quem
 * sabe qual dos dois é quem chama.
 */
export function Aviso({ tom, titulo, compacto = false, icone = null, acao = null, children, style, ...props }) {
  const { cor, fundo } = TONS[tomDoAviso(tom)];
  return (
    <div
      {...props}
      style={{
        padding: compacto ? "8px 10px" : "var(--space-3)",
        borderRadius: "var(--radius-sm)",
        fontSize: compacto ? "0.75rem" : "0.8rem",
        background: fundo,
        border: `1px solid ${cor}`,
        color: cor,
        ...style,
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          fontWeight: 700,
          marginBottom: "var(--space-1)",
        }}
      >
        {icone ? <span aria-hidden="true">{icone} </span> : null}
        {titulo}
      </div>
      {children}
      {acao ? <div style={{ marginTop: "var(--space-2)" }}>{acao}</div> : null}
    </div>
  );
}

export default Aviso;
