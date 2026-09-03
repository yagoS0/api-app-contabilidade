// O QUE O EVENTO VIRA. As duas pontas (conversa e envio de guia) entram como dublês: o que este
// teste prova é a COSTURA — quem é chamado, com o quê, e o que acontece quando algo falha no meio.
//
// ⚠ Zero rede e zero banco, por construção: os dois módulos que tocariam o Prisma são mockados.

jest.mock("../ConversaWhatsappService.js", () => ({ registrarMensagemRecebida: jest.fn() }));
jest.mock("../../guides/EnvioGuiaService.js", () => ({
  aplicarStatusDoProvedor: jest.fn(),
  aplicarFalhaDoProvedor: jest.fn(),
}));

import { processarEventoWhatsapp } from "../ProcessarEventoWhatsappService.js";
import { registrarMensagemRecebida } from "../ConversaWhatsappService.js";
import { aplicarStatusDoProvedor, aplicarFalhaDoProvedor } from "../../guides/EnvioGuiaService.js";

const AGORA = new Date("2026-08-15T12:00:00.000Z");

function logSpy() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

const evento = (value) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ value, field: "messages" }] }],
});

const MENSAGEM = {
  from: "5521988887777",
  id: "wamid.IN1",
  timestamp: "1755000000",
  type: "text",
  text: { body: "bom dia, chegou a guia?" },
};

beforeEach(() => {
  registrarMensagemRecebida.mockReset();
  aplicarStatusDoProvedor.mockReset();
  aplicarFalhaDoProvedor.mockReset();
});

describe("mensagens recebidas", () => {
  test("chama registrarMensagemRecebida com o instante JÁ convertido para Date", async () => {
    registrarMensagemRecebida.mockResolvedValue({
      duplicada: false,
      vinculo: { situacao: "VINCULADO", divergemPeloNonoDigito: false },
    });
    const resumo = await processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger: logSpy() });

    expect(registrarMensagemRecebida).toHaveBeenCalledTimes(1);
    const arg = registrarMensagemRecebida.mock.calls[0][0];
    expect(arg).toMatchObject({
      telefone: "5521988887777",
      providerMessageId: "wamid.IN1",
      tipo: "text",
      corpo: "bom dia, chegou a guia?",
    });
    // ⚠ `janela24h` RECUSA número cru como instante — a conversão é desta camada.
    expect(arg.ocorridaEmProvedor).toBeInstanceOf(Date);
    expect(resumo.mensagens).toMatchObject({ total: 1, gravadas: 1, duplicadas: 0, recusadas: 0 });
  });

  test("reentrega da Meta é contada como DUPLICADA, não como erro", async () => {
    registrarMensagemRecebida.mockResolvedValue({ duplicada: true, vinculo: { situacao: "VINCULADO" } });
    const resumo = await processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger: logSpy() });
    expect(resumo.mensagens).toMatchObject({ duplicadas: 1, gravadas: 0 });
    expect(resumo.erros).toEqual([]);
  });

  test("⚠ DESCONHECIDO e AMBIGUO passam pelo MESMO caminho — este módulo não escolhe empresa", async () => {
    for (const situacao of ["DESCONHECIDO", "AMBIGUO"]) {
      registrarMensagemRecebida.mockResolvedValue({ duplicada: false, vinculo: { situacao } });
      const log = logSpy();
      const resumo = await processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger: log });
      expect(resumo.mensagens.gravadas).toBe(1);
      expect(resumo.erros).toEqual([]);
      expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ vinculo: situacao }), expect.any(String));
    }
    // Nenhuma chamada com portalClientId: a atribuição é decisão do ConversaWhatsappService.
    for (const [arg] of registrarMensagemRecebida.mock.calls) expect(arg.portalClientId).toBeUndefined();
  });

  test("⚠ o CORPO DA MENSAGEM NUNCA VAI PARA O LOG (LGPD), e o telefone sai mascarado", async () => {
    registrarMensagemRecebida.mockResolvedValue({ duplicada: false, vinculo: { situacao: "VINCULADO" } });
    const log = logSpy();
    await processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger: log });

    const tudo = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(tudo).not.toContain("bom dia");
    expect(tudo).not.toContain("5521988887777");
    expect(tudo).toContain("+55…7777");
  });

  test("⚠ mensagem que NÃO conseguiu ser gravada sai em log de ERRO, com o wamid", async () => {
    const erro = Object.assign(new Error("Mensagem recebida sem o tipo informado pelo provedor."), { code: "SEM_TIPO" });
    registrarMensagemRecebida.mockRejectedValue(erro);
    const log = logSpy();
    const resumo = await processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger: log });

    expect(resumo.mensagens.recusadas).toBe(1);
    expect(resumo.erros[0]).toMatchObject({ onde: "mensagem", providerMessageId: "wamid.IN1", codigo: "SEM_TIPO" });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: "wamid.IN1" }),
      "WhatsApp: MENSAGEM RECEBIDA NÃO FOI GRAVADA",
    );
  });

  test("uma mensagem quebrada não leva junto as outras do mesmo evento", async () => {
    registrarMensagemRecebida
      .mockRejectedValueOnce(new Error("caiu"))
      .mockResolvedValueOnce({ duplicada: false, vinculo: { situacao: "VINCULADO" } });
    const resumo = await processarEventoWhatsapp(
      evento({ messages: [MENSAGEM, { ...MENSAGEM, id: "wamid.IN2" }] }),
      { agora: AGORA, logger: logSpy() },
    );
    expect(resumo.mensagens).toMatchObject({ total: 2, gravadas: 1, recusadas: 1 });
  });

  test("nunca lança: é chamada depois do 200, e uma exceção ali não teria quem a pegasse", async () => {
    registrarMensagemRecebida.mockRejectedValue(new Error("qualquer coisa"));
    await expect(
      processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger: logSpy() }),
    ).resolves.toBeDefined();
  });
});

describe("statuses", () => {
  test("sent/delivered/read vão para aplicarStatusDoProvedor, como vieram", async () => {
    aplicarStatusDoProvedor.mockResolvedValue({ id: "envio-1", status: "entregue" });
    for (const status of ["sent", "delivered", "read"]) {
      aplicarStatusDoProvedor.mockClear();
      const resumo = await processarEventoWhatsapp(
        evento({ statuses: [{ id: "wamid.OUT", status, timestamp: "1755000000" }] }),
        { agora: AGORA, logger: logSpy() },
      );
      expect(aplicarStatusDoProvedor).toHaveBeenCalledWith({ providerMessageId: "wamid.OUT", status });
      expect(resumo.statuses.aplicados).toBe(1);
    }
  });

  test("status de mensagem que não é envio de guia é caso NORMAL, não erro", async () => {
    aplicarStatusDoProvedor.mockResolvedValue(null);
    const resumo = await processarEventoWhatsapp(
      evento({ statuses: [{ id: "wamid.TEXTO", status: "read", timestamp: "1755000000" }] }),
      { agora: AGORA, logger: logSpy() },
    );
    expect(resumo.statuses).toMatchObject({ aplicados: 0, semEnvio: 1 });
    expect(resumo.erros).toEqual([]);
  });

  test("⚠ `failed` NÃO passa por aplicarStatusDoProvedor (ela o promoveria a 'enviado')", async () => {
    aplicarFalhaDoProvedor.mockResolvedValue({ envio: { id: "e1" }, aplicada: true, motivo: null });
    const erro = { code: 131047, title: "Re-engagement message", message: "Message failed to send" };
    const resumo = await processarEventoWhatsapp(
      evento({ statuses: [{ id: "wamid.OUT", status: "failed", timestamp: "1755000000", errors: [erro] }] }),
      { agora: AGORA, logger: logSpy() },
    );
    expect(aplicarStatusDoProvedor).not.toHaveBeenCalled();
    expect(aplicarFalhaDoProvedor).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: "wamid.OUT", codigo: "META_131047" }),
    );
    // A mensagem que chega ao contador é a TRADUZIDA, nunca o número cru.
    expect(aplicarFalhaDoProvedor.mock.calls[0][0].mensagemUsuario).toEqual(expect.any(String));
    expect(aplicarFalhaDoProvedor.mock.calls[0][0].mensagemUsuario).not.toBe("131047");
    expect(resumo.statuses.aplicados).toBe(1);
  });

  test("código de erro fora da tabela sobe CRU E NOMEADO, sem virar 'erro desconhecido'", async () => {
    aplicarFalhaDoProvedor.mockResolvedValue({ envio: { id: "e1" }, aplicada: true, motivo: null });
    await processarEventoWhatsapp(
      evento({
        statuses: [{ id: "wamid.OUT", status: "failed", timestamp: "1755000000", errors: [{ code: 999999, message: "algo novo" }] }],
      }),
      { agora: AGORA, logger: logSpy() },
    );
    expect(aplicarFalhaDoProvedor.mock.calls[0][0].codigo).toBe("META_999999");
  });

  test("falha reportada depois de entrega confirmada preserva o estado e registra a contradição", async () => {
    aplicarFalhaDoProvedor.mockResolvedValue({ envio: { id: "e1" }, aplicada: false, motivo: "CHEGADA_JA_CONFIRMADA" });
    const log = logSpy();
    const resumo = await processarEventoWhatsapp(
      evento({ statuses: [{ id: "wamid.OUT", status: "failed", timestamp: "1755000000", errors: [{ code: 131026 }] }] }),
      { agora: AGORA, logger: log },
    );
    expect(resumo.statuses.contradicoes).toBe(1);
    expect(log.warn).toHaveBeenCalled();
  });

  test("⚠ valor de status desconhecido é IGNORADO com aviso — nunca adivinhado", async () => {
    const log = logSpy();
    const resumo = await processarEventoWhatsapp(
      evento({ statuses: [{ id: "wamid.OUT", status: "warp", timestamp: "1755000000" }] }),
      { agora: AGORA, logger: log },
    );
    expect(aplicarStatusDoProvedor).not.toHaveBeenCalled();
    expect(aplicarFalhaDoProvedor).not.toHaveBeenCalled();
    expect(resumo.statuses.desconhecidos).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ status: "warp" }), expect.any(String));
  });

  test("falha do banco ao aplicar status vira erro NOMEADO no resumo e no log", async () => {
    aplicarStatusDoProvedor.mockRejectedValue(new Error("conexão caiu"));
    const log = logSpy();
    const resumo = await processarEventoWhatsapp(
      evento({ statuses: [{ id: "wamid.OUT", status: "delivered", timestamp: "1755000000" }] }),
      { agora: AGORA, logger: log },
    );
    expect(resumo.erros[0]).toMatchObject({ onde: "status", providerMessageId: "wamid.OUT" });
    expect(log.error).toHaveBeenCalled();
  });
});

// ── O GANCHO DO ASSISTENTE (F4, 02/09/2026): as QUATRO chaves, medidas por NÃO-chamada ──────────
import { decidirRespostaDaIa } from "../ProcessarEventoWhatsappService.js";

describe("decidirRespostaDaIa — a IA só responde com as quatro chaves", () => {
  const r = (over = {}) => ({
    duplicada: false,
    vinculo: { situacao: "VINCULADO" },
    conversa: { id: "cv1", portalClientId: "pc-1", atendidaPor: null, atendidaDesde: null },
    mensagem: { id: "m1" },
    ...over,
  });
  it("flag OFF → não responde (é o estado de hoje)", () => {
    expect(decidirRespostaDaIa({ r: r(), flag: false, piloto: ["pc-1"] })).toEqual({ responde: false, motivo: "FLAG_OFF" });
  });
  it("⚠ piloto VAZIO → ninguém, mesmo com a flag ligada", () => {
    expect(decidirRespostaDaIa({ r: r(), flag: true, piloto: [] }).motivo).toBe("FORA_DO_PILOTO");
    expect(decidirRespostaDaIa({ r: r(), flag: true, piloto: ["outra"] }).motivo).toBe("FORA_DO_PILOTO");
  });
  it("DESCONHECIDO/AMBIGUO/sem empresa → fila humana, nunca a IA", () => {
    expect(decidirRespostaDaIa({ r: r({ vinculo: { situacao: "DESCONHECIDO" }, conversa: { id: "cv1", portalClientId: null } }), flag: true, piloto: ["pc-1"] }).motivo).toBe("NAO_VINCULADA");
    expect(decidirRespostaDaIa({ r: r({ vinculo: { situacao: "AMBIGUO" } }), flag: true, piloto: ["pc-1"] }).motivo).toBe("NAO_VINCULADA");
  });
  it("assumida por pessoa, ou na fila do escritório → a IA cala", () => {
    expect(decidirRespostaDaIa({ r: r({ conversa: { id: "cv1", portalClientId: "pc-1", atendidaPor: "u9" } }), flag: true, piloto: ["pc-1"] }).motivo).toBe("ASSUMIDA_POR_HUMANO");
    expect(decidirRespostaDaIa({ r: r({ conversa: { id: "cv1", portalClientId: "pc-1", atendidaDesde: new Date() } }), flag: true, piloto: ["pc-1"] }).motivo).toBe("ASSUMIDA_POR_HUMANO");
  });
  it("duplicada (reentrega) nunca dispara", () => {
    expect(decidirRespostaDaIa({ r: r({ duplicada: true }), flag: true, piloto: ["pc-1"] }).motivo).toBe("DUPLICADA");
  });
  it("as quatro chaves ligadas → responde", () => {
    expect(decidirRespostaDaIa({ r: r(), flag: true, piloto: ["pc-1"] })).toEqual({ responde: true, motivo: null });
  });
});

// ── O GANCHO, LIGADO: `responder` é chamado (ou não) conforme a decisão ──────────────────────────
// ⚠ Isto existe desde 03/09/2026. Até então o comentário do gancho AFIRMAVA esta cobertura e ela
// não existia: fazer o gancho ignorar `decidirRespostaDaIa` deixava a suíte inteira verde.
describe("o gancho da IA — quem é chamado, e com o quê", () => {
  const REGISTRO = (over = {}) => ({
    duplicada: false,
    vinculo: { situacao: "VINCULADO", divergemPeloNonoDigito: false },
    conversa: { id: "cv1", portalClientId: "pc-1", atendidaPor: null, atendidaDesde: null },
    mensagem: { id: "m1" },
    ...over,
  });
  const proximoTick = () => new Promise((resolve) => setImmediate(resolve));

  async function rodar({ registro, ia, responder }) {
    registrarMensagemRecebida.mockResolvedValue(registro);
    const resumo = await processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger: logSpy(), responder, ia });
    await proximoTick();
    return resumo;
  }

  it("as quatro chaves ligadas → chama com o id do fio e o da mensagem", async () => {
    const responder = jest.fn(async () => ({ feito: true }));
    const resumo = await rodar({ registro: REGISTRO(), ia: { flag: true, piloto: ["pc-1"] }, responder });
    expect(responder).toHaveBeenCalledWith({ conversaId: "cv1", mensagemId: "m1" });
    expect(resumo.mensagens.gravadas).toBe(1);
  });

  it("⚠ flag OFF, fora do piloto, duplicada, não vinculada e assumida → NÃO chama", async () => {
    const casos = [
      [REGISTRO(), { flag: false, piloto: ["pc-1"] }, "FLAG_OFF"],
      [REGISTRO(), { flag: true, piloto: [] }, "FORA_DO_PILOTO"],
      [REGISTRO({ duplicada: true }), { flag: true, piloto: ["pc-1"] }, "DUPLICADA"],
      [REGISTRO({ vinculo: { situacao: "DESCONHECIDO" }, conversa: { id: "cv1", portalClientId: null } }), { flag: true, piloto: ["pc-1"] }, "NAO_VINCULADA"],
      [REGISTRO({ conversa: { id: "cv1", portalClientId: "pc-1", atendidaPor: "u9" } }), { flag: true, piloto: ["pc-1"] }, "ASSUMIDA_POR_HUMANO"],
    ];
    for (const [registro, ia, motivo] of casos) {
      const responder = jest.fn(async () => ({ feito: true }));
      await rodar({ registro, ia, responder });
      // O motivo da recusa é o de `decidirRespostaDaIa`; aqui o que se mede é a NÃO-CHAMADA.
      expect([motivo, responder.mock.calls.length]).toEqual([motivo, 0]);
    }
  });

  it("⚠ o assistente lançando NÃO derruba o webhook — o evento já foi processado", async () => {
    const responder = jest.fn(async () => { throw new Error("modelo caiu"); });
    const logger = logSpy();
    registrarMensagemRecebida.mockResolvedValue(REGISTRO());
    const resumo = await processarEventoWhatsapp(evento({ messages: [MENSAGEM] }), { agora: AGORA, logger, responder, ia: { flag: true, piloto: ["pc-1"] } });
    await proximoTick();
    await proximoTick();
    expect(resumo.mensagens.gravadas).toBe(1);
    expect(resumo.erros).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});
