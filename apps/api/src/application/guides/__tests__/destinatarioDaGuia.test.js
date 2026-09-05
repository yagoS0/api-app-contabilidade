// ⚠⚠ A GUIA SÓ VAI PARA QUEM ESTÁ CADASTRADO EM CONFIGURAÇÃO DE ENVIO (05/09/2026)
//
// > Dono, depois de ver a guia sair para um endereço que ninguém escolheu: *"a guia só vai para
// > e-mail ou número cadastrado na aba de guias, fora isso não sai e mostra por que não foi"*.
//
// Isto REVERTE uma decisão minha do mesmo dia. Eu tinha mantido a cascata
// (`guideNotificationEmail` → `Company.email` → e-mail do sócio) como rede contra "calar a
// carteira"; o que ela produziu foi pior: a guia saiu para o login do portal do cliente — endereço
// invisível em toda a interface — e a tela afirmou "e-mail enviado".
//
// O que este arquivo trava:
//   1. quem tem destinatário cadastrado recebe (e TODOS eles, não o primeiro);
//   2. quem NÃO tem não recebe, mesmo tendo `guideNotificationEmail` gravado — a cascata saiu;
//   3. ⚠ a cascata continua viva FORA da guia (documentos, elegibilidade do SERPRO);
//   4. ⚠ varredura: nenhum arquivo que ENVIA guia volta a importar a cascata.

import fs from "node:fs";
import path from "node:path";

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    contatoWhatsapp: { findMany: jest.fn() },
    portalClient: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
    companyClientUser: { findFirst: jest.fn() },
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  SEM_DESTINATARIO_DE_GUIA,
  resolveCompanyNotificationEmail,
  resolveCompanyNotificationEmails,
} from "../GuideScheduledEmailService.js";

// ⚠ `__dirname`, não `import.meta`: o jest desta casa transpila para CJS e `import.meta` é
// erro de SINTAXE — o arquivo inteiro morre antes do primeiro teste.
const SRC = path.resolve(__dirname, "../../..");

beforeEach(() => jest.clearAllMocks());

describe("o destinatário da guia sai SÓ da Configuração de envio", () => {
  it("todos os e-mails cadastrados, sem repetição — não é o primeiro da lista", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "c1", nome: "Julia", email: "julia@empresa.com", telefoneE164: null, optInEm: null, ativo: true },
      { id: "c2", nome: "Financeiro", email: "financeiro@empresa.com", telefoneE164: "5521999998888", optInEm: new Date(), ativo: true },
    ]);
    const emails = await resolveCompanyNotificationEmails("emp1");
    expect(emails).toEqual(["julia@empresa.com", "financeiro@empresa.com"]);
  });

  it("⚠⚠ SEM cadastrado a guia NÃO sai — nem com `guideNotificationEmail` no cadastro antigo", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
    // A cascata acharia este endereço. O caminho da guia não pode mais enxergá-lo.
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "leg1", guideNotificationEmail: "cascata@empresa.com" });

    const emails = await resolveCompanyNotificationEmails("emp1");

    expect(emails).toEqual([]);
    // A prova de que a cascata não foi consultada: ninguém perguntou pelo cadastro antigo.
    expect(prisma.portalClient.findUnique).not.toHaveBeenCalled();
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.companyClientUser.findFirst).not.toHaveBeenCalled();
  });

  it("a recusa DIZ o que fazer, e nomeia o lugar", () => {
    expect(SEM_DESTINATARIO_DE_GUIA.motivo).toMatch(/Configuração de envio/);
    expect(SEM_DESTINATARIO_DE_GUIA.motivo).toMatch(/aba Guias/);
    expect(SEM_DESTINATARIO_DE_GUIA.motivo).toMatch(/não sai/);
  });

  it("⚠ a cascata CONTINUA para quem não é guia (documentos, elegibilidade do SERPRO)", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "leg1", guideNotificationEmail: "" });
    prisma.company.findUnique.mockResolvedValue({ email: "contato@empresa.com" });
    // Se esta função fosse apertada junto, os workers do SERPRO parariam de CAPTURAR guia das
    // empresas sem e-mail (`if (!email) continue`) — o oposto do que o dono pediu.
    await expect(resolveCompanyNotificationEmail("emp1")).resolves.toBe("contato@empresa.com");
  });
});

describe("⚠ varredura: quem envia guia não importa a cascata", () => {
  const ENVIAM_GUIA = [
    "workers/guideEmailWorker.js",
    "application/guides/GuideCompanyEmailService.js",
  ];
  it.each(ENVIAM_GUIA)("%s não importa `resolveCompanyNotificationEmail`", (rel) => {
    const fonte = fs.readFileSync(path.join(SRC, rel), "utf8");
    const importes = fonte.match(/import\s*\{[^}]*\}\s*from\s*"[^"]*GuideScheduledEmailService\.js"/g) || [];
    expect(importes.length).toBeGreaterThan(0);
    for (const linha of importes) {
      // ⚠ O plural CONTÉM o singular como substring — a comparação tem de ser por TOKEN, senão a
      // varredura acusa o import correto e alguém a desliga.
      const nomes = linha.slice(linha.indexOf("{") + 1, linha.indexOf("}")).split(",").map((n) => n.trim());
      expect(nomes).not.toContain("resolveCompanyNotificationEmail");
    }
  });
});
