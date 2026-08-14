// Q11.2: schema Zod do formulário de empresa.
//
// MIRROR de apps/api/src/application/validators/companySchemas.js — mantenha SINCRONIZADO.
// Validação em tempo real no frontend (mensagens inline) + segunda barreira no backend.
//
// Decisões da Q8.A.4 / Q11.2:
// - Senha mínima 8 chars (sem letra/número obrigatórios — fricção sem ganho real)
// - CNPJ: aceita formatado (XX.XXX.XXX/XXXX-XX) ou só dígitos; valida 14 dígitos
// - Campos da empresa opcionais no Zod (validação rigorosa fica em validateAndNormalizeCompanyProfile no backend)

import { z } from "zod";
import { strongPasswordSchema } from "./passwordPolicy.js";

const cnpjOnlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const isValidCnpj = (v) => cnpjOnlyDigits(v).length === 14;

// Schema pra modo CRIAÇÃO (POST /firm/companies)
export const companyCreateFormSchema = z.object({
  ownerName: z
    .string()
    .max(120, "Nome muito longo (máx 120 chars)")
    .optional()
    .or(z.literal("")),
  ownerEmail: z
    .string()
    .min(1, "E-mail é obrigatório")
    .email("E-mail inválido (formato: exemplo@dominio.com)"),
  ownerPassword: strongPasswordSchema, // Q27.A: 8 + minúscula + maiúscula + número + especial
  cnpj: z
    .string()
    .min(1, "CNPJ é obrigatório")
    .refine(isValidCnpj, "CNPJ deve ter 14 dígitos"),
  razaoSocial: z
    .string()
    .min(1, "Razão social é obrigatória")
    .max(200, "Razão social muito longa"),
  nomeFantasia: z.string().max(200).optional().or(z.literal("")),
  guideNotificationEmail: z
    .string()
    .email("E-mail inválido")
    .or(z.literal(""))
    .optional(),
  telefone: z.string().max(40).optional().or(z.literal("")),
  regimeTributario: z.string().optional().or(z.literal("")),
  cnaePrincipal: z.string().max(20).optional().or(z.literal("")),
  // Município emissor da NFS-e. Vazio é legítimo (a empresa apenas não emite), 7 dígitos é o valor
  // — e não há terceira forma: o campo é preenchido por ESCOLHA na lista do IBGE, não digitado.
  codigoMunicipioIbge: z
    .string()
    .regex(/^\d{7}$/, "Escolha o município na lista — o código do IBGE tem 7 dígitos")
    .or(z.literal(""))
    .optional(),
  enderecoRua: z.string().max(200).optional().or(z.literal("")),
  enderecoNumero: z.string().max(20).optional().or(z.literal("")),
  enderecoBairro: z.string().max(120).optional().or(z.literal("")),
  enderecoCidade: z.string().max(120).optional().or(z.literal("")),
  enderecoUf: z.string().max(2).optional().or(z.literal("")),
  enderecoCep: z.string().max(20).optional().or(z.literal("")),
  enderecoComplemento: z.string().max(200).optional().or(z.literal("")),
  hasProlabore: z.boolean().optional(),
  temFolha: z.boolean().optional(),
  empresaZerada: z.boolean().optional(),
});

// Schema pra modo EDIÇÃO (PATCH) — senha opcional, CNPJ imutável (não revalida)
export const companyUpdateFormSchema = companyCreateFormSchema.partial().extend({
  // Em edição, senha é opcional; se vier, precisa ser forte (ou string vazia = não altera).
  ownerPassword: strongPasswordSchema.or(z.literal("")).optional(),
});
