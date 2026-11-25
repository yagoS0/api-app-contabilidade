import { StrictMode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmitirNfseWizard } from "../EmitirNfseWizard";

const cadastro = { cnpj: "39254243000191", inscricaoMunicipal: "123", codigoServicoNacional: "070201", codigoServicoMunicipal: "001", rpsSerie: "00001" };
const valoresIniciais = { tomador: { cnpjCpf: "11222333000181", nome: "Tomador" }, servico: { descricao: "Serviço da obra", valorServicos: "100,00" } };
const alterar = (nome, value) => fireEvent.change(screen.getByLabelText(nome), { target: { value } });
const preencher = () => {
  alterar("Tipo de identificador", "end");
  for (const [nome, value] of [["CEP da obra", "01551-020"], ["Logradouro da obra", "Rua da obra"], ["Número da obra", "0"], ["Complemento da obra (opcional)", "Bloco A"], ["Bairro da obra", "Centro"]]) alterar(nome, value);
};
function abrir() {
  const props = { companyId: "empresa", regime: "SIMPLES", codigoMunicipioIbge: "3304557", cadastroEmissao: cadastro, valoresIniciais, onEmitir: jest.fn(async () => ({ status: "issued" })), onClose: jest.fn(), apiPerfis: {
    getPerfisEmissao: jest.fn(async () => ({ integracaoLigada: false, perfis: [] })),
    consultarTomadorNfse: jest.fn(async () => ({ ok: false })),
    previaEmissaoNfse: jest.fn(async () => ({ ok: true, pendencias: [], regimeVigente: { regime: "SIMPLES" }, percentualSimples: { estado: "REFERENCIA", valor: 6 } })),
  } };
  return { ...render(<StrictMode><EmitirNfseWizard {...props} /></StrictMode>), props };
}
async function avancar() {
  await waitFor(() => expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
}
test("endereço próprio da obra chega ao resumo, confirmação e payload", async () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  try {
    const { props } = abrir();
    // Preenchimento explícito mantém o fixture independente da sugestão do modelo.
    fireEvent.change(document.getElementById("nfse-doc"), { target: { value: "11222333000181" } });
    fireEvent.change(document.getElementById("nfse-nome"), { target: { value: "Tomador" } });
    await avancar();
    fireEvent.change(document.getElementById("nfse-valor"), { target: { value: "100,00" } });
    fireEvent.change(document.getElementById("nfse-ptottribsn"), { target: { value: "6" } });
    fireEvent.click(screen.getByText(/Obra e destinatário IBS\/CBS/));
    preencher();
    alterar("Inscrição imobiliária fiscal (opcional)", "IM-123");
    expect(screen.getByText(/o CEP da obra deve pertencer ao município da prestação/)).toBeVisible();
    await avancar();
    expect(screen.getByText(/Endereço da obra: Rua da obra · 0 · Bloco A · Centro · CEP 01551020/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota" }));
    await waitFor(() => expect(props.onEmitir).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Endereço da obra: Rua da obra"));
    expect(props.onEmitir.mock.calls[0][0].obra).toEqual({ inscImobFisc: "IM-123", end: { CEP: "01551020", xLgr: "Rua da obra", nro: "0", xCpl: "Bloco A", xBairro: "Centro" } });
    expect(props.onEmitir.mock.calls[0][0].tomador.endereco).toBeUndefined();
  } finally { confirm.mockRestore(); }
});
test("troca de tipo e empresa limpa os campos inativos da obra", async () => {
  const { rerender, props } = abrir();
  await avancar();
  fireEvent.click(screen.getByText(/Obra e destinatário IBS\/CBS/));
  alterar("Identificador da obra", "123");
  alterar("Inscrição imobiliária fiscal (opcional)", "987");
  preencher();
  alterar("Tipo de identificador", "cCIB");
  expect(screen.getByLabelText("Identificador da obra")).toHaveValue("");
  expect(screen.getByLabelText("Inscrição imobiliária fiscal (opcional)")).toHaveValue("987");
  alterar("Tipo de identificador", "end");
  expect(screen.getByLabelText("CEP da obra")).toHaveValue("");
  preencher();
  rerender(<StrictMode><EmitirNfseWizard {...props} companyId="outra" /></StrictMode>);
  expect(screen.getByLabelText("Tipo de identificador")).toHaveValue("cObra");
  alterar("Tipo de identificador", "end");
  expect(screen.getByLabelText("CEP da obra")).toHaveValue("");
  expect(props.onEmitir).not.toHaveBeenCalled();
});

test("endereço incompleto mantém avanço bloqueado no escritório", async () => {
  const { props } = abrir(); await avancar();
  fireEvent.click(screen.getByText(/Obra e destinatário IBS\/CBS/));
  alterar("Tipo de identificador", "end");
  expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
  expect(screen.getByText(/CEP da obra: informe 8 dígitos/)).toBeInTheDocument();
  expect(props.onEmitir).not.toHaveBeenCalled();
});
