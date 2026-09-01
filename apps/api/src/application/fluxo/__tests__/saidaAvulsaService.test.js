// ⚠⚠ A SAÍDA AVULSA QUE O CLIENTE PLANEJOU — e o que ela NÃO é.
//
// > Dono, 29/08/2026: *"o cliente pode modificar as saídas, podendo colocar novas saídas, apenas
// > para visualização deles."*
//
// ⚠⚠ O bloco que mais importa é o de que **isto não é contabilidade**: confirmar aqui põe a linha no
// FLUXO, e não no razão. `LancamentoDeclarado` exige data de PAGAMENTO justamente porque afirma que
// o dinheiro saiu — e uma saída planejada para o mês que vem não saiu de lugar nenhum.

jest.mock("../../accounting/fechamentoContabil.js", () => ({
  isMonthClosed: jest.fn(async () => false),
}));

import { isMonthClosed } from "../../accounting/fechamentoContabil.js";
import {
  ESTADO_DA_SAIDA,
  lancarSaidaAvulsa,
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
    // ⚠⚠ ESTA VARREDURA PROIBIA `accountingEntry` NO ARQUIVO INTEIRO ATÉ 01/09/2026, e o dono
    // reverteu: *"não me dando opção de colocar como lançamentos"* … **"vira lançamento contábil
    // direto"**. `lancarSaidaAvulsa` ESCREVE no razão, de propósito.
    //
    // ⚠ O QUE A VARREDURA PROTEGIA CONTINUA PROTEGIDO, e mudou de alvo em vez de sumir: o
    // `decidirSaidaAvulsa` — o CONFIRMAR, que é o que o cliente e o contador usam todo dia — não
    // pode encostar no razão. "Confirmar não lança nada" segue sendo verdade; o que existe agora é
    // um verbo DIFERENTE, com guardas próprias (data futura, mês fechado, idempotência).
    const decidir = fonte.slice(fonte.indexOf("export async function decidirSaidaAvulsa"));
    const soODecidir = decidir.slice(0, decidir.indexOf("export async function lancarSaidaAvulsa"));
    expect(soODecidir).not.toMatch(/accountingEntry|lancamentoDeclarado/i);
    expect(soODecidir).not.toMatch(/\$transaction|\$executeRaw|\$queryRaw/);
  });

  it("⚠⚠ e o LANÇAR é o único que escreve no razão — a exceção é nomeada, não geral", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "SaidaAvulsaService.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // ⚠ Uma só criação de lançamento no arquivo. Duas seriam dois caminhos para a mesma despesa.
    expect((fonte.match(/accountingEntry\.create/g) || []).length).toBe(1);
    // ⚠ E ela mora DENTRO de uma transação: fora dela, um erro entre as duas escritas deixaria o
    // lançamento no razão com a saída dizendo que nunca foi lançada — e o clique seguinte criaria
    // o segundo.
    expect(fonte).toMatch(/\$transaction/);
  });

  it("⚠⚠ criar e remover continuam SEM tocar no razão", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "SaidaAvulsaService.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const criar = fonte.slice(fonte.indexOf("export async function criarSaidaAvulsa"));
    expect(criar.slice(0, criar.indexOf("export async function listarSaidasPendentes")))
      .not.toMatch(/accountingEntry/i);
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

describe("⚠⚠⚠ LANÇAR a saída do cliente — decisão do dono, 01/09/2026", () => {
  // > *"não me dando opção de colocar como lançamentos"* e, entre a fila e o direto:
  // > **"vira lançamento contábil direto"**.
  //
  // ⚠ Eu recomendei a fila e ele escolheu o direto. O que este bloco trava são as guardas que
  // tornam a escolha segura — elas não são detalhe, são a razão de o direto ser aceitável.
  const HOJE = new Date("2026-09-20T12:00:00.000Z");

  const PLANO = [
    { portalClientId: null, codigo: "5", nome: "Caixa", codigoCompleto: "111010001", analitica: true },
    { portalClientId: null, codigo: "401", nome: "Aluguel", codigoCompleto: "411020001", analitica: true },
    { portalClientId: null, codigo: "400", nome: "Despesas Gerais", codigoCompleto: "41102", analitica: false },
  ];

  const clientParaLancar = ({ saida = {}, criouEntry = { id: "ae-1" } } = {}) => {
    const alvo = {
      id: "sa-1",
      estado: ESTADO_DA_SAIDA.PENDENTE,
      data: new Date("2026-09-18T00:00:00.000Z"),
      valor: "3500.00",
      descricao: "Reforma da sala",
      accountingEntryId: null,
      ...saida,
    };
    const update = jest.fn(async (args) => ({ id: "sa-1", ...args.data }));
    const create = jest.fn(async () => criouEntry);
    const client = {
      saidaAvulsaCliente: { findFirst: jest.fn(async () => alvo), findMany: jest.fn(async () => []), update },
      chartOfAccount: { findMany: jest.fn(async () => PLANO) },
      accountingEntry: { create },
      // ⚠ O dublê da transação EXECUTA o callback com ele mesmo: é o que faz o teste medir as duas
      // escritas de verdade, em vez de provar que `$transaction` foi chamada.
      $transaction: jest.fn(async (fn) => fn(client)),
    };
    return { client, update, create };
  };

  const lancar = (client, extra = {}) => lancarSaidaAvulsa({
    portalClientId: "emp-1",
    saidaId: "sa-1",
    contaDespesa: "411020001",
    usuarioId: "u1",
    agora: HOJE,
    client,
    ...extra,
  });

  beforeEach(() => { isMonthClosed.mockResolvedValue(false); });

  it("cria o lançamento e marca a saída como LANCADA, com o vínculo", async () => {
    const { client, update, create } = clientParaLancar();
    const r = await lancar(client);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.estado).toBe(ESTADO_DA_SAIDA.LANCADA);
    expect(update.mock.calls[0][0].data.accountingEntryId).toBe("ae-1");
  });

  it("⚠⚠ o lançamento é `D despesa / C caixa` — a invariante do caixa, intacta", async () => {
    const { client, create } = clientParaLancar();
    await lancar(client);
    const linhas = create.mock.calls[0][0].data.lines.create;
    expect(linhas.find((l) => l.tipo === "D").conta).toBe("401");
    expect(linhas.find((l) => l.tipo === "C").conta).toBe("5");
  });

  it("⚠⚠ e ele carrega o `portalClientId` — sem isso a despesa nasce SEM EMPRESA", async () => {
    // Furo real, achado antes do primeiro teste: `montarLancamento` copia esse campo do objeto que
    // recebe, e omiti-lo criaria a linha com `undefined`. Multi-tenancy é a guarda do módulo.
    const { client, create } = clientParaLancar();
    await lancar(client);
    expect(create.mock.calls[0][0].data.portalClientId).toBe("emp-1");
  });

  it("⚠ a DATA do lançamento é a da saída — é ela que afirma quando o dinheiro saiu", async () => {
    const { client, create } = clientParaLancar();
    await lancar(client);
    expect(create.mock.calls[0][0].data.competencia).toBe("2026-09");
  });

  it("⚠⚠ DATA FUTURA RECUSA — previsão do mês que vem não saiu de lugar nenhum", async () => {
    const { client, create } = clientParaLancar({ saida: { data: new Date("2026-10-05T00:00:00.000Z") } });
    const e = await pegarRecusa(() => lancar(client));
    expect(e).toBeInstanceOf(SaidaRecusada);
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.DATA_FUTURA);
    expect(create).not.toHaveBeenCalled();
  });

  it("⚠ a saída de HOJE passa — a comparação é por DIA CIVIL, não por instante", async () => {
    // `data` é `@db.Date` e `agora` tem hora: comparar crus recusaria a saída de hoje depois da
    // meia-noite UTC.
    const { client, create } = clientParaLancar({ saida: { data: new Date("2026-09-20T00:00:00.000Z") } });
    await lancar(client);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ MÊS FECHADO recusa — a mesma guarda do declarado", async () => {
    isMonthClosed.mockResolvedValue(true);
    const { client, create } = clientParaLancar();
    const e = await pegarRecusa(() => lancar(client));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.MES_FECHADO);
    expect(create).not.toHaveBeenCalled();
  });

  it("⚠⚠ JÁ LANÇADA recusa — dois cliques não viram duas despesas no razão", async () => {
    const { client, create } = clientParaLancar({ saida: { accountingEntryId: "ae-velho" } });
    const e = await pegarRecusa(() => lancar(client));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.JA_LANCADA);
    expect(create).not.toHaveBeenCalled();
  });

  it("⚠ e ela diz «já lançada», nunca «estado inválido» — consertos diferentes", async () => {
    const { client } = clientParaLancar({
      saida: { accountingEntryId: "ae-velho", estado: ESTADO_DA_SAIDA.LANCADA },
    });
    const e = await pegarRecusa(() => lancar(client));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.JA_LANCADA);
  });

  it("⚠ saída RECUSADA não vira lançamento", async () => {
    const { client, create } = clientParaLancar({ saida: { estado: ESTADO_DA_SAIDA.RECUSADA } });
    const e = await pegarRecusa(() => lancar(client));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.ESTADO_INVALIDO);
    expect(create).not.toHaveBeenCalled();
  });

  it("⚠ a CONFIRMADA vira — ela já está no fluxo, e lançar é o passo seguinte", async () => {
    const { client, create } = clientParaLancar({ saida: { estado: ESTADO_DA_SAIDA.CONFIRMADA } });
    await lancar(client);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ SEM CONTA recusa ANTES de qualquer ida ao banco — o sistema não escolhe uma", async () => {
    const { client } = clientParaLancar();
    const e = await pegarRecusa(() => lancar(client, { contaDespesa: "  " }));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.SEM_CONTA);
    expect(client.saidaAvulsaCliente.findFirst).not.toHaveBeenCalled();
  });

  it("⚠⚠ conta SINTÉTICA recusa, e a frase da FORMA chega inteira", async () => {
    // É a trava do registro I250 da ECD (`IND_CTA = "A"`), e ela vem de `montarLancamento` — não é
    // reimplementada aqui. A frase nomeia a conta, que é o que o contador precisa para corrigir.
    const { client, create } = clientParaLancar();
    const e = await pegarRecusa(() => lancar(client, { contaDespesa: "41102" }));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.FORMA_INVALIDA);
    expect(create).not.toHaveBeenCalled();
  });

  it("⚠ conta fora do plano recusa", async () => {
    const { client, create } = clientParaLancar();
    const e = await pegarRecusa(() => lancar(client, { contaDespesa: "999999999" }));
    expect(e.codigo).toBe(RECUSA_DA_SAIDA.FORMA_INVALIDA);
    expect(create).not.toHaveBeenCalled();
  });

  it("⚠⚠ as duas escritas acontecem na MESMA transação", async () => {
    // Fora dela, um erro no meio deixaria o lançamento no razão com a saída dizendo que nunca foi
    // lançada — e o clique seguinte criaria o segundo.
    const { client } = clientParaLancar();
    await lancar(client);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it("⚠ lançar TAMBÉM é decidir: grava quem e quando, e limpa motivo de recusa", async () => {
    const { client, update } = clientParaLancar();
    await lancar(client);
    const data = update.mock.calls[0][0].data;
    expect(data.decididaPor).toBe("u1");
    expect(data.decididaEm).toEqual(HOJE);
    expect(data.motivoRecusa).toBeNull();
  });
});
