import { render, screen, fireEvent } from "@testing-library/react";
import { ValoresDaProposta } from "../ValoresDaProposta";
import { ApresentacaoProposta } from "../ApresentacaoProposta";
const onboarding = { origem: "INATIVA", dados: { modalidadeServico: "AVULSO" } };
const decisao = necessaria => ({ necessaria, justificativa: "Conferência sintética do diagnóstico.", condicaoInicioMensal: necessaria ? "APOS_REGULARIZACAO" : "SEM_REGULARIZACAO" });
test("falta de decisão no diagnóstico é explicada antes de gerar", () => {
  const onGerar = jest.fn(); render(<ValoresDaProposta onboarding={onboarding} onGerar={onGerar} />);
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Volte ao diagnóstico"); expect(onGerar).not.toHaveBeenCalled();
});
test("regularização avulsa usa um só campo de preço", () => {
  const onGerar = jest.fn(); render(<ValoresDaProposta onboarding={onboarding} regularizacao={decisao(true)} onGerar={onGerar} />);
  fireEvent.change(screen.getByLabelText("Tipo de serviço avulso"), { target: { value: "REGULARIZACAO" } });
  expect(screen.queryByLabelText("Serviço avulso (R$)")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Regularização — valor total do serviço avulso (R$)"), { target: { value: "53,27" } });
  fireEvent.change(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes"), { target: { value: "Honorários sintéticos conferidos para a regularização." } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(onGerar).toHaveBeenCalledWith({ tipoServicoAvulso: "REGULARIZACAO", regularizacaoCentavos: 5327, justificativa: "Honorários sintéticos conferidos para a regularização.", escopoAvulso: "" });
});
test("baixa sem pendências não sugere nem envia orçamento de regularização", () => {
  const onGerar = jest.fn(); render(<ValoresDaProposta onboarding={onboarding} regularizacao={decisao(false)} onGerar={onGerar} />);
  fireEvent.change(screen.getByLabelText("Tipo de serviço avulso"), { target: { value: "BAIXA" } });
  expect(screen.queryByLabelText(/Regularização anterior/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Encerramento da empresa (R$)"), { target: { value: "12,13" } });
  fireEvent.change(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes"), { target: { value: "Baixa sem regularização prévia necessária." } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(onGerar).toHaveBeenCalledWith({ tipoServicoAvulso: "BAIXA", servicoCentavos: 1213, justificativa: "Baixa sem regularização prévia necessária.", escopoAvulso: "" });
});
test("apresentação comparativa informa inclusão avulsa e condição mensal", () => {
  render(<ApresentacaoProposta proposta={{ opcoes: [{ chave: "AVULSO", titulo: "Regularização", unicoCentavos: 5327, mensalCentavos: 0, regularizacaoIncluida: true }, { chave: "RECORRENTE", titulo: "Mensal", unicoCentavos: 0, mensalCentavos: 13711, recorrente: true }], regularizacaoCentavos: 5327, decisaoRegularizacao: decisao(true) }} />);
  expect(screen.getByText("Regularização já incluída neste valor, sem cobrança duplicada.")).toBeVisible();
  expect(screen.getByText(/Regularização inicial:/)).toHaveTextContent("53,27");
  expect(screen.getByText(/condicionado à conclusão/)).toBeVisible();
});
test.each(["RECORRENTE", "COMPARAR"])("encerramento impede envio da modalidade %s e orienta a correção", modalidadeServico => {
  const onGerar = jest.fn();
  render(<ValoresDaProposta onboarding={{ ...onboarding, dados: { modalidadeServico, pretendeReativar: "BAIXAR" } }} regularizacao={decisao(false)} onGerar={onGerar} />);
  expect(screen.queryByLabelText("Mensalidade personalizada (R$)")).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Regularização de pendências" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Outro serviço pontual" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(screen.getByRole("alert")).toHaveTextContent("altere a modalidade para serviço avulso");
  expect(onGerar).not.toHaveBeenCalled();
});
test("encerramento avulso envia baixa e regularização separadas, sem mensalidade", () => {
  const onGerar = jest.fn();
  render(<ValoresDaProposta onboarding={{ ...onboarding, dados: { modalidadeServico: "AVULSO", pretendeReativar: "BAIXAR" } }} regularizacao={decisao(true)} onGerar={onGerar} />);
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Selecione Encerramento da empresa");
  expect(onGerar).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Tipo de serviço avulso"), { target: { value: "BAIXA" } });
  fireEvent.change(screen.getByLabelText("Encerramento da empresa (R$)"), { target: { value: "12,13" } });
  fireEvent.change(screen.getByLabelText("Regularização necessária antes do encerramento (R$)"), { target: { value: "53,27" } });
  fireEvent.change(screen.getByLabelText("Fonte, escopo e justificativa dos ajustes"), { target: { value: "Baixa e regularização discriminadas no escopo." } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar proposta para revisão" }));
  expect(onGerar).toHaveBeenCalledWith({ tipoServicoAvulso: "BAIXA", servicoCentavos: 1213, regularizacaoCentavos: 5327, justificativa: "Baixa e regularização discriminadas no escopo.", escopoAvulso: "" });
});
