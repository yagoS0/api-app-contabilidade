// O ESCAPE QUE FECHARIA O MODAL E LEVARIA O FORMULÁRIO JUNTO.
//
// ⚠ LEIA ANTES DE "CONSERTAR" O `useEscapeToClose`.
//
// Estes modais são formulários longos (linhas de provisão, config de pagamento, descrição das
// competências parceladas) e o Escape fecha o modal de propósito — a saída por clique no backdrop
// foi removida justamente porque perdia o preenchimento sem confirmação. Dentro deles vivem os
// campos de conta (`AccountCodeInput`), que têm o SEU Escape: fechar o dropdown de sugestões.
//
// As duas coisas convivem porque o campo faz `stopPropagation` no Escape que ele trata, e o
// listener do modal está no `window` — ACIMA da raiz do React, onde o React 17+ delega os eventos.
// Foi levantada a suspeita de que o `stopPropagation` do React não alcançaria esse listener; ela
// não se confirmou (verificado em jsdom e em Chrome real): o React chama
// `nativeEvent.stopPropagation()` enquanto o evento ainda está subindo, na raiz, e a propagação
// morre antes de `document` e `window`.
//
// Ou seja: este teste NÃO acompanha uma correção. Ele existe porque o comportamento certo aqui
// depende de um detalhe que ninguém enxerga lendo o código dos dois lados separadamente, e o
// defeito que ele impede é MUDO — some um formulário inteiro, sem erro no console, e só quem
// estava preenchendo percebe. Duas mudanças plausíveis o reintroduzem: tirar o `stopPropagation`
// do campo de conta, ou mover o listener do modal para a fase de CAPTURA (onde ele rodaria antes
// do React e nenhum `stopPropagation` o alcançaria).
//
// ⚠ O SUJEITO MUDOU (F2.3), O CONTRATO NÃO. O teste montava o `ParcelamentoIngestaoModal` — o
// modal-surpresa "Registrar 1ª parcela", removido junto com o desenho guia-first. Ele agora monta
// o `ParcelamentoConfigModal`, que é o outro modal longo com `AccountCodeInput` e o mesmo
// `useEscapeToClose`. O que se exercita é idêntico: Escape fecha o que estiver aberto POR DENTRO
// primeiro (o dropdown); só com nada aberto por dentro é que fecha o modal.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ParcelamentoConfigModal } from "../ParcelamentoModals.jsx";

const CONTAS = [
  { codigo: "426", nome: "Pró-labore", tipo: "DESPESA", natureza: "DEVEDORA" },
  { codigo: "4261", nome: "Pró-labore sócio 2", tipo: "DESPESA", natureza: "DEVEDORA" },
];

const DESCRICAO = "Ex.: DAS de SET/OUT/NOV/2024 e MAR..NOV/2025";

async function montar() {
  const onClose = jest.fn();
  render(
    <ParcelamentoConfigModal
      parcId="parc-1"
      label="PARCSN Nº 1234567"
      getConfig={jest.fn().mockResolvedValue({ configProvisao: null, configPagamento: null, observacoes: "" })}
      saveConfig={jest.fn().mockResolvedValue({ ok: true })}
      onClose={onClose}
      accounts={CONTAS}
      onSearchHistoricos={jest.fn().mockResolvedValue([])}
      onGetHistoricosByCode={jest.fn().mockResolvedValue([])}
    />,
  );
  // `getConfig` é assíncrono — sem isto o modal ainda está em "Carregando…".
  await act(async () => { await Promise.resolve(); });
  return { onClose };
}

// A busca de histórico do campo de conta é debounced (300 ms) e resolve promessa.
async function deixarAsSugestoesChegarem() {
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

const listaDeContasVisivel = () => screen.queryByText(/Plano de contas —/i) !== null;

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("Escape fecha a lista de sugestões antes de fechar o modal", () => {
  it("⚠ com o dropdown de conta aberto, Escape NÃO fecha o modal nem perde o formulário", async () => {
    const { onClose } = await montar();

    // Preenche um campo do formulário — é o que se perderia.
    const descricao = screen.getByPlaceholderText(DESCRICAO);
    fireEvent.change(descricao, { target: { value: "DAS de SET/2024" } });

    // Abre o dropdown na 1ª linha da provisão.
    const conta = screen.getAllByPlaceholderText("—")[0];
    fireEvent.change(conta, { target: { value: "426" } });
    await deixarAsSugestoesChegarem();
    expect(listaDeContasVisivel()).toBe(true);

    fireEvent.keyDown(conta, { key: "Escape" });

    expect(listaDeContasVisivel()).toBe(false); // fechou o que estava aberto por dentro
    expect(onClose).not.toHaveBeenCalled(); // e SÓ isso
    expect(screen.getByPlaceholderText(DESCRICAO).value).toBe("DAS de SET/2024"); // formulário intacto
  });

  it("sem nada aberto por dentro, o Escape volta a ser 'fechar o modal'", async () => {
    const { onClose } = await montar();
    const conta = screen.getAllByPlaceholderText("—")[0];

    fireEvent.change(conta, { target: { value: "426" } });
    await deixarAsSugestoesChegarem();
    fireEvent.keyDown(conta, { key: "Escape" }); // 1º: fecha a lista
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(conta, { key: "Escape" }); // 2º: fecha o modal
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape num campo comum (sem dropdown) fecha o modal — o atalho continua existindo", async () => {
    const { onClose } = await montar();
    fireEvent.keyDown(screen.getByPlaceholderText(DESCRICAO), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
