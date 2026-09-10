import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { RecursosComerciais } from "../RecursosComerciais";

// Valores arbitrários para testar conversão e validação; não representam política comercial.
const dados = () => ({ moeda: "BRL", fonte: "Catálogo fictício", faixas: [{ ate: 2, SIMPLES: 12345, LUCRO_PRESUMIDO: 23456, recebidas: 12 }, { ate: 8, SIMPLES: 45678, LUCRO_PRESUMIDO: 56789, recebidas: 35 }], pisoPersonalizado: { SIMPLES: 78901, LUCRO_PRESUMIDO: 89012 }, blocoRecebidas: { quantidade: 17, centavos: 456 }, aberturaCentavos: null, baixaCentavos: 0, consultoriaCentavos: 6789, irpfCentavos: 1234, regularizacaoMinimaCentavos: 34567, consultoriaIncluidaAPartir: 4, escopoAbertura: "Abertura fictícia", escopoMensal: "Contabilidade fictícia", condicoes: "Condições fictícias", regraFutura: { preservar: true } });
const recurso = (extra = {}) => ({ id: "cat-1", tipo: "CATALOGO", chave: "honorarios", titulo: "Catálogo de teste", texto: "", dados: dados(), versao: 3, aprovadoEm: "2026-09-09", ...extra });
function montar(recursos = [recurso()], api = { comercial: jest.fn().mockResolvedValue({ ok: true }) }) {
  const onAtualizar = jest.fn().mockResolvedValue();
  render(<RecursosComerciais recursos={recursos} api={api} onAtualizar={onAtualizar} />);
  fireEvent.click(screen.getByText("Biblioteca de mensagens, preços e modelos"));
  return { api, onAtualizar };
}
const alterar = (nome, value) => fireEvent.change(screen.getByLabelText(nome), { target: { value } });
const salvar = () => fireEvent.click(screen.getByText("Salvar nova versão em rascunho"));

test("edita todas as regras e salva nova versão, preservando campos desconhecidos, null e zero", async () => {
  const original = recurso(); const { api, onAtualizar } = montar([original]);
  fireEvent.click(screen.getByText("Revisar / nova versão"));
  expect(screen.getByLabelText("Abertura (R$)")).toHaveValue("");
  expect(screen.getByLabelText("Baixa (R$)")).toHaveValue("0,00");
  expect(screen.getByLabelText("Atalho / chave")).toHaveAttribute("readonly");
  const faixa = within(screen.getByRole("group", { name: "Faixa 1" }));
  fireEvent.change(faixa.getByLabelText("Até quantos funcionários"), { target: { value: "3" } });
  fireEvent.change(faixa.getByLabelText("Notas recebidas incluídas por mês"), { target: { value: "22" } });
  fireEvent.change(faixa.getByLabelText("Simples Nacional mensal (R$)"), { target: { value: "1250,50" } });
  alterar("Piso personalizado — Lucro Presumido (R$)", "987,65");
  alterar("Quantidade de notas por bloco adicional", "23"); alterar("Valor do bloco adicional (R$)", "12.34");
  alterar("Consultoria incluída a partir de quantos funcionários", "0"); alterar("Escopo da abertura", "Escopo revisado");
  salvar();
  await waitFor(() => expect(api.comercial).toHaveBeenCalledTimes(1));
  const [path, body] = api.comercial.mock.calls[0];
  expect(path).toBe("/recursos"); expect(body.id).toBeUndefined(); expect(body.aprovadoEm).toBeUndefined();
  expect(body.dados).toEqual({ ...original.dados, faixas: [{ ...original.dados.faixas[0], ate: 3, recebidas: 22, SIMPLES: 125050 }, original.dados.faixas[1]], pisoPersonalizado: { ...original.dados.pisoPersonalizado, LUCRO_PRESUMIDO: 98765 }, blocoRecebidas: { quantidade: 23, centavos: 1234 }, consultoriaIncluidaAPartir: 0, escopoAbertura: "Escopo revisado" });
  expect(original.dados.faixas[0].SIMPLES).toBe(12345); expect(onAtualizar).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("status")).toHaveTextContent("rascunho");
});

test("novo catálogo começa sem preços, tem chave correta e não salva incompleto", () => {
  const { api } = montar([]); fireEvent.click(screen.getByText("Novo recurso")); alterar("Tipo", "CATALOGO");
  expect(screen.getByLabelText("Atalho / chave")).toHaveValue("honorarios");
  expect(screen.getByLabelText("Simples Nacional mensal (R$)")).toHaveValue("");
  expect(screen.getByLabelText("Piso de regularização (R$)")).toHaveValue("");
  salvar(); expect(screen.getByRole("alert")).toHaveFocus(); expect(screen.getByRole("alert")).toHaveTextContent("Condições".toLowerCase()); expect(api.comercial).not.toHaveBeenCalled();
});

test("adiciona e remove faixas e rejeita limites repetidos sem ordenar silenciosamente", () => {
  const { api } = montar(); fireEvent.click(screen.getByText("Revisar / nova versão"));
  fireEvent.click(screen.getByText("Adicionar faixa")); expect(screen.getByRole("group", { name: "Faixa 3" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Remover faixa 3"));
  fireEvent.change(within(screen.getByRole("group", { name: "Faixa 2" })).getByLabelText("Até quantos funcionários"), { target: { value: "2" } });
  salvar(); expect(screen.getByRole("alert")).toHaveTextContent("maior que o da faixa anterior"); expect(api.comercial).not.toHaveBeenCalled();
});

test.each([["1.234,56", "Piso de regularização (R$)"], ["-1", "Consultoria mensal adicional (R$)"], ["1,234", "IRPF por declaração (R$)"], ["0", "Quantidade de notas por bloco adicional"], ["1,5", "Consultoria incluída a partir de quantos funcionários"], ["", "Consultoria mensal adicional (R$)"], ["90071992547409999", "Piso de regularização (R$)"]])("não salva valor inválido %s em %s", (value, campo) => {
  const { api } = montar(); fireEvent.click(screen.getByText("Revisar / nova versão")); alterar(campo, value); salvar();
  expect(screen.getByRole("alert")).toBeInTheDocument(); expect(api.comercial).not.toHaveBeenCalled();
});

test("abrir/limpar preços opcionais distingue honorário zero de valor a confirmar", async () => {
  const { api } = montar(); fireEvent.click(screen.getByText("Revisar / nova versão"));
  alterar("Abertura (R$)", "0"); alterar("Baixa (R$)", ""); salvar();
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/recursos", expect.objectContaining({ dados: expect.objectContaining({ aberturaCentavos: 0, baixaCentavos: null }) })));
});

test("aprovação de catálogo inválido abre revisão sem chamar aprovação", () => {
  const r = recurso({ aprovadoEm: null }); r.dados.faixas[1].ate = 1;
  const { api } = montar([r]); fireEvent.click(screen.getByText("Aprovar"));
  expect(screen.getByRole("alert")).toHaveTextContent("maior que o da faixa anterior"); expect(api.comercial).not.toHaveBeenCalled(); expect(screen.getByLabelText("Título")).toHaveValue(r.titulo);
});

test("falha ao salvar preserva edição e não faz aprovação automática", async () => {
  const api = { comercial: jest.fn().mockRejectedValue(new Error("Conexão indisponível")) }; montar([recurso()], api);
  fireEvent.click(screen.getByText("Revisar / nova versão")); alterar("Título", "Revisão em andamento"); salvar();
  expect(await screen.findByRole("alert")).toHaveTextContent("Conexão indisponível"); expect(screen.getByLabelText("Título")).toHaveValue("Revisão em andamento"); expect(api.comercial).toHaveBeenCalledTimes(1);
});

test("dados institucionais normalizam CNPJ e não aceitam link inseguro", async () => {
  const { api } = montar([]); fireEvent.click(screen.getByText("Novo recurso")); alterar("Tipo", "INSTITUCIONAL");
  expect(screen.getByLabelText("Atalho / chave")).toHaveValue("escritorio");
  alterar("Título", "Escritório demonstrativo"); alterar("Nome do escritório", "Escritório de teste"); alterar("CNPJ do procurador", "12.345.678/0001-95"); alterar("Link HTTPS das instruções de autorização", "http://example.invalid/instrucoes");
  salvar(); expect(screen.getByRole("alert")).toHaveTextContent("HTTPS"); expect(api.comercial).not.toHaveBeenCalled();
  alterar("Link HTTPS das instruções de autorização", "https://example.invalid/instrucoes"); salvar();
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/recursos", expect.objectContaining({ dados: expect.objectContaining({ procuradorCnpj: "12345678000195" }) })));
});

test("dois cliques durante salvamento enviam uma única versão", async () => {
  let concluir; const api = { comercial: jest.fn(() => new Promise(resolve => { concluir = resolve; })) }; montar([recurso()], api);
  fireEvent.click(screen.getByText("Revisar / nova versão")); salvar(); salvar(); expect(api.comercial).toHaveBeenCalledTimes(1);
  await act(async () => concluir({ ok: true }));
});

test("configura um catálogo válido do zero, sem importar valores prontos", async () => {
  const { api } = montar([]); fireEvent.click(screen.getByText("Novo recurso")); alterar("Tipo", "CATALOGO"); alterar("Título", "Regras fictícias preenchidas manualmente");
  for (const campo of ["Até quantos funcionários", "Notas recebidas incluídas por mês", "Simples Nacional mensal (R$)", "Lucro Presumido mensal (R$)", "Piso personalizado — Simples Nacional (R$)", "Piso personalizado — Lucro Presumido (R$)", "Valor do bloco adicional (R$)", "Consultoria mensal adicional (R$)", "IRPF por declaração (R$)", "Piso de regularização (R$)", "Consultoria incluída a partir de quantos funcionários"]) alterar(campo, "0");
  alterar("Quantidade de notas por bloco adicional", "1"); alterar("Escopo da abertura", "Escopo de teste"); alterar("Escopo da contabilidade mensal", "Escopo mensal de teste"); alterar("Condições comerciais", "Condições de teste"); salvar();
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/recursos", expect.objectContaining({ tipo: "CATALOGO", chave: "honorarios", dados: expect.objectContaining({ aberturaCentavos: null, baixaCentavos: null, faixas: [{ ate: 0, recebidas: 0, SIMPLES: 0, LUCRO_PRESUMIDO: 0 }], blocoRecebidas: { quantidade: 1, centavos: 0 } }) })));
});

test("campos substituíveis inválidos não são salvos silenciosamente", () => {
  const { api } = montar([]); fireEvent.click(screen.getByText("Novo recurso")); alterar("Título", "Orientação de teste"); alterar("Atalho / chave", "orientacao-teste"); alterar("Texto", "Olá {{ senha }}"); salvar();
  expect(screen.getByRole("alert")).toHaveTextContent("campos substituíveis"); expect(api.comercial).not.toHaveBeenCalled();
});

test("mensagem rápida não oferece variável que seu fluxo não preenche", () => {
  const { api } = montar([]); fireEvent.click(screen.getByText("Novo recurso")); alterar("Título", "Orientação de teste"); alterar("Atalho / chave", "orientacao-teste"); alterar("Texto", "Confira {{linkProposta}}"); salvar();
  expect(screen.getByRole("alert")).toHaveTextContent("campos substituíveis"); expect(api.comercial).not.toHaveBeenCalled();
});
