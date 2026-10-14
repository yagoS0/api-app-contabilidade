import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SitfisTab } from "../renderSitfisTab";

it("erro de leitura não afirma ausência de histórico e repete apenas leitura salva", () => {
  const reload = jest.fn(), consultar = jest.fn();
  render(<SitfisTab sitfisPanel={{ error: "Rede indisponível", status: null, reload, consultar }} />);
  expect(screen.queryByText(/Nenhuma consulta de situação fiscal foi feita/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Tentar ler o relatório salvo/ }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(consultar).not.toHaveBeenCalled();
});

it("falha do PDF não inventa remoção do arquivo e oferece leitura sem SERPRO", () => {
  const recarregarPdf = jest.fn(), consultar = jest.fn();
  render(<SitfisTab sitfisPanel={{ status: { situacao: "ESTADO_NOVO", relatorioPdfFileId: "pdf1" }, pdfIndisponivel: true, recarregarPdf, consultar }} />);
  expect(screen.getByText(/Situação não reconhecida: ESTADO_NOVO/)).toBeInTheDocument();
  expect(screen.queryByText(/não está mais no servidor/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ver PDF oficial" }));
  fireEvent.click(screen.getByRole("button", { name: /Tentar carregar PDF novamente/ }));
  expect(recarregarPdf).toHaveBeenCalledTimes(1);
  expect(consultar).not.toHaveBeenCalled();
});

it('recusa de acesso aos registros manuais não afirma ausência de cadastro', () => {
  const { PendenciasFiscaisTabelas } = require('../PendenciasFiscaisTabelas');
  render(<PendenciasFiscaisTabelas podeEditar manuais={{disponivel:true,itens:[],error:'Acesso negado',reload:jest.fn()}}/>);
  expect(screen.queryByText('Nenhum lançamento cadastrado.')).not.toBeInTheDocument();
  expect(screen.getAllByText('Não foi possível conferir todos os registros desta origem.').length).toBeGreaterThan(0);
  screen.getAllByRole('button',{name:'Adicionar'}).forEach(botao=>expect(botao).toBeDisabled());
  expect(screen.getByRole('button',{name:'Exportar PDF'})).toBeDisabled();
});
