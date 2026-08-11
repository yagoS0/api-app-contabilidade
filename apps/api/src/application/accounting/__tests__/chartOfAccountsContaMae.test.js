// A CONTA MÃE NO IMPORT — casa pelo REDUZIDO, só ACRESCENTA, mantém o que não veio no arquivo.
//
// ⚠ O que estes testes existem para reprovar:
//   1. o import trocar o `codigo` (reduzido) de uma conta. `AccountingEntryLine.conta` o guarda
//      como TEXTO, sem FK: trocá-lo orfanaria todo lançamento existente SEM ERRO NA TELA;
//   2. as duas colunas de código serem lidas na ordem errada — 42 códigos existem nas duas e 41
//      apontam para contas diferentes, então a troca não dá erro, dá resposta errada;
//   3. conta que está no banco e não está no arquivo ser apagada/zerada (decisão do dono: MANTÉM);
//   4. um arquivo sem a coluna APAGAR a conta mãe já conhecida.

const mockContas = [];
let mockNextId = 1;

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    chartOfAccount: {
      findFirst: jest.fn(async ({ where }) =>
        mockContas.find((c) => c.codigo === where.codigo && (c.portalClientId ?? null) === (where.portalClientId ?? null)) || null),
      findMany: jest.fn(async ({ where = {} } = {}) => mockContas.filter((c) => {
        if (where.id?.in) return where.id.in.includes(c.id);
        if (where.portalClientId?.not === null) {
          if (c.portalClientId == null) return false;
        } else if ("portalClientId" in where) {
          if ((c.portalClientId ?? null) !== (where.portalClientId ?? null)) return false;
        }
        if (where.codigo && c.codigo !== where.codigo) return false;
        return true;
      }).map((c) => ({ ...c }))),
      update: jest.fn(async ({ where, data }) => {
        const alvo = mockContas.find((c) => c.id === where.id);
        Object.assign(alvo, data);
        return { ...alvo };
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const alvos = mockContas.filter((c) => where.id?.in?.includes(c.id));
        for (const a of alvos) Object.assign(a, data);
        return { count: alvos.length };
      }),
      create: jest.fn(async ({ data }) => {
        const novo = { id: `c${mockNextId++}`, analitica: null, codigoCompleto: null, ...data };
        mockContas.push(novo);
        return { ...novo };
      }),
    },
  },
}));

import { importChartOfAccountsFromBuffer, parseCsvBuffer } from "../chartOfAccountsImport.js";

const csv = (texto) => Buffer.from(texto, "latin1");

// O arquivo real do ERP: `completo;nome;reduzido;0;0;0`, LATIN1, sem cabeçalho.
const ARQUIVO_REAL = [
  "1;ATIVO;1;0;0;0",
  "11;ATIVO CIRCULANTE;2;0;0;0",
  "111;DISPONIVEL;3;0;0;0",
  "11101;CAIXA GERAL;4;0;0;0",
  "111010001;CAIXA - MATRIZ;5;0;0;0",
  "111010002;CAIXA PEQUENO;6;0;0;0",
  "5;(-) IRPJ/CSLL;590;0;0;0",
  "50;(-) IRPJ;591;0;0;0",
].join("\r\n");

beforeEach(() => {
  mockContas.length = 0;
  mockNextId = 1;
  jest.clearAllMocks();
});

describe("parseCsvBuffer — a ordem das colunas é DECLARADA", () => {
  it("lê `completo;nome;reduzido` e NÃO confunde as duas colunas de código", () => {
    const parsed = parseCsvBuffer(csv(ARQUIVO_REAL));
    const caixa = parsed.find((a) => a.codigo === "5");
    expect(caixa.nome).toBe("CAIXA - MATRIZ");
    expect(caixa.codigoCompleto).toBe("111010001");

    // "5" também existe como código COMPLETO — e é outra conta.
    const irpj = parsed.find((a) => a.codigoCompleto === "5");
    expect(irpj.codigo).toBe("590");
    expect(irpj.nome).toBe("(-) IRPJ/CSLL");
  });

  it("as SEIS colunas do arquivo real não atrapalham (as três últimas são ignoradas)", () => {
    expect(parseCsvBuffer(csv(ARQUIVO_REAL))).toHaveLength(8);
  });

  it("LATIN1: nome com Ç/Ã sobrevive", () => {
    const parsed = parseCsvBuffer(csv("411020055;COMISSÃO;535;0;0;0"));
    expect(parsed[0].nome).toBe("COMISSÃO");
  });

  it("CSV antigo (`codigo;nome;tipo;natureza`) continua lido, e SEM código completo", () => {
    const parsed = parseCsvBuffer(csv("464;SERVICOS PJ;DESPESA;DEVEDORA"));
    expect(parsed[0]).toMatchObject({ codigo: "464", nome: "SERVICOS PJ", tipo: "DESPESA" });
    expect(parsed[0].codigoCompleto).toBeUndefined();
  });
});

describe("import — casa pelo reduzido e só acrescenta", () => {
  it("conta existente MANTÉM o `codigo`; ganha `codigoCompleto` e `analitica`", async () => {
    mockContas.push({ id: "existente", portalClientId: null, codigo: "5", nome: "CAIXA - MATRIZ", tipo: "ATIVO", natureza: "DEVEDORA", codigoCompleto: null, analitica: null });

    await importChartOfAccountsFromBuffer({ portalClientId: null, buffer: csv(ARQUIVO_REAL), filename: "plano.csv" });

    const caixa = mockContas.find((c) => c.id === "existente");
    expect(caixa.codigo).toBe("5"); // ⚠ a identidade não muda, nunca
    expect(caixa.codigoCompleto).toBe("111010001");
    expect(caixa.analitica).toBe(true); // folha
  });

  it("a conta de AGREGAÇÃO sai sintética; a folha sai analítica", async () => {
    await importChartOfAccountsFromBuffer({ portalClientId: null, buffer: csv(ARQUIVO_REAL), filename: "plano.csv" });
    const por = (codigo) => mockContas.find((c) => c.codigo === codigo);
    expect(por("1").analitica).toBe(false); // "1" tem "11" abaixo
    expect(por("4").analitica).toBe(false); // "11101" tem "111010001" abaixo
    expect(por("5").analitica).toBe(true); // "111010001" é folha
    expect(por("590").analitica).toBe(false); // "5" tem "50" abaixo
  });

  it("conta no banco que NÃO está no arquivo é mantida — e relatada", async () => {
    mockContas.push({ id: "propria", portalClientId: null, codigo: "999", nome: "CONTA DO ESCRITORIO", tipo: "DESPESA", natureza: "DEVEDORA", codigoCompleto: null, analitica: null });

    const r = await importChartOfAccountsFromBuffer({ portalClientId: null, buffer: csv(ARQUIVO_REAL), filename: "plano.csv" });

    const mantida = mockContas.find((c) => c.id === "propria");
    expect(mantida).toBeDefined();
    expect(mantida.nome).toBe("CONTA DO ESCRITORIO");
    expect(mantida.codigoCompleto).toBeNull();
    expect(mantida.analitica).toBeNull(); // ⚠ ausência nunca é resposta
    expect(r.mantidas).toBe(1);
    expect(r.mantidasCodigos).toContain("999");
    expect(r.semCodigoCompleto).toBe(1);
  });

  it("arquivo SEM a coluna não apaga a conta mãe já conhecida", async () => {
    mockContas.push({ id: "ja", portalClientId: null, codigo: "5", nome: "CAIXA - MATRIZ", tipo: "ATIVO", natureza: "DEVEDORA", codigoCompleto: "111010001", analitica: true });

    await importChartOfAccountsFromBuffer({ portalClientId: null, buffer: csv("5;CAIXA - MATRIZ;ATIVO;DEVEDORA"), filename: "antigo.csv" });

    expect(mockContas.find((c) => c.id === "ja").codigoCompleto).toBe("111010001");
  });
});

describe("import GLOBAL — propaga para as contas PRÓPRIAS das empresas", () => {
  it("acrescenta `codigoCompleto` na conta da empresa, sem tocar nome/tipo/natureza", async () => {
    mockContas.push({ id: "emp", portalClientId: "empresa-1", codigo: "5", nome: "CAIXA DA EMPRESA", tipo: "ATIVO", natureza: "DEVEDORA", codigoCompleto: null, analitica: null });

    await importChartOfAccountsFromBuffer({ portalClientId: null, buffer: csv(ARQUIVO_REAL), filename: "plano.csv" });

    const daEmpresa = mockContas.find((c) => c.id === "emp");
    expect(daEmpresa.codigoCompleto).toBe("111010001");
    expect(daEmpresa.nome).toBe("CAIXA DA EMPRESA"); // ⚠ o arquivo global não manda no nome dela
    expect(daEmpresa.codigo).toBe("5");
  });

  it("NÃO cria conta nenhuma dentro da empresa", async () => {
    mockContas.push({ id: "emp", portalClientId: "empresa-1", codigo: "5", nome: "CAIXA DA EMPRESA", tipo: "ATIVO", natureza: "DEVEDORA", codigoCompleto: null, analitica: null });

    await importChartOfAccountsFromBuffer({ portalClientId: null, buffer: csv(ARQUIVO_REAL), filename: "plano.csv" });

    expect(mockContas.filter((c) => c.portalClientId === "empresa-1")).toHaveLength(1);
  });

  it("import DE UMA EMPRESA não propaga para o global nem para as outras", async () => {
    mockContas.push({ id: "g", portalClientId: null, codigo: "5", nome: "CAIXA - MATRIZ", tipo: "ATIVO", natureza: "DEVEDORA", codigoCompleto: null, analitica: null });
    mockContas.push({ id: "outra", portalClientId: "empresa-2", codigo: "5", nome: "CAIXA", tipo: "ATIVO", natureza: "DEVEDORA", codigoCompleto: null, analitica: null });

    await importChartOfAccountsFromBuffer({ portalClientId: "empresa-1", buffer: csv(ARQUIVO_REAL), filename: "plano.csv" });

    expect(mockContas.find((c) => c.id === "g").codigoCompleto).toBeNull();
    expect(mockContas.find((c) => c.id === "outra").codigoCompleto).toBeNull();
  });
});

describe("import — a derivação NÃO cruza escopos", () => {
  it("a empresa que só tem a MÃE (sem as filhas) sai ANALÍTICA — o erro tem direção segura", async () => {
    // A empresa tem só a conta "1" (completo "1"). No global ela é sintética; no plano DELA não há
    // filha nenhuma, então ela sai analítica — continua sugerível, que é o estado de hoje.
    mockContas.push({ id: "emp1", portalClientId: "empresa-1", codigo: "1", nome: "ATIVO DA EMPRESA", tipo: "ATIVO", natureza: "DEVEDORA", codigoCompleto: null, analitica: null });

    await importChartOfAccountsFromBuffer({ portalClientId: null, buffer: csv(ARQUIVO_REAL), filename: "plano.csv" });

    expect(mockContas.find((c) => c.codigo === "1" && !c.portalClientId).analitica).toBe(false);
    expect(mockContas.find((c) => c.id === "emp1").analitica).toBe(true);
  });
});
