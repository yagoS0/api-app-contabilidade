// ⚠⚠ A SAÍDA AVULSA QUE O CLIENTE PLANEJOU — e o que ela NÃO é.
//
// > Dono, 29/08/2026: *"o cliente pode modificar as saídas, podendo colocar novas saídas, apenas
// > para visualização deles."*
//
// ⚠⚠ O bloco que mais importa é o de que **isto não é contabilidade**: confirmar aqui põe a linha no
// FLUXO, e não no razão. `LancamentoDeclarado` exige data de PAGAMENTO justamente porque afirma que
// o dinheiro saiu — e uma saída planejada para o mês que vem não saiu de lugar nenhum.

import {
  ESTADO_DA_SAIDA,
  RECUSA_DA_SAIDA,
  SaidaRecusada,
  criarSaidaAvulsa,
  decidirSaidaAvulsa,
  lerDataCivil,
  listarSaidasPendentes,
  removerSaidaAvulsa,
} from "../SaidaAvulsaService.js";

const linha = (extra = {}) => ({
  id: "sa-1", portalClientId: "emp-1", estado: ESTADO_DA_SAIDA.PENDENTE, ...extra,
});

function clientDe({ achada = linha(), lancaP2021 = false, semDelegate = false } = {}) {
  if (semDelegate) return {};
  const erro = Object.assign(new Error("tabela"), { code: "P2021" });
  const talvezLanca = (v) => jest.fn(async () => { if (lancaP2021) throw erro; return v; });
  return {
    saidaAvulsaCliente: {
      create: talvezLanca({ id: "sa-nova" }),
      findFirst: talvezLanca(achada),
      findMany: talvezLanca(achada ? [achada] : []),
      update: talvezLanca({ id: "sa-1", estado: ESTADO_DA_SAIDA.CONFIRMADA }),
      delete: talvezLanca({ id: "sa-1" }),
    },
  };
}

const pegarRecusa = async (fn) => {
  try { await fn(); } catch (e) { return e; }
  throw new Error("esperava uma recusa e não veio nenhuma");
};

const criar = (client, extra = {}) => criarSaidaAvulsa({
  portalClientId: "emp-1", data: "2026-09-10", valor: 3000, descricao: "Reforma da sala",
  usuarioId: "u-1", client, ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A DATA CIVIL.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a data é CIVIL, e não passa por `new Date(string)`", () => {
  it("lê os componentes e monta em UTC", () => {
    const d = lerDataCivil("2026-09-10");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8);
    expect(d.getUTCDate()).toBe(10);
  });

  it("⚠⚠ 31 de FEVEREIRO é RECUSADO — `new Date` o aceitaria e devolveria 03/03", () => {
    // É a prova de que a validação é por componentes, e não por "o construtor não explodiu".
    expect(lerDataCivil("2026-02-31")).toBeNull();
    expect(new Date("2026-02-31").toString()).not.toBe("Invalid Date");
  });

  it("⚠ forma torta não vira data nenhuma", () => {
    for (const v of ["10/09/2026", "2026-9-10", "", null, undefined, "ontem", 20260910]) {
      expect(lerDataCivil(v)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ NASCER PENDENTE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ ela nasce PENDENTE — afirmação não entra no fluxo sozinha", () => {
  it("o estado gravado é PENDENTE, e quem criou fica registrado", async () => {
    const client = clientDe();
    await criar(client);
    const { data } = client.saidaAvulsaCliente.create.mock.calls[0][0];
    expect(data.estado).toBe(ESTADO_DA_SAIDA.PENDENTE);
    expect(data.criadaPor).toBe("u-1");
    expect(data.descricao).toBe("Reforma da sala");
    expect(data.valor).toBe(3000);
  });

  it("⚠ e o escopo por empresa vai no dado, nunca deduzido depois", async () => {
    const client = clientDe();
    await criar(client);
    expect(client.saidaAvulsaCliente.create.mock.calls[0][0].data.portalClientId).toBe("emp-1");
  });
});

describe("⚠ as recusas de criação, cada uma nomeada", () => {
  it.each([
    ["data ausente", { data: null }, RECUSA_DA_SAIDA.DATA_INVALIDA],
    ["data impossível", { data: "2026-02-31" }, RECUSA_DA_SAIDA.DATA_INVALIDA],
    ["valor zero", { valor: 0 }, RECUSA_DA_SAIDA.VALOR_INVALIDO],
    ["valor negativo", { valor: -5 }, RECUSA_DA_SAIDA.VALOR_INVALIDO],
    ["valor não numérico", { valor: "abc" }, RECUSA_DA_SAIDA.VALOR_INVALIDO],
    ["descrição vazia", { descricao: "   " }, RECUSA_DA_SAIDA.SEM_DESCRICAO],
  ])("%s ⇒ %s", async (_n, extra, codigo) => {
    const client = clientDe();
    const e = await pegarRecusa(() => criar(client, extra));
    expect(e).toBeInstanceOf(SaidaRecusada);
    expect(e.codigo).toBe(codigo);
    // ⚠⚠ E NADA foi gravado: a recusa acontece ANTES do banco.
    expect(client.saidaAvulsaCliente.create).not.toHaveBeenCalled();
  });

  it("⚠⚠ `null` e `0` NÃO são a mesma coisa, mas os dois são recusados aqui", async () => {
    // ⚠ `Number(null)` é 0 e 0 é FINITO — a guarda é `> 0`, nunca `Number.isFinite` sozinha. Uma
    // saída de zero não é uma saída; deixá-la passar poria uma linha de R$ 0,00 no fluxo.
    const e = await pegarRecusa(() => criar(clientDe(), { valor: null }));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.VALOR_INVALIDO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS DUAS AUSÊNCIAS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ tabela ausente e DELEGATE ausente viram a mesma recusa nomeada", () => {
  it("sem a migration (P2021), recusa nomeada — nunca um erro cru", async () => {
    const e = await pegarRecusa(() => criar(clientDe({ lancaP2021: true })));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.INDISPONIVEL);
    expect(e.frase).toMatch(/migration não foi aplicada/i);
  });

  it("⚠⚠ sem o `prisma generate` (delegate `undefined`), a MESMA recusa — nunca TypeError", async () => {
    // ⚠ Este estado é REAL, não hipotético: no Windows o `prisma generate` falha com EPERM quando o
    // servidor de dev está de pé. Sem esta guarda seria `undefined.create`, e o erro subiria como
    // 500 sem nome nenhum.
    const e = await pegarRecusa(() => criar(clientDe({ semDelegate: true })));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.INDISPONIVEL);
  });

  it("⚠ mas a LISTAGEM devolve vazio, não recusa — ela alimenta a contagem da Conferência", async () => {
    // ⚠⚠ A assimetria é deliberada: derrubar a listagem tiraria da tela também o que o DECLARADO
    // tem a dizer, e a fila do contador ficaria muda por causa de uma tabela que não é dele.
    expect(await listarSaidasPendentes({ portalClientId: "emp-1", client: {} }))
      .toEqual({ saidas: [], indisponivel: true });
    expect(await listarSaidasPendentes({ portalClientId: "emp-1", client: clientDe({ lancaP2021: true }) }))
      .toEqual({ saidas: [], indisponivel: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ APAGAR — só o que ainda não foi decidido.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o cliente desfaz o que escreveu, e só enquanto está PENDENTE", () => {
  it("pendente: apaga", async () => {
    const client = clientDe();
    await removerSaidaAvulsa({ portalClientId: "emp-1", saidaId: "sa-1", client });
    expect(client.saidaAvulsaCliente.delete).toHaveBeenCalled();
  });

  it.each([ESTADO_DA_SAIDA.CONFIRMADA, ESTADO_DA_SAIDA.RECUSADA])(
    "⚠⚠ já decidida (%s): RECUSA — apagar seria desfazer a decisão do contador pelo lado do cliente",
    async (estado) => {
      const client = clientDe({ achada: linha({ estado }) });
      const e = await pegarRecusa(() => removerSaidaAvulsa({ portalClientId: "emp-1", saidaId: "sa-1", client }));
      expect(e.codigo).toBe(RECUSA_DA_SAIDA.JA_DECIDIDA);
      expect(client.saidaAvulsaCliente.delete).not.toHaveBeenCalled();
    },
  );

  it("⚠⚠ o ESCOPO POR EMPRESA vai no `where`, nunca só o id", async () => {
    // ⚠ Sem ele, conhecer um id apagaria a saída de OUTRA empresa — o furo de multi-tenancy que a
    // F1 do WhatsApp já mediu neste projeto.
    const client = clientDe();
    await removerSaidaAvulsa({ portalClientId: "emp-1", saidaId: "sa-1", client });
    expect(client.saidaAvulsaCliente.findFirst.mock.calls[0][0].where)
      .toEqual({ id: "sa-1", portalClientId: "emp-1" });
  });

  it("⚠ saída de outra empresa não é encontrada — e a recusa não diz que ela existe", async () => {
    const client = clientDe({ achada: null });
    const e = await pegarRecusa(() => removerSaidaAvulsa({ portalClientId: "emp-1", saidaId: "x", client }));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.NAO_ENCONTRADA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A DECISÃO DO CONTADOR.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o contador decide — e confirmar NÃO lança nada", () => {
  const decidir = (client, extra = {}) => decidirSaidaAvulsa({
    portalClientId: "emp-1", saidaId: "sa-1", estado: ESTADO_DA_SAIDA.CONFIRMADA,
    usuarioId: "u-9", client, ...extra,
  });

  it("confirmar grava o estado, quem decidiu e quando", async () => {
    const client = clientDe();
    await decidir(client);
    const { data } = client.saidaAvulsaCliente.update.mock.calls[0][0];
    expect(data.estado).toBe(ESTADO_DA_SAIDA.CONFIRMADA);
    expect(data.decididaPor).toBe("u-9");
    expect(data.decididaEm).toBeInstanceOf(Date);
  });

  it("⚠ confirmar LIMPA o motivo — motivo pendurado em linha confirmada conta o contrário do estado", async () => {
    const client = clientDe();
    await decidir(client, { motivoRecusa: "sobra de uma recusa anterior" });
    expect(client.saidaAvulsaCliente.update.mock.calls[0][0].data.motivoRecusa).toBeNull();
  });

  it("⚠⚠ recusar SEM motivo é recusado — ausência nunca é resposta", async () => {
    const client = clientDe();
    const e = await pegarRecusa(() => decidir(client, { estado: ESTADO_DA_SAIDA.RECUSADA, motivoRecusa: "  " }));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.SEM_MOTIVO);
    expect(client.saidaAvulsaCliente.update).not.toHaveBeenCalled();
  });

  it("recusar COM motivo grava o motivo", async () => {
    const client = clientDe();
    await decidir(client, { estado: ESTADO_DA_SAIDA.RECUSADA, motivoRecusa: "isto já está na guia do DAS" });
    expect(client.saidaAvulsaCliente.update.mock.calls[0][0].data.motivoRecusa)
      .toBe("isto já está na guia do DAS");
  });

  it("⚠ estado fora do vocabulário RECUSA — inclusive voltar para PENDENTE", async () => {
    for (const estado of [ESTADO_DA_SAIDA.PENDENTE, "APROVADA", null, ""]) {
      const client = clientDe();
      const e = await pegarRecusa(() => decidir(client, { estado }));
      expect(e.codigo).toBe(RECUSA_DA_SAIDA.ESTADO_INVALIDO);
    }
  });

  it("⚠ decidir DUAS vezes recusa — senão 'recusei' e 'confirmei' alternam sem rastro", async () => {
    const client = clientDe({ achada: linha({ estado: ESTADO_DA_SAIDA.CONFIRMADA }) });
    const e = await pegarRecusa(() => decidir(client));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.JA_DECIDIDA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ ISTO NÃO É CONTABILIDADE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada neste serviço encosta no razão", () => {
  it("a varredura de fonte prova: nenhum `AccountingEntry`, nenhuma transação", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "SaidaAvulsaService.js"), "utf8")
      // ⚠ BLOCO antes de LINHA: um `//` dentro de `/* */` apaga o fechamento e o regex não-guloso
      // engole código de verdade. Lição de 27/08/2026, e o cabeçalho deste serviço CITA
      // `LancamentoDeclarado` de propósito — sem tirar os comentários, a varredura casaria com a
      // própria explicação.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/accountingEntry|lancamentoDeclarado/i);
    expect(fonte).not.toMatch(/\$transaction|\$executeRaw|\$queryRaw/);
  });

  it("⚠ e o comentário que EXPLICA a distinção continua no arquivo cru", () => {
    // ⚠⚠ A prova de que a varredura acima olha o CÓDIGO, não o texto: o cabeçalho cita
    // `LancamentoDeclarado` para dizer por que esta tabela NÃO é ele.
    const fs = require("node:fs");
    const path = require("node:path");
    const cru = fs.readFileSync(path.join(__dirname, "..", "SaidaAvulsaService.js"), "utf8");
    expect(cru).toMatch(/LancamentoDeclarado/);
    expect(cru).toMatch(/não saiu de lugar nenhum/i);
  });
});
