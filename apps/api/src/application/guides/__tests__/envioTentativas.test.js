jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import {
  registrarEnvio, marcarEnviando, marcarEnviado, marcarFalhou, marcarIndeterminado,
  aplicarStatusDoProvedor, aplicarFalhaDoProvedor,
} from "../EnvioGuiaService.js";

function banco(estado = "pendente") {
  const envios = [{ id: "e1", guideId: "g1", canal: "WHATSAPP", destino: "destino-teste", status: estado, tentativas: 0, tentativaAtualId: null }];
  const tentativas = [];
  const igual = (a, b) => b && typeof b === "object" && Array.isArray(b.in) ? b.in.includes(a) : a === b;
  const casa = (linha, where = {}) => Object.entries(where).every(([k, v]) => v === undefined || igual(linha[k], v));
  const modelo = (linhas) => ({
    findFirst: jest.fn(async ({ where }) => { const r = linhas.find((l) => casa(l, where)); return r ? { ...r } : null; }),
    findUnique: jest.fn(async ({ where }) => { const r = linhas.find((l) => casa(l, where)); return r ? { ...r } : null; }),
    create: jest.fn(async ({ data }) => { linhas.push({ ...data }); return { ...data }; }),
    updateMany: jest.fn(async ({ where, data }) => {
      const rs = linhas.filter((l) => casa(l, where));
      for (const r of rs) for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in v ? Number(r[k] || 0) + v.increment : v;
      return { count: rs.length };
    }),
  });
  const tx = { envioGuia: modelo(envios), envioGuiaTentativa: modelo(tentativas) };
  return { tx, envios, tentativas };
}

const pedido = (tx, reenviar = false) => registrarEnvio({ guideId: "g1", canal: "WHATSAPP", destino: "destino-teste", reenviar, tx });

describe("tentativas de envio sem mistura de correlação", () => {
  it("segunda requisição não reabre a reserva que está enviando", async () => {
    const { tx, envios, tentativas } = banco();
    await pedido(tx);
    const a = await marcarEnviando("e1", tx);
    const b = await pedido(tx, true);
    const reservaB = await marcarEnviando("e1", tx);
    expect(a.reservado).toBe(true);
    expect(b.emAndamento).toBe(true);
    expect(reservaB.reservado).toBe(false);
    expect(envios[0].tentativas).toBe(1);
    expect(tentativas).toHaveLength(1);
  });

  it("nova tentativa limpa somente os carimbos atuais e mantém o histórico", async () => {
    const { tx, envios, tentativas } = banco();
    const a = await marcarEnviando("e1", tx);
    await marcarEnviado({ envioId: "e1", tentativaId: a.tentativaId, providerMessageId: "wamid-antigo" }, tx);
    await aplicarStatusDoProvedor({ providerMessageId: "wamid-antigo", status: "read" }, tx);
    await pedido(tx, true);
    const b = await marcarEnviando("e1", tx);
    expect(envios[0]).toMatchObject({ providerMessageId: null, entregueEm: null, lidoEm: null, tentativaAtualId: b.tentativaId });
    expect(tentativas[0]).toMatchObject({ providerMessageId: "wamid-antigo", status: "lido" });
    expect(tentativas).toHaveLength(2);
  });

  it("webhook da tentativa anterior não altera a tentativa atual", async () => {
    const { tx, envios, tentativas } = banco();
    const a = await marcarEnviando("e1", tx);
    await marcarEnviado({ envioId: "e1", tentativaId: a.tentativaId, providerMessageId: "antigo" }, tx);
    await pedido(tx, true);
    const b = await marcarEnviando("e1", tx);
    await aplicarStatusDoProvedor({ providerMessageId: "antigo", status: "delivered" }, tx);
    expect(tentativas[0].status).toBe("entregue");
    expect(envios[0]).toMatchObject({ status: "enviando", tentativaAtualId: b.tentativaId, entregueEm: null });
  });

  it("sent atrasado não apaga uma falha da mesma tentativa", async () => {
    const { tx, envios, tentativas } = banco();
    const { tentativaId } = await marcarEnviando("e1", tx);
    await marcarEnviado({ envioId: "e1", tentativaId, providerMessageId: "wamid-teste" }, tx);
    await aplicarFalhaDoProvedor({ providerMessageId: "wamid-teste", codigo: "META_TESTE", mensagemUsuario: "recusada" }, tx);
    const r = await aplicarStatusDoProvedor({ providerMessageId: "wamid-teste", status: "sent" }, tx);
    expect(r.mudou).toBe(false);
    expect(envios[0].status).toBe("falhou");
    expect(tentativas[0].status).toBe("falhou");
  });

  it("delivered/read concorrentes e falha posterior nunca rebaixam leitura", async () => {
    const { tx, envios } = banco();
    const { tentativaId } = await marcarEnviando("e1", tx);
    await marcarEnviado({ envioId: "e1", tentativaId, providerMessageId: "wamid-teste" }, tx);
    await Promise.all(["delivered", "read"].map((status) => aplicarStatusDoProvedor({ providerMessageId: "wamid-teste", status }, tx)));
    await aplicarFalhaDoProvedor({ providerMessageId: "wamid-teste", codigo: "META_TESTE" }, tx);
    expect(envios[0].status).toBe("lido");
  });

  it("indeterminado não é reaberto nem com reenviar e pode ser reconciliado por entrega", async () => {
    const { tx, envios } = banco();
    const { tentativaId } = await marcarEnviando("e1", tx);
    await marcarIndeterminado({ envioId: "e1", tentativaId, providerMessageId: "wamid-teste", mensagemUsuario: "conferir" }, tx);
    expect((await pedido(tx, true)).emAndamento).toBe(true);
    expect((await marcarEnviando("e1", tx)).reservado).toBe(false);
    await aplicarStatusDoProvedor({ providerMessageId: "wamid-teste", status: "delivered" }, tx);
    expect(envios[0].status).toBe("entregue");
  });

  it("finalização atrasada não rebaixa entrega já confirmada", async () => {
    const { tx, envios } = banco();
    const { tentativaId } = await marcarEnviando("e1", tx);
    await marcarEnviado({ envioId: "e1", tentativaId, providerMessageId: "wamid-teste" }, tx);
    await aplicarStatusDoProvedor({ providerMessageId: "wamid-teste", status: "read" }, tx);
    await marcarFalhou({ envioId: "e1", tentativaId, codigo: "ATRASO" }, tx);
    expect(envios[0].status).toBe("lido");
  });
});
