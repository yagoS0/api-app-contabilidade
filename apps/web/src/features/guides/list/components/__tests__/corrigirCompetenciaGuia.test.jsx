import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModalCorrigirCompetenciaGuia } from "../ModalCorrigirCompetenciaGuia";
const guia = { id: "g", tipo: "SIMPLES", competencia: "2029-09" };
const previa = { companyId: "A", guideId: "g", competenciaAtual: "2029-09", novaCompetencia: "2026-09", revisao: "rev" };
const makeApi = () => ({ preverCorrecaoCompetenciaGuia: jest.fn(async () => previa), corrigirCompetenciaGuia: jest.fn(async () => ({ ok: true, guideId: "g", competencia: "2026-09" })) });
function abrir(api, aoCorrigir = jest.fn()) { render(<ModalCorrigirCompetenciaGuia api={api} companyId="A" guia={guia} aoFechar={jest.fn()} aoCorrigir={aoCorrigir}/>); }
async function conferir() {
  fireEvent.change(screen.getByLabelText("Competência correta"), { target: { value: "2026-09" } });
  fireEvent.click(screen.getByRole("button", { name: "Conferir alteração" }));
  return screen.findByRole("button", { name: "Confirmar correção" });
}
test("seleciona mês, confere e corrige com revisão, recarregando a lista", async () => {
  const api = makeApi(), refresh = jest.fn(); abrir(api, refresh);
  expect(screen.getByRole("button", { name: "Conferir alteração" })).toBeDisabled();
  fireEvent.click(await conferir());
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(api.corrigirCompetenciaGuia).toHaveBeenCalledWith("A", "g", { competencia: "2026-09", revisao: "rev" });
  expect(screen.getByRole("status")).toHaveTextContent("Competência corrigida para 09/2026");
});
test("editar mês invalida confirmação anterior", async () => {
  const api = makeApi(); abrir(api); await conferir();
  fireEvent.change(screen.getByLabelText("Competência correta"), { target: { value: "2026-08" } });
  expect(screen.queryByRole("button", { name: "Confirmar correção" })).not.toBeInTheDocument();
  expect(api.corrigirCompetenciaGuia).not.toHaveBeenCalled();
});
test("bloqueio contábil explica o motivo sem enviar alteração", async () => {
  const api = makeApi(); api.preverCorrecaoCompetenciaGuia.mockRejectedValue(new Error("A competência está fechada.")); abrir(api);
  fireEvent.change(screen.getByLabelText("Competência correta"), { target: { value: "2026-09" } });
  fireEvent.click(screen.getByRole("button", { name: "Conferir alteração" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("competência está fechada");
  expect(api.corrigirCompetenciaGuia).not.toHaveBeenCalled();
});
test("recusa prévia de outra empresa e preserva correção concluída se refresh falhar", async () => {
  const api = makeApi(); api.preverCorrecaoCompetenciaGuia.mockResolvedValueOnce({ ...previa, companyId: "B" }); abrir(api, async () => { throw new Error("rede"); });
  fireEvent.change(screen.getByLabelText("Competência correta"), { target: { value: "2026-09" } });
  fireEvent.click(screen.getByRole("button", { name: "Conferir alteração" }));
  await screen.findByRole("alert"); expect(api.corrigirCompetenciaGuia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferir alteração" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar correção" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Competência corrigida");
  expect(screen.queryByRole("button", { name: "Confirmar correção" })).not.toBeInTheDocument();
});
