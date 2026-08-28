// O MAPEAMENTO DE EXTRATO — a ligação com o banco.
//
// ⚠⚠ ESTE ARQUIVO EXISTE POR UMA ASSERÇÃO: **confirmar exige mapeamento VÁLIDO**. É a única porta
// que liga `confirmado`, e é ela que faz da trava um fato em vez de uma convenção. A regra pura tem
// teste próprio (`lib/__tests__/mapeamentoDoExtrato.test.js`); o que se prende aqui é a ligação —
// exatamente o que um teste de unidade da regra deixaria passar.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

import { SINAL } from "../lib/mapeamentoDoExtrato.js";
import {
  RECUSA_DO_MAPEAMENTO,
  listarMapeamentos,
  salvarMapeamento,
} from "../MapeamentoExtratoService.js";

const AGORA = new Date("2026-08-28T10:00:00.000Z");
const BOM = { data: 0, historico: 1, valor: 2, sinal: null };

function bancoEmMemoria({ linhas = [], semTabela = false } = {}) {
  const mapas = [...linhas];
  const client = {};
  if (!semTabela) {
    client.mapeamentoExtrato = {
      findMany: jest.fn(async ({ where }) => mapas.filter((m) => m.portalClientId === where.portalClientId)),
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
      update: jest.fn(async ({ where, data }) => {
        const l = mapas.find((m) => m.id === where.id);
        Object.assign(l, data);
        return l;
      }),
    };
  }
  return { client, mapas };
}

const salvar = (client, extra = {}) =>
  salvarMapeamento({
    portalClientId: "emp-1",
    assinatura: "data|historico|valor",
    agora: AGORA,
    client,
    ...extra,
  });

describe("⚠⚠ CONFIRMAR EXIGE UM MAPEAMENTO VÁLIDO", () => {
  it("mapeamento completo confirma, e grava quem e quando", async () => {
    const { client, mapas } = bancoEmMemoria();
    await salvar(client, { colunas: BOM, sinal: SINAL.VALOR_NEGATIVO });
    const r = await salvar(client, { confirmar: true, confirmadoPor: "u-1" });

    expect(r.confirmado).toBe(true);
    expect(r.confirmadoEm).toBe(AGORA);
    expect(r.confirmadoPor).toBe("u-1");
    expect(mapas).toHaveLength(1);
  });

  it("⚠⚠ coluna obrigatória faltando RECUSA, com os erros NOMEADOS", async () => {
    // Sem eles, o contador descobriria qual coluna falta só no próximo envio, com o extrato inteiro
    // recusado e sem saber por quê.
    const { client } = bancoEmMemoria();
    await salvar(client, { colunas: { data: 0, valor: 2 }, sinal: SINAL.VALOR_NEGATIVO });
    const erro = await salvar(client, { confirmar: true }).catch((e) => e);

    expect(erro.codigo).toBe(RECUSA_DO_MAPEAMENTO.INVALIDO);
    expect(erro.erros).toContainEqual(
      expect.objectContaining({ papel: "historico", motivo: "coluna_nao_indicada" }),
    );
    expect(erro.erros[0].frase).toBeTruthy();
  });

  it("⚠⚠ COLUNAS SEPARADAS recusa — o sistema não escolhe uma das duas colunas de valor", async () => {
    const { client } = bancoEmMemoria();
    await salvar(client, { colunas: BOM, sinal: SINAL.COLUNAS_SEPARADAS });
    const erro = await salvar(client, { confirmar: true }).catch((e) => e);
    expect(erro.codigo).toBe(RECUSA_DO_MAPEAMENTO.INVALIDO);
  });

  it("⚠⚠ a validação é sobre o que VAI FICAR GRAVADO, não sobre o corpo", async () => {
    // Campo ausente herda do registro antigo. Validar só o corpo deixaria confirmar um mapeamento
    // cujo campo herdado está incompleto — e aí a trava confirmaria o que ela existe para barrar.
    const { client } = bancoEmMemoria({
      linhas: [{
        id: "map-1",
        portalClientId: "emp-1",
        assinatura: "data|historico|valor",
        colunas: { data: 0, valor: 2 },
        sinal: SINAL.VALOR_NEGATIVO,
        confirmado: false,
      }],
    });
    // O corpo traz só o rótulo — e mesmo assim a confirmação é recusada.
    const erro = await salvar(client, { rotulo: "Itaú", confirmar: true }).catch((e) => e);
    expect(erro.codigo).toBe(RECUSA_DO_MAPEAMENTO.INVALIDO);
  });

  it("⚠ recusado, NADA é gravado — nem o rótulo", async () => {
    const { client, mapas } = bancoEmMemoria({
      linhas: [{
        id: "map-1",
        portalClientId: "emp-1",
        assinatura: "data|historico|valor",
        colunas: { data: 0, valor: 2 },
        sinal: SINAL.VALOR_NEGATIVO,
        confirmado: false,
      }],
    });
    await salvar(client, { rotulo: "Itaú", confirmar: true }).catch(() => {});
    expect(client.mapeamentoExtrato.update).not.toHaveBeenCalled();
    expect(mapas[0].rotulo).toBeUndefined();
  });
});

describe("⚠ SALVAR SEM CONFIRMAR é permitido — e NUNCA liga o `confirmado`", () => {
  it("o contador ajusta em duas sessões, e mexer não é reafirmar", async () => {
    const { client } = bancoEmMemoria();
    const r = await salvar(client, { colunas: { data: 0 }, sinal: SINAL.VALOR_NEGATIVO });
    expect(r.confirmado).toBe(false);
    expect(r.confirmadoEm).toBeUndefined();
  });

  it("⚠⚠ e um mapeamento JÁ confirmado não é rebaixado por um salvar comum", async () => {
    const { client, mapas } = bancoEmMemoria();
    await salvar(client, { colunas: BOM, sinal: SINAL.VALOR_NEGATIVO });
    await salvar(client, { confirmar: true, confirmadoPor: "u-1" });
    await salvar(client, { rotulo: "Itaú conta 2" });
    expect(mapas[0].confirmado).toBe(true);
    expect(mapas[0].rotulo).toBe("Itaú conta 2");
  });
});

describe("⚠ `undefined` é NÃO MEXER — não é apagar", () => {
  it("salvar só o rótulo não apaga as colunas", async () => {
    // Um `data` com todos os campos sempre apagaria o que não veio no corpo. É a regra do
    // `PATCH /emissao-nfse`, e o defeito que ela impede é a empresa parar de funcionar em silêncio.
    const { client, mapas } = bancoEmMemoria();
    await salvar(client, { colunas: BOM, sinal: SINAL.VALOR_NEGATIVO });
    await salvar(client, { rotulo: "Itaú" });
    expect(mapas[0].colunas).toEqual(BOM);
    expect(mapas[0].sinal).toBe(SINAL.VALOR_NEGATIVO);
  });

  it("⚠ `null` no rótulo APAGA — é a outra metade da regra", async () => {
    const { client, mapas } = bancoEmMemoria();
    await salvar(client, { colunas: BOM, sinal: SINAL.VALOR_NEGATIVO, rotulo: "Itaú" });
    await salvar(client, { rotulo: null });
    expect(mapas[0].rotulo).toBeNull();
  });

  it("⚠ rótulo em branco vira `null`, nunca string vazia", async () => {
    const { client, mapas } = bancoEmMemoria();
    await salvar(client, { colunas: BOM, sinal: SINAL.VALOR_NEGATIVO, rotulo: "   " });
    expect(mapas[0].rotulo).toBeNull();
  });
});

describe("⚠ SEM A MIGRATION a resposta é NOMEADA, nunca 500", () => {
  it("listar devolve vazio com `indisponivel`", async () => {
    const { client } = bancoEmMemoria({ semTabela: true });
    expect(await listarMapeamentos("emp-1", client)).toEqual({ mapeamentos: [], indisponivel: true });
  });

  it("⚠ e `indisponivel` NÃO é o mesmo que 'não há mapeamento'", async () => {
    const { client } = bancoEmMemoria();
    expect(await listarMapeamentos("emp-1", client)).toEqual({ mapeamentos: [], indisponivel: false });
  });

  it("salvar recusa nomeando", async () => {
    const { client } = bancoEmMemoria({ semTabela: true });
    await expect(salvar(client, { colunas: BOM, sinal: SINAL.VALOR_NEGATIVO })).rejects.toMatchObject({
      codigo: RECUSA_DO_MAPEAMENTO.INDISPONIVEL,
    });
  });

  it("assinatura vazia recusa nomeando", async () => {
    const { client } = bancoEmMemoria();
    await expect(salvar(client, { assinatura: "  ", colunas: BOM, sinal: SINAL.VALOR_NEGATIVO }))
      .rejects.toMatchObject({ codigo: RECUSA_DO_MAPEAMENTO.SEM_ASSINATURA });
  });
});

describe("⚠⚠ A VALIDADE É DERIVADA NA LEITURA, nunca coluna", () => {
  it("a lista traz o veredito de agora, não um gravado", async () => {
    // Coluna de validade envelheceria calada — o defeito de `divergenciaDeFonte.js`, e o motivo de
    // `contaSugerida` não ser lida da coluna.
    const { client } = bancoEmMemoria({
      linhas: [
        {
          id: "map-1",
          portalClientId: "emp-1",
          assinatura: "a",
          colunas: BOM,
          sinal: SINAL.VALOR_NEGATIVO,
          confirmado: true,
        },
        {
          id: "map-2",
          portalClientId: "emp-1",
          assinatura: "b",
          colunas: { data: 0 },
          sinal: SINAL.VALOR_NEGATIVO,
          confirmado: true,
        },
      ],
    });
    const { mapeamentos } = await listarMapeamentos("emp-1", client);
    expect(mapeamentos[0].validacao.ok).toBe(true);
    expect(mapeamentos[1].validacao.ok).toBe(false);
  });
});
