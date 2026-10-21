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
  expect(await screen.findByText("Proposta 2 · Rascunho")).toBeVisible();
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
  const preparar = await screen.findByText("Preparar uma nova proposta em PDF", { selector: "summary" });
  fireEvent.click(preparar);
  fireEvent.change(screen.getByLabelText("Abertura (R$)"), { target: { value: "895" } });
  fireEvent.change(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes"), { target: { value: "Orçamento de abertura conferido pelo escritório." } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  await screen.findByText(`Proposta ${nova.versao} · Rascunho`);
  expect(screen.getByText(`Proposta ${nova.versao} · Rascunho`)).toBeVisible();
  expect(screen.getByText("Escopo da nova proposta")).toBeVisible();
  expect(screen.getByRole("button", { name: "Aprovar esta versão" })).toBeVisible();
  expect(screen.getByText("Dados para o orçamento", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Preparar uma nova proposta em PDF", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
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
  const estado = { onboarding: { id: "o1", origem: "ABERTURA", status: "RASCUNHO", dados: { responsavelNome: "Ana" }, versao: 7 }, propostas: [], contratos: [], documentos: [], trabalhos: [], jornada: { projecao: { atual: "proposta", abertura: true, passos: [{ id: "proposta", titulo: "Proposta", acessivel: true }] } } };
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [] } : estado) };
  render(<FluxoComercial api={api} onboardingId="o1" />);
  await screen.findByLabelText("Quantidade de funcionários");
  fireEvent.change(screen.getByLabelText("Quantidade de funcionários"), { target: { value: "4" } }); fireEvent.click(screen.getByText("Salvar dados deste passo"));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o1/campos", { versao: 7, operacoes: [{ campo: "qtdFuncionarios", acao: "set", valor: 4 }] }));
});

function fixtureContrato() {
  const proposta = { id: 'p-qa', versao: 1, status: 'ACEITA', opcaoAceita: 'RECORRENTE', snapshot: { opcoes: [{ chave: 'RECORRENTE', recorrente: true, mensalCentavos: 10000, unicoCentavos: 0, escopo: 'Escopo sintético' }] } };
  const modelo = { id: 'm-qa', tipo: 'CONTRATO', titulo: 'Modelo sintético', chave: 'mensal', versao: 1, aprovadoEm: '2026-10-01', texto: 'Representante: {{cargo}}', dados: { recorrente: true } };
  const estado = { onboarding: { id: 'qa', origem: 'TRANSFERENCIA', cnpj: '11222333000181', versao: 1, dados: {} }, propostas: [proposta], contratos: [], documentos: [], trabalhos: [], jornada: { projecao: { atual: 'contrato', proposta, passos: [{ id: 'proposta', titulo: 'Proposta', acessivel: true }, { id: 'contrato', titulo: 'Contrato', acessivel: true }] } } };
  return { estado, modelo };
}

test('contrato mantém cargo ao voltar da proposta e ao atualizar; outra ficha não herda edição', async () => {
  const { estado, modelo } = fixtureContrato();
  const api = { comercial: jest.fn(async path => path === '/recursos' ? { recursos: [modelo] } : { ...estado, onboarding: { ...estado.onboarding, id: path.split('/').pop() } }) };
  const view = render(<FluxoComercial api={api} onboardingId="qa" />);
  fireEvent.change(await screen.findByLabelText('Cargo do representante'), { target: { value: 'Administrador QA rascunho' } });
  fireEvent.click(screen.getByRole('button', { name: '1. Proposta' }));
  expect(screen.getByLabelText('Cargo do representante')).not.toBeVisible();
  expect(screen.getByLabelText('Cargo do representante')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '2. Contrato' }));
  expect(screen.getByLabelText('Cargo do representante')).toBeVisible();
  expect(screen.getByLabelText('Cargo do representante')).toHaveValue('Administrador QA rascunho');
  view.rerender(<FluxoComercial api={api} onboardingId="qa" revisao={1} />);
  await waitFor(() => expect(api.comercial).toHaveBeenCalledTimes(4));
  expect(screen.getByLabelText('Cargo do representante')).toHaveValue('Administrador QA rascunho');
  view.rerender(<FluxoComercial api={api} onboardingId="outra-qa" />);
  expect(await screen.findByLabelText('Cargo do representante')).toHaveValue('');
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('modelo que desaparece durante navegação não permite gerar contrato com rascunho antigo', async () => {
  const { estado, modelo } = fixtureContrato();
  let recursos = [modelo];
  const api = { comercial: jest.fn(async path => path === '/recursos' ? { recursos } : estado) };
  const view = render(<FluxoComercial api={api} onboardingId="qa" />);
  fireEvent.change(await screen.findByLabelText('Cargo do representante'), { target: { value: 'Cargo antigo' } });
  fireEvent.click(screen.getByRole('button', { name: '1. Proposta' }));
  recursos = [{ ...modelo, versao: 2 }];
  view.rerender(<FluxoComercial api={api} onboardingId="qa" revisao={1} />);
  await waitFor(() => expect(api.comercial).toHaveBeenCalledTimes(4));
  fireEvent.click(screen.getByRole('button', { name: '2. Contrato' }));
  expect(screen.getByRole('button', { name: 'Gerar contrato da opção aceita' })).toBeDisabled();
  expect(screen.getByText(/não está mais disponível para esta contratação/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Modelo do contrato'), { target: { value: modelo.id } });
  expect(screen.getByLabelText('Cargo do representante')).toHaveValue('');
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('etapa que perde acesso não mantém ações do formulário visitado', async () => {
  const fixture = fixtureContrato();
  let estado = fixture.estado;
  const api = { comercial: jest.fn(async path => path === '/recursos' ? { recursos: [fixture.modelo] } : estado) };
  const view = render(<FluxoComercial api={api} onboardingId="qa" />);
  await screen.findByLabelText('Cargo do representante');
  estado = { ...estado, jornada: { projecao: { ...estado.jornada.projecao, atual: 'proposta', passos: [{ id: 'proposta', titulo: 'Proposta', acessivel: true }, { id: 'contrato', titulo: 'Contrato', acessivel: false }] } } };
  view.rerender(<FluxoComercial api={api} onboardingId="qa" revisao={1} />);
  await waitFor(() => expect(screen.queryByLabelText('Cargo do representante')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: '2. Contrato' })).toBeDisabled();
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('recuperação da leitura limpa somente seu erro e conserva formulário', async () => {
  const { estado, modelo } = fixtureContrato();
  let falha = false;
  const api = { comercial: jest.fn(async path => { if (falha) throw new Error('Leitura interrompida'); return path === '/recursos' ? { recursos: [modelo] } : estado; }) };
  const view = render(<FluxoComercial api={api} onboardingId="qa" />);
  fireEvent.change(await screen.findByLabelText('Cargo do representante'), { target: { value: 'Cargo preservado' } });
  falha = true;
  view.rerender(<FluxoComercial api={api} onboardingId="qa" revisao={1} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Leitura interrompida');
  expect(screen.getByRole('button', { name: 'Gerar contrato da opção aceita' })).toBeDisabled();
  falha = false;
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar atendimento' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Cargo do representante')).toHaveValue('Cargo preservado');
});

test.each([
  ['TRANSFERENCIA', 9], ['INATIVA', 9], ['ABERTURA', 7], ['PESSOA_FISICA', 7],
])('mapa de %s conserva %i etapas e bloqueia as futuras sem criar marcos', async (origem, total) => {
  const estado = { onboarding: { id: 'mapa-qa', origem, versao: 1, dados: {} }, propostas: [], contratos: [], documentos: [], trabalhos: [] };
  const api = { comercial: jest.fn(async path => path === '/recursos' ? { recursos: [] } : estado), getOnboardingComercial: jest.fn(async () => ({ analises: [] })) };
  render(<FluxoComercial api={api} onboardingId="mapa-qa" />);
  const nav = await screen.findByRole('navigation', { name: 'Passo a passo do lead' });
  const etapas = nav.querySelectorAll('button');
  expect(etapas).toHaveLength(total);
  expect(etapas[0]).toBeEnabled();
  Array.from(etapas).slice(1).forEach(botao => expect(botao).toBeDisabled());
  expect(etapas[total - 1]).toHaveTextContent('Ficha e documentos');
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('execução usa destino da área e ação interna quando fornecida, sem concluir serviço', async () => {
  const { estado, modelo } = fixtureContrato();
  estado.jornada.projecao.atual = 'conclusao';
  estado.jornada.projecao.contrato = { id: 'contrato-qa', dados: { opcao: { recorrente: true } } };
  const api = { comercial: jest.fn(async path => path === '/recursos' ? { recursos: [modelo] } : estado) };
  const abrir = jest.fn();
  const view = render(<FluxoComercial api={api} onboardingId="qa" />);
  expect(await screen.findByRole('link', { name: 'Abrir implantação' })).toHaveAttribute('href', '/onboardings/qa#implantacao');
  view.rerender(<FluxoComercial api={api} onboardingId="qa" onAbrirExecucao={abrir} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir implantação' }));
  expect(abrir).toHaveBeenCalledTimes(1);
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('dados capturados apresentam opções e estruturas sem JSON e conservam valor desconhecido', async () => {
  const { estado, modelo } = fixtureContrato();
  estado.jornada.projecao.atual = 'conclusao';
  estado.onboarding.dados = { regimeAtual: 'SIMPLES', endereco: { logradouro: 'Rua sintética', numero: 0 }, campoFuturo: 'VALOR_DESCONHECIDO' };
  const api = { comercial: jest.fn(async path => path === '/recursos' ? { recursos: [modelo] } : estado) };
  render(<FluxoComercial api={api} onboardingId="qa" />);
  fireEvent.click(await screen.findByText('Consultar dados recebidos'));
  const dados = screen.getByLabelText('Dados capturados');
  expect(dados).toHaveTextContent('Simples Nacional');
  expect(dados).toHaveTextContent('Rua sintética');
  expect(dados).not.toHaveTextContent('"logradouro":');
  expect(dados).toHaveTextContent('VALOR_DESCONHECIDO');
});


test('serviço avulso com pagamento confirmado orienta execução e entrega sem falar em carteira', async () => {
  const { estado, modelo } = fixtureContrato();
  estado.jornada.projecao.atual = 'conclusao';
  estado.jornada.projecao.contrato = { id: 'contrato-qa', dados: { opcao: { recorrente: false } } };
  estado.jornada.projecao.contratacao = { ganha: true, carteiraPermitida: false };
  const api = { comercial: jest.fn(async path => path === '/recursos' ? { recursos: [modelo] } : estado) };
  render(<FluxoComercial api={api} onboardingId="qa" />);
  expect(await screen.findByRole('heading', { name: 'Execução do serviço' })).toBeVisible();
  expect(screen.getByText(/Ganha · contratação confirmada/)).toHaveTextContent('execução e entrega');
  expect(screen.queryByText(/A implantação pode começar/)).not.toBeInTheDocument();
  expect(screen.queryByText(/A entrada na carteira não conclui/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Encerrar serviço avulso após a entrega'));
  expect(screen.getByLabelText('Evidência da entrega')).toBeVisible();
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});
