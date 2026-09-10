import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PropostaPublica } from "../../pages/PropostaPublica";
import { OrientacoesRapidas } from "../../../whatsapp/components/AtendimentoComercial";
import { FluxoComercial } from "../FluxoComercial";

test("aceite público exige escolha e confirma a versão exibida", async () => {
  history.replaceState(null, "", "/proposta/publica#token=pessoal");
  const p = { versao: 4, status: "APROVADA", destinatario: "Ana", expiraEm: "2099-01-01", opcoes: [{ chave: "AVULSO", titulo: "Somente abertura", unicoCentavos: 100000, mensalCentavos: 0, escopo: "Abertura" }, { chave: "RECORRENTE", titulo: "Abertura e contabilidade", unicoCentavos: 100000, mensalCentavos: 43210, recorrente: true }] };
  const api = { propostaPublica: jest.fn().mockImplementation(async (_t, aceite) => ({ proposta: aceite ? { ...p, status: "ACEITA", opcaoAceita: aceite.opcao } : p })) };
  render(<PropostaPublica api={api} />);
  const aceitar = await screen.findByText("Aceitar opção escolhida"); expect(aceitar).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Somente abertura")); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(aceitar);
  await waitFor(() => expect(api.propostaPublica).toHaveBeenCalledWith("pessoal", { opcao: "AVULSO", versao: 4, confirmado: true }));
  expect(await screen.findByRole("status")).toHaveTextContent("Opção aceita"); expect(location.hash).toBe("");
});
test("mensagem rápida mostra a prévia e envia a versão com assumir explícito", async () => {
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [{ id: "r1", tipo: "ORIENTACAO", aprovadoEm: "2026-09-08", chave: "cnpj", titulo: "Pedir CNPJ", versao: 2 }] } : { previa: { texto: "Qual é o CNPJ?" } }), enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })) };
  render(<OrientacoesRapidas api={api} conversa={{ id: "c1" }} />);
  fireEvent.click(screen.getByText("Mensagens rápidas")); await screen.findByText("/cnpj — Pedir CNPJ · v2");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "r1" } });
  expect(await screen.findByText("Qual é o CNPJ?")).toBeInTheDocument(); fireEvent.click(screen.getByText("Assumir e enviar orientação"));
  await waitFor(() => expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("c1", { orientacaoId: "r1", variaveis: { nome: "", cnpj: "", servico: "" }, assumir: true }));
});
test("correção do contador envia campo com a versão carregada", async () => {
  const estado = { onboarding: { id: "o1", origem: "ABERTURA", status: "RASCUNHO", dados: { responsavelNome: "Ana" }, versao: 7 }, propostas: [], contratos: [], documentos: [], trabalhos: [] };
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [] } : estado) };
  render(<FluxoComercial api={api} onboardingId="o1" />); await screen.findByText("Conferir dados coletados na conversa");
  fireEvent.click(screen.getByText("Conferir dados coletados na conversa"));
  fireEvent.change(screen.getByLabelText("Corrigir campo"), { target: { value: "qtdFuncionarios" } });
  fireEvent.change(screen.getByLabelText("Quantidade de funcionários"), { target: { value: "4" } }); fireEvent.click(screen.getByText("Conferir e salvar campo"));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o1/campos", { versao: 7, operacoes: [{ campo: "qtdFuncionarios", acao: "set", valor: 4 }] }));
});
