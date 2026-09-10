export function Feedback({ message, error }) {
  const neutra = message?.tom === "pendente";
  const texto = typeof message === "object" ? message?.texto : message;
  return (
    <div className="feedback-stack" aria-live="polite" aria-relevant="additions text">
      {message ? (
        <p className={neutra ? "feedback" : "feedback success-text"} style={neutra ? { color: "var(--text-muted)" } : undefined} role="status">
          {texto}
        </p>
      ) : null}
      {error ? (
        <p className="feedback error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
