import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useManageCompaniesWorkspace } from "../useManageCompaniesWorkspace";

// Exercita o hook e o helper reais: o modal chamava este callback, mas ele enviava
// somente e-mail mesmo quando a empresa usava WhatsApp.
function montar({ whatsappErro } = {}) {
  const empresa = { companyId: "pc-klaus", razaoSocial: "Empresa de teste" };
  const guias = [{ id: "g-klaus", status: "PROCESSED" }];
  const api = {
    listCompanies: jest.fn().mockResolvedValue([empresa]),
    getCompanyGuides: jest.fn().mockResolvedValue(guias),
    resendGuideEmail: jest.fn().mockResolvedValue({
      ok: true,
      sent: false,
      envio: { feito: false, naoSeAplica: true, motivo: "sem_email_cadastrado" },
      message: "Sem e-mail cadastrado nesta empresa — a guia não foi enviada por e-mail.",
    }),
    liberarGuiaCliente: jest.fn(),
    listarContatosWhatsapp: jest.fn().mockResolvedValue({ canalPadraoEnvio: "WHATSAPP" }),
    enviarGuiaWhatsapp: whatsappErro
      ? jest.fn().mockRejectedValue(whatsappErro)
      : jest.fn().mockResolvedValue({ ok: true }),
  };
  const visivel = { mensagem: "", erro: "" };
  const feedback = {
    clearFeedback: jest.fn(() => { visivel.mensagem = ""; visivel.erro = ""; }),
    setMessage: jest.fn((mensagem) => { visivel.mensagem = mensagem; }),
    setError: jest.fn((erro) => { visivel.erro = erro; }),
  };
  const wrapper = ({ children }) => (
    <MemoryRouter initialEntries={["/companies/pc-klaus/guides"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {children}
    </MemoryRouter>
  );
  const hook = renderHook(() => useManageCompaniesWorkspace({
    api, page: "companyDetail", setPage: jest.fn(), feedback,
  }), { wrapper });
  return { ...hook, api, feedback, visivel, guias };
}

describe("reenvio confirmado pela aba Guias", () => {
  it("sem e-mail, reenvia por WhatsApp da empresa e mantém sucesso depois de recarregar as guias", async () => {
    const { result, api, feedback, visivel, guias } = montar();
    await waitFor(() => expect(result.current.guidesState.guides).toEqual(guias));
    feedback.clearFeedback.mockClear();
    let terminarRecarga;
    api.getCompanyGuides.mockImplementationOnce(() => new Promise((resolve) => { terminarRecarga = resolve; }));

    let envio;
    await act(async () => { envio = result.current.handleResendGuide("g-klaus"); });
    await waitFor(() => expect(terminarRecarga).toBeDefined());
    expect(api.resendGuideEmail).toHaveBeenCalledWith("g-klaus");
    expect(api.liberarGuiaCliente).not.toHaveBeenCalled();
    expect(api.listarContatosWhatsapp).toHaveBeenCalledWith("pc-klaus");
    expect(api.enviarGuiaWhatsapp).toHaveBeenCalledTimes(1);
    expect(api.enviarGuiaWhatsapp).toHaveBeenCalledWith("pc-klaus", "g-klaus", { reenviar: true });
    expect(result.current.guidesState.resendingGuideId).toBe("g-klaus");
    expect(visivel.mensagem).toBe("");

    await act(async () => { terminarRecarga(guias); await envio; });
    expect(api.getCompanyGuides).toHaveBeenLastCalledWith("pc-klaus");
    expect(visivel.mensagem.texto).toMatch(/sem e-mail cadastrado · WhatsApp: pedido aceito pela Meta, aguardando confirmação de entrega/);
    expect(visivel.erro).toBe("");
    expect(feedback.setError).not.toHaveBeenCalled();
    expect(result.current.guidesState.resendingGuideId).toBe("");
    const ultimasLimpezas = feedback.clearFeedback.mock.invocationCallOrder;
    expect(feedback.setMessage.mock.invocationCallOrder[0]).toBeGreaterThan(ultimasLimpezas[ultimasLimpezas.length - 1]);
  });

  it("preserva a recusa real do WhatsApp no feedback após a recarga", async () => {
    const erro = Object.assign(new Error("contato sem opt-in registrado"), { code: "SEM_OPT_IN" });
    const { result, api, visivel, guias } = montar({ whatsappErro: erro });
    await waitFor(() => expect(result.current.guidesState.guides).toEqual(guias));

    await act(async () => { await result.current.handleResendGuide("g-klaus"); });

    expect(api.enviarGuiaWhatsapp).toHaveBeenCalledTimes(1);
    expect(visivel.erro).toMatch(/WhatsApp não saiu \(contato sem opt-in registrado\)/);
    expect(visivel.mensagem).toBe("");
    expect(result.current.guidesState.resendingGuideId).toBe("");
  });
});
