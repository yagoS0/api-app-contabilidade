export const TONS = {
  ok: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  atencao: { cor: "var(--state-warn)", fundo: "var(--state-warn-surface)" },
  erro: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
  neutro: { cor: "var(--text-muted)", fundo: "var(--state-neutral-surface)" },
};

export const TONS_VALIDOS = Object.freeze(Object.keys(TONS));

export function tomDoAviso(tom) {
  return Object.prototype.hasOwnProperty.call(TONS, tom) ? tom : "neutro";
}

