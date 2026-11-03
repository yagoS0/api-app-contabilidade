import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { CompanyConsultas } from "../CompanyConsultas";
import { companyTabPath, SEGMENT_TO_TAB } from "../../lib/rotasDaEmpresa";
import { CONSULTA_OPERATIONS } from "../../../../fiscal/serpro/lib/consultaOperations";

async function executar() {
  fireEvent.click(screen.getByRole("button", { name: "Executar consulta" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("consulta paga");
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Executar consulta" })));
}
test("menu compartilha catálogo, fixa empresa/competência e só executa após confirmação", async () => {
  const onRunOp = jest.fn(async () => ({ ok: false, message: "Extrato obtido. Contabilização pendente. Mês contábil fechado." }));
  render(<CompanyConsultas companyId="c" competencia="2026-09" onRunOp={onRunOp} />);
  expect(onRunOp).not.toHaveBeenCalled();
  expect(screen.getAllByRole("option")).toHaveLength(CONSULTA_OPERATIONS.length);
  expect(companyTabPath("c", "consultas")).toBe("/companies/c/consultas");
  expect(SEGMENT_TO_TAB.consultas).toBe("consultas");
  await executar();
  expect(onRunOp).toHaveBeenCalledWith("extrato", "c", "2026-09");
  expect(screen.getByRole("alert")).toHaveTextContent("Mês contábil fechado");
});

test("StrictMode: cancelar não consulta e duplo clique confirma uma única execução", async () => {
  let resolve;
  const onRunOp = jest.fn(() => new Promise(r => { resolve = r; }));
  render(<StrictMode><CompanyConsultas companyId="c" competencia="2026-09" onRunOp={onRunOp} /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Executar consulta" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));
  await act(async () => {});
  expect(onRunOp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Executar consulta" }));
  const confirmar = within(await screen.findByRole("dialog")).getByRole("button", { name: "Executar consulta" });
  await act(async () => { fireEvent.click(confirmar); fireEvent.click(confirmar); });
  expect(onRunOp).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Consultando…" })).toBeDisabled();
  await act(async () => resolve({ ok: true, message: "Consulta concluída" }));
  expect(screen.getByRole("status")).toHaveTextContent("Consulta concluída");
});
test.each([undefined, { ok: false, message: "Resultado parcial" }])("resultado inválido/parcial permanece visível %j", async resposta => {
  render(<CompanyConsultas companyId="c" competencia="2026-09" onRunOp={async () => resposta} />);
  await executar();
  expect(screen.getByRole("alert")).toHaveTextContent(resposta?.message || "sem confirmação");
});
test.each([["d", "2026-09"], ["c", "2026-10"]])("troca de contexto descarta retorno antigo: %s %s", async (companyId, competencia) => {
  let resolve;
  const onRunOp = jest.fn(() => new Promise(r => { resolve = r; }));
  const t = render(<CompanyConsultas key="c:2026-09" companyId="c" competencia="2026-09" onRunOp={onRunOp} />);
  await executar();
  t.rerender(<CompanyConsultas key={`${companyId}:${competencia}`} companyId={companyId} competencia={competencia} onRunOp={onRunOp} />);
  await act(async () => resolve({ ok: true, message: "Resultado antigo" }));
  expect(screen.queryByText("Resultado antigo")).not.toBeInTheDocument();
  expect(onRunOp).toHaveBeenCalledTimes(1);
});
