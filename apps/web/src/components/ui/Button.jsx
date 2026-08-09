// ⚠ ESTE É O ÚNICO BOTÃO DO APP. Não crie um irmão — estenda aqui.
//
// `success` SAIU da lista de variantes de propósito, e o fallback silencioso para `primary` é a
// trava: **verde significa CONCLUÍDO** no vocabulário do app (`apps/web/CLAUDE.md`) — o rodapé
// `D = C ✓ ok`, a guia paga, a obrigação entregue. Um botão verde de "faça isto" ensina o contrário
// exatamente nas telas onde o verde precisa ser lido como "está fechado". Ação primária é o accent.
// Quem escrever `variant="success"` de novo recebe o botão de ação primária, não um verde novo.
const VALID_VARIANTS = new Set(["primary", "secondary", "danger"]);
const VALID_SIZES = new Set(["sm", "md", "lg"]);

function buildClassName({ variant = "primary", size = "md", className = "" }) {
  const safeVariant = VALID_VARIANTS.has(variant) ? variant : "primary";
  const safeSize = VALID_SIZES.has(size) ? size : "md";
  const classes = ["btn", `btn-${safeVariant}`, `btn-${safeSize}`];
  if (className) classes.push(className);
  return classes.join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}) {
  return (
    <button className={buildClassName({ variant, size, className })} {...props}>
      {children}
    </button>
  );
}

export default Button;
