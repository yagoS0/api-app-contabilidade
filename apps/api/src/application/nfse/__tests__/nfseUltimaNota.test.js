// DE ONDE SAI A SÉRIE E O NÚMERO DA DPS — e o que acontece quando não dá para ler.
//
// ⚠ O leiaute é o transcrito em `danfse/danfseLeiaute.js` (NT 008 §2.4.5), bloco "DADOS DA NFS-e":
//     NÚMERO DA DPS → `NFSe/infNFSe/DPS/infDPS/nDPS`
//     SÉRIE DA DPS  → `NFSe/infNFSe/DPS/infDPS/serie`
// Nada aqui foi deduzido por analogia com a NF-e.

import {
  lerSerieENumeroDaDps,
  lerUltimaNumeracaoDaEmpresa,
  NfseUltimaNotaError,
  ESTADO,
  JANELA_DE_NOTAS,
} from "../nfseUltimaNota.js";

// Uma NFS-e como o ADN a devolve: a DPS vive DENTRO da NFS-e.
function nfse({ serie = "00001", nDPS = "7", nNFSe = "900000123", extra = "" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS33045572239254243000191000000000000126019987379520">
    <nNFSe>${nNFSe}</nNFSe>
    <cStat>100</cStat>
    <emit><CNPJ>39254243000191</CNPJ><xNome>PRESTADOR</xNome></emit>
    <DPS>
      <infDPS Id="DPS3304557239254243000191${String(serie).padStart(5, "0")}${String(nDPS).padStart(15, "0")}">
        <tpAmb>1</tpAmb>
        <serie>${serie}</serie>
        <nDPS>${nDPS}</nDPS>
        <dCompet>2026-08-01</dCompet>
        <prest><CNPJ>39254243000191</CNPJ></prest>
        <toma><CNPJ>11222333000144</CNPJ></toma>
        ${extra}
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;
}

describe("leitura do XML — por CAMINHO, nunca por 'primeiro com esse nome'", () => {
  it("lê série e nDPS de uma NFS-e devolvida pelo sistema nacional", () => {
    expect(lerSerieENumeroDaDps(nfse({ serie: "00001", nDPS: "7" }))).toEqual({
      serie: "00001",
      numero: 7,
    });
  });

  it("normaliza a série para 5 dígitos — '1' e '00001' são a MESMA série", () => {
    // Sem isso a comparação com o cadastro (que grava com padding) diria que divergem, e a
    // resolução trocaria de série a cada emissão.
    expect(lerSerieENumeroDaDps(nfse({ serie: "1", nDPS: "12" })).serie).toBe("00001");
  });

  it("⚠ NÃO confunde `nDPS` com `nNFSe` — são dois contadores diferentes", () => {
    // `nNFSe` é o número da NFS-e (do município/SEFIN) e é ele que `PortalInvoice.numero` guarda.
    // Usá-lo como número de DPS misturaria as duas numerações.
    const lido = lerSerieENumeroDaDps(nfse({ nDPS: "7", nNFSe: "900000123" }));
    expect(lido.numero).toBe(7);
    expect(lido.numero).not.toBe(900000123);
  });

  it("⚠ não se confunde com uma tag `serie` de OUTRO grupo do documento", () => {
    // A leitura desce o caminho `NFSe/infNFSe/DPS/infDPS/serie`. Uma varredura por nome
    // (`getTextByLocalNames`) pegaria a primeira do documento — e num leiaute que ganhasse um
    // grupo novo com o mesmo nome, o número da DPS sairia errado sem nenhum erro.
    const xml = `<?xml version="1.0"?><NFSe><infNFSe><outroGrupo><serie>99999</serie><nDPS>4444</nDPS></outroGrupo><DPS><infDPS><serie>00002</serie><nDPS>31</nDPS></infDPS></DPS></infNFSe></NFSe>`;
    expect(lerSerieENumeroDaDps(xml)).toEqual({ serie: "00002", numero: 31 });
  });

  it("lê também uma DPS crua (o que um import manual pode trazer)", () => {
    const xml = `<?xml version="1.0"?><DPS><infDPS><serie>00004</serie><nDPS>9</nDPS></infDPS></DPS>`;
    expect(lerSerieENumeroDaDps(xml)).toEqual({ serie: "00004", numero: 9 });
  });

  it("ausência é `null`, nunca 0 — 0 não é numeração", () => {
    expect(lerSerieENumeroDaDps(null)).toEqual({ serie: null, numero: null });
    expect(lerSerieENumeroDaDps("")).toEqual({ serie: null, numero: null });
    expect(lerSerieENumeroDaDps("<a><b/></a>")).toEqual({ serie: null, numero: null });
    const semNumero = `<NFSe><infNFSe><DPS><infDPS><serie>00001</serie></infDPS></DPS></infNFSe></NFSe>`;
    expect(lerSerieENumeroDaDps(semNumero)).toEqual({ serie: "00001", numero: null });
  });

  it("XML quebrado não derruba a emissão — devolve vazio, e quem recusa é a camada de cima", () => {
    expect(lerSerieENumeroDaDps("<<<não é xml")).toEqual({ serie: null, numero: null });
  });
});

// ── Um Prisma de mentira. Nada aqui toca banco. ──────────────────────────────────────────────
function fakePrisma({ portalClient = { id: "pc1" }, notas = [], erro = null } = {}) {
  const chamadas = [];
  return {
    chamadas,
    client: {
      portalClient: {
        async findUnique(args) {
          chamadas.push(["portalClient.findUnique", args]);
          if (erro === "portalClient") throw new Error("banco fora");
          return portalClient;
        },
      },
      portalInvoice: {
        async findMany(args) {
          chamadas.push(["portalInvoice.findMany", args]);
          if (erro === "portalInvoice") throw new Error("banco fora");
          return notas.slice(0, args.take);
        },
      },
    },
  };
}

describe("a última numeração da empresa", () => {
  it("empresa sem nota nenhuma ⇒ SEM_NOTA (primeira emissão), não erro", async () => {
    const { client } = fakePrisma({ notas: [] });
    await expect(lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client })).resolves.toEqual({
      estado: ESTADO.SEM_NOTA,
      notasLidas: 0,
    });
  });

  it("empresa legada sem PortalClient ⇒ SEM_NOTA — ausência de fonte não é falha de leitura", async () => {
    const { client } = fakePrisma({ portalClient: null });
    await expect(lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client })).resolves.toMatchObject({
      estado: ESTADO.SEM_NOTA,
    });
  });

  it("⚠ o MAIOR nDPS da janela, não o da primeira linha", async () => {
    // A ordenação é por data de emissão. Se as datas estiverem fora de ordem em relação ao número
    // (acontece), a primeira linha não é a de maior número — e continuar dela repetiria números.
    const { client } = fakePrisma({
      notas: [
        { id: "a", xmlRaw: nfse({ serie: "00001", nDPS: "40" }) },
        { id: "b", xmlRaw: nfse({ serie: "00001", nDPS: "88" }) },
        { id: "c", xmlRaw: nfse({ serie: "00001", nDPS: "12" }) },
      ],
    });
    await expect(lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client })).resolves.toMatchObject({
      estado: ESTADO.LIDA,
      serie: "00001",
      numero: 88,
    });
  });

  it("guarda o maior número de CADA série vista — a empresa pode emitir por dois caminhos", async () => {
    const { client } = fakePrisma({
      notas: [
        { id: "a", xmlRaw: nfse({ serie: "900001", nDPS: "500" }) },
        { id: "b", xmlRaw: nfse({ serie: "00003", nDPS: "17" }) },
      ],
    });
    const r = await lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client });
    // A série da nota mais recente é a resposta; as demais ficam disponíveis para a decisão.
    expect(r.serie).toBe("900001");
    expect(r.porSerie).toEqual({ 900001: 500, "00003": 17 });
  });

  it("⚠ há notas e NENHUMA rende série/nDPS ⇒ RECUSA nomeada, nunca 'comece do zero'", async () => {
    const { client } = fakePrisma({
      notas: [
        { id: "a", xmlRaw: "<NFSe><infNFSe><nNFSe>1</nNFSe></infNFSe></NFSe>" },
        { id: "b", xmlRaw: "<<<quebrado" },
      ],
    });
    await expect(lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client })).rejects.toMatchObject({
      code: "NFSE_ULTIMA_NOTA_ILEGIVEL",
      notasLidas: 2,
    });
  });

  it("a consulta que não volta vira recusa nomeada, não exceção anônima", async () => {
    const a = fakePrisma({ erro: "portalClient" });
    await expect(lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client: a.client })).rejects.toMatchObject({
      code: "NFSE_LEITURA_ULTIMA_NOTA_FALHOU",
    });
    const b = fakePrisma({ erro: "portalInvoice" });
    await expect(lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client: b.client })).rejects.toBeInstanceOf(
      NfseUltimaNotaError
    );
  });

  it("empresa não informada recusa em vez de varrer a base inteira", async () => {
    const { client } = fakePrisma({});
    await expect(lerUltimaNumeracaoDaEmpresa({ companyId: null, client })).rejects.toMatchObject({
      code: "NFSE_ULTIMA_NOTA_SEM_EMPRESA",
    });
  });
});

describe("o RECORTE da consulta — o que entra e o que fica de fora", () => {
  it("multi-tenancy: filtra por `clientId` do PortalClient da empresa, e só", async () => {
    const { client, chamadas } = fakePrisma({ notas: [] });
    await lerUltimaNumeracaoDaEmpresa({ companyId: "c1", client });

    const [, argsPc] = chamadas.find(([nome]) => nome === "portalClient.findUnique");
    // ⚠ A ponte é `PortalClient.companyId`, que é @unique. Nunca casar por CNPJ ou semelhança.
    expect(argsPc.where).toEqual({ companyId: "c1" });

    const [, argsPi] = chamadas.find(([nome]) => nome === "portalInvoice.findMany");
    expect(argsPi.where.clientId).toBe("pc1");
    expect(argsPi.where.type).toBe("NFSE");
    // ⚠ Só onde a empresa é EMITENTE: a numeração de uma nota recebida é do prestador dela.
    expect(argsPi.where.papel).toBe("EMIT");
    // ⚠ Sem `xmlRaw` não há o que ler — a série da DPS NÃO existe em coluna nenhuma.
    expect(argsPi.where.xmlRaw).toEqual({ not: null });
    // ⚠ E NÃO se filtra por situação: nota CANCELADA consumiu o número do mesmo jeito, e não
    // existe inutilização na NFS-e. Filtrar por status aqui devolveria número já usado.
    expect(argsPi.where.status).toBeUndefined();
    expect(argsPi.where.statusEfetivo).toBeUndefined();
    expect(argsPi.take).toBe(JANELA_DE_NOTAS);
  });
});
