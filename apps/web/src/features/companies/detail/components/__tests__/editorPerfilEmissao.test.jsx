import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorPerfilEmissao, corpoDoPerfil } from "../EditorPerfilEmissao";
import { CAMPOS_PERFIL_EMISSAO } from "../../../../../lib/nfse/perfilEmissao";

const dados = {
  campos: CAMPOS_PERFIL_EMISSAO,
  perfis: [{ id: "p1", nome: "Contabilidade", codigoServicoNacional: "171901", ativo: true, retencaoFederalArt30: true }],
  sugestoes: { fonte: "Tabela oficial", url: "https://www.gov.br/nfse", porServico: [
    { codigo: "171901", descricao: "Contabilidade", nbs: [{ codigo: "1.1302.21.00", descricao: "Serviços de contabilidade" }],
      combinacoes: [{ cIndOp: "100301", cClassTrib: "000001", nomeClassTrib: "Tributação integral" }] },
  ] },
};

it('alterar serviço preserva os códigos mas exige revisão explícita antes de salvar', async () => {
  const onSalvar = jest.fn(async () => {});
  render(<EditorPerfilEmissao dados={{ ...dados, sugestoes: { ...dados.sugestoes, porServico: [...dados.sugestoes.porServico, { codigo: '170601', descricao: 'Publicidade' }] } }} podeEditar onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar Contabilidade' }));
  fireEvent.change(document.getElementById('perfil-codigoServicoNacional'), { target: { value: '170601' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
  expect(onSalvar).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Revise o complemento');
  fireEvent.click(screen.getByRole('checkbox', { name: /Revisei complemento/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith('p1', expect.objectContaining({ codigoServicoNacional: '170601' })));
  expect(onSalvar.mock.calls[0][1]).not.toHaveProperty('_revisarServico');
});

it("busca município por nome e UF e salva o código IBGE da escolha", async () => {
  const onSalvar = jest.fn(async () => {});
  render(<EditorPerfilEmissao dados={dados} podeEditar onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole("button", { name: "Editar Contabilidade" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Município da prestação" }), { target: { value: "sao paulo sp" } });
  fireEvent.click(await screen.findByRole("option", { name: /São Paulo \/ SP.*3550308/ }));
  expect(screen.getByRole("combobox", { name: "Município da prestação" })).toHaveValue("São Paulo / SP");
  fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith("p1", expect.objectContaining({ cLocPrestacao: "3550308" })));
  expect(onSalvar.mock.calls[0][1]).not.toHaveProperty("_buscaMunicipio");
});

it("mostra a cidade do código salvo e exige seleção ao trocar o nome", async () => {
  const onSalvar = jest.fn(async () => {});
  render(<EditorPerfilEmissao dados={{ ...dados, perfis: [{ ...dados.perfis[0], cLocPrestacao: "3304557" }] }} podeEditar onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole("button", { name: "Editar Contabilidade" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Município da prestação" })).toHaveValue("Rio de Janeiro / RJ"));
  fireEvent.change(screen.getByRole("combobox", { name: "Município da prestação" }), { target: { value: "Bom Jesus" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
  expect(onSalvar).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Selecione o município");
  fireEvent.change(screen.getByRole("combobox", { name: "Município da prestação" }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith("p1", expect.objectContaining({ cLocPrestacao: null })));
});

it('salva a categoria do prazo sem inferir pelo serviço e informa integrações desligadas', async () => {
  const onSalvar = jest.fn(async () => {});
  render(<EditorPerfilEmissao dados={{ ...dados, integracaoLigada: false, ibscbsLigado: false }} podeEditar onSalvar={onSalvar} />);
  expect(screen.getByText(/O envio de IBS\/CBS está desativado/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Editar Contabilidade' }));
  expect(screen.getByLabelText('Categoria da operação para o prazo de IBS/CBS')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Categoria da operação para o prazo de IBS/CBS'), { target: { value: 'SERVICO_ISS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith('p1', expect.objectContaining({ categoriaObrigacaoIbscbs: 'SERVICO_ISS' })));
});

it("sugestão só preenche após escolha; CST permanece decisão do contador", async () => {
  const onSalvar = jest.fn(async () => {});
  render(<EditorPerfilEmissao dados={dados} podeEditar onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole("button", { name: "Editar Contabilidade" }));
  expect(screen.getByLabelText("Item da NBS")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Sugestões de NBS para o serviço"), { target: { value: "1.1302.21.00" } });
  expect(screen.getByLabelText("Sugestões de NBS para o serviço")).toHaveValue("1.1302.21.00");
  fireEvent.change(screen.getByLabelText("Combinações de operação e classificação"), { target: { value: "100301:000001" } });
  expect(screen.getByLabelText("Combinações de operação e classificação")).toHaveValue("100301:000001");
  expect(screen.getByLabelText("Situação tributária do IBS/CBS (CST)")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Serviço sujeito à retenção federal (art. 30)"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
  await waitFor(() => expect(onSalvar).toHaveBeenCalledWith("p1", expect.objectContaining({
    codigoNbs: "1.1302.21.00", ibscbsCIndOp: "100301", ibscbsCClassTrib: "000001", ibscbsCst: null, retencaoFederalArt30: null,
  })));
});

it("mostra erro de gravação e preserva edição", async () => {
  render(<EditorPerfilEmissao dados={dados} podeEditar onSalvar={async () => { throw new Error("Perfil inválido"); }} />);
  fireEvent.click(screen.getByRole("button", { name: "Editar Contabilidade" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Perfil inválido");
  expect(screen.getByLabelText("Nome do perfil")).toHaveValue("Contabilidade");
});

it("preserva zero e false, normaliza percentual e desmarca padrão inativo", () => {
  expect(corpoDoPerfil({ nome: "X", ativo: false, padrao: true, retencaoFederalArt30: false, pAliq: "2,50", regEspTrib: "0" }, CAMPOS_PERFIL_EMISSAO)).toEqual(expect.objectContaining({ padrao: false, retencaoFederalArt30: false, pAliq: "2.50", regEspTrib: "0" }));
});

it("reabre a seção de um campo obrigatório inválido para permitir a correção", () => {
  render(<EditorPerfilEmissao dados={dados} podeEditar onSalvar={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Novo perfil" }));
  const campo = screen.getByLabelText("Código de Tributação Nacional");
  fireEvent.click(screen.getByText("Serviço e local"));
  expect(campo.closest("details").open).toBe(false);
  fireEvent.invalid(campo);
  expect(campo.closest("details").open).toBe(true);
});
