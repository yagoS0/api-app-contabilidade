import { emailValido } from "@contabilidade/shared/email";
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
  // ⚠⚠ O `.or(z.literal(""))` E O "TERCEIRO CAMPO" que `companyEmailVazio.test.js:8-9` antecipa:
  //   *"o guideNotificationEmail ja tinha .or(z.literal("")) — o mesmo tropeço, remendado só
  //   naquele campo. Este teste trava a regra para os dois, e para quem for adicionar o terceiro."*
  //   Sem ele, string vazia reprova o PATCH INTEIRO com `validation_failed`. Hoje escapa só
  //   porque `realApi` manda `null`; passa a existir campo na tela, e o vazio vira caminho normal.
  // ⚠ `.refine(emailValido)`, nao `.email()`: o Zod v4 restringe o alfabeto e RECUSA `joao@…` com
  //   acento, que o servidor sempre aceitou. Uma regra so — a do servidor.
  email: z.string().refine((v) => v === "" || emailValido(v), "E-mail da empresa inválido").or(z.literal("")).optional().nullable(),
  telefone: z.string().max(40).optional().nullable(),
  inscricaoMunicipal: z.string().max(60).optional().nullable(),
  // Código IBGE do município emissor da NFS-e. O Zod só confere a FORMA (string curta); quem diz
  // "7 dígitos ou nada" é `validateAndNormalizeCompanyProfile`, num lugar só, junto do motivo.
  // ⚠ Precisa estar declarado aqui mesmo assim: `company` é um `z.object` sem `passthrough`, e
  // chave não declarada é removida do `parsed.data` sem erro nenhum.
  codigoMunicipioIbge: z.string().max(20).optional().nullable(),
  // Configuração da emissão de NFS-e (`cTribNac`, `cTribMun` e a série da DPS). Mesmo motivo do
  // campo acima: `company` é um `z.object` SEM `passthrough`, e chave não declarada some do
  // `parsed.data` sem erro nenhum. Quem diz a forma de cada uma é
  // `validateAndNormalizeCompanyProfile`, num lugar só, junto do motivo da recusa.
  codigoServicoNacional: z.string().max(20).optional().nullable(),
  // ⚠ A LISTA DE CÓDIGOS DE SERVIÇO (decisão do dono, 16/08/2026). `optional()` SEM `nullable()`
  // e sem default: `undefined` significa "não veio no payload, não mexer", e `[]` significa
  // "apague a lista". São intenções diferentes, e um default aqui achataria as duas — toda tela
  // que salva a empresa sem enviar o campo apagaria o cadastro de serviços.
  // O limite de 50 espelha `cnaesSecundarios`; a forma de cada item (6 dígitos) é dita em
  // `validateAndNormalizeCompanyProfile`, num lugar só, junto do motivo da recusa.
  codigosServicoNacional: z.array(z.string().max(20)).max(50).optional(),
  codigoServicoMunicipal: z.string().max(20).optional().nullable(),
  rpsSerie: z.string().max(20).optional().nullable(),
  // ── CARGA TRIBUTÁRIA APROXIMADA da empresa NÃO OPTANTE (Lei 12.741/2012) ──────────────────
  // Mesmo motivo dos campos acima: sem declaração o `z.object` (sem `passthrough`) apaga a chave
  // do `parsed.data` em silêncio e o valor nunca chega ao `update`.
  //
  // ⚠ `union([string, number])` porque o formulário manda TEXTO ("11,33") e o mock/integração
  // mandam número. Quem diz "percentual de 0 a 100, com vírgula ou ponto" é
  // `validateAndNormalizeCompanyProfile`, num lugar só, junto do motivo da recusa — e é lá que
  // `""` (apagar) e `undefined` (não mexer) continuam sendo coisas diferentes.
  pTotTribFed: z.union([z.string().max(20), z.number()]).optional().nullable(),
  pTotTribEst: z.union([z.string().max(20), z.number()]).optional().nullable(),
  pTotTribMun: z.union([z.string().max(20), z.number()]).optional().nullable(),
  // ── BENEFÍCIO MUNICIPAL DO ISSQN (grupo `BM` da DPS) — dono, 20/08/2026 ───────────────────
  // ⚠ MESMO MOTIVO DE TODOS OS DE CIMA: sem declaração aqui o `z.object` (sem `passthrough`) tira
  // a chave do `parsed.data` EM SILÊNCIO — 200 na resposta, campo vazio na recarga.
  // A forma (`[0-9]{14}`), os três tipos e a faixa do percentual são conferidos em
  // `normalizeCamposEmissaoNfse`, junto do motivo de cada recusa; aqui é só a porta.
  beneficioMunicipalNumero: z.string().max(20).optional().nullable(),
  beneficioMunicipalTipoReducao: z.string().max(20).optional().nullable(),
  beneficioMunicipalPRedBC: z.union([z.string().max(20), z.number()]).optional().nullable(),
  cnaePrincipal: z.string().max(20).optional().nullable(),
  cnaesSecundarios: z.array(z.string().max(20)).max(50).optional(),
  regimeTributario: z.enum(["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI", "OUTRO"]).optional().nullable(),
  endereco: enderecoSchema,
  guideNotificationEmail: z.string().refine((v) => v === "" || emailValido(v), "E-mail para guias inválido").or(z.literal("")).optional().nullable(),
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
  ownerEmail: z.string().refine(emailValido, "E-mail do responsável inválido"),
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
  ownerEmail: z.string().refine((v) => v === "" || emailValido(v), "E-mail do responsável inválido").or(z.literal("")).optional().nullable(),
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
