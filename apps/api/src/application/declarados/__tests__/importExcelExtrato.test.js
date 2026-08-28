// O IMPORT DE EXTRATO EM EXCEL DO CLIENTE.
//
// ⚠⚠ O bloco "SEM MAPEAMENTO CONFIRMADO, NADA ENTRA" é o motivo deste arquivo existir. É a trava da
// fase, e o que ela impede é despesa lançada com a data no lugar do valor, ou com o sinal
// invertido, no razão do cliente.
//
// ⚠ A REGRA do mapeamento tem teste próprio em `lib/__tests__/mapeamentoDoExtrato.test.js`; a
// identidade da transação, em `lib/__tests__/dedupeOfx.test.js`. O que se prende AQUI é a
// ORQUESTRAÇÃO — e ela é o que um teste de unidade de qualquer um dos dois deixaria passar.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

import * as XLSX from "xlsx";
import { ESTADO, ORIGEM, ORIGEM_PAGAMENTO } from "../lib/estadosDeclarado.js";
import { SINAL } from "../lib/mapeamentoDoExtrato.js";
import {
  MOTIVO_DA_LINHA,
  RECUSA_DO_EXCEL,
  importarExtratoExcelDoCliente,
  transacaoDaLinha,
} from "../ImportExcelExtratoService.js";
import { RECUSA_EXTRATO } from "../lib/lerPlanilhaExtrato.js";

const AGORA = new Date("2026-08-28T10:00:00.000Z");

/** Uma planilha de verdade — não um dublê de `XLSX`. */
function planilha(linhas, nomeAba = "Extrato") {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nomeAba);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

const CABECALHO = ["Data", "Histórico", "Valor"];
const EXTRATO = (corpo = [["15/07/2026", "GOOGLE CLOUD BRASIL", "-1.500,00"]]) =>
  planilha([CABECALHO, ...corpo]);

/** ⚠ Um Prisma em memória que HONRA o `@@unique(portalClientId, hashDedupe)` — é ele quem prova. */
function bancoEmMemoria({ mapeamentos = [], semTabela = false } = {}) {
  const declarados = [];
  const imports = [];
  const mapas = [...mapeamentos];
  const client = {
    ofxImport: {
      create: jest.fn(async ({ data }) => {
        const linha = { id: `imp-${imports.length + 1}`, ...data };
        imports.push(linha);
        return linha;
      }),
      update: jest.fn(async ({ where, data }) => {
        const l = imports.find((i) => i.id === where.id);
        Object.assign(l, data);
        return l;
      }),
      findFirst: jest.fn(async ({ where }) =>
        [...imports].reverse().find(
          (i) => i.portalClientId === where.portalClientId && i.hashArquivo === where.hashArquivo,
        ) || null,
      ),
    },
    lancamentoDeclarado: {
      create: jest.fn(async ({ data }) => {
        // ⚠⚠ ESTE `if` É O `@@unique` DO BANCO. Sem ele o teste passaria com a proteção removida.
        if (declarados.some((d) => d.portalClientId === data.portalClientId && d.hashDedupe === data.hashDedupe)) {
          const e = new Error("unique");
          e.code = "P2002";
          throw e;
        }
        const linha = { id: `d-${declarados.length + 1}`, ...data };
        declarados.push(linha);
        return linha;
      }),
      findFirst: jest.fn(async ({ where }) =>
        declarados.find((d) => d.portalClientId === where.portalClientId && d.hashDedupe === where.hashDedupe) || null,
      ),
    },
  };
  if (!semTabela) {
    client.mapeamentoExtrato = {
      findUnique: jest.fn(async ({ where }) =>
        mapas.find(
          (m) =>
            m.portalClientId === where.portalClientId_assinatura.portalClientId
            && m.assinatura === where.portalClientId_assinatura.assinatura,
        ) || null,
      ),
      create: jest.fn(async ({ data }) => {
        const linha = { id: `map-${mapas.length + 1}`, ...data };
        mapas.push(linha);
        return linha;
      }),
    };
  }
  return { client, declarados, imports, mapas };
}

/** O mapeamento CONFIRMADO do cabeçalho padrão, já com a assinatura que ele produz. */
const mapaConfirmado = (extra = {}) => ({
  id: "map-1",
  portalClientId: "emp-1",
  assinatura: "data|historico|valor",
  colunas: { data: 0, historico: 1, valor: 2, sinal: null },
  sinal: SINAL.VALOR_NEGATIVO,
  rotulo: "Itaú",
  confirmado: true,
  ...extra,
});

const importar = (client, buffer, extra = {}) =>
  importarExtratoExcelDoCliente({
    portalClientId: "emp-1",
    buffer,
    nomeArquivo: "extrato.xlsx",
    criadoPor: "u-1",
    agora: AGORA,
    client,
    ...extra,
  });

describe("⚠⚠ SEM MAPEAMENTO CONFIRMADO, NADA ENTRA", () => {
  it("primeiro envio: zero declarados, e a PROPOSTA volta para o contador confirmar", async () => {
    const { client, declarados, mapas } = bancoEmMemoria();
    const r = await importar(client, EXTRATO());

    expect(r.precisaDeMapeamento).toBe(true);
    expect(r.criados).toBe(0);
    expect(declarados).toHaveLength(0);
    expect(r.proposta.colunas).toMatchObject({ data: 0, historico: 1, valor: 2 });
    // A proposta fica gravada — mas como PROPOSTA.
    expect(mapas).toHaveLength(1);
    expect(mapas[0].confirmado).toBe(false);
  });

  it("⚠⚠ mapeamento existente e NÃO confirmado também não importa nada", async () => {
    const { client, declarados } = bancoEmMemoria({
      mapeamentos: [mapaConfirmado({ confirmado: false })],
    });
    const r = await importar(client, EXTRATO());
    expect(r.precisaDeMapeamento).toBe(true);
    expect(declarados).toHaveLength(0);
  });

  it("⚠⚠ e um mapeamento JÁ EXISTENTE não é sobrescrito pela proposta", async () => {
    // Ele pode ter sido confirmado e depois invalidado por mudança de formato; apagar a decisão de
    // uma pessoa por causa de um arquivo é o que esta guarda impede.
    const { client, mapas } = bancoEmMemoria({
      mapeamentos: [mapaConfirmado({ confirmado: false, rotulo: "Itaú conta 2", colunas: { data: 9 } })],
    });
    await importar(client, EXTRATO());
    expect(client.mapeamentoExtrato.create).not.toHaveBeenCalled();
    expect(mapas[0].rotulo).toBe("Itaú conta 2");
  });

  it("⚠ a AMOSTRA volta junto — sem ver linhas de verdade, confirmar é no escuro", async () => {
    const { client } = bancoEmMemoria();
    const r = await importar(
      client,
      EXTRATO([
        ["15/07/2026", "GOOGLE CLOUD", "-1.500,00"],
        ["16/07/2026", "TARIFA", "-9,90"],
      ]),
    );
    expect(r.amostra).toHaveLength(2);
    expect(r.amostra[0]).toMatchObject({ numero: 2 });
    expect(r.totalDeLinhas).toBe(2);
  });

  it("⚠ sem a migration aplicada, a recusa é NOMEADA — nunca 500", async () => {
    const { client } = bancoEmMemoria({ semTabela: true });
    await expect(importar(client, EXTRATO())).rejects.toMatchObject({
      codigo: RECUSA_DO_EXCEL.MAPEAMENTO_INDISPONIVEL,
    });
  });
});

describe("⚠⚠ COM O MAPEAMENTO CONFIRMADO — o débito vira despesa, com PROVA", () => {
  it("cria o declarado com a data, a competência derivada e a procedência do Excel", async () => {
    const { client, declarados } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const r = await importar(client, EXTRATO());

    expect(r.precisaDeMapeamento).toBe(false);
    expect(r).toMatchObject({ transacoesLidas: 1, criados: 1, jaImportadas: 0 });
    expect(declarados[0]).toMatchObject({
      origem: ORIGEM.EXTRATO_EXCEL_CLIENTE,
      origemPagamento: ORIGEM_PAGAMENTO.EXTRATO_EXCEL,
      estado: ESTADO.A_CONFERIR,
      competencia: "2026-07",
      valor: 1500,
      descricaoOriginal: "GOOGLE CLOUD BRASIL",
    });
  });

  it("⚠⚠ a ORIGEM é PRÓPRIA, nunca `OFX_CLIENTE`", async () => {
    // Colapsá-las faria o contador ler "OFX" numa linha que saiu de uma planilha cujas colunas ELE
    // mapeou — que é justamente o que ele precisa poder conferir.
    const { client, declarados } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    await importar(client, EXTRATO());
    expect(declarados[0].origem).not.toBe(ORIGEM.OFX_CLIENTE);
  });

  it("⚠⚠ o VALOR é o módulo, e o sinal decide se a linha entra", async () => {
    const { client, declarados } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const r = await importar(
      client,
      EXTRATO([
        ["15/07/2026", "PAGAMENTO", "-1.500,00"],
        ["16/07/2026", "RECEBIMENTO CLIENTE", "2.000,00"],
      ]),
    );
    expect(r.criados).toBe(1);
    expect(r.foraDoEscopo).toBe(1);
    expect(declarados[0].valor).toBe(1500);
  });

  it("⚠ o mesmo arquivo duas vezes: a segunda importa ZERO e DIZ que já foi subido", async () => {
    const { client, declarados } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const arquivo = EXTRATO([
      ["15/07/2026", "GOOGLE CLOUD", "-1.500,00"],
      ["16/07/2026", "TARIFA", "-9,90"],
    ]);
    const um = await importar(client, arquivo);
    const dois = await importar(client, arquivo);

    expect(um).toMatchObject({ criados: 2, jaImportadas: 0 });
    expect(dois).toMatchObject({ criados: 0, jaImportadas: 2 });
    expect(declarados).toHaveLength(2);
    expect(dois.arquivoJaImportado).toMatchObject({ criadosNaquela: 2 });
  });

  it("⚠⚠ DUAS TARIFAS IGUAIS NO MESMO DIA entram as DUAS — é o ordinal que as preserva", async () => {
    // Sem ele, duas linhas idênticas colapsariam numa só e uma despesa REAL sumiria em silêncio.
    const { client, declarados } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const r = await importar(
      client,
      EXTRATO([
        ["15/07/2026", "TARIFA BANCARIA", "-9,90"],
        ["15/07/2026", "TARIFA BANCARIA", "-9,90"],
      ]),
    );
    expect(r.criados).toBe(2);
    expect(declarados).toHaveLength(2);
  });

  it("⚠⚠ o dedupe ATRAVESSA os formatos quando a conta é informada", async () => {
    // O cliente que mandar o mesmo período em OFX e em Excel não pode ver a despesa duas vezes.
    const { client, declarados } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const r = await importar(client, EXTRATO(), { contaBancaria: "12345-6" });
    expect(r.dedupeAtravessaFormatos).toBe(true);
    // A chave é a MESMA impressão digital do OFX — sem prefixo próprio.
    expect(declarados[0].hashDedupe).toMatch(/^OFXFP:12345-6:/);
  });

  it("⚠ e SEM a conta o relatório DIZ que ele não atravessa", async () => {
    const { client } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const r = await importar(client, EXTRATO());
    expect(r.dedupeAtravessaFormatos).toBe(false);
    expect(r.anomalias.some((a) => a.codigo === "sem_conta_bancaria")).toBe(true);
  });

  it("⚠ o registro do envio diz o FORMATO e o mapeamento usado", async () => {
    const { client, imports } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    await importar(client, EXTRATO());
    expect(imports[0]).toMatchObject({ formato: "EXCEL", mapeamentoExtratoId: "map-1" });
  });
});

describe("⚠⚠ NADA SOME — cada linha que não entrou tem MOTIVO", () => {
  it("`não deu para ler` é compartimento SEPARADO de `é entrada`", async () => {
    // Somadas num número só, um mapeamento errado passaria por "um extrato só de créditos".
    const { client } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const r = await importar(
      client,
      EXTRATO([
        ["15/07/2026", "PAGAMENTO", "-1.500,00"],
        ["16/07/2026", "RECEBIMENTO", "2.000,00"],
        ["17/07/2026", "MISTERIO", "abc"],
      ]),
    );
    expect(r).toMatchObject({ criados: 1, foraDoEscopo: 1, naoLegiveisTotal: 1 });
    expect(r.naoLegiveis[0]).toMatchObject({ motivo: MOTIVO_DA_LINHA.VALOR_ILEGIVEL, numero: 4 });
    expect(r.naoLegiveis[0].frase).toBeTruthy();
  });

  it("⚠⚠ AMOSTRA e CONTAGEM são campos diferentes", async () => {
    // O defeito que o OFX pagou: a contagem real ia para a coluna e NÃO voltava, e quem escrevesse
    // `naoLegiveis.length` na tela diria "50" num arquivo com 145 mil linhas inválidas.
    const { client } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    const linhas = Array.from({ length: 60 }, (_, i) => [`${(i % 28) + 1}/07/2026`, `X${i}`, "abc"]);
    const r = await importar(client, EXTRATO(linhas));
    expect(r.naoLegiveis).toHaveLength(50);
    expect(r.naoLegiveisTotal).toBe(60);
    expect(r.naoLegiveisTruncadas).toBe(true);
  });

  it("⚠ SINAL DESCONHECIDO não vira despesa — e não vira entrada por descarte", async () => {
    const mapa = mapaConfirmado({
      assinatura: "d c|data|historico|valor",
      colunas: { data: 0, historico: 1, valor: 2, sinal: 3 },
      sinal: SINAL.COLUNA_DE_SINAL,
    });
    const { client } = bancoEmMemoria({ mapeamentos: [mapa] });
    const buffer = planilha([
      ["Data", "Histórico", "Valor", "D/C"],
      ["15/07/2026", "PAGAMENTO", "1.500,00", "D"],
      ["16/07/2026", "COISA NOVA", "10,00", "TED"],
    ]);
    const r = await importar(client, buffer);
    expect(r.criados).toBe(1);
    expect(r.foraDoEscopo).toBe(0);
    expect(r.naoLegiveis[0].motivo).toBe(MOTIVO_DA_LINHA.SINAL_DESCONHECIDO);
  });
});

describe("⚠ A LEITURA DA LINHA — a ordem das recusas é o que torna a frase útil", () => {
  const mapa = { colunas: { data: 0, historico: 1, valor: 2, sinal: null }, sinal: SINAL.VALOR_NEGATIVO };
  const linha = (celulas) => ({ numero: 7, celulas });

  it("valor ilegível vence o sinal desconhecido — ele o EXPLICA", () => {
    expect(transacaoDaLinha(linha(["15/07/2026", "X", "abc"]), mapa).motivo)
      .toBe(MOTIVO_DA_LINHA.VALOR_ILEGIVEL);
  });

  it("data ilegível é motivo PRÓPRIO", () => {
    expect(transacaoDaLinha(linha(["ontem", "X", "-10,00"]), mapa).motivo)
      .toBe(MOTIVO_DA_LINHA.DATA_ILEGIVEL);
  });

  it("⚠ histórico vazio recusa — sem descrição a despesa não pode ser conferida", () => {
    expect(transacaoDaLinha(linha(["15/07/2026", "  ", "-10,00"]), mapa).motivo)
      .toBe(MOTIVO_DA_LINHA.HISTORICO_VAZIO);
  });

  it("⚠ o número devolvido é o da linha DO EXCEL, nunca o índice do array", () => {
    expect(transacaoDaLinha(linha(["ontem", "X", "-10,00"]), mapa).numero).toBe(7);
  });
});

describe("⚠ A PLANILHA QUE NÃO DÁ PARA LER — recusa NOMEADA, nunca leitura pela metade", () => {
  it("arquivo vazio", async () => {
    const { client } = bancoEmMemoria();
    await expect(importar(client, Buffer.alloc(0))).rejects.toMatchObject({
      codigo: RECUSA_EXTRATO.ARQUIVO_ILEGIVEL,
    });
  });

  it("cabeçalho sem nenhuma linha abaixo", async () => {
    const { client } = bancoEmMemoria();
    await expect(importar(client, planilha([CABECALHO]))).rejects.toMatchObject({
      codigo: RECUSA_EXTRATO.SEM_LINHAS,
    });
  });

  it("⚠ aba PEDIDA que não existe RECUSA — cair na primeira leria outro extrato", async () => {
    const { client } = bancoEmMemoria({ mapeamentos: [mapaConfirmado()] });
    await expect(importar(client, EXTRATO(), { aba: "Julho" })).rejects.toMatchObject({
      codigo: RECUSA_EXTRATO.SEM_ABA,
    });
  });
});
