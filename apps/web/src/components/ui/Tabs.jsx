/**
 * Tabs — a ÚNICA barra de abas do app.
 *
 * O app tinha TRÊS linguagens visuais para a mesma coisa, e a terceira estava copiada sete vezes
 * com valores diferentes em cada cópia:
 *
 *   A) pílula com fundo roxo sólido    → `.page-shell__tab`
 *   B) transparente com sublinhado roxo → `.company-topbar__link`, `.company-section-header__subtab`
 *   C) pílula contornada com tinta roxa → inline em Dashboard, Calendário, Apuração V2, Notas
 *      Fiscais, DEFIS e Consultas — com raio 6/8/20/999, fonte 0.7/0.82/0.85/0.9rem e padding
 *      3px/5px/6px/7px, cada tela com a sua combinação.
 *
 * Ficou a linguagem B, que é a do header da empresa — a barra que o contador vê em toda tela de
 * empresa. A ATIVA é o texto cheio com sublinhado roxo; a inativa é `--tab-ink`. É o contraste
 * entre as duas que diz o que está selecionado, então nenhuma das duas pode virar cor de estado:
 * aba não é pendência nem conclusão.
 *
 * Props:
 *  - `items`: `[{ key, label, disabled?, title?, badge? }]`
 *  - `pill`: envolve as abas numa faixa arredondada. Desligue quando a barra já mora dentro de um
 *    container próprio (é o caso do nível 1 do header da empresa, dentro do topbar).
 *  - `size`: `lg` (nível 1 da empresa) · `md` (padrão) · `sm` (barra densa, como os 11 blocos da
 *    DEFIS dentro de um modal).
 *  - `mode`: `nav` marca `aria-current="page"` (navegação — a aba muda de tela/rota); `view` marca
 *    `aria-pressed` (seletor de visão — o conteúdo é o mesmo, muda o recorte). Confundir os dois
 *    faz o leitor de tela anunciar "página atual" para um botão que não navegou para lugar nenhum.
 */
export function Tabs({
  items = [],
  active,
  onChange,
  ariaLabel,
  pill = true,
  size = "md",
  align = "center",
  mode = "nav",
  className = "",
  style,
}) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const classes = ["app-tabs", `app-tabs--${size}`, `app-tabs--${align}`];
  if (pill) classes.push("app-tabs--pill");
  if (className) classes.push(className);

  const Wrapper = mode === "nav" ? "nav" : "div";
  const wrapperProps = mode === "nav" ? {} : { role: "group" };

  return (
    <Wrapper className={classes.join(" ")} aria-label={ariaLabel} style={style} {...wrapperProps}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            className={`app-tab${isActive ? " is-active" : ""}`}
            /* Clicar na aba ativa não é ação: sem isto, cada clique repetido reexecuta o handler
               (recarga, refetch) numa tela que já está aberta. Era o comportamento do header da
               empresa e virou o padrão. */
            onClick={isActive || item.disabled ? undefined : () => onChange?.(item.key)}
            disabled={item.disabled}
            aria-current={mode === "nav" && isActive ? "page" : undefined}
            aria-pressed={mode === "view" ? isActive : undefined}
            title={item.title}
          >
            {item.label}
            {item.badge ? <span className="app-tab__badge">{item.badge}</span> : null}
          </button>
        );
      })}
    </Wrapper>
  );
}

export default Tabs;
