import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsappPage } from "../renderWhatsappPage";
import { ChatDaEmpresa } from "../../components/ChatDaEmpresa";

const clonar = valor => JSON.parse(JSON.stringify(valor));
function cenario() {
  const canais = [
    { id: "principal", chave: "Principal", conversaId: "antiga", janela: { situacao: "EXPIRADA", instante: "2026-09-17T10:00:00Z" }, podeResponder: false },
    { id: "comercial", chave: "Comercial", conversaId: "recente", janela: { situacao: "ABERTA", instante: "2026-09-21T15:54:22Z" }, podeResponder: true },
  ];
  const conversa = { id: "antiga", canalId: "principal", interlocutorId: "pessoa-teste", nomePerfilProvedor: "Pessoa teste", relacionamento: { tipo: "LEAD" }, escopoVerificado: true, canais, janela: canais[0].janela, solicitacaoComercial: { id: "caso", onboardingId: "o", origem: "INATIVA" } };
  const passos = ["publica", "autorizacao", "fiscal", "diagnostico", "devolutiva", "proposta", "contrato", "pagamento"].map((id, i) => ({ id, titulo: id, concluido: i < 4, acessivel: i <= 4, pendencias: [], instrucao: "Confira esta etapa." }));
  const estado = { onboarding: { id: "o", origem: "INATIVA", versao: 2, cnpj: "11222333000181", dados: {} }, atendimento: { conversaId: "antiga" }, propostas: [], contratos: [], documentos: [], trabalhos: [], jornada: {
    projecao: { atual: "devolutiva", passos }, diagnostico: { id: "d", dados: { texto: "Análise sintética e serviços conferidos.", servicos: "Regularização sintética.", analiseId: "fiscal" } }, devolutiva: { partes: [{ parte: "RELATORIO", status: "nao_enviado" }, { parte: "TEXTO", status: "nao_enviado" }], concluida: false },
  } };
  const api = {
    listarConversasWhatsapp: jest.fn(async () => ({ conversas: [clonar(conversa)], temMais: false })),
    getMensagensWhatsapp: jest.fn(async () => ({ conversa: clonar(conversa), mensagens: [], temMais: false })),
    baixarAnaliseOnboarding: jest.fn(async () => new Blob(["%PDF-1.4"], { type: "application/pdf" })),
    comercial: jest.fn(async (path, body) => {
      if (path === "/recursos") return { recursos: [] };
      if (path.startsWith("/conversas/")) return { atendimento: { id: "caso", onboardingId: "o", onboarding: estado.onboarding } };
      if (path.endsWith("/jornada/devolutiva")) {
        if (body.conversaId !== "recente" || canais[1].janela.situacao !== "ABERTA") throw Object.assign(new Error("Canal fechado"), { code: "FORA_DA_JANELA", status: 409 });
        estado.jornada.devolutiva.concluida = true;
      }
      if (path.endsWith("/jornada/apresentacao")) estado.jornada.devolutiva.concluida = true;
      if (estado.jornada.devolutiva.concluida) { estado.jornada.projecao.atual = "proposta"; passos[4].concluido = true; passos[5].acessivel = true; }
      return clonar(estado);
    }),
  };
  return { api, conversa, canais };
}
async function abrir(api) {
  render(<WhatsappPage api={api} />);
  fireEvent.click(await screen.findByTestId("conversa-antiga"));
  await screen.findByLabelText("Responder ao cliente");
  fireEvent.click(screen.getByRole("button", { name: "Detalhes da conversa" }));
  await screen.findByRole("navigation", { name: "Passo a passo do lead" });
}

test("entrada comercial recente escolhe o mesmo canal no chat e na etapa cinco, preservando a ficha antiga", async () => {
  const { api } = cenario(); await abrir(api);
  expect(screen.queryByLabelText("Canal da resposta")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Canal do atendimento")).not.toBeInTheDocument();
  expect(screen.getByText("WhatsApp · Comercial")).toBeVisible();
  const mapa = screen.getByRole("navigation", { name: "Passo a passo do lead" });
  expect(mapa).toBeVisible(); expect(mapa.closest("details")).toBeNull();
  expect(screen.getByRole("button", { name: "5. devolutiva" })).toHaveAttribute("aria-current", "step");
  expect(screen.getByText("Análise sintética e serviços conferidos.")).toBeVisible();
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/jornada/devolutiva"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Conferi: enviar PDF e devolutiva" }));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/jornada/devolutiva", { diagnosticoId: "d", conversaId: "recente" }));
  expect(await screen.findByText("Preparar uma nova proposta em PDF")).toBeVisible();
});

test("cliente pode trocar canal na própria etapa sem perder diagnóstico nem enviar automaticamente", async () => {
  const { api, conversa } = cenario(); conversa.relacionamento = { tipo: "CLIENTE" }; await abrir(api);
  fireEvent.change(screen.getByLabelText("Canal do atendimento"), { target: { value: "principal" } });
  await waitFor(() => expect(screen.getByLabelText("Canal do atendimento")).toHaveValue("principal"));
  expect(screen.getByRole("button", { name: "Conferi: enviar PDF e devolutiva" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Usar Comercial — conversa aberta" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Conferi: enviar PDF e devolutiva" })).toBeEnabled());
  expect(screen.getByText("Análise sintética e serviços conferidos.")).toBeVisible();
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/jornada/devolutiva"))).toBe(false);
});

test("janela fechada permite baixar relatório e registrar apresentação real por outro meio, avançando para proposta", async () => {
  const { api, canais } = cenario(); canais[1].janela.situacao = "EXPIRADA"; canais[1].podeResponder = false;
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => "blob:teste"); URL.revokeObjectURL = jest.fn();
  const baixar = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await abrir(api);
    expect(screen.getByRole("button", { name: "Conferi: enviar PDF e devolutiva" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF fiscal para apresentar" }));
    await waitFor(() => expect(api.baixarAnaliseOnboarding).toHaveBeenCalledWith("o", "fiscal"));
    await waitFor(() => expect(baixar).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "Apresentar por outro meio" }));
    fireEvent.change(screen.getByLabelText("Meio e data"), { target: { value: "Reunião em 21/09/2026" } });
    fireEvent.change(screen.getByLabelText("Evidência e observações"), { target: { value: "Relatório e escopo apresentados na reunião de teste." } });
    fireEvent.click(screen.getByRole("button", { name: "Conferi: registrar apresentação" }));
    expect(await screen.findByText("Preparar uma nova proposta em PDF")).toBeVisible();
    expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/jornada/apresentacao", { versao: 2, diagnosticoId: "d", meio: "Reunião em 21/09/2026", evidencia: "Relatório e escopo apresentados na reunião de teste." });
    expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/jornada/devolutiva"))).toBe(false);
  } finally { baixar.mockRestore(); URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test("chat da ficha abre o mesmo atendimento e envia a devolutiva pelo canal preparado", async () => {
  const { api, conversa } = cenario();
  conversa.relacionamento = { tipo: "CLIENTE" };
  conversa.portalClientId = "empresa-da-ficha";
  conversa.empresa = { id: "empresa-da-ficha", razao: "Empresa sintética" };
  render(<ChatDaEmpresa api={api} companyId="empresa-da-ficha" usuarioId="contador-sintetico" />);
  await screen.findByLabelText("Responder ao cliente");
  fireEvent.click(screen.getByRole("button", { name: "Detalhes da conversa" }));
  await screen.findByRole("navigation", { name: "Passo a passo do lead" });
  expect(screen.getByRole("button", { name: "5. devolutiva" })).toHaveAttribute("aria-current", "step");
  expect(screen.getByLabelText("Canal do atendimento")).toHaveValue("comercial");
  fireEvent.change(screen.getByLabelText("Canal do atendimento"), { target: { value: "principal" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Conferi: enviar PDF e devolutiva" })).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Usar Comercial — conversa aberta" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Conferi: enviar PDF e devolutiva" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Conferi: enviar PDF e devolutiva" }));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/jornada/devolutiva", { diagnosticoId: "d", conversaId: "recente" }));
  expect(await screen.findByText("Preparar uma nova proposta em PDF")).toBeVisible();
});
