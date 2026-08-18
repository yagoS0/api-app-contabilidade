// A LIGAÇÃO: o funil de gravação de guia realmente chama a leitura da linha digitável, e o
// serializador realmente devolve as quatro situações.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE SEPARADO DA REGRA. `lerLinhaDigitavelDoPdf.test.js` já prova que a
// leitura decide certo. Isso não prova NADA sobre a tela: o defeito clássico deste projeto é a
// função correta que ninguém chama — bloco que renderiza `null` para sempre porque a prop nunca foi
// passada. O que se prende aqui é o CAMINHO: PDF entra em `createOrUpdateGuideFromProcessing` →
// quatro colunas saem no `data` do Prisma → `toGuideResponse` as traduz em situação para o front.

const mockCriados = [];
const mockAtualizados = [];

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    guide: {
      create: jest.fn(async ({ data }) => {
        mockCriados.push(data);
        return { id: "g1", ...data };
      }),
      update: jest.fn(async ({ data }) => {
        mockAtualizados.push(data);
        return { id: "g1", ...data };
      }),
      findUnique: jest.fn(async () => ({
        emailStatus: "SENT",
        emailSentAt: null,
        emailAttempts: 0,
        emailLastError: null,
        emailNextRetryAt: null,
      })),
    },
  },
}));

jest.mock("../../accounting/fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));
jest.mock("../../accounting/GuideToProvisionService.js", () => ({
  generateProvisionsFromGuide: jest.fn(async () => null),
}));

// `pdf-parse` é CJS e entra por import dinâmico dentro de `lerLinhaDigitavelDoPdf`.
let mockTextoDoPdf = "";
jest.mock("pdf-parse", () => jest.fn(async () => ({ text: mockTextoDoPdf })));

const { createOrUpdateGuideFromProcessing, toGuideResponse } = require("../GuideService.js");
const { SITUACAO_LINHA } = require("../lerLinhaDigitavelDoPdf.js");
const { MOTIVOS } = require("../linhaDigitavelArrecadacao.js");

// DAS real do banco local: R$ 3.422,00 (342200 centavos codificados nas posições 05–15).
const LINHA_OK = "858800000342220003282624010720261829070844066762";
const TEXTO_DAS = "Documento de Arrecadação\n85880000034 2 22000328262 4 01072026182 9 07084406676 2\n";

const PDF = Buffer.from("%PDF-1.4 conteudo");

function chamar(extras = {}) {
  return createOrUpdateGuideFromProcessing({
    portalClientId: "empresa-1",
    parsed: { competencia: "2026-06", tipo: "SIMPLES", valor: 3422, vencimento: "2026-07-20", cnpj: "48684291000100" },
    source: "SERPRO",
    status: "PROCESSED",
    pdfBytes: PDF,
    ...extras,
  });
}

beforeEach(() => {
  mockCriados.length = 0;
  mockAtualizados.length = 0;
  mockTextoDoPdf = TEXTO_DAS;
});

describe("o funil grava a linha digitável", () => {
  test("PDF com linha conferida → os 48 dígitos limpos chegam ao `data` do create", async () => {
    await chamar();
    expect(mockCriados).toHaveLength(1);
    expect(mockCriados[0].linhaDigitavel).toBe(LINHA_OK);
    expect(mockCriados[0].linhaDigitavelLidaEm).toBeInstanceOf(Date);
    expect(mockCriados[0].linhaDigitavelMotivo).toBeNull();
    expect(mockCriados[0].linhaDigitavelValorLidoCentavos).toBeNull();
  });

  test("⚠ o valor conferido é o MESMO que está sendo gravado — divergência é recusada na hora", async () => {
    // O caso real do banco: o documento imprime R$ 3.422,00 e a guia está com R$ 100,00.
    await chamar({ parsed: { competencia: "2026-06", tipo: "SIMPLES", valor: 100, vencimento: "2026-07-20" } });
    expect(mockCriados[0].linhaDigitavel).toBeNull();
    expect(mockCriados[0].linhaDigitavelMotivo).toBe(MOTIVOS.VALOR_DIVERGENTE);
    expect(mockCriados[0].linhaDigitavelValorLidoCentavos).toBe(342200);
  });

  test("documento sem linha legível → data de leitura gravada, sem número e sem valor", async () => {
    mockTextoDoPdf = "Boleto bancário de cobrança — outro layout, 47 dígitos\n";
    await chamar();
    expect(mockCriados[0].linhaDigitavel).toBeNull();
    expect(mockCriados[0].linhaDigitavelMotivo).toBe(MOTIVOS.NAO_ENCONTRADA);
    expect(mockCriados[0].linhaDigitavelLidaEm).toBeInstanceOf(Date);
    expect(mockCriados[0].linhaDigitavelValorLidoCentavos).toBeNull();
  });

  test("⚠⚠ update que NÃO fala do arquivo não toca nas quatro colunas", async () => {
    // Confirmar pagamento, liberar ao cliente e reenviar e-mail passam por aqui sem `pdfBytes`.
    // Se este caminho escrevesse, uma linha válida seria apagada por um update que nada tem com ela.
    await createOrUpdateGuideFromProcessing({
      existingGuideId: "g1",
      portalClientId: "empresa-1",
      parsed: { competencia: "2026-06", tipo: "SIMPLES", valor: 3422 },
      source: "SERPRO",
      status: "PROCESSED",
    });
    const data = mockAtualizados[0];
    expect(data).not.toHaveProperty("linhaDigitavel");
    expect(data).not.toHaveProperty("linhaDigitavelLidaEm");
    expect(data).not.toHaveProperty("linhaDigitavelMotivo");
    expect(data).not.toHaveProperty("linhaDigitavelValorLidoCentavos");
  });

  test("PDF removido → volta a 'não tentamos', em vez de descrever um arquivo que não está mais lá", async () => {
    await chamar({ pdfBytes: null });
    expect(mockCriados[0].linhaDigitavel).toBeNull();
    expect(mockCriados[0].linhaDigitavelLidaEm).toBeNull();
    expect(mockCriados[0].linhaDigitavelMotivo).toBeNull();
  });

  test("PDF ilegível não derruba a gravação da guia", async () => {
    const pdfParse = require("pdf-parse");
    pdfParse.mockImplementationOnce(async () => {
      throw new Error("Invalid XRef stream header");
    });
    await expect(chamar()).resolves.toBeTruthy();
    expect(mockCriados[0].linhaDigitavelMotivo).toBe("pdf_ilegivel");
  });
});

describe("o contrato que chega aos dois portais", () => {
  const base = { id: "g1", tipo: "SIMPLES", status: "PROCESSED", valor: 3422 };

  test("as quatro situações saem nomeadas — `linhaDigitavel: null` sozinho não é contrato", () => {
    expect(toGuideResponse({ ...base }).linhaDigitavelSituacao).toBe(SITUACAO_LINHA.NAO_TENTADA);

    const disponivel = toGuideResponse({ ...base, linhaDigitavel: LINHA_OK, linhaDigitavelLidaEm: new Date() });
    expect(disponivel.linhaDigitavelSituacao).toBe(SITUACAO_LINHA.DISPONIVEL);
    expect(disponivel.linhaDigitavel).toBe(LINHA_OK); // 48 dígitos LIMPOS: é o que se digita no banco

    const divergente = toGuideResponse({
      ...base,
      linhaDigitavelLidaEm: new Date(),
      linhaDigitavelMotivo: MOTIVOS.VALOR_DIVERGENTE,
      linhaDigitavelValorLidoCentavos: 79079,
    });
    expect(divergente.linhaDigitavelSituacao).toBe(SITUACAO_LINHA.DIVERGENTE);
    expect(divergente.linhaDigitavel).toBeNull(); // ⚠ o número em conflito NUNCA vai para a tela
    expect(divergente.linhaDigitavelValorLidoCentavos).toBe(79079);

    const naoEncontrada = toGuideResponse({
      ...base,
      linhaDigitavelLidaEm: new Date(),
      linhaDigitavelMotivo: MOTIVOS.NAO_ENCONTRADA,
    });
    expect(naoEncontrada.linhaDigitavelSituacao).toBe(SITUACAO_LINHA.NAO_ENCONTRADA);
    expect(naoEncontrada.linhaDigitavelValorLidoCentavos).toBeNull();
  });
});
