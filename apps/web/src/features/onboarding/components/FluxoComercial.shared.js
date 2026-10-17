

export const campoComercial = {
  width: "100%",
  padding: 8,
  marginBlock: 5,
  background: "var(--bg-subtle)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 5
};

export const reais = c => c == null ? "A confirmar" : (c / 100).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL"
});
