import { render, screen, fireEvent, within } from "@testing-library/react";
import { FormularioContrato } from "../FormularioContrato";
const props = () => ({
  onboarding: { cnpj: "11222333000181", razaoSocial: "Empresa Sintética", responsavelNome: "Ana", dados: { endereco: { logradouro: "Rua Teste", numero: "8", cidade: "Cidade" } } },
  proposta: { id: "p1", status: "ACEITA", opcaoAceita: "RECORRENTE", snapshot: { limitesPlano: { funcionarios: 3, documentosEntradaMes: 30 }, opcoes: [{ chave: "RECORRENTE", recorrente: true, mensalCentavos: 13711, unicoCentavos: 0, escopo: "Escopo contratado" }], condicoes: "Condições contratadas" } },
  recursos: [{ id: "modelo", tipo: "CONTRATO", titulo: "Modelo mensal", versao: 2, aprovadoEm: "2026-09-01", texto: "{{contratante}} {{nome}} {{endereco}} {{cargo}} {{diaVencimento}} {{honorariosMensais}} {{servico}} {{limiteDocumentos}}", dados: { recorrente: true, camposPadrao: { diaVencimento: 10 } } }],
  onGerar: jest.fn(),
});
test("seleciona o único modelo compatível, preenche a ficha e envia apenas os campos editáveis", () => {
  const p = props(); render(<FormularioContrato {...p} />);
  expect(screen.getByLabelText("Modelo do contrato")).toHaveValue("modelo");
  expect(screen.getByLabelText("Razão social da contratante")).toHaveValue("Empresa Sintética");
  expect(screen.getByLabelText("Endereço completo da contratante")).toHaveValue("Rua Teste, 8, Cidade");
  expect(screen.getByLabelText("Dia de vencimento dos honorários")).toHaveValue(10);
  const vinculados = screen.getByRole("region", { name: "Dados vinculados à proposta" });
  expect(vinculados).toHaveTextContent("137,11");
  expect(within(vinculados).queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Gerar contrato da opção aceita" }));
  expect(p.onGerar).not.toHaveBeenCalled(); expect(screen.getByLabelText("Cargo do representante")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Cargo do representante"), { target: { value: "Sócia administradora" } });
  fireEvent.change(screen.getByLabelText("Nome do representante"), { target: { value: "Ana conferida" } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar contrato da opção aceita" }));
  expect(p.onGerar).toHaveBeenCalledWith({ modeloId: "modelo", variaveis: { contratante: "Empresa Sintética", nome: "Ana conferida", endereco: "Rua Teste, 8, Cidade", cargo: "Sócia administradora", diaVencimento: 10 } });
});
test("avulso, minuta e contrato que exige CNPJ não são oferecidos para a contratação incompatível", () => {
  const p = props(); p.onboarding.cnpj = null;
  p.recursos.push({ ...p.recursos[0], id: "avulso", titulo: "Serviço isolado", dados: { recorrente: false, permitePreCnpj: true } }, { ...p.recursos[0], id: "rascunho", aprovadoEm: null });
  render(<FormularioContrato {...p} />);
  expect(screen.getByRole("status")).toHaveTextContent("modelos em rascunho");
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeDisabled();
  expect(screen.queryByLabelText("Modelo do contrato")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /biblioteca/ })).toHaveAttribute("target", "_blank");
});
test("duas opções exigem escolha; troca de modelo limpa campos particulares", () => {
  const p = props(); p.recursos.push({ ...p.recursos[0], id: "m2", titulo: "Segundo modelo" });
  render(<FormularioContrato {...p} />);
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Modelo do contrato"), { target: { value: "modelo" } });
  fireEvent.change(screen.getByLabelText("Cargo do representante"), { target: { value: "Dados do modelo anterior" } });
  fireEvent.change(screen.getByLabelText("Modelo do contrato"), { target: { value: "m2" } });
  expect(screen.getByLabelText("Cargo do representante")).toHaveValue("");
});
test("limpar um valor previamente preenchido não restaura silenciosamente o cadastro", () => {
  const p = props(); render(<FormularioContrato {...p} />);
  fireEvent.change(screen.getByLabelText("Nome do representante"), { target: { value: "" } });
  expect(screen.getByLabelText("Nome do representante")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Gerar contrato da opção aceita" }));
  expect(p.onGerar).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Nome do representante")).toHaveAttribute("aria-invalid", "true");
});
test("modelo em rascunho permite preencher e conferir a prévia, mas não gera contrato", () => {
  const p = props(); p.recursos[0].aprovadoEm = null;
  p.recursos[0].texto += " Início: {{inicioVigencia}}.";
  render(<FormularioContrato {...p} />);
  expect(screen.getByRole("status")).toHaveTextContent("Rascunho da biblioteca");
  expect(screen.getByLabelText("Razão social da contratante")).toHaveValue("Empresa Sintética");
  fireEvent.change(screen.getByLabelText("Início da vigência do anexo"), { target: { value: "2026-09-21" } });
  fireEvent.change(screen.getByLabelText("Nome do representante"), { target: { value: "Nome revisado" } });
  fireEvent.click(screen.getByText("Conferir prévia do texto"));
  expect(screen.getByText(/Início: 21\/09\/2026\./)).toHaveTextContent("Nome revisado");
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeDisabled();
  expect(p.onGerar).not.toHaveBeenCalled();
});
test("prioriza a versão aprovada e oferece a versão mais recente do rascunho para revisar", () => {
  const p = props(); p.recursos[0].chave = "modelo-padrao";
  p.recursos.push({ ...p.recursos[0], id: "draft-old", versao: 3, aprovadoEm: null }, { ...p.recursos[0], id: "draft-new", versao: 4, aprovadoEm: null });
  render(<FormularioContrato {...p} />);
  expect(screen.getByLabelText("Modelo do contrato")).toHaveValue("modelo");
  expect(screen.queryByRole("option", { name: /v3/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Modelo do contrato"), { target: { value: "draft-new" } });
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeDisabled();
});
test("email da ficha e dia padrão podem ser apagados e a validação exige o novo valor", () => {
  const p = props(); p.onboarding.responsavelEmail = "cadastro@example.test";
  p.recursos[0].texto = "{{email}} {{diaVencimento}}";
  render(<FormularioContrato {...p} />);
  fireEvent.change(screen.getByLabelText("E-mail do representante"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Dia de vencimento dos honorários"), { target: { value: "" } });
  expect(screen.getByLabelText("E-mail do representante")).toHaveValue("");
  expect(screen.getByLabelText("Dia de vencimento dos honorários")).toHaveValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Gerar contrato da opção aceita" }));
  expect(screen.getByLabelText("E-mail do representante")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Dia de vencimento dos honorários")).toHaveAttribute("aria-invalid", "true");
  expect(p.onGerar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Conferir prévia do texto"));
  expect(screen.getByText("— preencher — — preencher —")).toBeVisible();
});
test("aprovar uma nova versão durante o preenchimento conserva o modelo iniciado e suas edições", () => {
  const p = props(); p.recursos[0].chave = "modelo-padrao";
  const original = p.recursos[0];
  const novo = { ...original, id: "modelo-v3", versao: 3, aprovadoEm: null, texto: original.texto + " Texto novo." };
  const { rerender } = render(<FormularioContrato {...p} recursos={[original, novo]} />);
  fireEvent.change(screen.getByLabelText("Cargo do representante"), { target: { value: "Cargo conferido na v2" } });
  rerender(<FormularioContrato {...p} recursos={[original, { ...novo, aprovadoEm: "2026-09-21" }]} />);
  expect(screen.getByLabelText("Modelo do contrato")).toHaveValue("modelo");
  expect(screen.getByRole("option", { name: /v2/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Cargo do representante")).toHaveValue("Cargo conferido na v2");
  fireEvent.click(screen.getByRole("button", { name: "Gerar contrato da opção aceita" }));
  expect(p.onGerar).toHaveBeenCalledWith(expect.objectContaining({ modeloId: "modelo", variaveis: expect.objectContaining({ cargo: "Cargo conferido na v2" }) }));
  expect(screen.queryByText(/Texto novo\./)).not.toBeInTheDocument();
});
test("exclusão do modelo iniciado bloqueia a geração até uma escolha explícita, mesmo se houver único aprovado", () => {
  const p = props(); p.recursos[0].chave = "modelo-padrao"; p.recursos[0].aprovadoEm = null;
  const original = p.recursos[0];
  const { rerender } = render(<FormularioContrato {...p} />);
  fireEvent.change(screen.getByLabelText("Cargo do representante"), { target: { value: "Cargo da minuta excluída" } });
  const novo = { ...original, id: "modelo-v3", versao: 3, aprovadoEm: "2026-09-21" };
  rerender(<FormularioContrato {...p} recursos={[novo]} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Selecione explicitamente outro modelo");
  expect(screen.getByLabelText("Modelo do contrato")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeDisabled();
  expect(p.onGerar).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Modelo do contrato"), { target: { value: "modelo-v3" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Cargo do representante")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Cargo do representante"), { target: { value: "Cargo conferido na nova versão" } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar contrato da opção aceita" }));
  expect(p.onGerar).toHaveBeenCalledWith(expect.objectContaining({ modeloId: "modelo-v3", variaveis: expect.objectContaining({ cargo: "Cargo conferido na nova versão" }) }));
});
test("versão que desaparece e reaparece não é restabelecida sem revisão explícita", () => {
  const p = props(); const { rerender } = render(<FormularioContrato {...p} />);
  rerender(<FormularioContrato {...p} recursos={[]} />);
  expect(screen.getByRole("alert")).toHaveTextContent("não está mais disponível");
  rerender(<FormularioContrato {...p} />);
  expect(screen.getByLabelText("Modelo do contrato")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Modelo do contrato"), { target: { value: "modelo" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
test("versão alterada sob o mesmo ID exige nova escolha e aprovação de rascunho preserva a versão em edição", () => {
  const p = props(); p.recursos[0].aprovadoEm = null;
  const original = p.recursos[0];
  const { rerender } = render(<FormularioContrato {...p} />);
  fireEvent.change(screen.getByLabelText("Cargo do representante"), { target: { value: "Cargo conferido" } });
  rerender(<FormularioContrato {...p} recursos={[{ ...original, aprovadoEm: "2026-09-21" }]} />);
  expect(screen.getByLabelText("Cargo do representante")).toHaveValue("Cargo conferido");
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeEnabled();
  rerender(<FormularioContrato {...p} recursos={[{ ...original, versao: 3, aprovadoEm: "2026-09-21" }]} />);
  expect(screen.getByRole("alert")).toHaveTextContent("não está mais disponível");
  expect(screen.getByRole("button", { name: "Gerar contrato da opção aceita" })).toBeDisabled();
});
