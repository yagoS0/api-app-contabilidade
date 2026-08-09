// Schemas do onboarding — FINOS DE PROPÓSITO.
//
// A regra dura da empresa (CNPJ válido, razão social, regime dos três aceitos, CNAE, endereço
// completo, senha forte do dono) já existe e já roda: `companyCreateSchema` +
// `validateAndNormalizeCompanyProfile`, chamados por `provisionarEmpresa` na CONVERSÃO. Repeti-la
// aqui seria escrever a segunda definição de "empresa válida" — e ela divergiria justamente na
// borda, deixando passar no funil o que a conversão recusa (ou, pior, o contrário: recusando no
// rascunho um dado que ainda nem precisa existir).
//
// O funil ACEITA PREENCHIMENTO PARCIAL. É a razão de ele existir. Então aqui só se valida a forma
// do envelope: origem conhecida, `dados` é objeto, flags são booleanas.

import { z } from "zod";

export const ORIGENS = ["ABERTURA", "TRANSFERENCIA", "INATIVA"];

export const onboardingCreateSchema = z.object({
  origem: z.enum(ORIGENS),
});

export const onboardingPatchSchema = z.object({
  origem: z.enum(ORIGENS).optional(),
  // `z.record(z.unknown())` e não um shape: a forma de `dados` é a spec do front
  // (`onboardingSpec.js`), e duplicá-la aqui criaria duas definições do formulário. O servidor
  // guarda o rascunho; quem sabe o que cada origem pergunta é a spec.
  dados: z.record(z.string(), z.unknown()).optional(),
  // ⚠ `.or(z.literal(""))` não é enfeite: campo em branco chega como `""` do formulário, e `""` é
  // uma string — `.optional()` e `.nullable()` não pegam. É o mesmo tropeço já documentado em
  // `companySchemas.js`, onde ele rejeitava a atualização INTEIRA de toda empresa.
  ultimoPasso: z.string().max(60).or(z.literal("")).optional().nullable(),
  finalizar: z.boolean().optional(),
}).strict();

export const onboardingEtapaPatchSchema = z.object({
  concluida: z.boolean().optional(),
  observacao: z.string().max(2000).or(z.literal("")).optional().nullable(),
}).strict();

export const onboardingDesistirSchema = z.object({
  motivo: z.string().max(500).or(z.literal("")).optional().nullable(),
}).strict();
