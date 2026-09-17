import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WhatsappPage } from "../renderWhatsappPage";

const cliente = { id: "cv-liz", interlocutorId: "liz", relacionamento: { tipo: "CLIENTE" }, solicitacaoComercial: { id: "novo", origem: "ABERTURA", onboardingId: "onboarding-1" }, contato: { nome: "Liz" }, portalClientId: "klaus", empresa: { razao: "Klaus" }, updatedAt: "2026-09-16", escopoVerificado: true, janela: { situacao: "ABERTA" }, naoLidas: 1 };
const oculto = { ...cliente, id: "cv-raphael", interlocutorId: "raphael", contato: { nome: "Raphael" }, solicitacaoComercial: null };

test("busca consulta servidor além da página carregada e não busca todos os onboardings", async () => {
  const api = { whatsappContratoV2: true, listarOnboardings: jest.fn(),
    listarConversasWhatsapp: jest.fn(async (_f, opts) => ({ versaoContrato: 2, buscaConfigurada: true, conversas: opts.q ? [oculto] : [cliente], temMais: !opts.q, proximoCursor: opts.q ? null : "segunda" })) };
  render(<WhatsappPage api={api} />);
  await screen.findByTestId("conversa-cv-liz");
  expect(screen.getByTestId("conversa-cv-liz")).toHaveTextContent("Cliente · Nova abertura");
  expect(screen.queryByTestId("conversa-cv-raphael")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Buscar pessoa ou empresa"), { target: { value: "Raphael" } });
  await screen.findByTestId("conversa-cv-raphael");
  expect(api.listarConversasWhatsapp).toHaveBeenLastCalledWith("todas", { empresa: null, q: "Raphael", relacionamento: "", naoLidas: false });
  expect(api.listarOnboardings).not.toHaveBeenCalled();
});

test("agrupamento usa interlocutor e mantém rascunho quando segmento operacional muda", async () => {
  let atual = cliente;
  const api = { whatsappContratoV2: true,
    listarConversasWhatsapp: jest.fn(async () => ({ versaoContrato: 2, buscaConfigurada: true, conversas: [atual], temMais: false })),
    getMensagensWhatsapp: jest.fn(async id => ({ conversa: { ...atual, id }, mensagens: [], notasInternas: [], temMais: false })) };
  render(<WhatsappPage api={api} />);
  fireEvent.click(await screen.findByTestId("conversa-cv-liz"));
  const campo = await screen.findByLabelText("Responder ao cliente");
  fireEvent.change(campo, { target: { value: "Resposta da Liz" } });
  atual = { ...cliente, id: "cv-lente", portalClientId: "lente", empresa: { razao: "Lente" } };
  fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
  fireEvent.click(await screen.findByTestId("conversa-cv-lente"));
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Resposta da Liz"));
  expect(screen.getAllByTestId(/^conversa-/)).toHaveLength(1);
});

test("cliente pode iniciar outro caso e recolher detalhes preserva o formulário", async () => {
 const api = { whatsappContratoV2: true,
  listarConversasWhatsapp: jest.fn(async () => ({ versaoContrato: 2, conversas: [{ ...cliente, solicitacaoComercial: null }], temMais: false })),
  getMensagensWhatsapp: jest.fn(async () => ({ conversa: { ...cliente, solicitacaoComercial: null }, mensagens: [], notasInternas: [] })),
  comercial: jest.fn(async (_path, body) => { if (body) throw new Error("Interrupção simulada antes da criação"); return { atendimento: null, anteriores: [] }; })
 };
 render(<WhatsappPage api={api} />);
 fireEvent.click(await screen.findByTestId("conversa-cv-liz"));
 await screen.findByTestId("fio"); expect(api.comercial).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Detalhes da conversa" }));
 fireEvent.click(screen.getByRole("button", { name: "Comercial" }));
 fireEvent.change(await screen.findByLabelText("Motivo do atendimento"), { target: { value: "ABERTURA" } });
 fireEvent.click(screen.getByRole("button", { name: "Fechar detalhes" }));
 expect(screen.queryByRole("button", { name: "Iniciar atendimento" })).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Detalhes da conversa" }));
 expect(screen.getByLabelText("Motivo do atendimento")).toHaveValue("ABERTURA");
 fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
 await screen.findByText(/Interrupção simulada antes da criação/);
 expect(api.comercial).toHaveBeenCalledWith("/conversas/cv-liz/iniciar", { origem: "ABERTURA" });
});
