// A ligação "liberar ao cliente" + WhatsApp — a ORDEM das chamadas e o que vira desfecho.

import { liberarComCanais } from "../liberarComCanais";

function apiFalso({ canal = "EMAIL", sent = true, zap = { ok: true } } = {}) {
  return {
    liberarGuiaCliente: jest.fn(async () => ({ ok: true, sent, message: sent ? "Guia liberada e enviada ao cliente." : "Guia liberada ao cliente, mas o e-mail NÃO foi enviado." })),
    listarContatosWhatsapp: jest.fn(async () => ({ ok: true, contatos: [], canalPadraoEnvio: canal })),
    enviarGuiaWhatsapp: jest.fn(async () => {
      if (zap instanceof Error) throw zap;
      return zap;
    }),
  };
}

describe("liberarComCanais", () => {
  it("EMAIL: libera + e-mail, e o WhatsApp NÃO é tentado", async () => {
    const api = apiFalso({ canal: "EMAIL" });
    const r = await liberarComCanais({ api, companyId: "pc-1", guideId: "g1" });
    expect(api.liberarGuiaCliente).toHaveBeenCalledWith("g1");
    expect(api.enviarGuiaWhatsapp).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.texto).toBe("Guia liberada ao cliente: e-mail enviado.");
  });

  it("WHATSAPP: e-mail PRIMEIRO, depois o WhatsApp — os dois nomeados no desfecho", async () => {
    const api = apiFalso({ canal: "WHATSAPP" });
    const ordem = [];
    api.liberarGuiaCliente.mockImplementation(async () => { ordem.push("email"); return { ok: true, sent: true }; });
    api.enviarGuiaWhatsapp.mockImplementation(async () => { ordem.push("zap"); return { ok: true }; });
    const r = await liberarComCanais({ api, companyId: "pc-1", guideId: "g1" });
    expect(ordem).toEqual(["email", "zap"]);
    expect(api.enviarGuiaWhatsapp).toHaveBeenCalledWith("pc-1", "g1");
    expect(r.ok).toBe(true);
    expect(r.texto).toMatch(/e-mail enviado · WhatsApp enviado/);
  });

  it("⚠ a recusa nomeada do WhatsApp (422) é DESFECHO, não exceção — e o e-mail que saiu continua dito", async () => {
    const recusa = Object.assign(new Error("contato sem opt-in registrado"), { code: "SEM_OPT_IN", status: 422 });
    const api = apiFalso({ canal: "WHATSAPP", zap: recusa });
    const r = await liberarComCanais({ api, companyId: "pc-1", guideId: "g1" });
    expect(r.ok).toBe(false);
    expect(r.tom).toBe("erro");
    expect(r.texto).toMatch(/e-mail enviado · WhatsApp não saiu \(contato sem opt-in registrado\)/);
    expect(r.whatsapp.motivo).toBe("SEM_OPT_IN");
  });

  it("PERGUNTAR: pergunta; 'não' não tenta, 'sim' tenta", async () => {
    const nao = apiFalso({ canal: "PERGUNTAR" });
    await liberarComCanais({ api: nao, companyId: "pc-1", guideId: "g1", perguntar: () => false });
    expect(nao.enviarGuiaWhatsapp).not.toHaveBeenCalled();

    const sim = apiFalso({ canal: "PERGUNTAR" });
    const perguntar = jest.fn(() => true);
    await liberarComCanais({ api: sim, companyId: "pc-1", guideId: "g1", perguntar });
    expect(perguntar).toHaveBeenCalledWith(expect.stringMatching(/também por WhatsApp/));
    expect(sim.enviarGuiaWhatsapp).toHaveBeenCalled();
  });

  it("sem conseguir ler o canal, o comportamento é o de ANTES: só e-mail, sem perguntar", async () => {
    const api = apiFalso({ canal: "WHATSAPP" });
    api.listarContatosWhatsapp.mockRejectedValue(new Error("500"));
    const perguntar = jest.fn(() => true);
    const r = await liberarComCanais({ api, companyId: "pc-1", guideId: "g1", perguntar });
    expect(perguntar).not.toHaveBeenCalled();
    expect(api.enviarGuiaWhatsapp).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("e-mail que não saiu é ERRO mesmo com o WhatsApp ok", async () => {
    const api = apiFalso({ canal: "WHATSAPP", sent: false });
    const r = await liberarComCanais({ api, companyId: "pc-1", guideId: "g1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/o e-mail NÃO foi enviado/);
    expect(r.texto).toMatch(/WhatsApp enviado/);
  });
});

// ── ⚠⚠ EMPRESA SEM E-MAIL CADASTRADO (05/09/2026) ───────────────────────────────────────────────
//
// Dono: *"o envio deve ser feito mesmo sem o e-mail, se já tiver o número; se tiver apenas um tipo
// de contato ela pode e deve ser enviada"*. Este bloco é a LIGAÇÃO: da resposta do servidor
// (`envio.naoSeAplica`) até a frase e o tom que a tela pinta. A regra pura tem teste próprio em
// `canalDeEnvio.test.js`; o que se mede aqui é o campo NÃO se perder no caminho.
describe("um canal basta — a empresa que só tem WhatsApp", () => {
  function apiSemEmail({ zap = { ok: true } } = {}) {
    return {
      liberarGuiaCliente: jest.fn(async () => ({
        ok: true,
        sent: false,
        // ⚠ É esta forma que a rota devolve: `naoSeAplica` vive DENTRO de `envio`.
        envio: { feito: false, naoSeAplica: true, motivo: "sem_email_cadastrado", podeTentarNovamente: false },
        message: "Sem e-mail cadastrado nesta empresa — a guia não foi enviada por e-mail.",
      })),
      listarContatosWhatsapp: jest.fn(async () => ({ ok: true, contatos: [], canalPadraoEnvio: "WHATSAPP" })),
      enviarGuiaWhatsapp: jest.fn(async () => zap),
    };
  }

  it("sem e-mail cadastrado + WhatsApp enviado ⇒ OK (verde), e a ausência é dita", async () => {
    const api = apiSemEmail();
    const r = await liberarComCanais({ api, companyId: "pc-1", guideId: "g1" });
    expect(r.ok).toBe(true);
    expect(r.texto).toMatch(/sem e-mail cadastrado · WhatsApp enviado/);
    expect(r.texto).not.toMatch(/não saiu/);
  });

  it("⚠ e o WhatsApp que falha continua ERRO — a ausência do e-mail não perdoa nada", async () => {
    const api = apiSemEmail({ zap: { ok: false, message: "contato sem opt-in" } });
    const r = await liberarComCanais({ api, companyId: "pc-1", guideId: "g1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/WhatsApp não saiu \(contato sem opt-in\)/);
  });
});
