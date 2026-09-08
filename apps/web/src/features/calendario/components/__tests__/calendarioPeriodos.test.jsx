import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CalendarioGrid } from "../renderCalendarioGrid";

const tarefa = { id: "oc-1", tipo: "obrigacao", natureza: "TAREFA", titulo: "Preparar folha", dataInicio: "2026-09-10", dataFim: "2026-09-15", data: "2026-09-15", companyId: "c1", empresa: "Alfa", situacao: "PENDENTE", resolvido: false };
const diasDaTarefa = (item = tarefa) => Array.from({ length: 6 }, (_, i) => ({ data: `2026-09-${10 + i}`, itens: [item] }));
function montar({ dias = diasDaTarefa(), contexto = {}, ...props } = {}) {
  const api = { getCalendario: jest.fn(async (mes) => ({ dias: dias.filter((d) => d.data.startsWith(mes)), pendenciasDoMes: [] })), concluirOcorrencia: jest.fn(async () => ({ ok: true })) };
  const result = render(<CalendarioGrid api={api} empresas={[{ companyId: "c1", razao: "Alfa" }]} initialContext={{ referencia: "2026-09-10", visao: "mes", ...contexto }} {...props} />);
  return { api, ...result };
}
const visao = (nome) => fireEvent.click(within(screen.getByRole("group", { name: "Granularidade do calendário" })).getByRole("button", { name: nome }));

test.each([
  ["2026-01-31", "fevereiro de 2026"], ["2024-01-30", "fevereiro de 2024"],
  ["2024-02-29", "março de 2024"], ["2026-12-31", "janeiro de 2027"],
])("avança exatamente um mês a partir de %s", async (referencia, destino) => {
  montar({ dias: [], contexto: { referencia } });
  fireEvent.click(screen.getByTitle("Próximo"));
  expect(await screen.findByText(destino)).toBeInTheDocument();
});

test("um intervalo desenha faixas conectadas por semana com o mesmo detalhe e prazo", async () => {
  const { container } = montar();
  const faixas = await screen.findAllByRole("button", { name: /Preparar folha/ });
  expect(faixas).toHaveLength(2);
  expect(container.querySelectorAll('[data-intervalo="true"][data-event-id="oc-1"]')).toHaveLength(2);
  expect(screen.getByLabelText("Continua na próxima semana")).toBeInTheDocument();
  expect(screen.getByLabelText("Continua da semana anterior")).toBeInTheDocument();
  fireEvent.click(faixas[1]);
  const detalhe = screen.getByRole("dialog", { name: "Detalhe" });
  expect(within(detalhe).getByText(/Tarefa · 10\/09\/2026 – 15\/09\/2026/)).toBeInTheDocument();
  expect(within(detalhe).queryByText(/Vencimento fiscal/)).not.toBeInTheDocument();
});

test("Agenda e contador da empresa contam uma ocorrência, mesmo repetida em seis dias", async () => {
  montar({ contexto: { visao: "agenda", painelAberto: true } });
  expect(await screen.findAllByRole("button", { name: /Preparar folha/ })).toHaveLength(1);
  expect(screen.getByTitle("1 obrigação(ões) em aberto no mês")).toHaveTextContent("1");
});

test("Ver mais abre os vinte eventos sem criar e permite abrir o último", async () => {
  const onOpenObligations = jest.fn();
  montar({ dias: [{ data: "2026-09-10", itens: Array.from({ length: 20 }, (_, i) => ({ tipo: "guia", id: `g${i}`, titulo: `Guia ${i + 1}`, data: "2026-09-10" })) }], onOpenObligations });
  fireEvent.click(await screen.findByRole("button", { name: "Ver mais 17 eventos" }));
  const dialog = screen.getByRole("dialog", { name: "Eventos de 10/09/2026" });
  expect(within(dialog).getAllByRole("button", { name: /Guia \d/ })).toHaveLength(20);
  expect(onOpenObligations).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: /Guia 20/ }));
  expect(within(screen.getByRole("dialog", { name: "Detalhe" })).getByText("Guia 20")).toBeInTheDocument();
});

test("atalhos de lista, criação e dia vazio carregam empresa e datas", async () => {
  const onOpenObligations = jest.fn();
  const onContextChange = jest.fn();
  montar({ dias: [], contexto: { empresaFiltro: "c1" }, onOpenObligations, onContextChange });
  fireEvent.click(screen.getByRole("button", { name: "Tarefas e obrigações" }));
  expect(onOpenObligations).toHaveBeenLastCalledWith({ companyId: "c1", dataInicio: "2026-09-01", dataFim: "2026-09-30", criar: false });
  fireEvent.click(screen.getByRole("button", { name: "+ Nova tarefa ou obrigação" }));
  expect(onOpenObligations).toHaveBeenLastCalledWith({ companyId: "c1", dataInicio: "2026-09-10", dataFim: "2026-09-10", criar: true });
  fireEvent.click(screen.getByRole("button", { name: "Criar tarefa ou obrigação em 2026-09-22" }));
  expect(onOpenObligations).toHaveBeenLastCalledWith({ companyId: "c1", dataInicio: "2026-09-22", dataFim: "2026-09-22", criar: true });
  visao("Agenda");
  await waitFor(() => expect(onContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ referencia: "2026-09-10", empresaFiltro: "c1", visao: "agenda" })));
});

test("concluir qualquer faixa chama o ID uma vez e recarrega todas as faixas", async () => {
  let concluida = false;
  const api = { getCalendario: jest.fn(async (mes) => ({ dias: mes === "2026-09" ? diasDaTarefa({ ...tarefa, resolvido: concluida, situacao: concluida ? "CONCLUIDA" : "PENDENTE" }) : [] })), concluirOcorrencia: jest.fn(async () => { concluida = true; return { ok: true }; }) };
  montar({ api });
  fireEvent.click((await screen.findAllByRole("button", { name: /Preparar folha/ }))[1]);
  fireEvent.click(screen.getByRole("button", { name: /Marcar como concluída/ }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Detalhe" })).not.toBeInTheDocument());
  expect(api.concluirOcorrencia).toHaveBeenCalledTimes(1);
  expect(api.concluirOcorrencia).toHaveBeenCalledWith("oc-1");
  await waitFor(() => screen.getAllByRole("button", { name: /Preparar folha/ }).forEach((faixa) => expect(faixa).toHaveStyle({ textDecoration: "line-through" })));
  fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar concluídas" }));
  expect(screen.queryByRole("button", { name: /Preparar folha/ })).not.toBeInTheDocument();
});

test("período da obrigação não substitui o vencimento fiscal no detalhe", async () => {
  const onOpenObligations = jest.fn();
  const obrigacao = { ...tarefa, natureza: "OBRIGACAO", data: "2026-09-20", dataVencimento: "2026-09-20" };
  montar({ dias: diasDaTarefa(obrigacao), onOpenObligations });
  fireEvent.click((await screen.findAllByRole("button", { name: /Preparar folha/ }))[0]);
  expect(screen.getByText(/Vencimento fiscal: 20\/09\/2026/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Editar tarefa ou obrigação" }));
  expect(onOpenObligations).toHaveBeenCalledWith(expect.objectContaining({ ocorrenciaId: "oc-1", dataInicio: "2026-09-10", dataFim: "2026-09-15", criar: false }));
});

test("resposta atrasada de setembro não substitui os eventos de outubro", async () => {
  let responderSetembro;
  const api = { getCalendario: jest.fn((mes) => mes === "2026-09"
    ? new Promise((resolve) => { responderSetembro = resolve; })
    : Promise.resolve({ dias: [{ data: "2026-10-05", itens: [{ id: "out", tipo: "guia", titulo: "Guia de outubro", data: "2026-10-05" }] }] })) };
  montar({ api, contexto: { visao: "agenda" } });
  fireEvent.click(screen.getByTitle("Próximo"));
  expect(await screen.findByRole("button", { name: /Guia de outubro/ })).toBeInTheDocument();
  await act(async () => responderSetembro({ dias: diasDaTarefa() }));
  expect(screen.queryByRole("button", { name: /Preparar folha/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Guia de outubro/ })).toBeInTheDocument();
});

test("tarefa intermediária permanece em aberto até seu fim e Dia mostra o intervalo", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  try {
    montar({ contexto: { visao: "dia", referencia: "2026-09-12" } });
    fireEvent.click(await screen.findByRole("button", { name: /Preparar folha/ }));
    expect(within(screen.getByRole("dialog", { name: "Detalhe" })).getByText("Em aberto")).toBeInTheDocument();
    expect(screen.queryByText("Atrasada")).not.toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});

test("um evento de um dia abre seu detalhe sem desaparecer num grupo lateral", async () => {
  montar({ dias: [{ data: "2026-09-10", itens: [{ ...tarefa, natureza: "OBRIGACAO", dataInicio: "2026-09-10", dataFim: "2026-09-10", data: "2026-09-10" }] }] });
  fireEvent.click(await screen.findByRole("button", { name: /Preparar folha/ }));
  expect(screen.getByRole("dialog", { name: "Detalhe" })).toBeInTheDocument();
});
