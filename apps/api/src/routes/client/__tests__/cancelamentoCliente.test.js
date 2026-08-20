// A PORTA DE CANCELAMENTO DO APP DO CLIENTE — `POST /client/companies/:id/notas/:notaId/cancelar`.
//
// ⚠⚠ ESTE É O ATO MAIS PERIGOSO QUE O APP DO CLIENTE PRATICA: uma NFS-e cancelada não volta, e o
// caminho está ligado e apontado para o sistema nacional de PRODUÇÃO. Por isso **cada recusa é
// medida por `NfseService.sendEvent` NÃO TER SIDO CHAMADO** — não basta o status HTTP: o que
// importa é que nada saiu da máquina.
//
// ⚠ NADA AQUI CANCELA COISA ALGUMA: o serviço é simulado.

import request from "supertest";
import express from "express";

const PORTAL_ID = "portal-1";
const OUTRO_PORTAL = "portal-2";
const LEGACY_ID = "company-legacy-1";
const NOTA_ID = "nota-1";
const CHAVE = "3".repeat(50);
const CNPJ_DA_EMPRESA = "11222333000181";

const cenario = {
  emissaoClienteLiberada: true,
  clientLink: null,
  firmLink: null,
  nota: null,
};

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const prisma = {
    company: { findUnique: jest.fn(), findMany: jest.fn() },
    portalClient: { findUnique: jest.fn(), findMany: jest.fn() },
    portalInvoice: { findFirst: jest.fn() },
    companyClientUser: { findUnique: jest.fn(), findMany: jest.fn() },
    companyFirmAccess: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (arg) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg))),
  };
  return { prisma };
});

jest.mock("../../../infrastructure/db/NfseRepository.js", () => ({
  NfseRepository: { updateByChaveAcesso: jest.fn(async () => null) },
}));

jest.mock("../../../application/nfse/NfseService.js", () => ({
  NfseService: {
    issue: jest.fn(),
    sendEvent: jest.fn(async () => ({ status: "accepted", providerData: { ok: true } })),
  },
}));

import { createClientPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { NfseService } from "../../../application/nfse/NfseService.js";
import { NfseRepository } from "../../../infrastructure/db/NfseRepository.js";

function montarApp(user) {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/client", createClientPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

const CORPO = { cMotivo: "2", justificativa: "Servico nao foi prestado ao tomador" };

function cancelar(user, { companyId = PORTAL_ID, notaId = NOTA_ID, corpo = CORPO } = {}) {
  return request(montarApp(user))
    .post(`/client/companies/${companyId}/notas/${notaId}/cancelar`)
    .send(corpo);
}

function usuarioCliente(role = "CLIENT_ADMIN") {
  cenario.clientLink = { role, status: "ACTIVE" };
  return { id: "user-cliente-1", role: "cliente", accountType: "CLIENT", email: "cliente@empresa.com" };
}

function recusaDoServico(code, extra = {}) {
  const err = new Error(extra.message || "recusa");
  err.code = code;
  Object.assign(err, extra);
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  cenario.emissaoClienteLiberada = true;
  cenario.clientLink = null;
  cenario.firmLink = null;
  cenario.nota = {
    id: NOTA_ID,
    chaveAcesso: CHAVE,
    numero: "13000",
    status: "EMITIDA",
    statusEfetivo: "autorizada",
    // ⚠ Campos que a guarda de nota RECEBIDA lê (20/08/2026). `EMIT` + tomador de terceiro = a
    // nota que a empresa emitiu, o caso normal.
    papel: "EMIT",
    type: "NFSE",
    emitenteDoc: CNPJ_DA_EMPRESA,
    tomadorDoc: "44555666000177",
  };

  NfseService.sendEvent.mockResolvedValue({ status: "accepted", providerData: { ok: true } });

  prisma.company.findUnique.mockImplementation(async ({ where }) =>
    where?.id === LEGACY_ID ? { id: LEGACY_ID } : null
  );
  prisma.company.findMany.mockResolvedValue([]);
  prisma.portalClient.findUnique.mockImplementation(async ({ where }) => {
    if (where?.id === PORTAL_ID) return { id: PORTAL_ID, companyId: LEGACY_ID, cnpj: CNPJ_DA_EMPRESA };
    if (where?.companyId === LEGACY_ID) {
      return { id: PORTAL_ID, emissaoClienteLiberada: cenario.emissaoClienteLiberada };
    }
    return null;
  });
  // ⚠ A nota só é devolvida quando o `clientId` do WHERE bate — é a multi-tenancy sendo exercida.
  prisma.portalInvoice.findFirst.mockImplementation(async ({ where }) =>
    where?.clientId === PORTAL_ID && where?.id === NOTA_ID ? cenario.nota : null
  );
  prisma.companyClientUser.findUnique.mockImplementation(async ({ where }) =>
    where?.companyId_userId?.companyId === PORTAL_ID ? cenario.clientLink : null
  );
  prisma.companyFirmAccess.findUnique.mockImplementation(async () => cenario.firmLink);
});

describe("⚠⚠ O MESMO PORTÃO DA EMISSÃO — e nada sai da máquina quando ele fecha", () => {
  it("empresa NÃO liberada pelo contador: 403, e NADA é cancelado", async () => {
    cenario.emissaoClienteLiberada = false;
    const r = await cancelar(usuarioCliente("OWNER"));
    expect(r.status).toBe(403);
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });

  it.each(["FINANCEIRO", "CLIENT_USER"])(
    "papel %s não cancela: 403, e NADA é cancelado",
    async (papel) => {
      const r = await cancelar(usuarioCliente(papel));
      expect(r.status).toBe(403);
      expect(NfseService.sendEvent).not.toHaveBeenCalled();
    }
  );

  it.each(["CLIENT_ADMIN", "OWNER"])("papel %s cancela", async (papel) => {
    const r = await cancelar(usuarioCliente(papel));
    expect(r.status).toBe(200);
    expect(NfseService.sendEvent).toHaveBeenCalled();
  });

  it("sem vínculo com a empresa: 403 antes de tudo", async () => {
    cenario.clientLink = null;
    const r = await cancelar({ id: "u", role: "cliente", accountType: "CLIENT" });
    expect(r.status).toBe(403);
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ MULTI-TENANCY: a CHAVE não vem do cliente", () => {
  it("a chave é lida da nota escopada por `clientId` e desce para o serviço", async () => {
    await cancelar(usuarioCliente());
    expect(prisma.portalInvoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: NOTA_ID, clientId: PORTAL_ID }),
      })
    );
    expect(NfseService.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ chaveAcesso: CHAVE, companyId: LEGACY_ID })
    );
  });

  it("⚠ uma `chaveAcesso` no CORPO é IGNORADA — senão bastaria conhecer a chave (que sai impressa no DANFSe)", async () => {
    const chaveAlheia = "9".repeat(50);
    await cancelar(usuarioCliente(), { corpo: { ...CORPO, chaveAcesso: chaveAlheia } });
    expect(NfseService.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ chaveAcesso: CHAVE })
    );
    expect(NfseService.sendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ chaveAcesso: chaveAlheia })
    );
  });

  it("⚠ um `companyId` no corpo não desvia o cancelamento — o path vence", async () => {
    await cancelar(usuarioCliente(), { corpo: { ...CORPO, companyId: "company-legacy-999" } });
    expect(NfseService.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: LEGACY_ID })
    );
  });

  it("nota de OUTRA empresa: 404, e NADA é cancelado", async () => {
    usuarioCliente("OWNER");
    const r = await cancelar({ id: "user-cliente-1", role: "cliente", accountType: "CLIENT" }, {
      companyId: OUTRO_PORTAL,
    });
    expect([403, 404]).toContain(r.status);
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });

  it("nota inexistente nesta empresa: 404, e NADA é cancelado", async () => {
    const r = await cancelar(usuarioCliente(), { notaId: "nota-que-nao-existe" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("nota_nao_encontrada");
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ NOTA RECEBIDA NÃO SE CANCELA — pedido do dono (20/08/2026)
//
// > *"as notas recebidas não devem ter opção de emitir elas, nem cancelar. Nota recebida foi
// > emitida PARA NÓS — não temos controle sobre esse tipo de nota."*
//
// ⚠ CANCELAR É ATO DO EMITENTE. Numa nota recebida quem emitiu foi o prestador; o nosso cliente é
// o tomador, e o certificado que assinaria o evento é o da empresa errada (a família do E0718).
//
// ⚠⚠ **A TELA É CONVENIÊNCIA; ESTE TESTE É A GARANTIA.** Ele chama a rota DIRETO, sem passar por
// tela nenhuma — que é exatamente o que alguém com o `curl` na mão faria. E cada caso mede a
// recusa por **`NfseService.sendEvent` NÃO ter sido chamado**: nada saiu da máquina.
describe("⚠⚠ nota RECEBIDA: o servidor recusa, mesmo chamando a rota direto", () => {
  it("`papel: DEST` ⇒ 422 `nota_recebida`, e NADA é cancelado", async () => {
    cenario.nota = { ...cenario.nota, papel: "DEST" };
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nota_recebida");
    expect(r.body.message).toMatch(/emitida PARA a sua empresa/i);
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });

  it("⚠ sem `papel`, a DEDUÇÃO pelo CNPJ pega: a empresa é a TOMADORA", async () => {
    // `papel` pode faltar (nota antiga, captura que não o gravou). A segunda fonte é a mesma de
    // `reaproveitarNota.js`: se o tomador é a empresa e o emitente é outro, ela recebeu.
    cenario.nota = {
      ...cenario.nota,
      papel: null,
      tomadorDoc: CNPJ_DA_EMPRESA,
      emitenteDoc: "44555666000177",
    };
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nota_recebida");
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });

  it("⚠⚠ AUSÊNCIA NÃO CASA COM AUSÊNCIA: empresa sem CNPJ não faz TODA nota virar recebida", async () => {
    // Se `normalizeDoc` devolvesse `""` em vez de `null`, `"" === ""` daria `true` e a dedução
    // acusaria toda nota de uma empresa sem CNPJ cadastrado — travando o cancelamento inteiro.
    prisma.portalClient.findUnique.mockImplementation(async ({ where }) => {
      if (where?.id === PORTAL_ID) return { id: PORTAL_ID, companyId: LEGACY_ID, cnpj: null };
      if (where?.companyId === LEGACY_ID) {
        return { id: PORTAL_ID, emissaoClienteLiberada: cenario.emissaoClienteLiberada };
      }
      return null;
    });
    cenario.nota = { ...cenario.nota, papel: null, tomadorDoc: null, emitenteDoc: null };
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(200);
    expect(NfseService.sendEvent).toHaveBeenCalled();
  });

  it("a nota que a empresa EMITIU continua cancelando normalmente", async () => {
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(200);
    expect(NfseService.sendEvent).toHaveBeenCalled();
  });
});

describe("⚠ NF-e é outro documento — e outro caminho de cancelamento", () => {
  it("`type: NFE` ⇒ 422 `nota_nao_e_nfse`, e NADA é cancelado", async () => {
    // O `pedRegEvento` que o serviço monta é do leiaute da NFS-e; mandá-lo sobre uma NF-e é pedir
    // o cancelamento no lugar errado (a SEFAZ é outra). O reaproveitamento já recusava; o
    // cancelamento não recusava.
    cenario.nota = { ...cenario.nota, type: "NFE" };
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nota_nao_e_nfse");
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });
});

describe("⚠ as recusas NOSSAS — nenhuma delas toca o sistema nacional", () => {
  it("nota SEM chave de acesso: 422 nomeado", async () => {
    cenario.nota = { ...cenario.nota, chaveAcesso: null };
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nota_sem_chave");
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["statusEfetivo", { statusEfetivo: "cancelada" }],
    ["status", { status: "CANCELADA", statusEfetivo: null }],
  ])("nota JÁ cancelada (por %s): 422, e NADA é reenviado", async (_campo, patch) => {
    cenario.nota = { ...cenario.nota, ...patch };
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nota_ja_cancelada");
    // ⚠ Um segundo pedido volta recusado pelo sistema nacional e é lido como "o cancelamento
    // falhou" — quando ele tinha dado certo. A recusa é NOSSA para essa confusão não existir.
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ o `cMotivo` e a justificativa — a lista fechada chega à tela", () => {
  it("motivo fora da lista: 400 `c_motivo_invalido`, COM os três aceitos", async () => {
    NfseService.sendEvent.mockRejectedValue(
      recusaDoServico("NFSE_CMOTIVO_INVALIDO", {
        message: "O motivo do evento é de lista fechada.",
        motivosAceitos: [
          { codigo: "1", rotulo: "Erro na emissão" },
          { codigo: "2", rotulo: "Serviço não prestado" },
          { codigo: "9", rotulo: "Outros" },
        ],
      })
    );
    const r = await cancelar(usuarioCliente(), { corpo: { ...CORPO, cMotivo: "01" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("c_motivo_invalido");
    expect(r.body.motivosAceitos.map((m) => m.codigo)).toEqual(["1", "2", "9"]);
    expect(r.body.podeTentarDeNovo).toBe(true);
  });

  it("motivo ausente: 400 `c_motivo_required`", async () => {
    NfseService.sendEvent.mockRejectedValue(recusaDoServico("NFSE_CMOTIVO_REQUIRED"));
    const r = await cancelar(usuarioCliente(), { corpo: { justificativa: CORPO.justificativa } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("c_motivo_required");
  });

  it("justificativa curta: 400, com a mensagem do serviço (que diz o mínimo)", async () => {
    NfseService.sendEvent.mockRejectedValue(
      recusaDoServico("NFSE_JUSTIFICATIVA_CURTA", {
        message: "A justificativa precisa ter pelo menos 15 caracteres (tem 4).",
      })
    );
    const r = await cancelar(usuarioCliente(), { corpo: { ...CORPO, justificativa: "erro" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("justificativa_curta");
    expect(r.body.message).toMatch(/15/);
  });
});

describe("⚠⚠ AS TRÊS CAMADAS — e o TRANSPORTE não convida a repetir", () => {
  it("TRANSPORTE ⇒ 502 e `podeTentarDeNovo: false`", async () => {
    NfseService.sendEvent.mockRejectedValue(
      recusaDoServico("NFSE_EVENT_FAILED", {
        camada: "TRANSPORTE",
        codigo: "HTTP_503",
        message: "Falha de comunicação",
        correcao: "NÃO envie o cancelamento de novo: consulte a situação da nota antes de decidir.",
      })
    );
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("nfse_cancelamento_transporte");
    // ⚠⚠ ESTE BOOLEANO É O QUE DESABILITA O BOTÃO NA TELA. Desfecho DESCONHECIDO: a nota pode
    // estar cancelada, e um segundo pedido volta recusado parecendo falha.
    expect(r.body.podeTentarDeNovo).toBe(false);
    expect(r.body.correcao).toMatch(/N[ÃA]O envie o cancelamento de novo/i);
  });

  it("RECEITA ⇒ 422 e `podeTentarDeNovo: true` (analisou e recusou; a nota NÃO foi cancelada)", async () => {
    NfseService.sendEvent.mockRejectedValue(
      recusaDoServico("NFSE_EVENT_FAILED", { camada: "RECEITA", codigo: "E0044" })
    );
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nfse_cancelamento_rejeitado");
    expect(r.body.podeTentarDeNovo).toBe(true);
  });

  it("NOSSA ⇒ 400 e `podeTentarDeNovo: true` (nada saiu da máquina)", async () => {
    NfseService.sendEvent.mockRejectedValue(
      recusaDoServico("NFSE_EVENT_FAILED", { camada: "NOSSA", codigo: "NFSE_NOT_CONFIGURED" })
    );
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(400);
    expect(r.body.podeTentarDeNovo).toBe(true);
  });

  it("erro DESCONHECIDO não ganha tradução inventada — 500", async () => {
    NfseService.sendEvent.mockRejectedValue(new Error("boom"));
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("internal_error");
  });
});

describe("⚠ o NOSSO registro acompanha — e a projeção do ADN NÃO é tocada", () => {
  it("a linha de `ServiceInvoice` vira `cancelled` — a nossa base não mente sobre um ato nosso", async () => {
    await cancelar(usuarioCliente());
    expect(NfseRepository.updateByChaveAcesso).toHaveBeenCalledWith(CHAVE, { status: "cancelled" });
  });

  it("⚠⚠ `PortalInvoice` NÃO é escrita — quem traz o cancelamento é a captura do ADN", async () => {
    await cancelar(usuarioCliente());
    // ⚠ `PortalInvoice` é a projeção de um sistema EXTERNO. Escrevê-la à mão é o que o
    // cabeçalho de `notasEmitidasNaoConfirmadas.js` proíbe — e o encontro da linha escrita à
    // mão com a que a captura traz é onde este projeto já mediu faturamento contado duas vezes.
    // O falso Prisma só expõe `findFirst`, então uma escrita seria um TypeError; a asserção
    // explícita existe para quem for acrescentar um `update` aqui achando que ajuda.
    expect(prisma.portalInvoice.findFirst).toHaveBeenCalled();
    expect(prisma.portalInvoice.update).toBeUndefined();
  });

  it("⚠ nota emitida FORA do portal (sem linha nossa) cancela igual — `null` não é erro", async () => {
    NfseRepository.updateByChaveAcesso.mockResolvedValue(null);
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("⚠ a resposta DIZ que a lista ainda não reflete — ela lê a projeção do ADN", async () => {
    const r = await cancelar(usuarioCliente());
    expect(r.body.refletidoNaLista).toBe(false);
  });
});

describe("o desfecho feliz", () => {
  it("manda `e101101` (nunca o de substituição) e devolve a nota cancelada", async () => {
    const r = await cancelar(usuarioCliente());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, evento: "e101101", status: "cancelled", numero: "13000" });
    const args = NfseService.sendEvent.mock.calls[0][0];
    expect(args.tipoEvento).toBe("e101101");
    // ⚠ Escopo FECHADO por decisão do dono: esta porta não oferece substituição, e o `tipoEvento`
    // não vem do corpo — nem quando o corpo tenta.
    expect(args.chaveSubstituta).toBeUndefined();
  });

  it("⚠ `tipoEvento` no corpo é IGNORADO — a porta faz UMA coisa", async () => {
    await cancelar(usuarioCliente(), { corpo: { ...CORPO, tipoEvento: "e105102" } });
    expect(NfseService.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tipoEvento: "e101101" })
    );
  });
});
