// Zod DERIVADO da spec — zero regra duplicada.
//
// `obrigatorio` está escrito UMA vez, no descritor. Aqui só se lê. Um schema escrito à mão ao lado
// da spec seria a segunda definição de "campo obrigatório", e as duas divergiriam na primeira
// condição nova (é o que já aconteceu com `guideNotificationEmail` em `companySchemas.js`, onde o
// remendo foi aplicado num campo só).

import { z } from "zod";
import { camposDoPasso, camposDaOrigem, ehObrigatorio } from "./onboardingSpec";

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

function baseDoTipo(descritor) {
  switch (descritor.tipo) {
    case "email":
      return z.string().email("e-mail inválido");
    case "cnpj":
      return z.string().refine((v) => soDigitos(v).length === 14, "CNPJ precisa ter 14 dígitos");
    case "cpf":
      return z.string().refine((v) => soDigitos(v).length === 11, "CPF precisa ter 11 dígitos");
    case "telefone":
      return z.string().refine((v) => soDigitos(v).length >= 10, "telefone incompleto");
    case "inteiro":
      return z.string().refine((v) => /^\d+$/.test(String(v).trim()), "informe um número inteiro");
    case "moeda":
      return z.string().refine(
        (v) => /^-?\d+([.,]\d{1,2})?$/.test(String(v).trim().replace(/\./g, "").replace(/\s/g, "")),
        "informe um valor"
      );
    case "mesAno":
      return z.string().regex(/^\d{4}-\d{2}$/, "use o formato AAAA-MM");
    case "booleano":
      return z.boolean();
    case "escolha": {
      const valores = (descritor.opcoes || []).map((o) => o.valor);
      return valores.length ? z.enum(valores) : z.string();
    }
    case "lista":
      return z.array(z.record(z.string(), z.unknown()));
    case "texto":
    default:
      return z.string().max(2000);
  }
}

/**
 * ⚠ O "obrigatório" tem de RECUSAR o vazio, e o vazio de cada tipo é diferente.
 * `z.string()` aceita `""` alegremente — sem esta camada, um campo marcado obrigatório passava em
 * branco e o wizard deixava avançar com a ficha vazia, que é o oposto do que o descritor pediu.
 * Já `escolha` (z.enum) e `booleano` (z.boolean) recusam `""`/`null` sozinhos.
 */
function exigirPreenchido(base, descritor) {
  if (descritor.tipo === "lista") return base.min(1, "informe ao menos um item");
  if (descritor.tipo === "booleano" || descritor.tipo === "escolha") return base;
  return base.refine((v) => String(v ?? "").trim() !== "", "campo obrigatório");
}

/**
 * @param {string} origem
 * @param {object} dados   o rascunho INTEIRO — `obrigatorio` depende dele, então os dois argumentos
 *                         são obrigatórios de verdade, não conveniência.
 * @param {object} [opts]
 * @param {string} [opts.passo] restringe ao passo (validação por tela do wizard)
 */
export function buildZodFromSpec(origem, dados, { passo } = {}) {
  const descritores = passo
    ? camposDoPasso(origem, passo, dados)
    : camposDaOrigem(origem);

  const shape = {};
  for (const descritor of descritores) {
    const base = baseDoTipo(descritor);
    if (ehObrigatorio(descritor, dados)) {
      shape[descritor.campo] = exigirPreenchido(base, descritor);
      continue;
    }
    // ⚠ `.or(z.literal(""))` NÃO É OPCIONAL. Campo em branco chega como `""` do input, e `""` é
    // uma string: `.optional()` sozinho não pega, o valor cai na validação de formato e DERRUBA O
    // SCHEMA INTEIRO. É o mesmo tropeço já documentado em `companySchemas.js`, onde ele rejeitava
    // a atualização de toda empresa por causa de um `ownerEmail` vazio.
    //
    // Booleano e lista ficam de fora do `.or("")`: `""` não é um valor possível deles, e admiti-lo
    // deixaria passar um checkbox em estado de string.
    shape[descritor.campo] =
      descritor.tipo === "booleano" || descritor.tipo === "lista"
        ? base.optional().nullable()
        : base.optional().nullable().or(z.literal(""));
  }

  // ⚠ `.partial()` NÃO entra aqui: os obrigatórios precisam continuar obrigatórios. E o objeto é
  // permissivo com chaves extras (`passthrough`) porque o rascunho pode carregar resíduo que a
  // poda ainda vai remover — recusar aqui transformaria "campo que sobrou" em erro de formulário.
  return z.object(shape).passthrough();
}

/**
 * Valida um passo e devolve `{ ok, erros }` com `erros` no formato `{ campo: mensagem }` — que é o
 * que o input precisa para mostrar a mensagem embaixo dele.
 */
export function validarPasso(origem, dados, passo) {
  const schema = buildZodFromSpec(origem, dados, { passo });
  const parsed = schema.safeParse(dados || {});
  if (parsed.success) return { ok: true, erros: {} };
  const erros = {};
  for (const issue of parsed.error.issues) {
    const campo = issue.path?.[0];
    if (campo && !erros[campo]) erros[campo] = issue.message;
  }
  return { ok: false, erros };
}
