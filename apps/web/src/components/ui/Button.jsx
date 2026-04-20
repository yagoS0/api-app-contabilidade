const VALID_VARIANTS = new Set(["primary", "secondary", "danger", "success"]);
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
