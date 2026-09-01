// ⚠⚠ O ESCRITÓRIO ENTRA NO PORTAL DO CLIENTE — para VER, e só (30/08/2026)
//
// > Dono: *"não estou conseguindo acessar o portal do cliente com meu acesso de contador (…) o meu
// > acesso admin deve ser o único a conseguir isso."*
//
// A porta é uma marca POR USUÁRIO (`podeAbrirPortalDoCliente`), e não o `role`. ⚠⚠ `role: "admin"`
// é **bypass total** nos três middlewares desta casa: quem o tem ganha OWNER em qualquer empresa do
// banco, fora da carteira inclusive. Promover a conta para abrir uma porta daria privilégio sobre o
// sistema inteiro — e, medido em 30/08/2026, **zero** usuários têm esse role, então aquela exceção
// nunca foi exercida por ninguém.
//
// ⚠⚠ O QUE ESTA SUÍTE PROTEGE NÃO É A PORTA, É O PISO. O portal do cliente **emite NFS-e**, e a
// emissão exige `CLIENT_ADMIN`+. Com OWNER, o contador emitiria nota fiscal em nome do cliente, no
// CNPJ dele, sem volta — a NFS-e não tem inutilização.

// ⚠ O prefixo `mock` no nome é EXIGÊNCIA do jest: a fábrica de `jest.mock` não pode referenciar
// variável de fora (guarda contra mock não inicializado). É o mesmo molde de
// `parcelamento/__tests__/baixaParcelaComposicaoDeclarada.test.js`.
const mockFindUniqueFirm = jest.fn();
const mockFindUniqueClient = jest.fn();

jest.mock("../../infrastructure/db/prisma.js", () => ({
  prisma: {
    companyFirmAccess: { findUnique: (...a) => mockFindUniqueFirm(...a) },
    companyClientUser: { findUnique: (...a) => mockFindUniqueClient(...a) },
  },
}));

import { requireAccountType } from "../requireAccountType.js";
import { requireClientCompanyAccess } from "../requireClientCompanyAccess.js";

const VISITANTE = { id: "u-firm", role: "contador", accountType: "FIRM", podeAbrirPortalDoCliente: true };
const CONTADOR_COMUM = { id: "u-2", role: "contador", accountType: "FIRM" };

function chamada(user, { companyId = "pc-1" } = {}) {
  const req = { auth: { user }, params: { companyId }, body: {} };
  const res = {
    statusCode: null,
    corpo: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.corpo = b; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUniqueFirm.mockResolvedValue({ status: "ACTIVE" });
  mockFindUniqueClient.mockResolvedValue(null);
});

describe("⚠⚠ a PORTA — só quem tem a marca", () => {
  it("o visitante marcado passa por `requireAccountType(\"CLIENT\")`", () => {
    const next = jest.fn();
    const { req, res } = chamada(VISITANTE);
    requireAccountType("CLIENT")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("⚠⚠ contador SEM a marca continua barrado — é o que mantém o 'só eu'", () => {
    const next = jest.fn();
    const { req, res } = chamada(CONTADOR_COMUM);
    requireAccountType("CLIENT")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("⚠ `=== true`, nunca truthy — ausência do campo NÃO é permissão", () => {
    for (const v of [undefined, null, 0, "", "true", 1, {}]) {
      const next = jest.fn();
      const { req, res } = chamada({ ...CONTADOR_COMUM, podeAbrirPortalDoCliente: v });
      requireAccountType("CLIENT")(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });

  it("⚠⚠ a marca abre SÓ esta porta — ela não vale no portal do escritório", () => {
    // Um CLIENTE com o campo ligado por engano não pode virar conta FIRM.
    const next = jest.fn();
    const { req, res } = chamada({ id: "u-c", role: "user", accountType: "CLIENT", podeAbrirPortalDoCliente: true });
    requireAccountType("FIRM")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("⚠⚠ o PISO — ele entra para VER", () => {
  it("nas rotas financeiras (sem minRole) ele passa, como FINANCEIRO", async () => {
    const next = jest.fn();
    const { req, res } = chamada(VISITANTE);
    await requireClientCompanyAccess()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.access.role).toBe("FINANCEIRO");
    expect(req.access.visitaDoEscritorio).toBe(true);
  });

  it("⚠⚠ CLIENT_ADMIN é RECUSADO — é o piso da EMISSÃO de NFS-e e do pró-labore", async () => {
    const next = jest.fn();
    const { req, res } = chamada(VISITANTE);
    await requireClientCompanyAccess("CLIENT_ADMIN")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.corpo.error).toBe("insufficient_role");
  });

  it("⚠⚠ OWNER é RECUSADO — gestão de usuários do cliente não é assunto do contador", async () => {
    const next = jest.fn();
    const { req, res } = chamada(VISITANTE);
    await requireClientCompanyAccess("OWNER")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.corpo.error).toBe("insufficient_role");
  });
});

describe("⚠⚠ o ESCOPO — a carteira dele, nunca 'qualquer empresa'", () => {
  it("empresa FORA da carteira é recusada", async () => {
    // Sem isto, o id na URL alcançaria empresa de outro escritório. Multi-tenancy é invariante.
    mockFindUniqueFirm.mockResolvedValue(null);
    const next = jest.fn();
    const { req, res } = chamada(VISITANTE, { companyId: "de-outro-escritorio" });
    await requireClientCompanyAccess()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("⚠ vínculo de carteira SUSPENSO também recusa — só ACTIVE vale", async () => {
    mockFindUniqueFirm.mockResolvedValue({ status: "SUSPENDED" });
    const next = jest.fn();
    const { req, res } = chamada(VISITANTE);
    await requireClientCompanyAccess()(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it("⚠ e ele NUNCA cai na consulta de vínculo de CLIENTE — são populações diferentes", async () => {
    const next = jest.fn();
    const { req, res } = chamada(VISITANTE);
    await requireClientCompanyAccess()(req, res, next);
    expect(mockFindUniqueClient).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O MESTRE — decisão do dono, 01/09/2026, e ela REVERTE o piso para UMA conta.
//
// > Dono: *"o meu login e senha em ambos os portais é de mestre, eu posso executar o que eu quiser,
// > emitir nota em qualquer empresa etc, apenas o meu deve fazer isso."*
//
// O cabeçalho desta suíte dizia que promover a conta a `admin` "daria privilégio sobre o sistema
// inteiro" — e é LITERALMENTE o que foi pedido. O mecanismo não mudou uma linha: `role === "admin"`
// sempre foi o bypass; o que mudou foi a conta do dono passar a tê-lo. O piso FINANCEIRO continua
// de pé para QUALQUER OUTRO usuário com a marca da porta — mestre é o ROLE, não a marca.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o MESTRE — `role: admin` passa por cima do piso, e só ele", () => {
  const MESTRE = { id: "u-dono", role: "admin", accountType: "FIRM", podeAbrirPortalDoCliente: true };

  it("⚠⚠ entra como OWNER mesmo onde a visita é recusada — o piso não o alcança", async () => {
    const { req, res } = chamada(MESTRE);
    let passou = false;
    await requireClientCompanyAccess("OWNER")(req, res, () => { passou = true; });
    expect(passou).toBe(true);
    expect(req.access.role).toBe("OWNER");
    // ⚠ E SEM a marca de visita: é ela que o portão de emissão usa para recusar — o mestre não a
    // recebe, e é por isso que ele emite.
    expect(req.access.visitaDoEscritorio).toBeUndefined();
  });

  it("⚠ 'qualquer empresa' é literal — o ramo nem consulta a carteira", async () => {
    const { req, res } = chamada(MESTRE, { companyId: "pc-de-outro-escritorio" });
    let passou = false;
    await requireClientCompanyAccess()(req, res, () => { passou = true; });
    expect(passou).toBe(true);
    expect(mockFindUniqueFirm).not.toHaveBeenCalled();
    expect(mockFindUniqueClient).not.toHaveBeenCalled();
  });

  it("⚠⚠ e o VISITANTE COMUM continua no piso — é o 'apenas o meu'", async () => {
    const { req, res } = chamada(VISITANTE);
    await requireClientCompanyAccess("OWNER")(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });
});
