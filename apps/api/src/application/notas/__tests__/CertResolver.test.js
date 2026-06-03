// Q12.A.3: testes do CertResolver — resolve cert por (empresa, serviço).

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    procuracao: { findUnique: jest.fn() },
    portalClient: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
  },
}));

jest.mock("../../../infrastructure/storage/CertStorage.js", () => ({
  readStoredCompanyPfx: jest.fn(),
}));

jest.mock("../../../utils/crypto.js", () => ({
  decryptSecret: jest.fn((s) => `decrypted:${s}`),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { readStoredCompanyPfx } from "../../../infrastructure/storage/CertStorage.js";
import { decryptSecret } from "../../../utils/crypto.js";
import { resolveCertForCompany, checkCertAvailability, CertResolutionError, SERVICOS } from "../CertResolver.js";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolveCertForCompany — validação", () => {
  it("throw quando portalClientId vazio", async () => {
    await expect(resolveCertForCompany({ servico: SERVICOS.DFE })).rejects.toBeInstanceOf(CertResolutionError);
  });

  it("throw quando servico inválido", async () => {
    await expect(resolveCertForCompany({ portalClientId: "pc-1", servico: "XYZ" }))
      .rejects.toMatchObject({ code: "INVALID_SERVICO" });
  });
});

describe("resolveCertForCompany — procuração", () => {
  it("retorna source=procuracao_escritorio quando há procuração ATIVA dentro da validade", async () => {
    prisma.procuracao.findUnique.mockResolvedValue({
      id: "proc-1", status: "ATIVA", validade: new Date(Date.now() + 86400000 * 30),
    });
    const out = await resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.DFE });
    expect(out.source).toBe("procuracao_escritorio");
    expect(out.procuracaoId).toBe("proc-1");
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it("ignora procuração EXPIRADA e cai pro cert da empresa", async () => {
    prisma.procuracao.findUnique.mockResolvedValue({
      id: "proc-1", status: "ATIVA", validade: new Date(Date.now() - 86400000),
    });
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
    prisma.company.findUnique.mockResolvedValue({ certPfxBytes: null, certStorageKey: "k", certPasswordEnc: "x" });
    readStoredCompanyPfx.mockReturnValue(Buffer.from("pfx"));

    const out = await resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.DFE });
    expect(out.source).toBe("company_a1");
  });

  it("ignora procuração REVOGADA", async () => {
    prisma.procuracao.findUnique.mockResolvedValue({ id: "p", status: "REVOGADA" });
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
    prisma.company.findUnique.mockResolvedValue({ certPfxBytes: null, certStorageKey: "k", certPasswordEnc: null });
    readStoredCompanyPfx.mockReturnValue(Buffer.from("pfx"));

    const out = await resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.DFE });
    expect(out.source).toBe("company_a1");
  });
});

describe("resolveCertForCompany — cert empresa", () => {
  beforeEach(() => {
    prisma.procuracao.findUnique.mockResolvedValue(null);
  });

  it("retorna pfx + senha decriptada quando cert existe", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
    prisma.company.findUnique.mockResolvedValue({
      certPfxBytes: null, certStorageKey: "k", certPasswordEnc: "enc-pass",
      certExpiresAt: new Date("2027-12-31"),
    });
    readStoredCompanyPfx.mockReturnValue(Buffer.from("pfxdata"));

    const out = await resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.NFSE });
    expect(out.source).toBe("company_a1");
    expect(out.pfxBuffer.toString()).toBe("pfxdata");
    expect(out.password).toBe("decrypted:enc-pass");
    expect(decryptSecret).toHaveBeenCalledWith("enc-pass");
    expect(out.certExpiresAt).toEqual(new Date("2027-12-31"));
  });

  it("retorna senha null quando não há senha encriptada", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
    prisma.company.findUnique.mockResolvedValue({
      certPfxBytes: null, certStorageKey: "k", certPasswordEnc: null,
    });
    readStoredCompanyPfx.mockReturnValue(Buffer.from("pfx"));

    const out = await resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.NFSE });
    expect(out.password).toBeNull();
    expect(decryptSecret).not.toHaveBeenCalled();
  });

  it("throw NO_CERT_AVAILABLE quando company não tem cert nem PFX", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
    prisma.company.findUnique.mockResolvedValue({ certStorageKey: null, certPfxBytes: null });
    readStoredCompanyPfx.mockReturnValue(null);

    await expect(resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.DFE }))
      .rejects.toMatchObject({ code: "NO_CERT_AVAILABLE" });
  });

  it("throw NO_CERT_AVAILABLE quando portalClient não tem companyId legacy", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: null });

    await expect(resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.SN }))
      .rejects.toMatchObject({ code: "NO_CERT_AVAILABLE" });
  });

  it("propaga CERT_PASSWORD_DECRYPT_FAILED quando decrypt falha", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
    prisma.company.findUnique.mockResolvedValue({
      certPfxBytes: null, certStorageKey: "k", certPasswordEnc: "broken",
    });
    readStoredCompanyPfx.mockReturnValue(Buffer.from("pfx"));
    decryptSecret.mockImplementationOnce(() => { throw new Error("bad key"); });

    await expect(resolveCertForCompany({ portalClientId: "pc-1", servico: SERVICOS.DFE }))
      .rejects.toMatchObject({ code: "CERT_PASSWORD_DECRYPT_FAILED" });
  });
});

describe("checkCertAvailability (soft)", () => {
  it("retorna { ok: true } quando resolve sucesso", async () => {
    prisma.procuracao.findUnique.mockResolvedValue({ id: "p", status: "ATIVA", validade: null });
    const out = await checkCertAvailability({ portalClientId: "pc-1", servico: SERVICOS.DFE });
    expect(out).toEqual({ ok: true, source: "procuracao_escritorio" });
  });

  it("retorna { ok: false, code } sem throw quando falha", async () => {
    prisma.procuracao.findUnique.mockResolvedValue(null);
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: null });

    const out = await checkCertAvailability({ portalClientId: "pc-1", servico: SERVICOS.DFE });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("NO_CERT_AVAILABLE");
  });
});
