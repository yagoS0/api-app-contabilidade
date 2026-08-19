/**
 * Tabs — a ÚNICA barra de abas do app.
 *
 * O app tinha TRÊS linguagens visuais para a mesma coisa, e a terceira estava copiada sete vezes
 * com valores diferentes em cada cópia:
 *
 *   A) pílula com fundo roxo sólido    → `.page-shell__tab`
 *   B) transparente com sublinhado roxo → `.company-topbar__link`, `.company-section-header__subtab`
 *   C) pílula contornada com tinta roxa → inline em Dashboard, Calendário, Apuração V2, Notas
 *      Fiscais e Consultas — com raio 6/8/20/999, fonte 0.7/0.82/0.85/0.9rem e padding
 *      3px/5px/6px/7px, cada tela com a sua combinação.
 *
 * Ficou a linguagem B, que é a do header da empresa — a barra que o contador vê em toda tela de
 * empresa. A ATIVA é o texto cheio com sublinhado roxo; a inativa é `--tab-ink`. É o contraste
 * entre as duas que diz o que está selecionado, então nenhuma das duas pode virar cor de estado:
 * aba não é pendência nem conclusão.
 *
 * Props:
 *  - `items`: `[{ key, label, disabled?, title?, badge?, href? }]`
 *  - `pill`: envolve as abas numa faixa arredondada. Desligue quando a barra já mora dentro de um
 *    container próprio (é o caso do nível 1 do header da empresa, dentro do topbar).
 *  - `size`: `lg` (nível 1 da empresa) · `md` (padrão) · `sm` (barra densa — as visões do Calendário
 *    e as sub-abas de Relatórios).
 *  - `mode`: `nav` marca `aria-current="page"` (navegação — a aba muda de tela/rota); `view` marca
 *    `aria-pressed` (seletor de visão — o conteúdo é o mesmo, muda o recorte). Confundir os dois
 *    faz o leitor de tela anunciar "página atual" para um botão que não navegou para lugar nenhum.
 *
 * ── `item.href`: A ABA VIRA UM LINK DE VERDADE (dono, 19/08/2026) ─────────────────────────────
 *
 * > *"ao apertar control + uma das abas, abrir em uma nova guia do navegador aquela aba que
 * > clicamos."*
 *
 * ⚠ A TECLA NÃO É INTERCEPTADA, e isso é a decisão. Um `onClick` que olhasse `event.ctrlKey` para
 * chamar `window.open` resolveria o caso pedido e quebraria outros cinco que ninguém pediria de
 * novo: o clique do MEIO, o "abrir em nova aba" do BOTÃO DIREITO, o Cmd no Mac, a URL aparecendo
 * ao PASSAR O MOUSE e o "copiar endereço do link". Com um `<a href>` de verdade o navegador faz
 * todas elas de graça, e não se escreve nenhuma.
 *
 * O clique NORMAL continua sendo SPA: `preventDefault()` + a navegação que já existia. Ctrl, Cmd,
 * Shift, Alt e qualquer botão que não seja o esquerdo passam SEM `preventDefault` — é aí que o
 * navegador assume.
 *
 * ⚠ NEM TODA ABA TEM URL, E ESSAS CONTINUAM `<button>`. As abas de VISÃO (`mode="view"`: os
 * regimes do dashboard, as visões do calendário, o recorte de período dos relatórios) trocam o
 * que a tela mostra sem navegar — não existe URL para elas. Dar `href` ali criaria um endereço
 * que não existe, e o Ctrl+clique abriria uma guia quebrada. Por isso o `href` só é honrado com
 * `mode === "nav"`; em `view` ele é IGNORADO, mesmo que alguém o passe.
 *
 * ⚠ Aba DESABILITADA também continua `<button>`: `<a>` não tem `disabled`, e um link cinza
 * continuaria navegando no Ctrl+clique — exatamente o que o `disabled` existe para impedir.
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
        const classe = `app-tab${isActive ? " is-active" : ""}`;
        const conteudo = (
          <>
            {item.label}
            {item.badge ? <span className="app-tab__badge">{item.badge}</span> : null}
          </>
        );

        // A aba só vira link quando ELA TEM URL e a barra é de navegação. Ver o cabeçalho.
        const href = mode === "nav" && !item.disabled ? String(item.href || "") : "";
        if (href) {
          return (
            <a
              key={item.key}
              href={href}
              className={classe}
              onClick={(event) => {
                // ⚠ SEM `preventDefault` AQUI: Ctrl/Cmd (nova guia), Shift (nova janela), Alt
                // (baixar) e qualquer botão que não seja o esquerdo são do NAVEGADOR. Interceptar
                // é o que o `<a href>` existe para não precisar fazer.
                if (event.defaultPrevented) return;
                if (event.button !== 0) return;
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                // Clique normal: a navegação continua sendo a do app (SPA), sem recarregar a
                // página. ⚠ O `preventDefault` vale TAMBÉM para a aba ativa — sem ele, clicar na
                // aba já aberta seguiria o link e recarregaria a tela inteira, que é pior que o
                // "clique repetido não é ação" que este componente já garantia.
                event.preventDefault();
                if (!isActive) onChange?.(item.key);
              }}
              aria-current={isActive ? "page" : undefined}
              title={item.title}
            >
              {conteudo}
            </a>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            className={classe}
            /* Clicar na aba ativa não é ação: sem isto, cada clique repetido reexecuta o handler
               (recarga, refetch) numa tela que já está aberta. Era o comportamento do header da
               empresa e virou o padrão. */
            onClick={isActive || item.disabled ? undefined : () => onChange?.(item.key)}
            disabled={item.disabled}
            aria-current={mode === "nav" && isActive ? "page" : undefined}
            aria-pressed={mode === "view" ? isActive : undefined}
            title={item.title}
          >
            {conteudo}
          </button>
        );
      })}
    </Wrapper>
  );
}

export default Tabs;
