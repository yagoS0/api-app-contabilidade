import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { OrientacoesRapidas, AtendimentoComercial } from "../../../whatsapp/components/AtendimentoComercial";
import { AnaliseDoLead } from "../AnaliseDoLead";
import { AnexoDaConversa } from "../../../whatsapp/components/AnexoDaConversa";
import { FioDaConversa } from "../../../whatsapp/components/FioDaConversa";

test("formulário de abertura liga a conversa ao onboarding antes de preparar o link, sem enviar sozinho", async () => {
  const api = { comercial: jest.fn(async (path) => path === "/recursos" ? { recursos: [] } : path.endsWith("/iniciar") ? { atendimento: { id: "lead", onboardingId: "o1" } } : { atendimento: null }), criarLinkOnboarding: jest.fn(async () => ({ token: "pessoal" })), enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })) };
  render(<OrientacoesRapidas api={api} conversa={{ id: "c1", nomePerfilProvedor: "Maria" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  const card = await screen.findByText("Formulário de abertura");
  const preparar = within(card.closest("article")).getByRole("button", { name: "Preparar formulário" });
  await waitFor(() => expect(preparar).toBeEnabled());
  fireEvent.click(preparar);
  expect(await screen.findByText(/preencha este formulário:/)).toHaveTextContent("/onboarding/publico#token=pessoal");
  expect(api.comercial).toHaveBeenCalledWith("/conversas/c1/iniciar", { origem: "ABERTURA" });
  expect(api.criarLinkOnboarding).toHaveBeenCalledWith("o1", { diasValidade: 7 }); expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Assumir e enviar orientação" }));
  await waitFor(() => expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("c1", expect.objectContaining({ assumir: true, texto: expect.stringContaining("pessoal") })));
});
test("formulário de outra origem não mistura solicitações", async () => {
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [] } : { atendimento: { onboardingId: "o1", onboarding: { origem: "TRANSFERENCIA" } } }), criarLinkOnboarding: jest.fn() };
  render(<OrientacoesRapidas api={api} conversa={{ id: "c1" }} />); fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  const preparar = within((await screen.findByText("Formulário de abertura")).closest("article")).getByRole("button", { name: "Preparar formulário" });
  await waitFor(() => expect(preparar).toBeEnabled());
  fireEvent.click(preparar);
  expect(await screen.findByRole("alert")).toHaveTextContent("outra solicitação ativa"); expect(api.criarLinkOnboarding).not.toHaveBeenCalled();
  expect(api.comercial.mock.calls.filter(([, body]) => body !== undefined)).toHaveLength(0);
});
test("consulta pública mostra razão social e falha explícita sem inventar regularidade", async () => {
  const onboarding = { id: "o1", origem: "TRANSFERENCIA", versao: 3, cnpj: "11222333000181" };
  const api = { getOnboardingComercial: jest.fn(async () => ({ analises: [] })), criarAnaliseOnboarding: jest.fn(async () => ({ analise: { id: "a", cnpj: onboarding.cnpj, tipo: "PUBLICA", status: "CONCLUIDA", resultado: { razaoSocial: "Empresa exemplo", atividadePrincipal: "Consultoria", situacaoCadastral: "ATIVA" }, createdAt: "2026-09-14" } })) };
  render(<AnaliseDoLead api={api} onboarding={onboarding} />);
  fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ publicamente" }));
  expect(await screen.findByText("Empresa exemplo")).toBeInTheDocument(); expect(screen.getByText("Consultoria")).toBeInTheDocument();
  api.criarAnaliseOnboarding.mockRejectedValueOnce(new Error("Provedor indisponível"));
  fireEvent.click(screen.getByRole("button", { name: "Consultar CNPJ publicamente" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Provedor indisponível");
});
test("anexo exige conferência, envia ao contato certo e não repete timeout", async () => {
  const api = { enviarAnexoWhatsapp: jest.fn().mockRejectedValue(new Error("Resultado incerto")) };
  render(<AnexoDaConversa api={api} conversa={{ id: "c1", contato: { nome: "Maria" } }} />);
  const arquivo = new File(["%PDF-1.7"], "contrato.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Arquivo para enviar no WhatsApp"), { target: { files: [arquivo] } });
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Assumir e enviar anexo" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Assumir e enviar anexo" })).toBeDisabled());
  expect(api.enviarAnexoWhatsapp).toHaveBeenCalledWith("c1", arquivo, "", { clientRequestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) }); expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1);
});

test("formulário preparado atualiza o atendimento e retira o vínculo com outra empresa sem recarregar a página", async () => {
  let atendimento = null;
  const conversa = { id: "c1", portalClientId: null, janela: { situacao: "ABERTA" }, escopoVerificado: true };
  const api = { criarLinkOnboarding: jest.fn(async () => ({ token: "pessoal" })), comercial: jest.fn(async (path, body) => {
    if (path === "/recursos") return { recursos: [] };
    if (body) atendimento = { id: "l1", onboardingId: "o1", onboarding: { id: "o1", origem: body.origem, dados: {} } };
    if (path.startsWith("/conversas")) return { atendimento, anteriores: [] };
    return { onboarding: atendimento.onboarding, propostas: [], contratos: [], documentos: [], trabalhos: [], marcos: [] };
  }) };
  render(<FioDaConversa fio={{ conversa, mensagens: [] }} hook={{ api }} slotVincular={<AtendimentoComercial api={api} conversa={conversa} slotEmpresa={<p>Vincular empresa existente</p>} />} />);
  fireEvent.click(screen.getByRole("button", { name: "Abrir atendimento" }));
  expect(await screen.findByText("Vincular empresa existente")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  const preparar = within((await screen.findByText("Formulário de abertura")).closest("article")).getByRole("button", { name: "Preparar formulário" });
  await waitFor(() => expect(preparar).toBeEnabled());
  fireEvent.click(preparar);
  expect(await screen.findByText(/preencha este formulário:/)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Vincular empresa existente")).not.toBeInTheDocument());
  expect(await screen.findByRole("button", { name: "Nova solicitação", exact: true })).toBeInTheDocument();
});

test("atualizar atendimento recupera resultado fiscal mesmo sem mudança na versão da ficha", async () => {
  const onboarding = { id: "o1", origem: "TRANSFERENCIA", versao: 3, cnpj: "11222333000181" };
  const api = { getOnboardingComercial: jest.fn().mockResolvedValueOnce({ analises: [] }).mockResolvedValueOnce({ analises: [{ id: "a1", tipo: "SITFIS", cnpj: onboarding.cnpj, status: "CONCLUIDA", createdAt: "2026-09-14", resultado: { relatorioDisponivel: true, mensagem: "Relatório concluído pelo worker" } }] }) };
  const tela = render(<AnaliseDoLead api={api} onboarding={onboarding} />);
  await waitFor(() => expect(api.getOnboardingComercial).toHaveBeenCalledTimes(1));
  tela.rerender(<AnaliseDoLead api={api} onboarding={{ ...onboarding }} />);
  expect(await screen.findByText("Relatório concluído pelo worker")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Abrir relatório fiscal PDF" })).toBeInTheDocument();
});
