import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { WorkspaceNavigationProvider, WorkspaceHomeLink, useWorkspaceNavigation } from "../WorkspaceNavigation";

function Screen() {
  const nav = useWorkspaceNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    {location.pathname.startsWith('/companies/123/') && <WorkspaceHomeLink />}
    <output aria-label="rota">{location.pathname}{location.search}</output>
    <output aria-label="visão">{nav.modoVisao}</output>
    <button onClick={() => nav.setModoVisao("tabela")}>Tabela</button>
    <button onClick={() => navigate("/companies/123/notas?competencia=2026-09")}>Notas</button>
    <button onClick={() => navigate("/planejamento")}>Planejamento</button>
    <button onClick={() => nav.goBack()}>Voltar</button>
    <button onClick={() => { nav.resetSession(); navigate("/companies", { replace: true }); }}>Novo login</button>
  </>;
}
function setup(route = "/companies") {
  return render(<MemoryRouter initialEntries={[route]}><WorkspaceNavigationProvider><Screen /></WorkspaceNavigationProvider></MemoryRouter>);
}

test('link direto de Operações mantém a visão sem desmontar a navegação', () => {
  setup('/companies?visao=operacoes');
  expect(screen.getByLabelText('visão')).toHaveTextContent('operacoes');
  fireEvent.click(screen.getByText('Notas'));
  fireEvent.click(screen.getByText('Voltar'));
  expect(screen.getByLabelText('visão')).toHaveTextContent('operacoes');
});

test('entrar e sair de empresas conserva a sessão montada e o trabalho em memória', () => {
  const montar = jest.fn(), desmontar = jest.fn();
  function Sessao() {
    const [valor, setValor] = useState('');
    useEffect(() => { montar(); return desmontar; }, []);
    return <><Screen/><input aria-label="Trabalho em andamento" value={valor} onChange={e => setValor(e.target.value)}/></>;
  }
  render(<MemoryRouter initialEntries={['/companies']}><WorkspaceNavigationProvider><Sessao/></WorkspaceNavigationProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Trabalho em andamento'), { target: { value: 'preservar' } });
  for (const nome of ['Notas', 'Planejamento', 'Voltar', 'Voltar', 'Notas']) {
    fireEvent.click(screen.getByText(nome));
    expect(screen.getByLabelText('Trabalho em andamento')).toHaveValue('preservar');
  }
  expect(montar).toHaveBeenCalledTimes(1);
  expect(desmontar).not.toHaveBeenCalled();
});
test("voltar restaura a rota interna anterior, incluindo competência", () => {
  setup();
  fireEvent.click(screen.getByText("Notas"));
  fireEvent.click(screen.getByText("Planejamento"));
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/companies/123/notas?competencia=2026-09");
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});
test("acesso direto usa página principal como fallback", () => {
  setup("/planejamento");
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});
test("logo preserva Tabela; novo login restaura Calendário e limite de histórico", () => {
  setup();
  fireEvent.click(screen.getByText("Tabela"));
  fireEvent.click(screen.getByText("Notas"));
  fireEvent.click(screen.getByRole("link", { name: "Altan — página principal" }));
  expect(screen.getByLabelText("visão")).toHaveTextContent("tabela");
  fireEvent.click(screen.getByText("Novo login"));
  expect(screen.getByLabelText("visão")).toHaveTextContent("calendario");
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});
