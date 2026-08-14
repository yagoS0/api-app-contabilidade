// SEM O A1 DA PRÓPRIA EMPRESA, RECUSA — NUNCA O CERTIFICADO DO ESCRITÓRIO.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `NfseService.loadCertAndKey()` lia um PFX GLOBAL de `NFSE_CERT_PFX_PATH` e o usava para ASSINAR
// e para o mTLS nos TRÊS caminhos (emissão, consulta, evento), **sem conferir de quem ele era** —
// na prática, o A1 do escritório assinando DPS de 33 CNPJs diferentes. E havia um `cachedCertInfo`
// de módulo: o primeiro certificado carregado ficava valendo para a carteira inteira.
//
// A regra é a mesma que a CAPTURA já segue (`apps/api/CLAUDE.md`), e a fonte oficial é **E0718**
// (Anexo I, RN DPS_NFS-e): *"A assinatura deve ser feita com o certificado digital do emitente da
// DPS."* — mais a Res. CGNFS-e nº 3, art. 2º, §1º, I.
//
// ⚠ E são DOIS certificados: o de ASSINATURA (E0718, tem de ser do emitente) e o de TRANSPORTE
// (mTLS, validado por E1200–E1209, sem regra que exija ser o mesmo). Hoje apontam para o mesmo
// arquivo; o teste trava que continuam sendo CAMPOS SEPARADOS, porque colapsá-los é o que
// impediria a figura da procuração depois.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: { findUnique: jest.fn(async () => ({ id: "portal-1" })) },
  },
}));

jest.mock("../../notas/CertResolver.js", () => ({
  SERVICOS: { NFSE: "NFSE", DFE: "DFE", ESOCIAL: "ESOCIAL", SN: "SN" },
  resolveCertForCompany: jest.fn(),
}));

// O PFX real não entra em teste (nem no git). O que importa aqui é DE QUEM vem o buffer, não a
// criptografia — a leitura do PFX é do node-forge e já é exercida pela captura.
jest.mock("node-forge", () => ({
  asn1: { fromDer: jest.fn(() => ({})) },
  pkcs12: {
    pkcs12FromAsn1: jest.fn(() => ({
      getBags: jest.fn(({ bagType }) =>
        bagType === "certBagOid"
          ? { certBagOid: [{ cert: { fake: "cert" } }] }
          : { keyBagOid: [{ key: { fake: "key" } }] }
      ),
    })),
  },
  pki: {
    oids: { certBag: "certBagOid", pkcs8ShroudedKeyBag: "keyBagOid", keyBag: "keyBagOid2" },
    certificateToPem: jest.fn(() => "-----BEGIN CERTIFICATE-----\nBASE64DOCERT\n-----END CERTIFICATE-----"),
    privateKeyToPem: jest.fn(() => "-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----"),
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolveCertForCompany } from "../../notas/CertResolver.js";
import { resolverCertificadosDaEmpresa, NfseCertError } from "../nfseCertificado.js";

const PFX_DA_EMPRESA = Buffer.from("pfx-da-empresa");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findUnique.mockResolvedValue({ id: "portal-1" });
});

describe("certificado da emissão de NFS-e", () => {
  it("usa o A1 da empresa e devolve ASSINATURA e TRANSPORTE como campos separados", async () => {
    resolveCertForCompany.mockResolvedValue({
      source: "company_a1",
      pfxBuffer: PFX_DA_EMPRESA,
      password: "senha",
      certExpiresAt: null,
    });

    const cert = await resolverCertificadosDaEmpresa("company-1");

    // ⚠ Dois papéis, dois campos — mesmo apontando hoje para o mesmo arquivo.
    expect(cert.assinatura.pfxBuffer).toBe(PFX_DA_EMPRESA);
    expect(cert.transporte.pfxBuffer).toBe(PFX_DA_EMPRESA);
    expect(cert.assinatura).toHaveProperty("keyPem");
    expect(cert.assinatura).toHaveProperty("certBase64");
    expect(cert.origem).toBe("company_a1");

    // Não há SEGUNDA resolução de certificado: quem resolve continua sendo o CertResolver, que já
    // confere o CNPJ do subject. Duas resoluções foi como a captura divergiu no passado.
    expect(resolveCertForCompany).toHaveBeenCalledWith({
      portalClientId: "portal-1",
      servico: "NFSE",
    });
  });

  it("⚠ SEM A1 da empresa: recusa NO_COMPANY_CERT em vez de cair no do escritório", async () => {
    // `resolveCertForCompany` lança `NO_CERT_AVAILABLE` quando não há nem procuração nem A1.
    const err = new Error("Sem certificado");
    err.code = "NO_CERT_AVAILABLE";
    resolveCertForCompany.mockRejectedValue(err);

    await expect(resolverCertificadosDaEmpresa("company-1")).rejects.toMatchObject({
      code: "NO_COMPANY_CERT",
    });
    // A mensagem tem de dizer O QUE FAZER e por quê — é ela que evita o contador ficar girando.
    await expect(resolverCertificadosDaEmpresa("company-1")).rejects.toThrow(/E0718/);
  });

  it("⚠ PROCURAÇÃO do escritório NÃO serve para assinar a DPS", async () => {
    // A procuração e-CAC autoriza o escritório a AGIR no e-CAC; ela não transforma o certificado
    // dele no certificado do cliente perante o sistema nacional. Mesma decisão do ADN e da SEFAZ,
    // que também não aceitam esse `source`.
    resolveCertForCompany.mockResolvedValue({
      source: "procuracao_escritorio",
      procuracaoId: "proc-1",
    });

    await expect(resolverCertificadosDaEmpresa("company-1")).rejects.toMatchObject({
      code: "NO_COMPANY_CERT",
      origemResolvida: "procuracao_escritorio",
    });
  });

  it("⚠ CNPJ divergente NÃO vira 'não tem certificado' — o conserto é outro", async () => {
    // Esta distinção já custou uma investigação na captura: a mensagem genérica mandava cadastrar
    // um certificado que já estava lá. Trocar o arquivo × redigitar a senha × cadastrar o primeiro
    // são três consertos diferentes.
    const err = new Error("O certificado cadastrado pertence ao CNPJ 111…");
    err.code = "CERT_CNPJ_MISMATCH";
    resolveCertForCompany.mockRejectedValue(err);

    await expect(resolverCertificadosDaEmpresa("company-1")).rejects.toMatchObject({
      code: "CERT_CNPJ_MISMATCH",
    });
  });

  it("senha que não descriptografa também mantém o próprio código", async () => {
    const err = new Error("Falha ao descriptografar");
    err.code = "CERT_PASSWORD_DECRYPT_FAILED";
    resolveCertForCompany.mockRejectedValue(err);

    await expect(resolverCertificadosDaEmpresa("company-1")).rejects.toMatchObject({
      code: "CERT_PASSWORD_DECRYPT_FAILED",
    });
  });

  it("empresa legada sem PortalClient recusa — não há de onde tirar o A1", async () => {
    prisma.portalClient.findUnique.mockResolvedValue(null);
    await expect(resolverCertificadosDaEmpresa("company-1")).rejects.toMatchObject({
      code: "NO_COMPANY_CERT",
    });
    expect(resolveCertForCompany).not.toHaveBeenCalled();
  });

  it("o erro é um NfseCertError (código nomeado, não string solta)", async () => {
    resolveCertForCompany.mockResolvedValue({ source: "none" });
    await expect(resolverCertificadosDaEmpresa("company-1")).rejects.toBeInstanceOf(NfseCertError);
  });
});
