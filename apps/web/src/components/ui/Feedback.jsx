export function Feedback({ message, error }) {
  return (
    <div className="feedback-stack" aria-live="polite" aria-relevant="additions text">
      {message ? (
        <p className="feedback success-text" role="status">
          {message}
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
