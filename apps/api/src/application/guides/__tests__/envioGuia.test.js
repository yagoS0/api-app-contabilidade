// O ESTADO DE ENVIO POR CANAL — as três regras que não podem escorregar.
//
// Até aqui `Guide.emailStatus` respondia "esta guia foi enviada?", e dele saíam o chip da listagem,
// o selo "Guias concluídas" e a barra de progresso. Com um segundo canal, um campo só não consegue
// dizer "enviada por WhatsApp e ainda não por e-mail".

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { envioGuia: { findUnique: jest.fn(), upsert: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() } },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  foiEnviada, envioParaExibir, registrarEnvio, aplicarStatusDoProvedor,
} from "../EnvioGuiaService.js";

beforeEach(() => jest.clearAllMocks());

describe("foiEnviada — terminal em QUALQUER canal basta", () => {
  it("só e-mail entregue já conta como enviada", () => {
    expect(foiEnviada([{ canal: "EMAIL", status: "entregue" }])).toBe(true);
  });

  it("e-mail FALHOU mas WhatsApp entregou: a guia chegou", () => {
    // Cobrar o segundo canal transformaria uma escolha de conveniência em pendência.
    expect(foiEnviada([
      { canal: "EMAIL", status: "falhou" },
      { canal: "WHATSAPP", status: "entregue" },
    ])).toBe(true);
  });

  it("os dois falharam: não foi enviada", () => {
    expect(foiEnviada([
      { canal: "EMAIL", status: "falhou" },
      { canal: "WHATSAPP", status: "falhou" },
    ])).toBe(false);
  });

  it("pendente e enviando NÃO são enviada — a guia ainda não saiu", () => {
    expect(foiEnviada([{ canal: "WHATSAPP", status: "pendente" }])).toBe(false);
    expect(foiEnviada([{ canal: "WHATSAPP", status: "enviando" }])).toBe(false);
  });

  it("sem nenhum envio: não foi enviada", () => {
    expect(foiEnviada([])).toBe(false);
    expect(foiEnviada(undefined)).toBe(false);
  });
});

describe("envioParaExibir — o popover mostra o mais adiantado", () => {
  it("lido vence entregue", () => {
    const r = envioParaExibir([
      { canal: "EMAIL", status: "entregue" },
      { canal: "WHATSAPP", status: "lido" },
    ]);
    expect(r.canal).toBe("WHATSAPP");
  });

  it("qualquer sucesso vence uma falha", () => {
    expect(envioParaExibir([
      { canal: "WHATSAPP", status: "falhou" },
      { canal: "EMAIL", status: "enviado" },
    ]).canal).toBe("EMAIL");
  });
});

describe("registrarEnvio — idempotência é o que torna o lote seguro", () => {
  it("guia JÁ enviada naquele canal não é redisparada", async () => {
    // É esta guarda que faz reexecutar o lote não mandar a mesma guia duas vezes ao cliente.
    prisma.envioGuia.findUnique.mockResolvedValue({ id: "e1", status: "entregue" });
    const r = await registrarEnvio({ guideId: "g1", canal: "WHATSAPP" });
    expect(r.jaEnviado).toBe(true);
    expect(prisma.envioGuia.upsert).not.toHaveBeenCalled();
  });

  it("envio que falhou PODE ser retentado, e o erro antigo é limpo", async () => {
    prisma.envioGuia.findUnique.mockResolvedValue({ id: "e1", status: "falhou" });
    prisma.envioGuia.upsert.mockResolvedValue({ id: "e1", status: "pendente" });
    const r = await registrarEnvio({ guideId: "g1", canal: "WHATSAPP", destino: "5521999998888" });
    expect(r.jaEnviado).toBe(false);
    expect(prisma.envioGuia.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ erroCodigo: null, erroMensagemUsuario: null }) }),
    );
  });
});

describe("aplicarStatusDoProvedor — NUNCA rebaixa", () => {
  it("delivered atrasado não faz a mensagem 'desler'", async () => {
    // A Meta entrega eventos fora de ordem. Sem a comparação por peso, um `delivered` chegando
    // depois do `read` apagaria o ✓✓ azul que o contador já tinha visto.
    prisma.envioGuia.findFirst.mockResolvedValue({ id: "e1", status: "lido", entregueEm: new Date() });
    const r = await aplicarStatusDoProvedor({ providerMessageId: "wamid.X", status: "delivered" });
    expect(prisma.envioGuia.update).not.toHaveBeenCalled();
    expect(r.status).toBe("lido");
  });

  it("read depois de entregue promove", async () => {
    prisma.envioGuia.findFirst.mockResolvedValue({ id: "e1", status: "entregue", entregueEm: new Date() });
    prisma.envioGuia.update.mockResolvedValue({ id: "e1", status: "lido" });
    await aplicarStatusDoProvedor({ providerMessageId: "wamid.X", status: "read" });
    expect(prisma.envioGuia.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "lido" }) }),
    );
  });

  it("wamid desconhecido não explode — devolve null", async () => {
    prisma.envioGuia.findFirst.mockResolvedValue(null);
    expect(await aplicarStatusDoProvedor({ providerMessageId: "wamid.?", status: "read" })).toBeNull();
  });
});
