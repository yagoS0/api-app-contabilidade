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

it("sugestão só preenche após escolha; CST permanece decisão do contador", async () => {
  const onSalvar = jest.fn(async () => {});
  render(<EditorPerfilEmissao dados={dados} podeEditar onSalvar={onSalvar} />);
  fireEvent.click(screen.getByRole("button", { name: "Editar Contabilidade" }));
  expect(screen.getByLabelText("Item da NBS")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Sugestões de NBS para o serviço"), { target: { value: "1.1302.21.00" } });
  fireEvent.change(screen.getByLabelText("Combinações de operação e classificação"), { target: { value: "100301:000001" } });
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
