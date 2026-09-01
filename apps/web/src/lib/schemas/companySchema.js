import { emailValido } from "@contabilidade/shared/email";
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
    .refine(emailValido, "E-mail inválido (formato: exemplo@dominio.com)"),
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
    .refine(emailValido, "E-mail inválido")
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
  // ── Configuração da emissão de NFS-e ──────────────────────────────────────────────────────
  // ⚠ Só FORMA, e só a forma que uma fonte já versionada no projeto prova. Nenhum destes três é
  // conferido quanto ao CONTEÚDO: a lista de serviços da LC 116 e a do município não estão neste
  // repositório, e validar contra uma lista inventada seria pior que não validar. A regra completa
  // (com as fontes) vive em `lib/nfse/cadastroEmissaoNfse.js`.
  // Vazio é legítimo nos três: a empresa apenas não emite, e a tela diz isso.
  codigoServicoNacional: z
    .string()
    // `docs/nfse-preenchimento.md` §5: "cTribNac: código nacional (6 dígitos numéricos)".
    .regex(/^\d{6}$/, "O código nacional do serviço tem 6 dígitos (ex.: 171201)")
    .or(z.literal(""))
    .optional(),
  // ⚠ A LISTA de códigos de serviço (decisão do dono, 16/08/2026): a empresa pode prestar mais de
  // uma atividade. Cada item tem 6 dígitos, e vem de ESCOLHA na lista oficial versionada
  // (`docs/lista-servico-nacional/`) — o formulário não deixa digitar. Lista vazia é legítima: a
  // empresa apenas não emite, e a tela diz isso.
  codigosServicoNacional: z
    .array(z.string().regex(/^\d{6}$/, "Cada código de serviço tem 6 dígitos"))
    .max(50)
    .optional(),
  codigoServicoMunicipal: z
    .string()
    // ⚠ Sem comprimento fixo de propósito: a fonte prova que o XML leva os ÚLTIMOS 3 dígitos, não
    // que o código publicado pelo município tenha 3. Exigir 3 recusaria código legítimo mais longo.
    .regex(/^\d+$/, "O código municipal do serviço é numérico — informe só os dígitos")
    .or(z.literal(""))
    .optional(),
  rpsSerie: z
    .string()
    // RN E0010: faixa 1–49999 (emissor por aplicativo próprio). Espelha `nfseNumeracao.js`.
    .regex(/^\d+$/, "A série da DPS é numérica (RN E0010)")
    .refine((v) => Number(v) >= 1 && Number(v) <= 49999, "A série da DPS vai de 1 a 49999 (RN E0010)")
    .or(z.literal(""))
    .optional(),
  // ── Carga tributária aproximada da empresa NÃO optante (Lei 12.741/2012) ──────────────────
  // ⚠ Percentual de 0 a 100, com até duas casas, vírgula OU ponto. Não há separador de milhar
  // num percentual, então os dois só podem ser o decimal — é por isso que a regra é própria e
  // não reusa o normalizador de moeda. Espelha `validateAndNormalizeCompanyProfile` (backend) e
  // `lerPercentualCarga` (`lib/nfse/cadastroEmissaoNfse.js`).
  // Vazio é legítimo: a empresa apenas não emite como não optante, e a tela diz isso.
  ...Object.fromEntries(
    ["pTotTribFed", "pTotTribEst", "pTotTribMun"].map((campo) => [
      campo,
      z
        .string()
        .regex(/^\d{1,3}([.,]\d{1,2})?$/, "Informe um percentual entre 0 e 100 (ex.: 11,33)")
        .refine(
          (v) => Number(String(v).replace(",", ".")) <= 100,
          "Informe um percentual entre 0 e 100 (ex.: 11,33)"
        )
        .or(z.literal(""))
        .optional(),
    ])
  ),
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
  // ⚠⚠ NA EDIÇÃO, E-MAIL DO RESPONSÁVEL EM BRANCO SIGNIFICA "NÃO MEXER" — é o contrato de
  //   `omitIfEmpty` (`realApi.js`), travado no backend por `companyEmailVazio.test.js`
  //   ("ownerEmail vazio NÃO reprova a atualização").
  //   ⚠ O `.partial()` NÃO bastava: ele só admite `undefined`, e o formulário guarda `""`
  //   (`useManageCompanyForm`), que É string — então o `.min(1, "E-mail é obrigatório")` do
  //   schema de criação continuava reprovando, e o "Salvar alterações" parecia não fazer nada.
  ownerEmail: z.string().refine(emailValido, "E-mail inválido (formato: exemplo@dominio.com)").or(z.literal("")).optional(),
});
