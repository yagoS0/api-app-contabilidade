// O ESTADO DE ENVIO POR CANAL — as três regras que não podem escorregar.
//
// Até aqui `Guide.emailStatus` respondia "esta guia foi enviada?", e dele saíam o chip da listagem,
// o selo "Guias concluídas" e a barra de progresso. Com um segundo canal, um campo só não consegue
// dizer "enviada por WhatsApp e ainda não por e-mail".

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { envioGuia: { findUnique: jest.fn(), upsert: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() } },
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
  it("guia JÁ enviada naquele DESTINO não é redisparada", async () => {
    // É esta guarda que faz reexecutar o lote não mandar a mesma guia duas vezes ao cliente.
    prisma.envioGuia.findFirst.mockResolvedValue({ id: "e1", status: "entregue" });
    const r = await registrarEnvio({ guideId: "g1", canal: "WHATSAPP", destino: "5521999998888" });
    expect(r.jaEnviado).toBe(true);
    expect(prisma.envioGuia.create).not.toHaveBeenCalled();
    expect(prisma.envioGuia.update).not.toHaveBeenCalled();
  });

  it("⚠ OUTRO destino no MESMO canal não é repetição — é outro destinatário (05/09/2026)", async () => {
    // A chave passou a incluir o destino porque a guia vai para TODOS os cadastrados. Sem isto, o
    // segundo telefone da empresa nunca receberia: a linha do primeiro diria "já enviada".
    prisma.envioGuia.findFirst.mockResolvedValue(null);
    prisma.envioGuia.create.mockResolvedValue({ id: "e2", status: "pendente" });
    const r = await registrarEnvio({ guideId: "g1", canal: "WHATSAPP", destino: "5521988887777" });
    expect(r.jaEnviado).toBe(false);
    expect(prisma.envioGuia.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ destino: "5521988887777" }) }),
    );
  });

  it("⚠ REENVIAR só com o pedido explícito — sem ele, enviada continua sendo recusa", async () => {
    // Decisão do dono (05/09/2026): a tela avisa que já foi enviada e o contador decide. O LOTE
    // nunca passa `reenviar` — é o que impede a carteira inteira de sair duas vezes num clique.
    prisma.envioGuia.findFirst.mockResolvedValue({ id: "e1", status: "entregue" });
    prisma.envioGuia.update.mockResolvedValue({ id: "e1", status: "pendente" });
    const semPedido = await registrarEnvio({ guideId: "g1", canal: "WHATSAPP", destino: "5521999998888" });
    expect(semPedido.jaEnviado).toBe(true);
    const comPedido = await registrarEnvio({ guideId: "g1", canal: "WHATSAPP", destino: "5521999998888", reenviar: true });
    expect(comPedido.jaEnviado).toBe(false);
    expect(comPedido.reenvio).toBe(true);
    expect(prisma.envioGuia.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "e1" }, data: expect.objectContaining({ status: "pendente" }) }),
    );
  });

  it("envio que falhou PODE ser retentado, e o erro antigo é limpo", async () => {
    prisma.envioGuia.findFirst.mockResolvedValue({ id: "e1", status: "falhou" });
    prisma.envioGuia.update.mockResolvedValue({ id: "e1", status: "pendente" });
    const r = await registrarEnvio({ guideId: "g1", canal: "WHATSAPP", destino: "5521999998888" });
    expect(r.jaEnviado).toBe(false);
    // ⚠ A MESMA linha volta a `pendente` — nunca uma segunda para o mesmo destino.
    expect(prisma.envioGuia.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "e1" }, data: expect.objectContaining({ erroCodigo: null, erroMensagemUsuario: null }) }),
    );
    expect(prisma.envioGuia.create).not.toHaveBeenCalled();
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

describe("foiEnviadaComLegado — a janela entre o deploy e o backfill", () => {
  it("guia SEM envio registrado mas com emailStatus SENT continua enviada", async () => {
    // ⚠ Sem isto, no intervalo entre subir a F2 e rodar o backfill a carteira INTEIRA aparece como
    // não enviada — e o contador reenvia guias que o cliente já recebeu. Não é invenção:
    // `emailStatus: SENT` é exatamente o dado que o backfill converteria.
    const { foiEnviadaComLegado } = await import("../EnvioGuiaService.js");
    expect(foiEnviadaComLegado([], { emailStatus: "SENT" })).toBe(true);
  });

  it("guia sem envio e sem SENT continua não enviada", async () => {
    const { foiEnviadaComLegado } = await import("../EnvioGuiaService.js");
    expect(foiEnviadaComLegado([], { emailStatus: "PENDING" })).toBe(false);
    expect(foiEnviadaComLegado([], {})).toBe(false);
  });

  it("HAVENDO envio, ele manda — o legado não mascara o canal", async () => {
    // Guia cujo e-mail consta SENT mas cujo envio falhou: quem vale é o envio. Deixar o legado
    // vencer aqui esconderia uma falha real atrás de um campo velho.
    const { foiEnviadaComLegado } = await import("../EnvioGuiaService.js");
    expect(foiEnviadaComLegado([{ canal: "EMAIL", status: "falhou" }], { emailStatus: "SENT" })).toBe(false);
    expect(foiEnviadaComLegado([{ canal: "WHATSAPP", status: "entregue" }], { emailStatus: null })).toBe(true);
  });
});
