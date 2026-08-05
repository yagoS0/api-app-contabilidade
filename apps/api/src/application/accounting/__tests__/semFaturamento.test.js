// AS DUAS TRAVAS DE "MÊS SEM FATURAMENTO" — agora num service, e por um motivo concreto.
//
// Elas viviam DENTRO do handler HTTP. Enquanto o único caminho era o contador clicando, isso
// bastava. A partir do momento em que o extrato zerado do PGDAS-D marca sozinho, um caminho
// automático gravando direto no Prisma nasceria **sem nenhuma das duas** — e afirmaria "sem
// faturamento" numa empresa com nota emitida, em nome do escritório.
//
// O que estes testes travam é justamente isso: a decisão é a MESMA venha ela do clique ou do
// extrato.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    apuracaoSnapshot: { findUnique: jest.fn(async () => null) },
    companyMonthlyCircular: {
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
    },
  },
}));

jest.mock("../../notas/apuracao/v2/FechamentoService.js", () => ({
  faturamentoEmitDaCompetencia: jest.fn(async () => 0),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { faturamentoEmitDaCompetencia } from "../../notas/apuracao/v2/FechamentoService.js";
import { marcarSemFaturamento } from "../semFaturamento.js";

const BASE = { portalClientId: "p1", competencia: "2026-07", ok: true };

beforeEach(() => {
  jest.clearAllMocks();
  faturamentoEmitDaCompetencia.mockResolvedValue(0);
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue(null);
});

describe("marcarSemFaturamento", () => {
  it("sem receita e sem conferência: aceita e REGISTRA que não conferiu", async () => {
    const r = await marcarSemFaturamento({ ...BASE, userId: "u1" });
    expect(r.ok).toBe(true);
    expect(r.conferencia).toBe("sem_conferencia");
    // Exigir conferência "ok" inutilizaria o campo em toda empresa de município fora do ADN —
    // justamente onde ele mais serve. Aceita, mas grava COMO foi aceito.
    expect(prisma.companyMonthlyCircular.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ semFaturamento: true, semFaturamentoConferencia: "sem_conferencia" }) }),
    );
  });

  it("⚠ recusa quando há nota emitida — a evidência direta contra a afirmação", async () => {
    faturamentoEmitDaCompetencia.mockResolvedValue(23076.26);
    const r = await marcarSemFaturamento(BASE);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SEM_FATURAMENTO_COM_RECEITA");
    expect(r.faturamento).toBeCloseTo(23076.26, 2);
    expect(prisma.companyMonthlyCircular.create).not.toHaveBeenCalled();
    expect(prisma.companyMonthlyCircular.update).not.toHaveBeenCalled();
  });

  it("⚠ recusa na conferência DIVERGENTE — o ADN tem nota que nós não temos", async () => {
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue({
      conferenciaStatus: "divergente",
      conferenciaResultado: { faltantes: ["chave1", "chave2"] },
    });
    const r = await marcarSemFaturamento(BASE);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SEM_FATURAMENTO_CONFERENCIA_DIVERGENTE");
    expect(r.faltantes).toBe(2);
    expect(prisma.companyMonthlyCircular.create).not.toHaveBeenCalled();
  });

  it("`nao_conferivel` NÃO recusa — município fora do ADN ainda pode declarar mês parado", async () => {
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue({ conferenciaStatus: "nao_conferivel" });
    const r = await marcarSemFaturamento(BASE);
    expect(r.ok).toBe(true);
    expect(r.conferencia).toBe("nao_conferivel");
  });

  it("O CAMINHO AUTOMÁTICO PASSA PELAS MESMAS TRAVAS", async () => {
    // É o teste que dá sentido à extração: o extrato zerado não pode afirmar o que o clique
    // recusaria. Mesma entrada, mesma decisão — só muda quem assina.
    faturamentoEmitDaCompetencia.mockResolvedValue(500);
    const manual = await marcarSemFaturamento({ ...BASE, userId: "u1", origem: "manual" });
    const automatico = await marcarSemFaturamento({ ...BASE, userId: null, origem: "extrato_pgdas_zerado" });
    expect(manual.ok).toBe(false);
    expect(automatico.ok).toBe(false);
    expect(automatico.error).toBe(manual.error);
  });

  it("no caminho automático quem assina NÃO é uma pessoa", async () => {
    // `semFaturamentoPor: null` é intencional: quem afirma é a declaração transmitida à Receita.
    // Carimbar um usuário aleatório seria atribuir a alguém uma afirmação que ele não fez.
    await marcarSemFaturamento({ ...BASE, userId: null, origem: "extrato_pgdas_zerado" });
    expect(prisma.companyMonthlyCircular.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ semFaturamentoPor: null }) }),
    );
  });

  it("desmarcar não consulta faturamento nem conferência", async () => {
    const r = await marcarSemFaturamento({ ...BASE, ok: false });
    expect(r.ok).toBe(true);
    expect(faturamentoEmitDaCompetencia).not.toHaveBeenCalled();
    expect(prisma.companyMonthlyCircular.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ semFaturamento: false, semFaturamentoEm: null }) }),
    );
  });

  it("competência inválida não grava nada", async () => {
    const r = await marcarSemFaturamento({ ...BASE, competencia: "07/2026" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("competencia_required");
    expect(prisma.companyMonthlyCircular.create).not.toHaveBeenCalled();
  });
});
