// A CHAVE DA DEDUPLICAÇÃO — e a prova de que ela IDENTIFICA.
//
// ⚠ POR QUE ESTA SUÍTE É O CORAÇÃO DA MUDANÇA. A lista do cliente passou a juntar duas fontes: a
// projeção do ADN (`PortalInvoice`) e a nossa emissão (`ServiceInvoice`). Se o casamento entre
// elas errar, o defeito não é cosmético: **a nota aparece duas vezes**, e ela entra duas vezes no
// "Valor total" da competência. É a mesma classe do defeito já medido em `ingestaoNfse.js`, em que
// o import criava uma segunda linha e o faturamento somava a nota duplicada.
//
// As três provas, cada uma exercitada SOZINHA (as outras duas ausentes dos dois lados):
//   1. `chaveAcesso`
//   2. a TUPLA DO E0014 — `(série, nDPS)`, lida do `xmlRaw` do lado do ADN
//   3. `numeroNfse` (`nNFSe`)
//
// ⚠ E o negativo que importa tanto quanto: **ausência não vira igualdade**. Duas notas sem chave,
// sem número e sem XML NÃO são declaradas a mesma.
//
// ⚠ NADA AQUI EMITE, CANCELA OU CONSULTA COISA ALGUMA — o Prisma é simulado.

import fs from "node:fs";
import path from "node:path";

const cenario = { emitidas: [], projecao: [] };

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const prisma = {
    serviceInvoice: { findMany: jest.fn() },
    portalInvoice: { findMany: jest.fn() },
  };
  return { prisma };
});

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  lerEmitidasNaoConfirmadas,
  identidadeDaEmissao,
  identidadeDaProjecao,
  mesmaNota,
  TETO_EMITIDAS,
} from "../notasEmitidasNaoConfirmadas.js";

const LEGACY = "company-legacy-1";
const PORTAL = "portal-1";

/**
 * O XML como a captura o guarda: a NFS-e devolvida pelo sistema nacional, com a DPS DENTRO dela.
 * ⚠ O caminho `NFSe/infNFSe/DPS/infDPS/{serie,nDPS}` é o da NT 008 §2.4.5 — é dele que
 * `nfseUltimaNota.lerSerieENumeroDaDps` lê, e é o mesmo par que `buildDpsXml` escreve a partir da
 * numeração reservada.
 */
function xmlComDps({ serie, nDPS }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS123">
    <nNFSe>4321</nNFSe>
    <DPS>
      <infDPS Id="DPS330455720000000000191${serie}${String(nDPS).padStart(15, "0")}">
        <serie>${serie}</serie>
        <nDPS>${nDPS}</nDPS>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;
}

function emissao(over = {}) {
  return {
    id: "si-1",
    chaveAcesso: null,
    numeroNfse: null,
    rpsSerie: "00001",
    rpsNumero: "7",
    tomadorDoc: "11222333000181",
    tomadorNome: "TOMADOR LTDA",
    valorServicos: 100,
    competencia: new Date("2026-08-01T00:00:00Z"),
    status: "issued",
    createdAt: new Date("2026-08-19T12:00:00Z"),
    updatedAt: new Date("2026-08-19T12:00:00Z"),
    ...over,
  };
}

function doAdn(over = {}) {
  return { id: "pi-1", chaveAcesso: null, numero: null, xmlRaw: null, ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  cenario.emitidas = [];
  cenario.projecao = [];
  prisma.serviceInvoice.findMany.mockImplementation(async () => cenario.emitidas);
  prisma.portalInvoice.findMany.mockImplementation(async () => cenario.projecao);
});

async function rodar() {
  return lerEmitidasNaoConfirmadas({ legacyCompanyId: LEGACY, portalClientId: PORTAL });
}

describe("⚠⚠ prova 1 — `chaveAcesso`", () => {
  it("mesma chave dos dois lados ⇒ é a MESMA nota (não aparece duas vezes)", async () => {
    const chave = "3".repeat(50);
    cenario.emitidas = [emissao({ chaveAcesso: chave })];
    cenario.projecao = [doAdn({ chaveAcesso: chave })];
    expect(await rodar()).toEqual([]);
  });

  it("chaves DIFERENTES ⇒ são duas notas", async () => {
    cenario.emitidas = [emissao({ chaveAcesso: "3".repeat(50) })];
    cenario.projecao = [doAdn({ chaveAcesso: "4".repeat(50) })];
    expect(await rodar()).toHaveLength(1);
  });

  it("⚠ o FALLBACK `chaveAcesso = numeroNfse` da emissão não casa com a chave de outra nota", () => {
    // `NfseService.js` grava `response.chaveAcesso || response.numeroNfse || null`. O número é
    // curto; a chave da NFS-e Nacional tem 50 dígitos. A prova fica INCOMPLETA, nunca INSEGURA.
    const nossa = identidadeDaEmissao(emissao({ chaveAcesso: "4321", rpsSerie: null, rpsNumero: null }));
    const deles = identidadeDaProjecao(doAdn({ chaveAcesso: "3".repeat(50) }));
    expect(mesmaNota(nossa, deles)).toBe(false);
  });
});

describe("⚠⚠ prova 2 — a TUPLA DO E0014 `(série, nDPS)`: a única que funciona SEM CHAVE dos dois lados", () => {
  it("nota SEM CHAVE e SEM NÚMERO dos dois lados é reconhecida pela tupla lida do XML", async () => {
    cenario.emitidas = [emissao({ chaveAcesso: null, numeroNfse: null, rpsSerie: "00001", rpsNumero: "7" })];
    cenario.projecao = [doAdn({ chaveAcesso: null, numero: null, xmlRaw: xmlComDps({ serie: "00001", nDPS: 7 }) })];
    expect(await rodar()).toEqual([]);
  });

  it("⚠ `1` e `00001` são a MESMA série — as duas escritas convergem para a forma de 5 dígitos", async () => {
    cenario.emitidas = [emissao({ rpsSerie: "1", rpsNumero: "7" })];
    cenario.projecao = [doAdn({ xmlRaw: xmlComDps({ serie: "00001", nDPS: 7 }) })];
    expect(await rodar()).toEqual([]);
  });

  it("MESMA série e nDPS DIFERENTE ⇒ são duas notas", async () => {
    cenario.emitidas = [emissao({ rpsSerie: "00001", rpsNumero: "7" })];
    cenario.projecao = [doAdn({ xmlRaw: xmlComDps({ serie: "00001", nDPS: 8 }) })];
    expect(await rodar()).toHaveLength(1);
  });

  it("MESMO nDPS em série DIFERENTE ⇒ são duas notas (a tupla é o par, não o número)", async () => {
    cenario.emitidas = [emissao({ rpsSerie: "00002", rpsNumero: "7" })];
    cenario.projecao = [doAdn({ xmlRaw: xmlComDps({ serie: "00001", nDPS: 7 }) })];
    expect(await rodar()).toHaveLength(1);
  });

  it("⚠ série cadastrada FORA da faixa E0010 ainda é COMPARÁVEL — a comparação não valida", async () => {
    // `normalizarSerie` LANÇA fora de 1–49999, e é isso que ela existe para fazer na EMISSÃO.
    // Aqui recusar a comparação faria a nota duplicar justamente quando o cadastro está torto.
    cenario.emitidas = [emissao({ rpsSerie: "99999", rpsNumero: "7" })];
    cenario.projecao = [doAdn({ xmlRaw: xmlComDps({ serie: "99999", nDPS: 7 }) })];
    expect(await rodar()).toEqual([]);
  });
});

describe("⚠⚠ prova 3 — `numeroNfse` (a rede quando o XML não pôde ser lido)", () => {
  it("mesmo `nNFSe` dos dois lados ⇒ é a MESMA nota, mesmo sem chave e sem XML", async () => {
    cenario.emitidas = [emissao({ numeroNfse: "4321" })];
    cenario.projecao = [doAdn({ numero: "4321", xmlRaw: null })];
    expect(await rodar()).toEqual([]);
  });

  it("números diferentes ⇒ duas notas", async () => {
    cenario.emitidas = [emissao({ numeroNfse: "4321" })];
    cenario.projecao = [doAdn({ numero: "9999" })];
    expect(await rodar()).toHaveLength(1);
  });
});

describe("⚠⚠ AUSÊNCIA NÃO VIRA IGUALDADE", () => {
  it("chave nula dos DOIS lados NÃO declara que são a mesma nota", () => {
    const nossa = identidadeDaEmissao(emissao({ chaveAcesso: null, numeroNfse: null, rpsSerie: null, rpsNumero: null }));
    const deles = identidadeDaProjecao(doAdn({ chaveAcesso: null, numero: null, xmlRaw: null }));
    expect(nossa).toEqual({ chave: null, tupla: null, numero: null });
    expect(deles).toEqual({ chave: null, tupla: null, numero: null });
    expect(mesmaNota(nossa, deles)).toBe(false);
  });

  it("string vazia é tratada como ausência, não como valor que casa", () => {
    const nossa = identidadeDaEmissao(emissao({ chaveAcesso: "", numeroNfse: "", rpsSerie: "", rpsNumero: "" }));
    expect(nossa).toEqual({ chave: null, tupla: null, numero: null });
    expect(mesmaNota(nossa, nossa)).toBe(false);
  });

  it("XML ILEGÍVEL não fabrica tupla — a linha nossa continua aparecendo, e nada é adivinhado", async () => {
    cenario.emitidas = [emissao()];
    cenario.projecao = [doAdn({ xmlRaw: "isto não é XML" })];
    const fora = await rodar();
    expect(fora).toHaveLength(1);
  });
});

describe("quais linhas nossas entram", () => {
  it.each([
    ["pending", "a reserva do número acontece ANTES de o pedido sair — a nota pode não existir"],
    ["rejected", "recusa fiscal: não gerou nota"],
    ["falha_envio", "erro nosso ou queda de rede: não gerou nota"],
  ])("`%s` NUNCA entra na lista (%s)", async (status) => {
    // A exclusão é feita no `where` da consulta — o que se prova aqui é o CONTRATO dela.
    cenario.emitidas = [];
    await rodar();
    const where = prisma.serviceInvoice.findMany.mock.calls[0][0].where;
    expect(where.status.notIn).toContain(status);
  });

  it("a consulta é escopada pela empresa LEGADA e a projeção pelo PortalClient (multi-tenancy)", async () => {
    cenario.emitidas = [emissao()];
    await rodar();
    expect(prisma.serviceInvoice.findMany.mock.calls[0][0].where.companyId).toBe(LEGACY);
    const wherePi = prisma.portalInvoice.findMany.mock.calls[0][0].where;
    expect(wherePi.clientId).toBe(PORTAL);
    // ⚠ `papel: "EMIT"` é indispensável: a numeração de uma nota RECEBIDA é do prestador dela, e
    // comparar a tupla do E0014 contra ela atravessaria CNPJs.
    expect(wherePi.papel).toBe("EMIT");
    expect(wherePi.type).toBe("NFSE");
  });

  it("sem `companyId` legado (empresa sem vínculo) não há o que juntar, e nada é consultado", async () => {
    expect(await lerEmitidasNaoConfirmadas({ legacyCompanyId: null, portalClientId: PORTAL })).toEqual([]);
    expect(prisma.serviceInvoice.findMany).not.toHaveBeenCalled();
  });

  it("há teto de leitura — defesa contra empresa com a captura parada há meses", async () => {
    cenario.emitidas = [emissao()];
    await rodar();
    expect(prisma.serviceInvoice.findMany.mock.calls[0][0].take).toBe(TETO_EMITIDAS);
  });
});

describe("⚠ ESTE MÓDULO NÃO ESCREVE NADA — a união é de LEITURA", () => {
  it("só `findMany` é chamado, uma vez de cada lado", async () => {
    cenario.emitidas = [emissao()];
    await rodar();
    expect(prisma.serviceInvoice.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.portalInvoice.findMany).toHaveBeenCalledTimes(1);
  });

  it("⚠ VARREDURA DO FONTE: nenhuma escrita de Prisma aparece no arquivo", () => {
    // Molde de `ingestaoNfseUnica.test.js`: o mock não pega o que ninguém escreveu ainda. Esta
    // varredura é o que impede alguém "resolver" a duplicata gravando `PortalInvoice` na leitura —
    // exatamente o caminho que o cabeçalho do módulo existe para proibir.
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "notasEmitidasNaoConfirmadas.js"),
      "utf8",
    );
    for (const proibido of [".create(", ".createMany(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$executeRaw"]) {
      expect(fonte).not.toContain(proibido);
    }
  });
});
