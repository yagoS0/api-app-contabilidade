import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { WhatsappPage } from "../renderWhatsappPage";

const cliente = { id: "cliente", contato: { nome: "Ana Exemplo", papel: "sócia" }, relacionamento: { tipo: "CLIENTE", motivo: "CONTATO_ATIVO_CADASTRADO" }, portalClientId: "empresa", empresa: { razao: "Empresa fictícia", cnpj: "11222333000181" }, naoLidas: 2, escopoVerificado: true, janela: { situacao: "ABERTA" }, ultimaMensagem: { corpo: "Texto que não deve poluir a lista" } };
const lead = { id: "lead", nomePerfilProvedor: "Bruno Exemplo", relacionamento: { tipo: "LEAD" }, naoLidas: 1, solicitacaoComercial: { origem: "TRANSFERENCIA" }, janela: { situacao: "ABERTA" } };
const semNome = { id: "sem-nome", telefoneMascarado: "+55…1234", relacionamento: { tipo: "A_IDENTIFICAR" }, naoLidas: 0 };
const totais = { conversas: 503, naoVinculadas: 101, conversasNaoLidas: 203, mensagensNaoLidas: 517, contagensNaoLidas: { TODOS: 517, CLIENTE: 407, LEAD: 109, A_IDENTIFICAR: 1 } };
function apiLocal() {
  return {
    whatsappContratoV2: true,
    listarConversasWhatsapp: jest.fn(async (_f, opcoes) => ({ conversas: opcoes.q ? [] : opcoes.relacionamento ? [cliente, lead, semNome].filter(c => c.relacionamento.tipo === opcoes.relacionamento) : [cliente, lead, semNome], versaoContrato: 2, buscaConfigurada: true, temMais: true })),
    getMensagensWhatsapp: jest.fn(async id => ({ conversa: [cliente, lead, semNome].find(c => c.id === id), mensagens: [] })),
    getResumoWhatsapp: jest.fn(async () => ({ ok: true, resumo: totais })),
  };
}
beforeEach(() => localStorage.clear());

test("lista mostra somente nome ou telefone, relacionamento e não lidas", async () => {
  render(<WhatsappPage api={apiLocal()} />);
  const linha = await screen.findByTestId("conversa-cliente");
  expect(linha).toHaveTextContent("Ana Exemplo"); expect(linha).toHaveTextContent("Cliente");
  expect(linha).not.toHaveTextContent(/sócia|Empresa fictícia|11222333000181|cadastro/);
  const l = screen.getByTestId("conversa-lead");
  expect(l).toHaveTextContent("Bruno Exemplo"); expect(l).toHaveTextContent("Lead");
  expect(l).not.toHaveTextContent(/Transferência|perfil|conferid/);
  expect(screen.getByTestId("conversa-sem-nome")).toHaveTextContent("+55…1234");
});

test("Ctrl+B e botão visível recolhem a lista sem perder o fio ou rascunho", async () => {
  render(<WhatsappPage api={apiLocal()} />);
  fireEvent.click(await screen.findByTestId("conversa-cliente"));
  const campo = await screen.findByLabelText("Responder ao cliente");
  fireEvent.change(campo, { target: { value: "Rascunho preservado" } });
  expect(fireEvent.keyDown(campo, { key: "b", ctrlKey: true })).toBe(false);
  expect(screen.queryByRole("complementary", { name: "Caixa de entrada" })).not.toBeInTheDocument();
  const mostrar = screen.getByRole("button", { name: "Mostrar contatos" });
  expect(mostrar).toHaveAttribute("aria-expanded", "false");
  expect(mostrar).toHaveFocus();
  expect(campo).toHaveValue("Rascunho preservado");
  fireEvent.click(mostrar);
  expect(screen.getByRole("complementary", { name: "Caixa de entrada" })).toBeVisible();
  expect(screen.getByTestId("conversa-cliente")).toHaveAttribute("aria-current", "true");
  expect(campo).toHaveValue("Rascunho preservado");
  fireEvent.keyDown(window, { key: "B", ctrlKey: true });
  expect(screen.getByRole("button", { name: "Mostrar contatos" })).toBeVisible();
});

test("largura suporta range, teclado, limites e preferência por usuário", async () => {
  localStorage.setItem("altan:comunicacao:largura:operador", "340");
  render(<WhatsappPage api={apiLocal()} usuarioId="operador" />);
  await screen.findByTestId("conversa-cliente");
  const separar = screen.getByRole("separator", { name: "Redimensionar lista de contatos" });
  expect(separar).toHaveAttribute("aria-valuenow", "340");
  fireEvent.keyDown(separar, { key: "End" });
  fireEvent.keyDown(separar, { key: "ArrowRight" });
  expect(separar).toHaveAttribute("aria-valuenow", "380");
  fireEvent.keyDown(separar, { key: "Home" });
  fireEvent.keyDown(separar, { key: "ArrowLeft" });
  expect(separar).toHaveAttribute("aria-valuenow", "200");
  fireEvent.click(screen.getByText("Opções", { selector: "summary" }));
  const range = screen.getByRole("slider", { name: "Largura da lista" });
  fireEvent.change(range, { target: { value: "315" } });
  expect(separar).toHaveAttribute("aria-valuenow", "315");
  expect(localStorage.getItem("altan:comunicacao:largura:operador")).toBe("315");
});

test("arrasto do separador respeita limites e termina ao soltar", async () => {
  const anterior = window.PointerEvent; window.PointerEvent = MouseEvent;
  try {
    render(<WhatsappPage api={apiLocal()} />);
    await screen.findByTestId("conversa-cliente");
    const separar = screen.getByRole("separator", { name: "Redimensionar lista de contatos" });
    fireEvent.pointerDown(separar, { clientX: 238, button: 0 });
    fireEvent.pointerMove(window, { clientX: 999 });
    expect(separar).toHaveAttribute("aria-valuenow", "380");
    fireEvent.pointerMove(window, { clientX: -20 });
    expect(separar).toHaveAttribute("aria-valuenow", "200");
    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientX: 300 });
    expect(separar).toHaveAttribute("aria-valuenow", "200");
  } finally { window.PointerEvent = anterior; }
});

test("filtros exibem totais globais mesmo quando busca e página não trazem os contatos", async () => {
  const api = apiLocal(); render(<WhatsappPage api={api} />);
  const todos = screen.getByRole("button", { name: "Todos" }), leads = screen.getByRole("button", { name: "Leads" }), clientes = screen.getByRole("button", { name: "Clientes" });
  await waitFor(() => expect(todos).toHaveTextContent("517"));
  expect(leads).toHaveTextContent("109"); expect(clientes).toHaveTextContent("407");
  fireEvent.click(leads);
  await waitFor(() => expect(screen.queryByTestId("conversa-cliente")).not.toBeInTheDocument());
  expect(clientes).toHaveTextContent("407"); expect(todos).toHaveTextContent("517");
  fireEvent.change(screen.getByLabelText("Buscar pessoa ou empresa"), { target: { value: "ausente" } });
  await screen.findByText("Nenhuma conversa corresponde à busca e aos filtros.");
  expect(leads).toHaveTextContent("109"); expect(todos).toHaveTextContent("517");
});

test("indisponibilidade do resumo não vira contagem zero ou contagem da página", async () => {
  const api = apiLocal(); api.getResumoWhatsapp.mockRejectedValue(new Error("Indisponível"));
  render(<WhatsappPage api={api} />);
  await screen.findByTestId("conversa-cliente");
  expect(within(screen.getByRole("button", { name: "Todos" })).queryByLabelText(/novas mensagens/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Todos" })).toHaveAttribute("title", "Contagem de novas mensagens indisponível");
});

test("iniciar o atendimento relê o fio e adota o canal comercial mesmo se a lista falhar", async () => {
  let criado = false;
  const canais = [
    { id: "principal", chave: "Principal", conversaId: "inicial", finalidade: "PRINCIPAL", janela: { situacao: "ABERTA" }, podeResponder: true },
    { id: "comercial", chave: "Comercial", conversaId: "comercial-fio", finalidade: "COMERCIAL", janela: { situacao: "ABERTA" }, podeResponder: true },
  ];
  const inicial = { id: "inicial", interlocutorId: "pessoa", nomePerfilProvedor: "Contato sintético", relacionamento: { tipo: "A_IDENTIFICAR" }, canalId: "principal", janela: canais[0].janela, canais };
  const atual = () => criado ? { ...inicial, relacionamento: { tipo: "LEAD" }, solicitacaoComercial: { id: "caso", origem: "ABERTURA", onboardingId: "ficha" } } : inicial;
  const caso = { id: "caso", onboardingId: "ficha" };
  const api = {
    whatsappContratoV2: true,
    listarConversasWhatsapp: jest.fn(async () => { if (criado) throw new Error("Lista temporariamente indisponível"); return { conversas: [atual()], versaoContrato: 2 }; }),
    getMensagensWhatsapp: jest.fn(async () => ({ conversa: atual(), mensagens: [] })),
    comercial: jest.fn(async (path, body) => {
      if (path.endsWith("/iniciar") && body) { criado = true; return { atendimento: caso }; }
      if (path.startsWith("/conversas/")) return { atendimento: criado ? caso : null, anteriores: [] };
      if (path === "/recursos") return { recursos: [] };
      throw new Error("Detalhes da ficha temporariamente indisponíveis");
    }),
  };
  render(<WhatsappPage api={api} />);
  fireEvent.click(await screen.findByTestId("conversa-inicial"));
  await screen.findByLabelText("Responder ao cliente");
  fireEvent.click(screen.getByRole("button", { name: "Detalhes da conversa" }));
  fireEvent.change(await screen.findByLabelText("Motivo do atendimento"), { target: { value: "ABERTURA" } });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
  await waitFor(() => expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(2));
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("inicial");
  await waitFor(() => expect(screen.queryByLabelText("Canal da resposta")).not.toBeInTheDocument());
  expect(screen.getByTestId("fio")).toHaveTextContent("Comercial");
  expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(2);
});
