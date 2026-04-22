export function AppShell({ children, className = "" }) {
  const classes = ["layout", className].filter(Boolean).join(" ");
  return <main className={classes}>{children}</main>;
}
