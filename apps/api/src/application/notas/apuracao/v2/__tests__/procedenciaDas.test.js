// CADA NÚMERO DE DAS NA SUA COLUNA — e o que não tem dono continua dizendo que não tem.
//
// O defeito: `FechamentoService.calcularFechamento` gravava o valor da SIMULAÇÃO OFICIAL da RFB
// (`TRANSDECLARACAO11`, `indicadorTransmissao:false`) dentro de `ApuracaoSnapshot.dasCalculadoLocal`
// — a coluna do NOSSO motor, que também escreve nela. A coluna passou a guardar ora um número, ora
// o outro, sem NADA na linha que os distinguisse; e na mesma escrita zerava `receitaPorTipo` e
// `receitaPorAnexo`, apagando do snapshot a segregação por tipo daquele mês.
//
// O que estes testes travam:
//   1. o valor da simulação NÃO entra em `dasCalculadoLocal` — vai para `dasSimuladoSerpro`;
//   2. `calcularFechamento` não encosta no grupo de colunas do motor (nem para zerar);
//   3. `receitaPorTipo` deixa de ser zerada e passa a ser gravada de verdade;
//   4. o motor marca o que escreve (`dasCalculadoLocalProcedencia: MOTOR_LOCAL`);
//   5. o snapshot ANTIGO, sem marca, continua saindo como AMBÍGUO — o estado que a tela mostra.
//
// ⚠ O item 5 é o que impede a "correção" de virar mentira nova: apagar a ambiguidade dos dados
// velhos seria afirmar procedência que ninguém pode provar.

jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findUnique: jest.fn(async () => null),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    aggregate: jest.fn(async () => ({ _sum: { total: 0 } })),
    count: jest.fn(async () => 0),
    create: jest.fn(async (args) => ({ id: "novo", ...(args?.data || {}) })),
    update: jest.fn(async (args) => ({ id: "existente", ...(args?.data || {}) })),
  });
  return {
    prisma: {
      portalClient: model(),
      portalInvoice: model(),
      apuracaoSnapshot: model(),
      cadastroFiscal: model(),
      filaPendencia: model(),
      companyMonthlyCircular: model(),
      logDecisaoFatorR: model(),
      aliquotaSimplesNacional: model(),
      relatorioFaturamento: model(),
      company: model(),
    },
  };
});

const mockSimular = jest.fn();
jest.mock("../../../../fiscal/serpro/PgdasSimulacaoService.js", () => ({
  PgdasSimulacaoService: jest.fn().mockImplementation(() => ({ simular: mockSimular, transmitir: jest.fn() })),
  parseRetornoSimulacao: jest.fn(),
}));
jest.mock("../../../../fiscal/serpro/SerproPgdasdService.js", () => ({ SerproPgdasdService: jest.fn() }));
jest.mock("../../../../fiscal/serpro/SerproRuntimeSettings.js", () => ({
  getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { hasCertificate: true, document: "11111111111111" } })),
}));
jest.mock("../RbtExtratoService.js", () => ({
  getRbt12: jest.fn(async () => ({ rbt12: 480000, origem: "teste", detalhePorMes: [] })),
  lerPeriodosAceitos: jest.fn(async () => null),
  gravarPeriodosAceitos: jest.fn(async () => null),
}));
jest.mock("../ApuracaoConfigMemoryService.js", () => ({
  lerConfigMemory: jest.fn(async () => null),
  salvarConfigMemory: jest.fn(async () => null),
  normalizarFormaAtividades: jest.fn((x) => x),
}));
jest.mock("../AtividadeResolver.js", () => ({ montarAtividadesDefault: jest.fn(), carregarAtividades: jest.fn() }));
jest.mock("../DisparidadeService.js", () => ({ detectarDisparidades: jest.fn(async () => []) }));
jest.mock("../FolhaDerivadaService.js", () => ({ derivarFolha12m: jest.fn(async () => null) }));
// A tabela de alíquotas é regra fiscal versionada e tem teste próprio — aqui só precisa devolver
// UMA faixa para o motor chegar até a escrita do snapshot.
jest.mock("../AliquotaResolver.js", () => ({
  resolverAliquota: jest.fn(async () => ({
    aliquotaNominal: 0.113, parcelaDeduzir: 22500, faixa: 3, vigenciaInicio: new Date("2018-01-01T00:00:00Z"),
  })),
  calcularAliquotaEfetiva: jest.fn(() => 0.0754),
  AliquotaResolverError: class extends Error {},
}));

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { calcularFechamento } from "../FechamentoService.js";
import { calcularApuracaoLocal } from "../MotorApuracaoService.js";
import { montarRelatorioFaturamento } from "../RelatorioFaturamentoService.js";
import { PROCEDENCIA_DAS, ehCalculoNosso } from "../procedenciaDas.js";

const PORTAL_ID = "portal-1";
const COMPETENCIA = "2026-06";
const BASE = { portalClientId: PORTAL_ID, competencia: COMPETENCIA };
const ATIVIDADES = [{ idAtividade: 11, valorInterno: 10000, valorExterno: 0 }];

/** Uma nota EMIT autorizada com dois itens classificados — a segregação por tipo do mês. */
const NOTAS = [{
  id: "nota-1", type: "NFSE", numero: "1", serie: "1", chaveAcesso: null,
  issueDate: new Date("2026-06-15T12:00:00Z"), competencia: new Date("2026-06-01T00:00:00Z"),
  total: "10000.00", tomadorNome: "CLIENTE", tomadorDoc: "11222333000181",
  itens: [
    { id: "i1", valor: "6000.00", descricao: "Revenda", cfop: "5102", codigoServico: null, ncm: "1", tipoReceita: "REVENDA_MERCADORIA", flagST: false, flagMonofasico: false, flagExportacao: false },
    { id: "i2", valor: "4000.00", descricao: "Serviço", cfop: null, codigoServico: "1.01", ncm: null, tipoReceita: "SERVICO_ANEXO_III", flagST: false, flagMonofasico: false, flagExportacao: false },
  ],
}];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findUnique.mockResolvedValue({
    id: PORTAL_ID, razao: "EMPRESA TESTE LTDA", cnpj: "34627370000175", municipio: "São Paulo", uf: "SP",
  });
  prisma.portalInvoice.findMany.mockResolvedValue(NOTAS);
  prisma.portalInvoice.aggregate.mockResolvedValue({ _sum: { total: 10000 } });
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  prisma.cadastroFiscal.findUnique.mockResolvedValue({ portalClientId: PORTAL_ID, regime: "SIMPLES_NACIONAL", sublimiteICMSISS: false });
  prisma.filaPendencia.count.mockResolvedValue(0);
  mockSimular.mockResolvedValue({ dasValor: 812.34, rbt12: null, mensagens: [], raw: { simulado: true } });
});

/** O objeto que foi de fato para o banco no [Calcular]. */
function dadosGravadosNoCalcular() {
  const create = prisma.apuracaoSnapshot.create.mock.calls[0];
  const update = prisma.apuracaoSnapshot.update.mock.calls[0];
  return create ? create[0].data : update[0].data;
}

describe("[Calcular] — a simulação da RFB não mora na coluna do motor", () => {
  it("⚠ o valor da simulação vai para `dasSimuladoSerpro`, NUNCA para `dasCalculadoLocal`", async () => {
    await calcularFechamento({ ...BASE, atividades: ATIVIDADES });
    const data = dadosGravadosNoCalcular();

    expect(data.dasSimuladoSerpro).toBe(812.34);
    // Este é o defeito, escrito como asserção: o número da Receita dentro da coluna "local".
    expect(data.dasCalculadoLocal).toBeUndefined();
  });

  it("⚠ não é `dasRetornadoSerpro` tampouco — simular não é transmitir", async () => {
    // A coluna do transmitido é escrita só em `transmitirFechamento`, junto de `numeroDeclaracao`
    // e `transmitidoEm`. Preenchê-la aqui faria uma competência apenas calculada parecer entregue.
    await calcularFechamento({ ...BASE, atividades: ATIVIDADES });
    const data = dadosGravadosNoCalcular();

    expect(data.dasRetornadoSerpro).toBeUndefined();
    expect(data.numeroDeclaracao).toBeUndefined();
    expect(data.transmitidoEm).toBeUndefined();
    expect(data.estado).toBe("calculada");
  });

  it("⚠ NÃO ZERA `receitaPorTipo` — grava a segregação do mês, de verdade", async () => {
    await calcularFechamento({ ...BASE, atividades: ATIVIDADES });
    const data = dadosGravadosNoCalcular();

    // Era `{}`. Uma competência que passasse pelo Calcular perdia a segregação por tipo.
    expect(data.receitaPorTipo).toEqual({ REVENDA_MERCADORIA: 6000, SERVICO_ANEXO_III: 4000 });
  });

  it("⚠ não encosta no grupo de colunas do MOTOR — nem para zerar", async () => {
    // `receitaPorAnexo: {}` afirmaria "calculei e não achei anexo nenhum". Este caminho não decide
    // anexo: quem decide, a partir das atividades, é a RFB. Ausente = intocado; no `create` a
    // coluna nasce NULA = "o motor nunca rodou aqui".
    await calcularFechamento({ ...BASE, atividades: ATIVIDADES });
    const data = dadosGravadosNoCalcular();

    for (const coluna of ["receitaPorAnexo", "dasCalculadoLocal", "dasCalculadoLocalProcedencia",
      "aliquotaEfetivaPorAnexo", "vigenciaAliquota"]) {
      expect(Object.prototype.hasOwnProperty.call(data, coluna)).toBe(false);
    }
  });

  it("o retorno cru da simulação continua guardado em `simulacaoSerpro`", async () => {
    // É o campo que PROVA a procedência do valor — e é dele que o backfill da migration se serve.
    await calcularFechamento({ ...BASE, atividades: ATIVIDADES });
    expect(dadosGravadosNoCalcular().simulacaoSerpro).toEqual({ simulado: true });
  });
});

describe("[Motor local] — a marca de procedência viaja com o número", () => {
  it("⚠ grava `dasCalculadoLocalProcedencia: MOTOR_LOCAL` junto do DAS", async () => {
    const r = await calcularApuracaoLocal({ ...BASE });
    expect(r.ok).toBe(true);

    const data = prisma.apuracaoSnapshot.create.mock.calls[0][0].data;
    expect(data.dasCalculadoLocalProcedencia).toBe(PROCEDENCIA_DAS.MOTOR_LOCAL);
    expect(data.dasCalculadoLocal).toBeGreaterThan(0);
    // E a decomposição que sustenta o número vai junto — é ela que o [Calcular] apagava.
    expect(data.receitaPorAnexo).toEqual(expect.any(Object));
    expect(Object.keys(data.receitaPorAnexo).length).toBeGreaterThan(0);
  });

  it("`ehCalculoNosso` só aceita a marca explícita — ausência não é prova", async () => {
    expect(ehCalculoNosso(PROCEDENCIA_DAS.MOTOR_LOCAL)).toBe(true);
    expect(ehCalculoNosso(PROCEDENCIA_DAS.AMBIGUO)).toBe(false);
    // ⚠ O default NÃO é "nosso": linha com valor e sem marca é linha velha, e velha é ambígua.
    expect(ehCalculoNosso(null)).toBe(false);
    expect(ehCalculoNosso(undefined)).toBe(false);
  });
});

describe("[Relatório] — o que a tela recebe sobre a procedência", () => {
  async function oficialDoRelatorio(snapshot) {
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue(snapshot);
    const dados = await montarRelatorioFaturamento({ ...BASE });
    return dados.preApurado.oficial;
  }

  it("⚠ snapshot ANTIGO (valor sem marca) continua AMBÍGUO — a tela não pode afirmar de quem é", async () => {
    const oficial = await oficialDoRelatorio({
      estado: "calculada", dasRetornadoSerpro: null, dasSimuladoSerpro: null,
      dasCalculadoLocal: "1234.56", dasCalculadoLocalProcedencia: null,
    });

    expect(oficial.dasCalculadoLocalNoSnapshot).toMatchObject({ valor: 1234.56, procedenciaAmbigua: true });
    expect(oficial.dasSimuladoSerpro).toBeNull();
  });

  it("valor marcado MOTOR_LOCAL NÃO sai no bloco oficial — ele é nosso", async () => {
    // Sair aqui o faria ser lido como "o número da Receita", que é o defeito original pelo avesso.
    const oficial = await oficialDoRelatorio({
      estado: "calculada", dasRetornadoSerpro: null, dasSimuladoSerpro: null,
      dasCalculadoLocal: "999.00", dasCalculadoLocalProcedencia: PROCEDENCIA_DAS.MOTOR_LOCAL,
    });

    expect(oficial.dasCalculadoLocalNoSnapshot).toBeNull();
  });

  it("a simulação chega nomeada, e sem ambiguidade", async () => {
    const oficial = await oficialDoRelatorio({
      estado: "calculada", dasRetornadoSerpro: null, dasSimuladoSerpro: "812.34",
      dasCalculadoLocal: null, dasCalculadoLocalProcedencia: null,
    });

    expect(oficial.dasSimuladoSerpro).toBe(812.34);
    expect(oficial.dasRetornadoSerpro).toBeNull();
    expect(oficial.dasCalculadoLocalNoSnapshot).toBeNull();
  });

  it("marcado AMBIGUO explicitamente também segue ambíguo", async () => {
    const oficial = await oficialDoRelatorio({
      estado: "calculada", dasRetornadoSerpro: null, dasSimuladoSerpro: null,
      dasCalculadoLocal: "77.00", dasCalculadoLocalProcedencia: PROCEDENCIA_DAS.AMBIGUO,
    });

    expect(oficial.dasCalculadoLocalNoSnapshot).toMatchObject({ valor: 77, procedenciaAmbigua: true });
  });
});
