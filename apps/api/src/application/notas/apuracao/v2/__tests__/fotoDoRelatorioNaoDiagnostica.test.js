// ⚠⚠ UM DIAGNÓSTICO CONGELADO NUMA FOTO AFIRMA HOJE O QUE ERA VERDADE ONTEM.
//
// O CASO REAL (25/08/2026). O dono relatou, com as duas telas na frente: a aba Apuração da LENTE
// dizia "A empresa não tem Cadastro Fiscal preenchido (regime + CNAE)" enquanto Empresa → Perfil
// fiscal, da MESMA empresa, mostrava "Simples Nacional" e duas atividades ativas.
//
// A explicação natural — "são tabelas diferentes" — foi conferida no código e NÃO se sustenta:
// `MotorApuracaoService` e `DadosPlanejamentoService` fazem a MESMA chamada,
// `prisma.cadastroFiscal.findUnique({ where: { portalClientId } })`.
//
// O que era, medido contra produção (`scripts/diag-cadastro-fiscal-vs-perfil.mjs`, só leitura):
//   · relatório da LENTE gerado em .... 25/08/2026 12:26:57
//   · CadastroFiscal criado em ........ 25/08/2026 12:55:24   ← 28 minutos DEPOIS
//
// O relatório é uma FOTO salva (`relatorios_faturamento`, com `geradoEm` e botão "Regerar"), e ser
// foto é decisão de desenho — para os NÚMEROS do faturamento, que se imprimem e circulam, é o
// certo. O que não podia viajar congelado junto é o BLOQUEIO do motor, que não é número: é
// diagnóstico de estado.

jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findUnique: jest.fn(async () => null),
    count: jest.fn(async () => 0),
  });
  return { prisma: { relatorioFaturamento: model(), cadastroFiscal: model(), filaPendencia: model() } };
});

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { conferirBloqueiosDaFoto, lerRelatorioFaturamento } from "../RelatorioFaturamentoService.js";

const PORTAL = "pc-lente";
const COMP = "2026-07";
const GERADO_EM = new Date("2026-08-25T15:26:57.000Z");

function foto(blockers) {
  return {
    id: "rel-1",
    portalClientId: PORTAL,
    competencia: COMP,
    geradoEm: GERADO_EM,
    dados: { preApurado: { ok: false, das: null, blockers } },
  };
}

const CADASTRO_OK = { portalClientId: PORTAL, regime: "SIMPLES_NACIONAL", cnaePrincipal: "7319003" };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.cadastroFiscal.findUnique.mockResolvedValue(null);
  prisma.filaPendencia.count.mockResolvedValue(0);
});

describe("⚠⚠ O BLOQUEIO DA FOTO É RECONFERIDO NA LEITURA", () => {
  it("cadastro criado DEPOIS da foto ⇒ o bloqueio dela deixou de valer", async () => {
    // É literalmente o caso da LENTE.
    prisma.cadastroFiscal.findUnique.mockResolvedValue(CADASTRO_OK);
    const d = await conferirBloqueiosDaFoto({
      portalClientId: PORTAL,
      relatorio: foto([{ tipo: "CADASTRO_FALTANDO", mensagem: "Cadastro fiscal não preenchido." }]),
    });
    expect(d.bloqueios[0]).toMatchObject({ tipo: "CADASTRO_FALTANDO", aindaVale: false });
    expect(d.algumDeixouDeValer).toBe(true);
  });

  it("cadastro ainda ausente ⇒ o bloqueio CONTINUA valendo, e nada é dito a mais", async () => {
    const d = await conferirBloqueiosDaFoto({
      portalClientId: PORTAL,
      relatorio: foto([{ tipo: "CADASTRO_FALTANDO", mensagem: "Cadastro fiscal não preenchido." }]),
    });
    expect(d.bloqueios[0].aindaVale).toBe(true);
    expect(d.algumDeixouDeValer).toBe(false);
  });

  it("pendências resolvidas depois da foto ⇒ deixou de valer", async () => {
    prisma.cadastroFiscal.findUnique.mockResolvedValue(CADASTRO_OK);
    prisma.filaPendencia.count.mockResolvedValue(0);
    const d = await conferirBloqueiosDaFoto({
      portalClientId: PORTAL,
      relatorio: foto([{ tipo: "PENDENCIAS_ABERTAS", mensagem: "3 pendência(s) aberta(s)." }]),
    });
    expect(d.bloqueios[0].aindaVale).toBe(false);
  });
});

describe("⚠⚠ `aindaVale: null` É UMA RESPOSTA — e é a que impede a mentira oposta", () => {
  it("RECEITA_NAO_CLASSIFICADA não é reconferida, e sai NULL — nunca `false`", async () => {
    // Ela depende da varredura das notas do mês. Reconferi-la a cada LEITURA poria uma varredura no
    // caminho de abrir a aba. Devolver `false` ("já não vale") por não termos olhado seria trocar um
    // diagnóstico velho por um diagnóstico INVENTADO — ausência de conferência não é conferência
    // com resultado negativo. Mesma disciplina de `folhaAusenteNaoEZero` e de `NAO_CONFERIVEL`.
    prisma.cadastroFiscal.findUnique.mockResolvedValue(CADASTRO_OK);
    const d = await conferirBloqueiosDaFoto({
      portalClientId: PORTAL,
      relatorio: foto([{ tipo: "RECEITA_NAO_CLASSIFICADA", mensagem: "R$ 147450,00 em itens não classificados." }]),
    });
    expect(d.bloqueios[0].aindaVale).toBeNull();
    expect(d.algumDeixouDeValer).toBe(false);
  });

  it("com um conferível FALSO e um não conferível, só o primeiro conta", async () => {
    prisma.cadastroFiscal.findUnique.mockResolvedValue(CADASTRO_OK);
    const d = await conferirBloqueiosDaFoto({
      portalClientId: PORTAL,
      relatorio: foto([
        { tipo: "CADASTRO_FALTANDO", mensagem: "x" },
        { tipo: "RECEITA_NAO_CLASSIFICADA", mensagem: "y" },
      ]),
    });
    expect(d.bloqueios.map((b) => b.aindaVale)).toEqual([false, null]);
    expect(d.algumDeixouDeValer).toBe(true);
  });
});

describe("⚠ A CONFERÊNCIA NÃO PODE PIORAR A LEITURA", () => {
  it("⚠⚠ ela NÃO reescreve a foto — `dados` sai intacto e nada é gravado", async () => {
    // Regravar aqui faria a LEITURA mudar o documento salvo, que é o que `persistir: false` existe
    // para impedir no motor.
    prisma.cadastroFiscal.findUnique.mockResolvedValue(CADASTRO_OK);
    const original = foto([{ tipo: "CADASTRO_FALTANDO", mensagem: "x" }]);
    const antes = JSON.stringify(original.dados);
    prisma.relatorioFaturamento.findUnique.mockResolvedValue(original);

    const r = await lerRelatorioFaturamento({ portalClientId: PORTAL, competencia: COMP });

    expect(JSON.stringify(r.dados)).toBe(antes);
    expect(prisma.relatorioFaturamento.update).toBeUndefined();
    expect(r.diagnostico.algumDeixouDeValer).toBe(true);
  });

  it("falha ao conferir NÃO derruba o relatório — ele sai como sempre saiu", async () => {
    prisma.cadastroFiscal.findUnique.mockRejectedValue(new Error("banco caiu"));
    prisma.relatorioFaturamento.findUnique.mockResolvedValue(foto([{ tipo: "CADASTRO_FALTANDO", mensagem: "x" }]));

    const r = await lerRelatorioFaturamento({ portalClientId: PORTAL, competencia: COMP });
    expect(r.dados.preApurado.blockers).toHaveLength(1);
    expect(r.diagnostico).toBeNull();
  });

  it("relatório inexistente continua devolvendo null — ausência não é erro", async () => {
    prisma.relatorioFaturamento.findUnique.mockResolvedValue(null);
    expect(await lerRelatorioFaturamento({ portalClientId: PORTAL, competencia: COMP })).toBeNull();
  });

  it("foto SEM bloqueio nenhum não ganha diagnóstico — não há o que conferir", async () => {
    prisma.relatorioFaturamento.findUnique.mockResolvedValue({
      ...foto([]), dados: { preApurado: { ok: true, das: 19_539.95, blockers: [] } },
    });
    const r = await lerRelatorioFaturamento({ portalClientId: PORTAL, competencia: COMP });
    expect(r.diagnostico).toBeNull();
  });
});
