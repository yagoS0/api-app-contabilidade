// ⚠⚠ GUARDAR A SIMULAÇÃO EM DOCUMENTOS — os dois atos, e o desfecho de cada um.
//
// > Dono: *"ela deve poder ser impressa, salva e colocada na área de documento ou na área fiscal,
// > onde melhor encaixar para termos isso em mão para nosso cliente"*.
//
// ⚠⚠ O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR: que "a foto foi salva e o PDF não" chegue à tela como
// um "falhou" genérico. Sem o Volume no Railway o storage recusa, e o contador refaria a simulação
// inteira à toa — o defeito nem é dele.

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PlanejamentoPage } from "../renderPlanejamentoPage.jsx";

const EMPRESAS = [{ id: "e1", razao: "ALFA LTDA", cnpj: "11111111000111" }];
const ok = (valor) => ({ valor, apurado: true, origem: "medido", motivoAusencia: null });

function payload() {
  return {
    empresa: { id: "e1", razao: "ALFA LTDA", cnpj: "11111111000111" },
    referencia: { competencia: "2026-08", janela: [], janelaRotulo: "08/2025 a 07/2026" },
    campos: {
      receitaAnual: ok(300000),
      rbt12: ok(300000),
      folhaAnual: ok(60000),
      regimeAtual: ok("SIMPLES_NACIONAL"),
      anexo: ok("III"),
      sujeitoFatorR: ok(false),
      aliquotaIss: ok(0.03),
      atividadePresumido: { valor: null, apurado: false, origem: null, motivoAusencia: "Escolha na tela." },
    },
  };
}

function montar(api = {}) {
  const cliente = {
    getDadosPlanejamento: jest.fn(async () => payload()),
    salvarSimulacaoPlanejamento: jest.fn(async () => ({ ok: true, simulacao: { id: "sim-1" } })),
    gerarDocumentoDaSimulacao: jest.fn(async () => ({ ok: true, documento: { id: "doc-1" } })),
    ...api,
  };
  render(<PlanejamentoPage api={cliente} empresas={EMPRESAS} empresa={{ id: "e1" }} onVoltar={() => {}} />);
  return cliente;
}

const botao = () => screen.getByRole("button", { name: /Guardar em Documentos/i });
// ⚠ `getAllByDisplayValue`: receita e RBT12 têm o mesmo valor neste fixture, logo DOIS inputs o
// exibem. Uma consulta singular estoura com "multiple found" e faz parecer defeito o que é o
// prefill funcionando.
const esperarCalculo = () =>
  waitFor(() => expect(screen.getAllByDisplayValue("300.000,00").length).toBeGreaterThan(0));

describe("⚠⚠ o botão só existe onde há onde guardar", () => {
  it("com empresa escolhida, ele está habilitado", async () => {
    montar();
    await esperarCalculo();
    expect(botao()).not.toBeDisabled();
  });

  it("⚠⚠ em SIMULAÇÃO LIVRE ele fica DESABILITADO com o motivo — nunca escondido", async () => {
    // A foto pertence a uma empresa, e os Documentos são dela. Sumir esconderia que a ação existe.
    montar();
    await esperarCalculo();
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: /^Empresa$/ }), { target: { value: "" } });
    });
    // ⚠ Voltar para a simulação livre LIMPA o formulário (a regra que impede o vazamento entre
    // empresas), e sem receita não há resultado nem bloco de ações. A asserção forte é digitar de
    // novo e ver que o botão existe, DESABILITADO — e não que ele sumiu.
    fireEvent.change(screen.getByLabelText(/Receita anual/i), { target: { value: "30000000" } });
    await waitFor(() => expect(botao()).toBeInTheDocument());
    expect(botao()).toBeDisabled();
    expect(botao()).toHaveAttribute("title", expect.stringMatching(/simulação livre não tem onde ser guardada/i));
  });
});

describe("⚠⚠ os DOIS atos, e os desfechos que não podem ser o mesmo", () => {
  it("caminho feliz: salva, gera e diz onde foi parar", async () => {
    const api = montar();
    await esperarCalculo();
    await act(async () => { fireEvent.click(botao()); });
    await waitFor(() => expect(screen.getByText(/Guardado em Documentos/i)).toBeInTheDocument());
    expect(api.salvarSimulacaoPlanejamento).toHaveBeenCalled();
    expect(api.gerarDocumentoDaSimulacao).toHaveBeenCalledWith("e1", "sim-1");
  });

  it("⚠⚠⚠ o PDF falha e a tela DIZ que a simulação foi salva", async () => {
    // É a distinção que este arquivo existe para travar. "Falhou" sozinho mandaria o contador
    // refazer tudo — e a foto está lá.
    montar({
      gerarDocumentoDaSimulacao: jest.fn(async () => ({
        ok: false,
        error: "documento_nao_gerado",
        message: "A simulação foi salva, mas o PDF não pôde ser guardado. Verifique o armazenamento de arquivos.",
      })),
    });
    await esperarCalculo();
    await act(async () => { fireEvent.click(botao()); });
    await waitFor(() => expect(screen.getByText(/A simulação foi salva, mas o PDF/i)).toBeInTheDocument());
  });

  it("⚠ falhando o SALVAR, o PDF nem é tentado", async () => {
    const api = montar({
      salvarSimulacaoPlanejamento: jest.fn(async () => ({ ok: false, message: "Competência deve ser AAAA-MM." })),
    });
    await esperarCalculo();
    await act(async () => { fireEvent.click(botao()); });
    await waitFor(() => expect(screen.getByText(/Competência deve ser AAAA-MM/i)).toBeInTheDocument());
    expect(api.gerarDocumentoDaSimulacao).not.toHaveBeenCalled();
  });

  it("⚠⚠ o que vai para o servidor é O QUE A TELA CALCULOU — entradas E resultado", async () => {
    // A foto tem de guardar o que o contador VIU. Mandar só as entradas faria o servidor recalcular
    // depois, e o número mudaria assim que o RBT12 ou as tabelas mudassem — o PDF deixaria de
    // descrever o que foi entregue.
    const api = montar();
    await esperarCalculo();
    await act(async () => { fireEvent.click(botao()); });
    await waitFor(() => expect(api.salvarSimulacaoPlanejamento).toHaveBeenCalled());
    const [, corpo] = api.salvarSimulacaoPlanejamento.mock.calls[0];
    expect(corpo.entradas).toBeTruthy();
    expect(corpo.resultado).toBeTruthy();
    expect(corpo.competencia).toBe("2026-08");
    // ⚠ A procedência viaja junto: é ela que distingue dois PDFs da mesma empresa no papel.
    expect(corpo.procedencias).toBeTruthy();
  });
});
