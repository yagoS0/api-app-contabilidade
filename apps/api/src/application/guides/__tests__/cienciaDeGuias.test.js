// A CIÊNCIA SOBRE AS GUIAS EM ATRASO — o "Estou ciente" do pop-up.
//
// ⚠⚠ O que este arquivo protege, acima de tudo, é a DISTÂNCIA entre ciência e pagamento. As duas
// nascem do mesmo clique do cliente, na mesma tela, e são coisas opostas: uma dispensa um aviso, a
// outra afirma que uma dívida foi quitada. A `CONSTITUICAO-do-produto.md` fecha a palavra na Lei 5.

import { avaliarCiencia, lerGuiasComCiencia, registrarCiencia, ORIGEM_DA_CIENCIA }
  from "../cienciaDeGuias.js";

const item = (id) => ({ id });

describe("⚠⚠ ainda preciso avisar? — a pergunta é sobre o CONJUNTO", () => {
  it("sem ciência nenhuma, avisa", () => {
    expect(avaliarCiencia({ itens: [item("g-1")], cientes: [] }).precisaAvisar).toBe(true);
  });

  it("com todas reconhecidas, NÃO avisa", () => {
    const r = avaliarCiencia({ itens: [item("g-1"), item("g-2")], cientes: ["g-1", "g-2"] });
    expect(r.precisaAvisar).toBe(false);
    expect(r.novas).toEqual([]);
  });

  it("⚠⚠ guia NOVA reabre o aviso — mesmo com as antigas todas reconhecidas", () => {
    // É a metade do v3 §1 que faz o pop-up ser útil em vez de irritante: ele some quando a pessoa
    // responde, e volta quando o mundo muda.
    const r = avaliarCiencia({ itens: [item("g-1"), item("g-9")], cientes: ["g-1"] });
    expect(r.precisaAvisar).toBe(true);
    expect(r.novas).toEqual(["g-9"]);
  });

  it("⚠⚠ o que se guarda é o CONJUNTO, não a data — senão a guia de amanhã nasce silenciada", () => {
    // A armadilha óbvia é gravar "avisado em 27/08" e comparar com o relógio. A guia que vence no
    // dia 28 ficaria calada por um clique dado antes de ela existir. Este caso é a prova de que a
    // decisão não olha tempo nenhum: `cientes` não tem data, e o veredito muda só com o id.
    expect(avaliarCiencia({ itens: [item("g-nova")], cientes: ["g-velha"] }).precisaAvisar).toBe(true);
  });

  it("⚠ sem guia em atraso, não há o que avisar", () => {
    expect(avaliarCiencia({ itens: [], cientes: [] }).precisaAvisar).toBe(false);
  });

  it("⚠ id vazio ou ausente não conta como guia nova — não abriria pop-up sobre nada", () => {
    expect(avaliarCiencia({ itens: [{ id: "" }, {}], cientes: [] }).precisaAvisar).toBe(false);
  });

  it("⚠ argumentos ausentes não explodem — a tela não pode cair por falta de payload", () => {
    expect(avaliarCiencia().precisaAvisar).toBe(false);
    expect(avaliarCiencia({}).precisaAvisar).toBe(false);
  });
});

describe("a leitura e a gravação", () => {
  const clientDe = (linhas = []) => ({
    cienciaDeGuias: {
      findMany: jest.fn(async () => linhas),
      create: jest.fn(async ({ data }) => ({ id: "c-1", criadoEm: new Date(), ...data })),
    },
  });

  it("⚠ a leitura ACHATA os conjuntos de todas as ciências", async () => {
    const ids = await lerGuiasComCiencia({
      portalClientId: "emp-1",
      client: clientDe([{ guiaIds: ["g-1", "g-2"] }, { guiaIds: ["g-2", "g-3"] }]),
    });
    expect([...ids].sort()).toEqual(["g-1", "g-2", "g-3"]);
  });

  it("⚠⚠ ela é escopada por empresa — ciência de uma não silencia o aviso de outra", async () => {
    const client = clientDe();
    await lerGuiasComCiencia({ portalClientId: "emp-1", client });
    expect(client.cienciaDeGuias.findMany.mock.calls[0][0].where).toEqual({ portalClientId: "emp-1" });
  });

  it("⚠⚠ NÃO HÁ JANELA DE TEMPO na leitura — o aviso volta com guia nova, não com o calendário", async () => {
    // Filtrar "só as ciências dos últimos N dias" faria uma guia em atraso há seis meses reabrir o
    // modal sozinha, todo dia, sem nada ter mudado.
    const client = clientDe();
    await lerGuiasComCiencia({ portalClientId: "emp-1", client });
    expect(JSON.stringify(client.cienciaDeGuias.findMany.mock.calls[0][0]))
      .not.toMatch(/criadoEm|gte|lte/);
  });

  it("⚠⚠ cada clique é uma LINHA NOVA — nunca um upsert que acumula ids", async () => {
    // O histórico é o produto: quem reconheceu o quê, e quando. Um registro único sobrescrito
    // apagaria exatamente isso.
    const client = clientDe();
    await registrarCiencia({
      portalClientId: "emp-1", guiaIds: ["g-1"], userId: "u-1", origem: ORIGEM_DA_CIENCIA.CLIENT, client,
    });
    expect(client.cienciaDeGuias.create).toHaveBeenCalledTimes(1);
    expect(client.cienciaDeGuias).not.toHaveProperty("upsert");
  });

  it("⚠ ids repetidos são deduplicados", async () => {
    const client = clientDe();
    await registrarCiencia({
      portalClientId: "emp-1", guiaIds: ["g-1", "g-1", " g-2 "], userId: "u-1",
      origem: ORIGEM_DA_CIENCIA.CLIENT, client,
    });
    expect(client.cienciaDeGuias.create.mock.calls[0][0].data.guiaIds).toEqual(["g-1", "g-2"]);
  });

  it("⚠⚠ lista VAZIA recusa — uma ciência sobre nada faria o histórico mentir sobre ter havido aviso", async () => {
    const client = clientDe();
    await expect(registrarCiencia({
      portalClientId: "emp-1", guiaIds: [], userId: "u-1", origem: ORIGEM_DA_CIENCIA.CLIENT, client,
    })).rejects.toMatchObject({ code: "CIENCIA_SEM_GUIAS" });
    expect(client.cienciaDeGuias.create).not.toHaveBeenCalled();
  });

  it("⚠ origem fora do vocabulário recusa — e nada é gravado", async () => {
    const client = clientDe();
    await expect(registrarCiencia({
      portalClientId: "emp-1", guiaIds: ["g-1"], userId: "u-1", origem: "SEI_LA", client,
    })).rejects.toMatchObject({ code: "CIENCIA_ORIGEM_INVALIDA" });
    expect(client.cienciaDeGuias.create).not.toHaveBeenCalled();
  });

  it("⚠⚠ CIÊNCIA NÃO É PAGAMENTO — nada aqui encosta em `paymentStatus`", async () => {
    // A guarda é de FONTE, e é de propósito: um teste de comportamento passaria com alguém
    // acrescentando um `guide.update` "só para marcar como vista". As duas colunas de pagamento
    // (`clienteConfirmouEm`, `paymentConfirmedAt`) têm dono, e não é este módulo.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "cienciaDeGuias.js"), "utf8")
      // ⚠ BLOCO antes de LINHA — um `//` dentro de `/* */` apaga o fechamento.
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/paymentStatus|clienteConfirmou|paymentConfirmedAt|guide\./);
  });
});
