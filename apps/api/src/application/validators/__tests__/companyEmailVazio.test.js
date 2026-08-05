// CAMPO DE E-MAIL EM BRANCO NÃO PODE DERRUBAR A EDIÇÃO INTEIRA.
//
// O formulário monta o payload com `String(input.ownerEmail || "")`, então campo vazio chega como
// `""`. E `""` É uma string: `.optional()` e `.nullable()` não o interceptam, ele cai direto em
// `.email()` e reprova. Resultado em produção: `validation_failed` ao salvar QUALQUER empresa,
// mesmo sem ninguém ter tocado no e-mail do dono.
//
// O `guideNotificationEmail` já tinha `.or(z.literal(""))` — o mesmo tropeço, remendado só naquele
// campo. Este teste trava a regra para os dois, e para quem for adicionar o terceiro.

import { companyCreateSchema, companyUpdateSchema, validateCompanyInput } from "../companySchemas.js";

describe("edição: campo de e-mail em branco significa 'não mexer'", () => {
  it("ownerEmail vazio NÃO reprova a atualização", () => {
    const r = validateCompanyInput(companyUpdateSchema, { ownerEmail: "", razaoSocial: "ACME LTDA" });
    expect(r.ok).toBe(true);
  });

  it("guideNotificationEmail vazio também passa", () => {
    expect(validateCompanyInput(companyUpdateSchema, { guideNotificationEmail: "" }).ok).toBe(true);
  });

  it("ausente passa (é o significado de 'não mexer')", () => {
    expect(validateCompanyInput(companyUpdateSchema, { razaoSocial: "ACME LTDA" }).ok).toBe(true);
  });

  it("e-mail REALMENTE inválido continua reprovando — a guarda não foi afrouxada", () => {
    const r = validateCompanyInput(companyUpdateSchema, { ownerEmail: "nao-e-email" });
    expect(r.ok).toBe(false);
    expect(r.body.error).toBe("validation_failed");
  });
});

describe("criação: o e-mail do dono é obrigatório", () => {
  it("sem ownerEmail reprova — e diz qual campo", () => {
    const r = validateCompanyInput(companyCreateSchema, { razaoSocial: "ACME LTDA" });
    expect(r.ok).toBe(false);
    expect(r.body.issues.some((i) => i.path === "ownerEmail")).toBe(true);
  });

  it("a resposta carrega o CAMPO e o MOTIVO, não só o código", () => {
    // É o que a tela precisa para dizer o que corrigir. Enquanto ela mostrava só
    // "validation_failed", o detalhe existia na resposta e ia para o lixo.
    const r = validateCompanyInput(companyCreateSchema, { ownerEmail: "xxx" });
    expect(r.body.issues[0]).toEqual(expect.objectContaining({ path: "ownerEmail", message: expect.any(String) }));
  });
});
