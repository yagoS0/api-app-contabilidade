// Q27.A: política de senha forte (frontend). MIRROR de
// apps/api/src/application/validators/passwordPolicy.js — manter SINCRONIZADO.
// Regra: mín. 8 + minúscula + maiúscula + número + caractere especial.
import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_RULES = [
  { key: "len", label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`, test: (s) => s.length >= PASSWORD_MIN_LENGTH },
  { key: "lower", label: "Uma letra minúscula", test: (s) => /[a-z]/.test(s) },
  { key: "upper", label: "Uma letra maiúscula", test: (s) => /[A-Z]/.test(s) },
  { key: "digit", label: "Um número", test: (s) => /[0-9]/.test(s) },
  { key: "special", label: "Um caractere especial", test: (s) => /[^A-Za-z0-9]/.test(s) },
];

/** Retorna a lista de regras com { ...rule, ok } para montar um checklist na UI. */
export function passwordChecklist(password) {
  const s = String(password || "");
  return PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, ok: r.test(s) }));
}

export function isStrongPassword(password) {
  const s = String(password || "");
  return PASSWORD_RULES.every((r) => r.test(s));
}

// Zod: senha forte com mensagem listando o que falta.
export const strongPasswordSchema = z.string().superRefine((val, ctx) => {
  const faltam = PASSWORD_RULES.filter((r) => !r.test(String(val || ""))).map((r) => r.label.toLowerCase());
  if (faltam.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A senha precisa de: ${faltam.join(", ")}.` });
  }
});
