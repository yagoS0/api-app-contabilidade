// Q8.A.4: schemas Zod para validação rigorosa de input em POST/PATCH /firm/companies.
// Complementa `validateAndNormalizeCompanyProfile` (mantida) — Zod roda PRIMEIRO,
// se passar, a normalização legada cuida das transformações.

import { z } from "zod";
import { strongPasswordSchema } from "./passwordPolicy.js";

const cnpjRegex = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;
const cnpjDigitsOnly = z.string().transform((s) => String(s || "").replace(/\D+/g, ""));

// Q27.A: senha de acesso forte (8 + maiúscula + minúscula + número + especial) — política única.
const senhaForte = strongPasswordSchema;

const enderecoSchema = z.object({
  rua: z.string().max(200).optional().nullable(),
  numero: z.string().max(20).optional().nullable(),
  bairro: z.string().max(120).optional().nullable(),
  cidade: z.string().max(120).optional().nullable(),
  uf: z.string().length(2).optional().nullable(),
  cep: z.string().max(20).optional().nullable(),
  complemento: z.string().max(200).optional().nullable(),
}).partial().optional();

const companyBaseFields = {
  razaoSocial: z.string().min(1, "razão social obrigatória").max(200),
  nomeFantasia: z.string().max(200).optional().nullable(),
  cnpj: z.string().regex(cnpjRegex, "CNPJ em formato inválido"),
  email: z.string().email().optional().nullable(),
  telefone: z.string().max(40).optional().nullable(),
  inscricaoMunicipal: z.string().max(60).optional().nullable(),
  cnaePrincipal: z.string().max(20).optional().nullable(),
  cnaesSecundarios: z.array(z.string().max(20)).max(50).optional(),
  regimeTributario: z.enum(["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI", "OUTRO"]).optional().nullable(),
  endereco: enderecoSchema,
  guideNotificationEmail: z.string().email().or(z.literal("")).optional().nullable(),
  hasProlabore: z.boolean().optional(),
  temFolha: z.boolean().optional(),
  empresaZerada: z.boolean().optional(),
};

// POST /firm/companies — cria empresa + owner (cliente).
// Aceita 2 formatos de payload (legado): aninhado { company: {...} } OU achatado.
// Validação rigorosa fica downstream em validateAndNormalizeCompanyProfile — aqui só
// confirma tipos básicos e formato de email/senha. Campos da empresa são opcionais
// no nível Zod (resolvedos no handler que sabe qual caminho usar).
const companyBaseFieldsOptional = Object.fromEntries(
  Object.entries(companyBaseFields).map(([k, v]) => [k, v.optional()])
);

export const companyCreateSchema = z.object({
  ownerEmail: z.string().email("ownerEmail inválido"),
  ownerName: z.string().max(120).optional().nullable(),
  ownerPassword: senhaForte.optional(), // só obrigatório se owner ainda não existe
  company: z.object(companyBaseFieldsOptional).optional(),
  ...companyBaseFieldsOptional, // permite payload "achatado" (legacy)
}).passthrough();

// PATCH /firm/companies/:companyId — atualiza empresa (CNPJ é ignorado downstream — imutável)
export const companyUpdateSchema = z.object({
  // ⚠ `""` PRECISA PASSAR. O formulário manda string vazia quando o campo está em branco
  // (`buildCompanyPayload` faz `String(input.ownerEmail || "")`), e `""` é uma string — então
  // `.optional()` e `.nullable()` não pegam: o valor chega em `.email()` e a atualização INTEIRA
  // era rejeitada com `validation_failed`, em toda empresa, mesmo sem ninguém tocar no e-mail.
  //
  // O `guideNotificationEmail` logo acima já tinha `.or(z.literal(""))` — alguém tropeçou nisso lá
  // e remendou só naquele campo. Aqui vale a mesma regra: campo em branco na EDIÇÃO significa "não
  // mexer", não "e-mail inválido".
  ownerEmail: z.string().email().or(z.literal("")).optional().nullable(),
  company: z.object({
    ...companyBaseFields,
    cnpj: z.string().optional(), // pode vir mas é ignorado (CNPJ imutável)
  }).partial().optional(),
  ...Object.fromEntries(Object.entries(companyBaseFields).map(([k, v]) => [k, v.optional()])),
  hasProlabore: z.boolean().optional(),
}).passthrough();

/**
 * Wrapper que valida com Zod e retorna { ok: true, data } ou { ok: false, status: 400, body }
 * pronto para o handler usar.
 */
export function validateCompanyInput(schema, body) {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));
  return {
    ok: false,
    status: 400,
    body: { ok: false, error: "validation_failed", issues },
  };
}
