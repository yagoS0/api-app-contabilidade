import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RotinasPage } from "../renderRotinasPage.jsx";

test("horário meia-noite e frequência diária são conservados ao salvar", async () => {
  const api = {
    getRotinas: jest.fn(async () => ({
      rotinas: [{ key: "pagamento", label: "Pagamento" }],
      agenda: { pagamento: { enabled: true, day: 20, hour: 8, frequency: "MONTHLY" } }, empresas: [],
    })),
    saveRotinas: jest.fn(async (body) => ({ agenda: body.agenda })),
  };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("Horário de Pagamento"), { target: { value: "00:00" } });
  fireEvent.change(screen.getByLabelText("Frequência da consulta de pagamentos"), { target: { value: "DAILY" } });
  expect(screen.getByLabelText("Dia de Pagamento")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Salvar rotinas" }));
  await waitFor(() => expect(api.saveRotinas).toHaveBeenCalledWith(expect.objectContaining({
    agenda: { pagamento: { enabled: true, day: 20, hour: 0, frequency: "DAILY" } },
  })));
});

test("executor sem sinal não aparece como consulta bem-sucedida", async () => {
  const api = { getRotinas: jest.fn(async () => ({ rotinas: [{ key: "pagamento", label: "Pagamento" }],
    agenda: {}, empresas: [], executions: [{ routine: "pagamento", enabled: true, alive: false,
      lastRun: null, nextAt: "2026-09-25T11:00:00Z" }] })) };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  expect(await screen.findByText("Sem sinal do executor")).toBeVisible();
  expect(screen.queryByText("Concluída")).not.toBeInTheDocument();
});

test("execução técnica concluída mostra ressalvas fiscais e não promete nova tentativa", async () => {
  const api = { getRotinas: jest.fn(async () => ({ rotinas: [{ key: "pagamento", label: "Pagamento" }],
    agenda: {}, empresas: [], executions: [{ routine: "pagamento", enabled: true, alive: true,
      lastRun: { status: "SUCCEEDED", qualidadeConsulta: "PARCIAL", attempts: 1, result: { indeterminados: 2, semDoc: 1 } }, nextAt: "2026-09-25T11:00:00Z" }] })) };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  expect(await screen.findByText("Concluída com ressalvas — pagamentos a conferir")).toBeInTheDocument();
  expect(screen.getByText(/2 consulta\(s\) inconclusiva/)).toBeInTheDocument();
  expect(screen.queryByText(/Nova tentativa a partir/)).not.toBeInTheDocument();
});
test("falha mostra ação do contador e não promete retry antigo", async () => {
  const api = { getRotinas: jest.fn(async () => ({ rotinas: [{ key: "pagamento", label: "Pagamento" }], agenda: {}, empresas: [],
    executions: [{ routine: "pagamento", enabled: true, alive: true, retryExhausted: true,
      lastRun: { status: "FAILED", attempts: 3, retryAt: "2026-09-25T11:15:00Z" }, nextAt: "2026-10-20T11:00:00Z" }] })) };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  expect(await screen.findByText("Consultar falha")).toBeVisible();
  expect(screen.getByText("Sem nova tentativa automática. A próxima consulta seguirá a agenda salva.")).toBeInTheDocument();
  expect(screen.queryByText(/Nova tentativa a partir/)).not.toBeInTheDocument();
});
