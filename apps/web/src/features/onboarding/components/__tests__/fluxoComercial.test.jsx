import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PropostaPublica } from "../../pages/PropostaPublica";
import { OrientacoesRapidas } from "../../../whatsapp/components/AtendimentoComercial";
import { FluxoComercial } from "../FluxoComercial";
import { ValoresDaProposta } from "../ValoresDaProposta";

test("valor informado exige justificativa antes de criar um rascunho", async () => {
  const gerar = jest.fn();
  render(<ValoresDaProposta onboarding={{ origem: "ABERTURA", dados: { modalidadeServico: "AVULSO" } }} onGerar={gerar} />);
  fireEvent.change(screen.getByLabelText("Abertura (R$)"), { target: { value: "895" } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Explique a fonte e o motivo");
  expect(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes")).toHaveFocus();
  expect(gerar).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Mensalidade personalizada (R$)")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes"), { target: { value: "Valor conferido com o escopo da abertura." } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(gerar).toHaveBeenCalledWith({ aberturaCentavos: 89500, justificativa: "Valor conferido com o escopo da abertura.", escopoAvulso: "" });
});

test("rascunho antigo com justificativa ausente recupera valores e permite corrigir, aprovar e gerar o link", async () => {
  const pendente = { id: "p1", versao: 1, status: "RASCUNHO", snapshot: { pendencias: ["Registrar a justificativa e fonte dos valores conferidos."],
    taxasCentavos: 0, opcoes: [{ chave: "RECORRENTE", titulo: "Contabilidade mensal", mensalCentavos: 79000, unicoCentavos: 0, recorrente: true }] } };
  let proposta = pendente;
  const api = { comercial: jest.fn(async (path, body) => {
    if (path === "/recursos") return { recursos: [] };
    if (path === "/onboardings/o/propostas" && body) {
      proposta = { ...pendente, id: "p2", versao: 2, snapshot: { ...pendente.snapshot, pendencias: [], justificativa: body.ajustes.justificativa } }; return { proposta };
    }
    if (path.endsWith("/aprovar")) { proposta = { ...proposta, status: "APROVADA" }; return { proposta }; }
    if (path.endsWith("/link")) return { token: "teste-proposta" };
    return { onboarding: { id: "o", origem: "INATIVA", dados: { modalidadeServico: "RECORRENTE" }, versao: 3 }, propostas: [proposta], contratos: [], documentos: [], trabalhos: [],
      jornada: { diagnostico: { dados: { servicos: "Regularização e serviços conferidos.", regularizacao: { necessaria: false, justificativa: "Períodos anteriores conferidos sem execução pendente.", condicaoInicioMensal: "SEM_REGULARIZACAO" } } }, projecao: { atual: "proposta", proposta, passos: [{ id: "proposta", titulo: "Proposta", acessivel: true }] } } };
  }) };
  render(<FluxoComercial api={api} onboardingId="o" />);
  expect(await screen.findByRole("region", { name: "Corrigir proposta pendente" })).toBeVisible();
  expect(screen.getByLabelText("Mensalidade personalizada (R$)")).toHaveValue("790,00");
  expect(screen.getByLabelText("Taxas públicas (R$)")).toHaveValue("0,00");
  expect(screen.queryByLabelText("Abertura (R$)")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Aprovar esta versão" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes"), { target: { value: "Honorários conferidos conforme o escopo negociado." } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar versão corrigida para revisão" }));
  expect(await screen.findByText("Proposta 2 · RASCUNHO")).toBeVisible();
  expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/propostas", { versao: 3, ajustes: { mensalCentavos: 79000, taxasCentavos: 0, justificativa: "Honorários conferidos conforme o escopo negociado.", escopoAvulso: "Regularização e serviços conferidos." } });
  fireEvent.click(screen.getByRole("button", { name: "Aprovar esta versão" }));
  const link = await screen.findByRole("button", { name: "Gerar link da proposta" });
  fireEvent.click(link);
  expect(await screen.findByLabelText("Link pessoal da proposta — envie pela conversa")).toHaveValue("http://localhost/proposta/publica#token=teste-proposta");
});

test.each([false, true])("gerar proposta pela aba de preparação mostra imediatamente o resultado (anterior: %s)", async temAnterior => {
  const anterior = { id: "proposta-antiga", versao: 1, status: "RASCUNHO", snapshot: { opcoes: [] } };
  const nova = { id: "proposta-nova", versao: temAnterior ? 2 : 1, status: "RASCUNHO", snapshot: { opcoes: [{ chave: "AVULSO", titulo: "Escopo da nova proposta", unicoCentavos: 89500, mensalCentavos: 0 }] } };
  let estado = { onboarding: { id: "ficha", origem: "ABERTURA", dados: { responsavelEmail: "pessoa@example.test" }, versao: 4 },
    propostas: temAnterior ? [anterior] : [], contratos: [], documentos: [], trabalhos: [],
    jornada: { diagnostico: { id: "diagnostico", dados: { servicos: "Abertura conforme análise conferida." } },
      projecao: { atual: "proposta", abertura: true, proposta: temAnterior ? anterior : null, passos: [{ id: "proposta", titulo: "Proposta", acessivel: true, pendencias: [] }] } } };
  const api = { comercial: jest.fn(async (path, body) => {
    if (path === "/recursos") return { recursos: [] };
    if (path === "/onboardings/ficha/propostas" && body) {
      estado = { ...estado, propostas: [nova], jornada: { ...estado.jornada, projecao: { ...estado.jornada.projecao, proposta: nova } } };
      return { proposta: nova };
    }
    return estado;
  }) };
  render(<FluxoComercial api={api} onboardingId="ficha" />);
  const preparar = await screen.findByRole("tab", { name: "Preparar uma nova proposta em PDF" });
  fireEvent.click(preparar);
  fireEvent.change(screen.getByLabelText("Abertura (R$)"), { target: { value: "895" } });
  fireEvent.change(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes"), { target: { value: "Orçamento de abertura conferido pelo escritório." } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Dados e proposta" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByText(`Proposta ${nova.versao} · RASCUNHO`)).toBeVisible();
  expect(screen.getByText("Escopo da nova proposta")).toBeVisible();
  expect(screen.getByRole("button", { name: "Aprovar esta versão" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Dados para o orçamento" })).toHaveAttribute("aria-selected", "false");
  expect(screen.getByRole("tab", { name: "Preparar uma nova proposta em PDF" })).toHaveAttribute("aria-selected", "false");
  expect(api.comercial).toHaveBeenCalledWith("/onboardings/ficha/propostas", { versao: 4, ajustes: { aberturaCentavos: 89500, justificativa: "Orçamento de abertura conferido pelo escritório.", escopoAvulso: "Abertura conforme análise conferida." } });
  expect(api.comercial.mock.calls.filter(([path, body]) => path.endsWith("/propostas") && body)).toHaveLength(1);
});

test.each([
  {},
  { conversaId: null, canalDisponivel: false, janela: { situacao: "ABERTA" } },
  { conversaId: "comercial", canalDisponivel: false, janela: { situacao: "ABERTA" } },
  { conversaId: "comercial", canalDisponivel: true, janela: { situacao: "EXPIRADA" } },
])("proposta não envia por destino ausente ou canal indisponível: %j", async canal => {
  const estado = { onboarding: { id: "o", origem: "ABERTURA", dados: {}, versao: 1 }, atendimento: { conversaId: "principal-antigo" },
    propostas: [{ id: "p", status: "APROVADA", versao: 1, snapshot: { opcoes: [] } }], contratos: [], documentos: [], trabalhos: [],
    jornada: { projecao: { atual: "proposta", proposta: { id: "p" }, passos: [{ id: "proposta", titulo: "Proposta", acessivel: true, pendencias: [] }] } } };
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [] } : estado) };
  render(<FluxoComercial api={api} onboardingId="o" {...canal} />);
  const enviar = await screen.findByRole("button", { name: "Assumir e enviar PDF da proposta no WhatsApp" });
  expect(enviar).toBeDisabled(); fireEvent.click(enviar);
  expect(api.comercial.mock.calls.filter(([, body]) => body !== undefined)).toHaveLength(0);
});

test("aceite público exige escolha e confirma a versão exibida", async () => {
  history.replaceState(null, "", "/proposta/publica#token=pessoal");
  const p = { versao: 4, status: "APROVADA", destinatario: "Ana", expiraEm: "2099-01-01", opcoes: [{ chave: "AVULSO", titulo: "Somente abertura", unicoCentavos: 100000, mensalCentavos: 0, escopo: "Abertura" }, { chave: "RECORRENTE", titulo: "Abertura e contabilidade", unicoCentavos: 100000, mensalCentavos: 43210, recorrente: true }] };
  const api = { propostaPublica: jest.fn().mockImplementation(async (_t, aceite) => ({ proposta: aceite ? { ...p, status: "ACEITA", opcaoAceita: aceite.opcao } : p })) };
  render(<PropostaPublica api={api} />);
  const aceitar = await screen.findByText("Aceitar opção escolhida"); expect(aceitar).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Somente abertura")); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(aceitar);
  await waitFor(() => expect(api.propostaPublica).toHaveBeenCalledWith("pessoal", { opcao: "AVULSO", versao: 4, confirmado: true }));
  expect(await screen.findByRole("status")).toHaveTextContent("Opção aceita"); expect(location.hash).toBe("");
});
test("mensagem rápida mostra a prévia e envia a versão com assumir explícito", async () => {
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [{ id: "r1", tipo: "ORIENTACAO", aprovadoEm: "2026-09-08", chave: "cnpj", titulo: "Pedir CNPJ", versao: 2 }] } : { previa: { texto: "Qual é o CNPJ?" } }), enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })) };
  render(<OrientacoesRapidas api={api} conversa={{ id: "c1" }} />);
  fireEvent.click(screen.getByText("Mensagens rápidas")); await screen.findByText("Pedir CNPJ");
  fireEvent.click(screen.getByRole("button", { name: "Usar no chat" }));
  expect(await screen.findByText("Qual é o CNPJ?")).toBeInTheDocument(); fireEvent.click(screen.getByText("Assumir e enviar orientação"));
  await waitFor(() => expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("c1", { orientacaoId: "r1", orientacaoVersao: 2, variaveis: { nome: "", cnpj: "", servico: "" }, assumir: true }));
});
test("correção do contador envia campo com a versão carregada", async () => {
  const estado = { onboarding: { id: "o1", origem: "ABERTURA", status: "RASCUNHO", dados: { responsavelNome: "Ana" }, versao: 7 }, propostas: [], contratos: [], documentos: [], trabalhos: [] };
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [] } : estado) };
  render(<FluxoComercial api={api} onboardingId="o1" />);
  expect(await screen.findByRole("region", { name: "Dados capturados" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("Corrigir campo"), { target: { value: "qtdFuncionarios" } });
  fireEvent.change(screen.getByLabelText("Quantidade de funcionários"), { target: { value: "4" } }); fireEvent.click(screen.getByText("Conferir e salvar campo"));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o1/campos", { versao: 7, operacoes: [{ campo: "qtdFuncionarios", acao: "set", valor: 4 }] }));
});
