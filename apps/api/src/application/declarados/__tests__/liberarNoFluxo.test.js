// ⚠⚠⚠ O SEGUNDO VERBO DA LINHA: liberar no fluxo SEM lançar — decisão do dono, 01/09/2026.
//
// > *"temos um botão fluxo, que apenas libera no fluxo mas não lança"* … *"tudo que virar
// > lançamento deve entrar no fluxo, mas nem tudo do fluxo necessariamente deve ser um lançamento"*.
//
// A diferença entre os dois verbos é a invariante do caixa:
//   · **Lançar** cria `AccountingEntry` (`D despesa / C caixa`) e AFIRMA que o dinheiro saiu.
//   · **Fluxo**  só diz *"deve sair por volta de tal dia"* — não toca no razão.
//
// ⚠ O que este arquivo trava, em ordem de custo:
//   1. a despesa já LANÇADA não virar previsão também (o mesmo dinheiro duas vezes na tela);
//   2. `undefined` (não mandei data) e `null` (tire do fluxo) não se confundirem;
//   3. nenhuma data ser INVENTADA quando não há emissão.

import {
  RECUSA_DO_SERVICO,
  liberarDeclaradoNoFluxo,
} from "../DeclaradoService.js";

const EMISSAO = new Date("2026-09-02T00:00:00.000Z");

const declarado = (extra = {}) => ({
  id: "dec-1",
  estado: "A_CONFERIR",
  dataDocumento: EMISSAO,
  accountingEntryId: null,
  ...extra,
});

function clientDe(achado = declarado()) {
  const update = jest.fn(async (args) => ({ id: "dec-1", ...args.data }));
  return {
    client: {
      lancamentoDeclarado: { findFirst: jest.fn(async () => achado), update },
    },
    update,
  };
}

const pegarRecusa = async (fn) => {
  try { await fn(); } catch (e) { return e; }
  throw new Error("esperava uma recusa e não veio nenhuma");
};

const liberar = (client, extra = {}) => liberarDeclaradoNoFluxo({
  portalClientId: "emp-1",
  declaradoId: "dec-1",
  usuarioId: "u1",
  client,
  ...extra,
});

describe("⚠⚠ a data: emissão por padrão, e o contador pode alterar", () => {
  it("⚠⚠ SEM data, cai na EMISSÃO da nota — foi a escolha do dono", () => {
    const { client, update } = clientDe();
    return liberar(client).then(() => {
      expect(update.mock.calls[0][0].data.previstoNoFluxoEm).toEqual(EMISSAO);
    });
  });

  it("com data, ela vence — o contador altera", async () => {
    const { client, update } = clientDe();
    await liberar(client, { data: "2026-09-25" });
    expect(update.mock.calls[0][0].data.previstoNoFluxoEm)
      .toEqual(new Date(Date.UTC(2026, 8, 25)));
  });

  it("⚠⚠ a data civil é montada POR PEDAÇO — o dia não escorrega no fuso", () => {
    // `new Date("2026-09-25")` é UTC e `new Date("2026-09-25T00:00")` é local: as duas formas
    // chegam de clientes diferentes e uma delas desloca o dia. Montar por pedaço não tem esse ramo.
    const { client, update } = clientDe();
    return liberar(client, { data: "2026-09-25" }).then(() => {
      const d = update.mock.calls[0][0].data.previstoNoFluxoEm;
      expect(d.toISOString().slice(0, 10)).toBe("2026-09-25");
    });
  });

  it("⚠ data malformada não vira data nenhuma — e a recusa é nomeada", async () => {
    const { client } = clientDe();
    const e = await pegarRecusa(() => liberar(client, { data: "25/09/2026" }));
    expect(e.codigo).toBe(RECUSA_DO_SERVICO.SEM_DATA_PARA_O_FLUXO);
  });

  it("⚠⚠ sem emissão e sem data, RECUSA — nunca «hoje», nunca o fim da competência", async () => {
    // O fluxo é uma linha do tempo: um dia chutado ali é uma afirmação sobre quando a empresa fica
    // sem dinheiro.
    const { client, update } = clientDe(declarado({ dataDocumento: null }));
    const e = await pegarRecusa(() => liberar(client));
    expect(e.codigo).toBe(RECUSA_DO_SERVICO.SEM_DATA_PARA_O_FLUXO);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ `undefined` ≠ `null` — e confundi-los faz o botão de remover reinserir a linha", () => {
  it("`null` TIRA do fluxo", async () => {
    const { client, update } = clientDe();
    await liberar(client, { data: null });
    expect(update.mock.calls[0][0].data.previstoNoFluxoEm).toBeNull();
  });

  it("⚠⚠ e tirar do fluxo é SEMPRE permitido — desfazer uma previsão não afirma nada", async () => {
    // Inclusive numa linha já lançada e numa recusada: as duas guardas abaixo valem só para PÔR.
    for (const alvo of [
      declarado({ accountingEntryId: "ae-1" }),
      declarado({ estado: "RECUSADO" }),
    ]) {
      const { client, update } = clientDe(alvo);
      await liberar(client, { data: null });
      expect(update.mock.calls[0][0].data.previstoNoFluxoEm).toBeNull();
    }
  });
});

describe("⚠⚠ as duas recusas que evitam a tela mentir", () => {
  it("⚠⚠ já LANÇADA não vira previsão — o lançamento dela JÁ é linha do fluxo", async () => {
    // Sem esta recusa, o mesmo dinheiro apareceria duas vezes: uma como FATO (o lançamento) e outra
    // como PREVISÃO.
    const { client, update } = clientDe(declarado({ accountingEntryId: "ae-1" }));
    const e = await pegarRecusa(() => liberar(client));
    expect(e.codigo).toBe(RECUSA_DO_SERVICO.JA_LANCADO_NO_FLUXO);
    expect(update).not.toHaveBeenCalled();
  });

  it("⚠ RECUSADA não vai ao fluxo — diria ao cliente o contrário do que o contador decidiu", async () => {
    const { client, update } = clientDe(declarado({ estado: "RECUSADO" }));
    const e = await pegarRecusa(() => liberar(client));
    expect(e.codigo).toBe(RECUSA_DO_SERVICO.RECUSADO_NAO_VAI_AO_FLUXO);
    expect(update).not.toHaveBeenCalled();
  });

  it("declarado de outra empresa não é encontrado", async () => {
    const { client } = clientDe(null);
    const e = await pegarRecusa(() => liberar(client));
    expect(e.codigo).toBe(RECUSA_DO_SERVICO.NAO_ENCONTRADO);
  });
});

describe("⚠⚠ e ele NÃO encosta no razão — é o que separa este verbo do «lançar»", () => {
  it("nenhum `AccountingEntry` é criado, e não há transação", async () => {
    const { client } = clientDe();
    await liberar(client);
    // O dublê não tem `accountingEntry` nem `$transaction`: se o serviço os procurasse, isto
    // estouraria com TypeError em vez de passar.
    expect(client.accountingEntry).toBeUndefined();
    expect(client.$transaction).toBeUndefined();
  });

  it("⚠ e não mexe no ESTADO da linha — ela continua esperando conferência", async () => {
    // Liberar no fluxo é uma previsão de caixa, não uma decisão sobre a despesa. Mudar o estado
    // aqui tiraria a linha da fila do contador sem ninguém ter conferido nada.
    const { client, update } = clientDe();
    await liberar(client);
    expect(update.mock.calls[0][0].data.estado).toBeUndefined();
  });
});
