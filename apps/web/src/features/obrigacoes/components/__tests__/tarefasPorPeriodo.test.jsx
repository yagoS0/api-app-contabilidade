import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ObrigacoesPage } from "../renderObrigacoesPage";

const empresas = [{ companyId: "alfa", razao: "Alfa Ltda" }, { companyId: "beta", razao: "Beta Ltda" }];
const dados = { ok: true, resumo: { pendentes: 0, vencendoEm7Dias: 0, vencidas: 0 }, obrigacoes: [], opcoes: { periodicidades: ["MENSAL"], verificadores: [] } };
const mudar = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function apiBase(extra = {}) { return { listObrigacoes: jest.fn().mockResolvedValue(dados), createObrigacao: jest.fn().mockResolvedValue({ ok: true, obrigacaoId: "item-1", ocorrenciasCriadas: 1 }), ...extra }; }

it("cria uma tarefa 10–15 com empresa do calendário e callback de retorno", async () => {
  const api = apiBase(), onCreated = jest.fn(), onViewDate = jest.fn();
  render(<ObrigacoesPage api={api} empresas={empresas} initialCompanyId="beta" initialCreate={{ companyId: "beta", inicio: "2026-09-10", fim: "2026-09-15" }} onCreated={onCreated} onViewDate={onViewDate} />);
  await screen.findByRole("dialog");
  expect(screen.getByLabelText("Empresa")).toHaveValue("beta");
  mudar("Nome", "Preparar folha"); mudar("Tipo", "TAREFA");
  fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
  await waitFor(() => expect(api.createObrigacao).toHaveBeenCalledWith("beta", expect.objectContaining({ nome: "Preparar folha", periodicidade: "AVULSA", tipo: "TAREFA", dataInicio: "2026-09-10", dataFim: "2026-09-15", dataVencimento: "2026-09-15" })));
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ companyId: "beta", dataInicio: "2026-09-10", dataFim: "2026-09-15" }));
  fireEvent.click(await screen.findByRole("button", { name: /Ver no calendário ·/ }));
  expect(onViewDate).toHaveBeenCalledWith("2026-09-10", "beta");
});

it("recusa fim anterior ao início sem chamar a API", async () => {
  const api = apiBase();
  render(<ObrigacoesPage api={api} empresas={empresas} initialCreate={{ inicio: "2026-09-15", fim: "2026-09-10" }} />);
  mudar("Nome", "Conferir folha");
  fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("igual ou posterior");
  expect(api.createObrigacao).not.toHaveBeenCalled();
});

it("avisa quando preparação ultrapassa prazo fiscal e preserva esse prazo ao salvar", async () => {
  const api = apiBase();
  render(<ObrigacoesPage api={api} empresas={empresas} initialCreate={{ inicio: "2026-09-10", fim: "2026-09-15" }} />);
  mudar("Nome", "Entregar obrigação"); mudar("Vencimento fiscal", "2026-09-12");
  expect(screen.getByRole("status")).toHaveTextContent("ultrapassa o vencimento fiscal");
  fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));
  await waitFor(() => expect(api.createObrigacao).toHaveBeenCalledWith("alfa", expect.objectContaining({ dataFim: "2026-09-15", dataVencimento: "2026-09-12" })));
});

const item = { obrigacaoId: "item-1", companyId: "alfa", nome: "Folha", tipo: "TAREFA", periodicidade: "AVULSA", dataInicio: "2026-09-10", dataFim: "2026-09-15", dataVencimento: "2026-09-15", ocorrencias: [{ ocorrenciaId: "oc-1", situacao: "PENDENTE", dataInicio: "2026-09-10", dataFim: "2026-09-15", dataVencimento: "2026-09-15" }] };
it("edita a tarefa no mesmo ID e mostra início/fim na lista", async () => {
  const api = apiBase({ listObrigacoes: jest.fn().mockResolvedValue({ ...dados, obrigacoes: [item] }), updateObrigacao: jest.fn().mockResolvedValue({ ok: true }) });
  render(<ObrigacoesPage api={api} empresas={empresas} />);
  expect(await screen.findByText(/Trabalho: 10\/09\/2026 até 15\/09\/2026/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Editar" }));
  mudar("Fim planejado", "2026-09-16");
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.updateObrigacao).toHaveBeenCalledWith("item-1", expect.objectContaining({ dataFim: "2026-09-16" })));
  expect(api.createObrigacao).not.toHaveBeenCalled();
});

it("abre ocorrência pelo calendário e edita somente sua janela sem enviar prazo fiscal", async () => {
  const recorrente = { ...item, periodicidade: "MENSAL", tipo: "OBRIGACAO" };
  const api = apiBase({ listObrigacoes: jest.fn().mockResolvedValue({ ...dados, obrigacoes: [recorrente] }), updateOcorrencia: jest.fn().mockResolvedValue({ ok: true }) });
  render(<ObrigacoesPage api={api} empresas={empresas} initialOccurrenceId="oc-1" />);
  const modal = await screen.findByRole("dialog", { name: "Editar somente esta ocorrência" });
  expect(within(modal).queryByLabelText("Vencimento fiscal")).not.toBeInTheDocument();
  mudar("Início do trabalho", "2026-09-09");
  fireEvent.click(within(modal).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(api.updateOcorrencia).toHaveBeenCalledWith("oc-1", { dataInicio: "2026-09-09", dataFim: "2026-09-15" }));
});

it("mantém ação de recorrências visível e envia dias de preparação", async () => {
  const api = apiBase();
  render(<ObrigacoesPage api={api} empresas={empresas} />);
  expect(await screen.findByRole("button", { name: "Regras e recorrências" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "+ Nova tarefa ou obrigação" }));
  mudar("Nome", "Transmitir declaração"); mudar("Repetição", "MENSAL"); mudar("Dias corridos de preparação", "5");
  expect(screen.getByText(/Primeira janela de preparação:/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));
  await waitFor(() => expect(api.createObrigacao).toHaveBeenCalledWith("alfa", expect.objectContaining({ periodicidade: "MENSAL", diasPreparacao: 5 })));
});

it("preserva retorno contextual e conclusão automática", async () => {
  const onBack = jest.fn();
  const api = apiBase({ listObrigacoes: jest.fn().mockResolvedValue({ ...dados, obrigacoes: [{ ...item, conclusaoAutomatica: true }] }) });
  render(<ObrigacoesPage api={api} empresas={empresas} onBack={onBack} onBackLabel="Voltar à empresa" />);
  await screen.findByText("Folha");
  expect(screen.queryByRole("button", { name: /Concluir/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Voltar à empresa/ }));
  expect(onBack).toHaveBeenCalled();
});

it("filtra a ocorrência do período e conclui esse mesmo ID", async () => {
  const antiga = { ...item.ocorrencias[0], ocorrenciaId: "oc-antiga", dataInicio: "2026-08-10", dataFim: "2026-08-15", dataVencimento: "2026-08-15", situacao: "VENCIDA" };
  const api = apiBase({ listObrigacoes: jest.fn().mockResolvedValue({ ...dados, obrigacoes: [{ ...item, periodicidade: "MENSAL", ocorrencias: [antiga, ...item.ocorrencias] }] }), concluirOcorrencia: jest.fn().mockResolvedValue({ ok: true }) });
  render(<ObrigacoesPage api={api} empresas={empresas} />);
  await screen.findByText("Folha");
  mudar("Período a partir de", "2026-09-12"); mudar("Período até", "2026-09-12");
  expect(screen.getByText(/Trabalho: 10\/09\/2026 até 15\/09\/2026/)).toBeInTheDocument();
  expect(screen.queryByText(/Trabalho: 10\/08/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "✓ Concluir" }));
  await waitFor(() => expect(api.concluirOcorrencia).toHaveBeenCalledWith("oc-1"));
});

it("mudar a empresa no cadastro atualiza a lista e mantém a empresa no retorno", async () => {
  const api = apiBase(), onViewDate = jest.fn();
  render(<ObrigacoesPage api={api} empresas={empresas} initialCompanyId="alfa" initialCreate={{ companyId: "alfa", inicio: "2026-09-10", fim: "2026-09-15" }} onViewDate={onViewDate} />);
  mudar("Nome", "Conferir documentos"); mudar("Empresa", "beta");
  fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));
  await waitFor(() => expect(screen.getByLabelText("Filtrar empresa")).toHaveValue("beta"));
  expect(api.listObrigacoes).toHaveBeenLastCalledWith({ companyId: "beta" });
  fireEvent.click(screen.getByRole("button", { name: /Ver no calendário ·/ }));
  expect(onViewDate).toHaveBeenCalledWith("2026-09-10", "beta");
});

it("a linha retorna ao calendário da empresa correta e avulsa concluída não oferece edição", async () => {
  const onViewDate = jest.fn();
  const api = apiBase({ listObrigacoes: jest.fn().mockResolvedValue({ ...dados, obrigacoes: [{ ...item, ocorrencias: [{ ...item.ocorrencias[0], situacao: "CONCLUIDA" }] }] }) });
  render(<ObrigacoesPage api={api} empresas={empresas} onViewDate={onViewDate} />);
  await screen.findByText("Folha");
  expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ver no calendário" }));
  expect(onViewDate).toHaveBeenCalledWith("2026-09-10", "alfa");
});

it("recebe período do calendário e amplia o filtro com aviso ao salvar fora dele", async () => {
  const api = apiBase();
  render(<ObrigacoesPage api={api} empresas={empresas} initialPeriod={{ dataInicio: "2026-09-01", dataFim: "2026-09-30" }} initialCreate={{ inicio: "2026-10-02", fim: "2026-10-05" }} />);
  expect(screen.getByLabelText("Período até")).toHaveValue("2026-09-30");
  mudar("Nome", "Preparar outubro");
  fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));
  await waitFor(() => expect(screen.getByLabelText("Período até")).toHaveValue("2026-10-05"));
  expect(screen.getByText(/O filtro de período foi ampliado/)).toBeInTheDocument();
});

it.each(["TAREFA", "AVULSA"])("remove conclusão automática ao mudar para %s e não restaura a escolha antiga", async (destino) => {
  const api = apiBase({ listObrigacoes: jest.fn().mockResolvedValue({ ...dados, opcoes: { verificadores: [{ chave: "MES_FECHADO", rotulo: "Quando fechar o mês" }] } }) });
  render(<ObrigacoesPage api={api} empresas={empresas} />);
  await screen.findByText("Nenhuma tarefa ou obrigação cadastrada.");
  fireEvent.click(screen.getByRole("button", { name: "+ Nova tarefa ou obrigação" }));
  expect(screen.queryByLabelText("Concluir sozinha")).not.toBeInTheDocument();
  mudar("Nome", "Preparar fechamento"); mudar("Repetição", "MENSAL");
  mudar("Concluir sozinha", "MES_FECHADO");
  mudar(destino === "TAREFA" ? "Tipo" : "Repetição", destino);
  expect(screen.queryByLabelText("Concluir sozinha")).not.toBeInTheDocument();
  mudar(destino === "TAREFA" ? "Tipo" : "Repetição", destino === "TAREFA" ? "OBRIGACAO" : "MENSAL");
  expect(screen.getByLabelText("Concluir sozinha")).toHaveValue("");
  mudar(destino === "TAREFA" ? "Tipo" : "Repetição", destino);
  fireEvent.click(screen.getByRole("button", { name: destino === "TAREFA" ? "Criar tarefa" : "Criar obrigação" }));
  await waitFor(() => expect(api.createObrigacao).toHaveBeenCalledWith("alfa", expect.objectContaining({ verificador: null })));
});
