export function Feedback({ message, error }) {
  return (
    <>
      {message ? <p className="feedback success-text">{message}</p> : null}
      {error ? <p className="feedback error">{error}</p> : null}
    </>
  );
}

