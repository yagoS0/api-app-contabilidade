// UM A1 DE OUTRO CNPJ NUNCA É USADO POR OUTRA EMPRESA — regra do dono, verificada na LEITURA.
//
// A rota de upload já recusa arquivo de CNPJ divergente, mas essa validação é recente: todo
// certificado subido antes dela nunca passou por conferência nenhuma. Guarda que mora só no upload
// protege o futuro e deixa o passado como está. Esta aqui roda em `resolveCertForCompany`, por onde
// TODO consumidor passa (ADN, SEFAZ, e o que vier depois).

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    procuracao: { findUnique: jest.fn(), findFirst: jest.fn() },
    portalClient: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
  },
}));

jest.mock("../../../infrastructure/storage/CertStorage.js", () => ({
  readStoredCompanyPfx: jest.fn(async () => Buffer.from("pfx-falso")),
}));

jest.mock("../../../utils/crypto.js", () => ({
  decryptSecret: jest.fn(async () => "senha"),
}));

jest.mock("../../security/inspectPfx.js", () => ({
  inspectPfx: jest.fn(),
}));

jest.mock("../../security/CertAccessAudit.js", () => ({
  auditCertAccess: jest.fn(async () => {}),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { inspectPfx } from "../../security/inspectPfx.js";
import { resolveCertForCompany, SERVICOS } from "../CertResolver.js";

const EMPRESA = "48684291000100";
const OUTRO = "12345678000199";

beforeEach(() => {
  jest.clearAllMocks();
  prisma.procuracao.findFirst?.mockResolvedValue?.(null);
  prisma.procuracao.findUnique?.mockResolvedValue?.(null);
  prisma.portalClient.findUnique.mockResolvedValue({ companyId: "c1", cnpj: EMPRESA });
  prisma.company.findUnique.mockResolvedValue({
    certPfxBytes: Buffer.from("x"), certStorageKey: "db:company-pfx",
    certPasswordEnc: "enc", certExpiresAt: new Date("2027-01-01"),
  });
});

describe("certificado tem que ser da própria empresa", () => {
  it("certificado do CNPJ certo é aceito", async () => {
    inspectPfx.mockReturnValue({ cnpj: EMPRESA, notAfter: new Date("2027-01-01") });
    const r = await resolveCertForCompany({ portalClientId: "p1", servico: SERVICOS.NFSE });
    expect(r.source).toBe("company_a1");
  });

  it("certificado de OUTRO CNPJ é recusado — é a regra inteira", async () => {
    inspectPfx.mockReturnValue({ cnpj: OUTRO, notAfter: new Date("2027-01-01") });
    await expect(resolveCertForCompany({ portalClientId: "p1", servico: SERVICOS.NFSE }))
      .rejects.toMatchObject({ code: "CERT_CNPJ_MISMATCH", certCnpj: OUTRO, portalCnpj: EMPRESA });
  });

  it("a recusa vale para TODOS os serviços, não só o ADN", async () => {
    inspectPfx.mockReturnValue({ cnpj: OUTRO, notAfter: null });
    await expect(resolveCertForCompany({ portalClientId: "p1", servico: SERVICOS.DFE }))
      .rejects.toMatchObject({ code: "CERT_CNPJ_MISMATCH" });
  });

  it("CNPJ ilegível no certificado NÃO bloqueia — ausência de dado não é prova", async () => {
    // e-CPF ou subject fora do padrão ICP-Brasil. Recusar aqui derrubaria empresa legítima; a
    // guarda de ingestão do ADN continua sendo o segundo cinto.
    inspectPfx.mockReturnValue({ cnpj: null, notAfter: null });
    const r = await resolveCertForCompany({ portalClientId: "p1", servico: SERVICOS.NFSE });
    expect(r.source).toBe("company_a1");
  });

  it("PFX que não abre não bloqueia a resolução — só avisa", async () => {
    inspectPfx.mockImplementation(() => { const e = new Error("senha"); e.code = "CERT_SENHA_INVALIDA"; throw e; });
    const r = await resolveCertForCompany({ portalClientId: "p1", servico: SERVICOS.NFSE });
    expect(r.source).toBe("company_a1");
  });

  it("empresa sem CNPJ no cadastro não é comparada (não há contra o quê)", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "c1", cnpj: "" });
    inspectPfx.mockReturnValue({ cnpj: OUTRO, notAfter: null });
    const r = await resolveCertForCompany({ portalClientId: "p1", servico: SERVICOS.NFSE });
    expect(r.source).toBe("company_a1");
  });
});
