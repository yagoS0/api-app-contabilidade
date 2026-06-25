// Q27.A — Política única de senha forte (acesso). Usada em TODA criação/alteração de senha:
// signup, ownerPassword da empresa, cliente legado. Regra: mín. 8 + maiúscula + minúscula + número
// + caractere especial. Espelhada no front em apps/web/src/lib/schemas/passwordPolicy.js — manter sync.
import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;

// Cada regra com a mensagem do que falta (pra UI/erro listar).
const RULES = [
  { test: (s) => s.length >= PASSWORD_MIN_LENGTH, msg: `pelo menos ${PASSWORD_MIN_LENGTH} caracteres` },
  { test: (s) => /[a-z]/.test(s), msg: "uma letra minúscula" },
  { test: (s) => /[A-Z]/.test(s), msg: "uma letra maiúscula" },
  { test: (s) => /[0-9]/.test(s), msg: "um número" },
  { test: (s) => /[^A-Za-z0-9]/.test(s), msg: "um caractere especial" },
];

/** Valida a senha contra a política. @returns {{ ok: boolean, errors: string[] }} */
export function validateStrongPassword(password) {
  const s = String(password || "");
  const errors = RULES.filter((r) => !r.test(s)).map((r) => r.msg);
  return { ok: errors.length === 0, errors };
}

/** Mensagem única amigável ("A senha precisa ter: …"). */
export function strongPasswordMessage(errors) {
  return `A senha precisa ter: ${errors.join(", ")}.`;
}

// Zod schema reutilizável (usado nos schemas de empresa/cliente).
export const strongPasswordSchema = z.string().superRefine((val, ctx) => {
  const { ok, errors } = validateStrongPassword(val);
  if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: strongPasswordMessage(errors) });
});
