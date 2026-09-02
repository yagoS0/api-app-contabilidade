// ⚠⚠ UMA REGRA DE E-MAIL, NÃO TRÊS — decisão do dono, 30/08/2026.
//
// O mesmo campo era julgado por três regras que discordavam (HTML5 `type="email"`, Zod v4
// `.email()` e a regex do servidor). O caso que decidiu: **endereço com acento** — normal no
// Brasil — passava no servidor e era recusado pelas outras duas, então o contador via
// "e-mail inválido" num valor que o servidor aceitaria.
//
// Este teste trava as DUAS metades: o que a regra aceita, e que ela é a MESMA nas duas pontas.

import fs from "node:fs";
import path from "node:path";
import { emailValido, normalizarEmail } from "@contabilidade/shared/email";

const RAIZ = path.resolve(__dirname, "../../..");

describe("a regra compartilhada", () => {
  test("⚠⚠ ACEITA ACENTO — o caso que motivou a decisão", () => {
    expect(emailValido("joão@empresa.com.br")).toBe(true);
    expect(emailValido("contação@escritório.com.br")).toBe(true);
  });

  test("aceita o que o servidor sempre aceitou", () => {
    expect(emailValido("a@b.c")).toBe(true);
    expect(emailValido("contato+guias@empresa.com.br")).toBe(true);
    expect(emailValido("CONTATO@EMPRESA.COM")).toBe(true);
    expect(emailValido("  contato@empresa.com  ")).toBe(true); // espaço nas pontas é aparado
  });

  test("recusa o que não é e-mail", () => {
    expect(emailValido("a@b")).toBe(false);       // sem ponto no domínio
    expect(emailValido("sem-arroba.com")).toBe(false);
    expect(emailValido("com espaço@empresa.com")).toBe(false);
    expect(emailValido("@empresa.com")).toBe(false);
    expect(emailValido("contato@")).toBe(false);
  });

  test("⚠ VAZIO É FALSE — 'opcional' é decisão do campo, não do formato", () => {
    // Misturar as duas aqui faria um campo obrigatório aceitar branco em silêncio.
    expect(emailValido("")).toBe(false);
    expect(emailValido("   ")).toBe(false);
    expect(emailValido(null)).toBe(false);
    expect(emailValido(undefined)).toBe(false);
  });

  test("normalizar é aparar e minúsculo — os dois lados comparam a MESMA string", () => {
    expect(normalizarEmail("  Contato@Empresa.COM ")).toBe("contato@empresa.com");
    expect(normalizarEmail(null)).toBe("");
  });
});

describe("⚠ ela é a ÚNICA — não sobrou regex de e-mail solta no caminho do cadastro", () => {
  // ⚠ Varre a FONTE. Uma lista à mão precisaria ser atualizada junto, e é a atualização que se
  //   esquece — foi assim que as três regras nasceram.
  const ARQUIVOS = [
    "application/company/companyProfile.js",
    "application/validators/companySchemas.js",
  ];

  test.each(ARQUIVOS)("%s não escreve a própria regra de e-mail", (rel) => {
    const fonte = fs.readFileSync(path.join(RAIZ, rel), "utf8");
    // A regex antiga, e o `.email()` do Zod — os dois caminhos que discordavam.
    const linhasComRegexPropria = fonte
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .filter((l) => /\[\^\\s@\]/.test(l) || /\.email\(/.test(l));
    expect({ arquivo: rel, linhasComRegexPropria }).toEqual({ arquivo: rel, linhasComRegexPropria: [] });
  });

  test("e os dois importam a compartilhada", () => {
    for (const rel of ARQUIVOS) {
      const fonte = fs.readFileSync(path.join(RAIZ, rel), "utf8");
      expect(fonte).toContain('@contabilidade/shared/email');
    }
  });
});
