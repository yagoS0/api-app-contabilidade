function buildClassName({ variant = "primary", size = "md", className = "" }) {
  const classes = ["btn", `btn-${variant}`, `btn-${size}`];
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

