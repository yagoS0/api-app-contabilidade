// A SEÇÃO COM TÍTULO — uma só.
//
// ⚠ ELE NÃO INVENTA VISUAL: envolve a classe `.panel` / `.panel__head` / `.panel__title` que já
// existe no `App.css` desde sempre. O que existia era o contrário — a classe estava lá e as telas
// escreviam a caixa à mão, cada uma com os seus números:
//
//   ficha da empresa      `<section style={{ background:"#24253a", border:"1px solid rgba(189,147,249,.22)", borderRadius:16, padding:18 }}>`
//   relatório de faturamento  `const caixa = { background: PANEL.surface, border: …, borderRadius: 8 }`
//   apuração / parcelamento   mais duas variações de raio e padding
//
// Quatro desenhos para "uma seção com título", na mesma tela, em telas vizinhas. Cor nova entra em
// `styles/tokens.css`; caixa nova entra aqui — não num `const` dentro do componente.
//
// `titulo` é opcional: há painel que é só um contêiner (a grade de KPIs). O que NÃO é opcional é
// vir daqui, e não de um objeto de estilo local.

/**
 * @param {string}      [titulo]     Vai num `<h2>` — o painel é uma seção, não um `<div>` bonito.
 * @param {import("react").ReactNode} [acoes]  Botões à direita do título (`.panel__head`).
 * @param {"normal"|"densa"} [densidade]  `densa` = padding menor, para painel dentro de painel.
 * @param {string}      [id]         Âncora (`#bloco-inscricoes`), para link vindo de outra tela.
 * @param {boolean}     [alerta]     Contorno de atenção. ⚠ NÃO repete o texto do aviso: o contorno
 *                                   marca ONDE está o problema; QUAL é o problema é do `Aviso`.
 */
export function Painel({
  titulo = null,
  acoes = null,
  densidade = "normal",
  id,
  alerta = false,
  className = "",
  style,
  children,
  ...props
}) {
  const classes = ["panel"];
  if (densidade === "densa") classes.push("panel--densa");
  if (className) classes.push(className);

  return (
    <section
      {...props}
      id={id}
      className={classes.join(" ")}
      style={alerta ? { borderColor: "var(--state-warn)", ...style } : style}
    >
      {titulo || acoes ? (
        <div className="panel__head">
          {titulo ? <h2 className="panel__title">{titulo}</h2> : <span />}
          {acoes ? <div className="panel__acoes">{acoes}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export default Painel;
