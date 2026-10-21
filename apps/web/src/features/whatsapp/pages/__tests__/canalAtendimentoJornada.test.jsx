import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsappPage } from "../renderWhatsappPage";
import { ChatDaEmpresa } from "../../components/ChatDaEmpresa";

let criarUrlOriginal, revogarUrlOriginal;
beforeEach(() => {
  criarUrlOriginal = URL.createObjectURL; revogarUrlOriginal = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => "blob:apresentacao-sintetica"); URL.revokeObjectURL = jest.fn();
});
afterEach(() => { URL.createObjectURL = criarUrlOriginal; URL.revokeObjectURL = revogarUrlOriginal; });

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
    baixarApresentacaoComercial: jest.fn(async (id, diagnostico, hash) => {
      if (id !== "o" || diagnostico !== "d" || hash !== "hash-atual") throw new Error("PDF de outro contexto");
      return new Blob(["%PDF-1.4 sintético"], { type: "application/pdf" });
    }),
    comercial: jest.fn(async (path, body) => {
      if (path === "/recursos") return { recursos: [] };
      if (path.startsWith("/conversas/")) return { atendimento: { id: "caso", onboardingId: "o", onboarding: estado.onboarding } };
      if (path === "/onboardings/o/apresentacao" && body === undefined) return { diagnosticoId: "d", conteudoHash: "hash-atual", versao: 2, pdfDisponivel: true };
      if (path === "/onboardings/o/apresentacao/d/enviar") {
        if (body.conteudoHash !== "hash-atual") throw new Error("Apresentação desatualizada");
        if (body.conversaId !== "recente" || canais[1].janela.situacao !== "ABERTA") throw Object.assign(new Error("Canal fechado"), { code: "FORA_DA_JANELA", status: 409 });
        return { envio: { estado: "ENVIADO" } };
      }
      if (path === "/onboardings/o/apresentacao/d/conferir") {
        if (body.versao !== 2 || body.conteudoHash !== "hash-atual" || body.confirmado !== true) throw new Error("Conferência de outra revisão");
        estado.jornada.devolutiva.concluida = true;
        return { conferencia: { atorId: "contador-sintetico", createdAt: "2026-10-21T15:00:00Z" } };
      }
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
  expect(await screen.findByTitle("Prévia PDF da apresentação da empresa")).toBeVisible();
  expect(api.baixarApresentacaoComercial).toHaveBeenCalledWith("o", "d", "hash-atual");
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/enviar"))).toBe(false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Enviar ao cliente" }));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/apresentacao/d/enviar", { conteudoHash: "hash-atual", conversaId: "recente" }));
  expect(screen.queryByText("Preparar uma nova proposta em PDF")).not.toBeInTheDocument();
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/conferir"))).toBe(false);
});

test("cliente pode trocar canal na própria etapa sem perder diagnóstico nem enviar automaticamente", async () => {
  const { api, conversa } = cenario(); conversa.relacionamento = { tipo: "CLIENTE" }; await abrir(api);
  fireEvent.change(screen.getByLabelText("Canal do atendimento"), { target: { value: "principal" } });
  await waitFor(() => expect(screen.getByLabelText("Canal do atendimento")).toHaveValue("principal"));
  expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Usar Comercial — conversa aberta" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  expect(await screen.findByTitle("Prévia PDF da apresentação da empresa")).toBeVisible();
  expect(api.baixarApresentacaoComercial).toHaveBeenCalledWith("o", "d", "hash-atual");
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/enviar"))).toBe(false);
});

test("janela fechada permite baixar PDF e conferir a revisão sem enviar ao cliente", async () => {
  const { api, canais } = cenario(); canais[1].janela.situacao = "EXPIRADA"; canais[1].podeResponder = false;
  const baixar = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await abrir(api);
    await screen.findByTitle("Prévia PDF da apresentação da empresa");
    expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    await waitFor(() => expect(api.baixarApresentacaoComercial).toHaveBeenCalledTimes(2));
    expect(api.baixarApresentacaoComercial).toHaveBeenLastCalledWith("o", "d", "hash-atual");
    await waitFor(() => expect(baixar).toHaveBeenCalled());
    expect(screen.queryByText("Preparar uma nova proposta em PDF")).not.toBeInTheDocument();
    expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/conferir"))).toBe(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Conferi o PDF e quero preparar a proposta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Conferi o PDF e quero preparar a proposta" }));
    expect(await screen.findByText("Preparar uma nova proposta em PDF")).toBeVisible();
    expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/apresentacao/d/conferir", { versao: 2, conteudoHash: "hash-atual", confirmado: true });
    expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/enviar"))).toBe(false);
  } finally { baixar.mockRestore(); }
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
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Usar Comercial — conversa aberta" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Enviar ao cliente" }));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/apresentacao/d/enviar", { conteudoHash: "hash-atual", conversaId: "recente" }));
  expect(screen.queryByText("Preparar uma nova proposta em PDF")).not.toBeInTheDocument();
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/conferir"))).toBe(false);
});
