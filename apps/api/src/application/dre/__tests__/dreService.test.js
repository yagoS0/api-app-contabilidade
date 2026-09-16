import { Prisma } from "@prisma/client";
// A LIGAÇÃO do DRE com o banco.
//
// ⚠⚠ A REGRA tem teste em `lib/__tests__/dreGerencial.test.js`. O que se prende AQUI é o que a regra
// não pode provar sozinha: que a leitura traz o dado CERTO, somente de competências fechadas, e
// que **nada aqui escreve**.

import { DreRecusado, RECUSA_DO_DRE, montarDre } from "../DreService.js";

/**
 * ⚠⚠ O DUBLÊ LANÇA EM TODO MÉTODO DE ESCRITA.
 *
 * É o molde de `dadosPlanejamento.test.js`: uma escrita acidental não vira um teste vermelho
 * obscuro, vira uma exceção com o nome do método. E o teste final varre o objeto inteiro, para o
 * método NOVO que alguém acrescentar já nascer coberto.
 */
function clientDe({ lancamentos = [], contas = [], fechamentos = [
  { competencia: "2026-09", fechadoContabilEm: new Date("2026-10-01T12:00:00Z") },
  { competencia: "2026-08", fechadoContabilEm: new Date("2026-09-01T12:00:00Z") },
] } = {}) {
  const proibido = (nome) => () => { throw new Error(`escrita proibida no DRE: ${nome}`); };
  return {
    companyMonthlyCircular: { findMany: jest.fn(async () => fechamentos) },
    accountingEntry: {
      findMany: jest.fn(async () => lancamentos),
      create: proibido("accountingEntry.create"),
      update: proibido("accountingEntry.update"),
      delete: proibido("accountingEntry.delete"),
      updateMany: proibido("accountingEntry.updateMany"),
    },
    chartOfAccount: {
      findMany: jest.fn(async () => contas),
      create: proibido("chartOfAccount.create"),
      update: proibido("chartOfAccount.update"),
      upsert: proibido("chartOfAccount.upsert"),
    },
  };
}

const conta = (codigo, codigoCompleto, extra = {}) => ({
  portalClientId: null, codigo, nome: codigoCompleto, codigoCompleto, analitica: true, ...extra,
});

const lanc = (...lines) => ({ lines });
const D = (c, v) => ({ tipo: "D", conta: c, valor: String(v) });
const C = (c, v) => ({ tipo: "C", conta: c, valor: String(v) });

const valorDe = (dre, chave) => dre.linhas.find((l) => l.chave === chave)?.valor;

describe("a competência explícita tem formato conferido", () => {
  it.each(["2026", "13/2026", "2026-13", "sem-competencia"])(
    "%s é recusada, nomeando o formato",
    async (competencia) => {
      // Seleção explícita inválida não pode virar silenciosamente o fechamento mais recente.
      await expect(montarDre({ portalClientId: "emp-1", competencia, client: clientDe() }))
        .rejects.toMatchObject({ codigo: RECUSA_DO_DRE.COMPETENCIA_INVALIDA });
    },
  );

  it("⚠ a recusa é NOMEADA, com a frase — não um 500 mudo", async () => {
    const erro = await montarDre({ portalClientId: "emp-1", competencia: "x", client: clientDe() })
      .catch((e) => e);
    expect(erro).toBeInstanceOf(DreRecusado);
    expect(erro.frase).toMatch(/AAAA-MM/);
  });

  it("⚠ e ela é conferida ANTES de ir ao banco", async () => {
    const client = clientDe();
    await montarDre({ portalClientId: "emp-1", competencia: "x", client }).catch(() => {});
    expect(client.accountingEntry.findMany).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ a leitura", () => {
  it("pede os lançamentos DAQUELA competência e daquela empresa", async () => {
    const client = clientDe();
    await montarDre({ portalClientId: "emp-1", competencia: "2026-08", client });
    expect(client.accountingEntry.findMany.mock.calls[0][0].where)
      .toEqual({ portalClientId: "emp-1", competencia: "2026-08" });
  });

  it("⚠ e traz só o que a regra lê — não o razão inteiro", async () => {
    // O `historico` e o `tipo` do lançamento não entram no DRE: quem decide o grupo é a CONTA.
    const client = clientDe();
    await montarDre({ portalClientId: "emp-1", competencia: "2026-08", client });
    expect(client.accountingEntry.findMany.mock.calls[0][0].select)
      .toEqual({ status: true, lines: { select: { tipo: true, valor: true, conta: true } } });
  });

  it("⚠⚠ o plano traz a EMPRESA e as GLOBAIS — e a da empresa vence", async () => {
    // Medido: 593 contas globais servem 33 das 34 empresas. Sem as globais, o DRE de quase toda a
    // carteira sairia inteiro em "não classificado".
    const client = clientDe({
      contas: [
        conta("100", "31101", { portalClientId: null, nome: "VENDAS (global)" }),
        conta("100", "42101", { portalClientId: "emp-1", nome: "CUSTO (da empresa)" }),
      ],
      lancamentos: [lanc(C("100", 1000))],
    });
    const dre = await montarDre({ portalClientId: "emp-1", competencia: "2026-08", client });
    // ⚠ A da empresa venceu: o código 100 virou CUSTO (grupo 4), não receita.
    expect(valorDe(dre, "receitaBruta")).toBe(0);
    expect(valorDe(dre, "custos")).toBe(1000);
  });
});

describe("⚠⚠ o resultado chega montado pela regra", () => {
  it("a receita e o DAS de uma competência real", async () => {
    const client = clientDe({
      contas: [conta("100", "31101"), conta("200", "331030009"), conta("300", "41101")],
      lancamentos: [lanc(C("100", 10000)), lanc(D("200", 800)), lanc(D("300", 2500))],
    });
    const dre = await montarDre({ portalClientId: "emp-1", competencia: "2026-08", client });
    expect(dre.competencia).toBe("2026-08");
    expect(valorDe(dre, "receitaLiquida")).toBe(9200);
    expect(valorDe(dre, "resultadoDoPeriodo")).toBe(6700);
  });

  it("⚠⚠ `demonstracao: false` — é ele que apaga o selo no portal do cliente", async () => {
    const dre = await montarDre({ portalClientId: "emp-1", competencia: "2026-08", client: clientDe() });
    expect(dre.demonstracao).toBe(false);
  });

  it("⚠⚠ empresa SEM lançamento devolve `semLancamento`, não um DRE de zeros mudo", async () => {
    // Medido: 12 das 34 empresas. `R$ 0,00` em toda linha AFIRMA que ela não faturou nem gastou.
    const dre = await montarDre({ portalClientId: "emp-1", competencia: "2026-08", client: clientDe() });
    expect(dre.semLancamento).toBe(true);
  });
});

describe("⚠⚠ o DRE NÃO ESCREVE", () => {
  it("nenhum método de escrita é chamado no caminho feliz", async () => {
    const client = clientDe({
      contas: [conta("100", "31101")],
      lancamentos: [lanc(C("100", 1000))],
    });
    // ⚠ O dublê LANÇA em toda escrita: se alguma fosse chamada, este teste falharia com o nome do
    // método, não com um resultado torto.
    await expect(montarDre({ portalClientId: "emp-1", competencia: "2026-08", client }))
      .resolves.toBeTruthy();
  });

  it("⚠ e a varredura da fonte confirma — inclusive para o método que alguém acrescentar", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "DreService.js"), "utf8")
      // ⚠ BLOCO antes de LINHA: um `//` dentro de um comentário de bloco apaga o `*/`, e o regex
      // não-guloso engole o código real até o `*/` seguinte. Lição de 27/08/2026.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(fonte).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
    expect(fonte).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction/);
    // ⚠ E nada externo: o DRE não chama ADN, SEFAZ nem SERPRO.
    expect(fonte).not.toMatch(/axios|fetch\(/);
  });
});


test('contrato do serviço recebe Decimal do Prisma e serializa resultado real e parcialidade', async () => {
  const client = clientDe({ contas: [conta('r', '311020001'), conta('d', '411020001'), conta('x', '413010001')], lancamentos: [{ lines: [
    { conta: 'r', tipo: 'C', valor: new Prisma.Decimal('1000') },
    { conta: 'd', tipo: 'D', valor: new Prisma.Decimal('200') },
    { conta: 'x', tipo: 'D', valor: new Prisma.Decimal('17.35') },
  ] }] });
  const dto = JSON.parse(JSON.stringify(await montarDre({ portalClientId: 'emp-1', competencia: '2026-09', client })));
  expect(valorDe(dto, 'resultadoDoPeriodo')).toBe(800);
  expect(dto).toMatchObject({ competencia: '2026-09', demonstracao: false, semLancamento: false, qualidade: { status: 'PROVISORIO', provisorio: true, linhasNaoClassificadas: 1, linhasInvalidas: 0 }, inconsistencias: [] });
  expect(dto.naoClassificado[0]).toMatchObject({ causa: 'resultado_sem_mapeamento', valor: 17.35 });
  expect(client.accountingEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: 'emp-1', competencia: '2026-09' } }));
});


test('fechamento revisa rascunhos válidos sem excluir valores nem modificar lançamentos', async () => {
  const client = clientDe({ contas: [conta('r', '311020001')], lancamentos: [
    { status: 'CONFIRMADO', lines: [{ conta: 'r', tipo: 'C', valor: new Prisma.Decimal('80') }] },
    { status: 'RASCUNHO', lines: [{ conta: 'r', tipo: 'C', valor: new Prisma.Decimal('20') }] },
  ] });
  const dre = await montarDre({ portalClientId: 'emp-1', competencia: '2026-09', client });
  expect(valorDe(dre, 'receitaBruta')).toBe(100);
  expect(dre.qualidade).toMatchObject({ status: 'SEM_PENDENCIAS_IDENTIFICADAS', provisorio: false, lancamentosRascunho: 1, motivos: [] });
});

describe('somente competências fechadas', () => {
  it.each([undefined, '', null])('omissão %s escolhe a mais recente fechada da empresa', async competencia => {
    const client = clientDe();
    const dre = await montarDre({ portalClientId: 'emp-1', competencia, client });
    expect(client.companyMonthlyCircular.findMany).toHaveBeenCalledWith({
      where: { portalClientId: 'emp-1', fechadoContabilEm: { not: null } },
      select: { competencia: true, fechadoContabilEm: true }, orderBy: { competencia: 'desc' },
    });
    expect(dre).toMatchObject({ competencia: '2026-09', competenciasDisponiveis: ['2026-09', '2026-08'], semCompetenciaFechada: false });
    expect(dre.fechadoEm.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(client.accountingEntry.findMany.mock.calls[0][0].where).toEqual({ portalClientId: 'emp-1', competencia: '2026-09' });
  });

  it('permite selecionar fechamento anterior', async () => {
    const client = clientDe();
    const dre = await montarDre({ portalClientId: 'emp-1', competencia: '2026-08', client });
    expect(dre.fechadoEm.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(dre.competenciasDisponiveis).toEqual(['2026-09', '2026-08']);
  });

  it('recusa mês aberto sem ler seus lançamentos ou plano', async () => {
    const client = clientDe();
    await expect(montarDre({ portalClientId: 'emp-1', competencia: '2026-10', client }))
      .rejects.toMatchObject({ codigo: 'competencia_nao_fechada' });
    expect(client.accountingEntry.findMany).not.toHaveBeenCalled();
    expect(client.chartOfAccount.findMany).not.toHaveBeenCalled();
  });

  it('sem fechamento não fabrica DRE nem consulta lançamentos abertos', async () => {
    const client = clientDe({ fechamentos: [] });
    await expect(montarDre({ portalClientId: 'emp-2', client })).resolves.toEqual({
      semCompetenciaFechada: true, competencia: null, competenciasDisponiveis: [], fechadoEm: null,
      linhas: [], naoClassificado: [], inconsistencias: [], demonstracao: false, semLancamento: true,
    });
    expect(client.accountingEntry.findMany).not.toHaveBeenCalled();
    expect(client.chartOfAccount.findMany).not.toHaveBeenCalled();
    expect(client.companyMonthlyCircular.findMany.mock.calls[0][0].where.portalClientId).toBe('emp-2');
  });

  it('mesmo fechado conserva classificação pendente e valor inválido', async () => {
    const lancamentos = [{ status: 'RASCUNHO', lines: [D('desconhecida', 10), D('x', 'invalido')] }];
    const client = clientDe({ lancamentos });
    const dre = await montarDre({ portalClientId: 'emp-1', client });
    expect(dre.qualidade).toMatchObject({ provisorio: true, status: 'PROVISORIO', linhasNaoClassificadas: 1, linhasInvalidas: 1, lancamentosRascunho: 1 });
    expect(dre.qualidade.motivos).toEqual(['fora_do_plano', 'valor_invalido']);
    expect(dre.naoClassificado).toHaveLength(1);
    expect(dre.inconsistencias).toHaveLength(1);
    expect(lancamentos[0].status).toBe('RASCUNHO');
  });
});
