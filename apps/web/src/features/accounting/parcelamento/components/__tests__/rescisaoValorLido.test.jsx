// ⚠ O ATO MAIS CARO DO MÓDULO LIA "12.000" COMO R$ 12,00 — E O BOTÃO LIBERAVA.
//
// `ParcelamentoRescisaoModal` tinha um parser próprio, escrito na linha 231:
//
//     const num = (v) => { const n = Number(String(v).replace(",", ".")); return ... : 0; };
//
// Digitando o saldo real de um contrato (`12.000` / `10.000` / `2.000`), o rodapé mostrava
// "Σ Débito 12,00 · Σ Crédito 12,00 ✓" e a confirmação dizia "R$ 12,00". `6.900,00` lia ZERO.
//
// ⚠ AS DUAS GUARDAS DO MODAL NÃO PEGAVAM NADA, e é por isso que ia até o razão: Σ D = Σ C erra na
// MESMA proporção, e o piso `Σ D < 0,01` é satisfeito por doze reais. O servidor não re-deriva
// (`ParcelamentoService`), a rescisão manda o saldo para a Dívida Ativa da União, e o app não a
// desfaz.
//
// A ARITMÉTICA da leitura está em `lib/__tests__/rescisaoParcelamento.test.js` (com o experimento
// inverso). Este arquivo cobre só a LIGAÇÃO — a convenção do módulo: prévia na tela, gate do botão,
// e o número que sobe no payload.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ParcelamentoRescisaoModal } from "../ParcelamentoModals.jsx";

/** Contrato SEM `saldoContratual` — os campos abrem vazios (a recusa da fase anterior). */
const PARC = { id: "parc-1", label: "PARCSN Nº 1234567", saldoContratual: null, saldoPassivo: null };

const campo = (papel) => screen.getByLabelText(`Valor — ${papel}`);
const PARC_PASSIVO = "Parcelamento a pagar (passivo)";

async function montar(over = {}) {
  const onConfirm = jest.fn().mockResolvedValue({ ok: true });
  render(
    <ParcelamentoRescisaoModal
      parc={PARC}
      getConfig={jest.fn().mockResolvedValue({ configProvisao: null })}
      onConfirm={onConfirm}
      onClose={jest.fn()}
      accounts={[]}
      onSearchHistoricos={jest.fn().mockResolvedValue([])}
      onGetHistoricosByCode={jest.fn().mockResolvedValue([])}
      {...over}
    />,
  );
  await act(async () => { await Promise.resolve(); });
  return { onConfirm };
}

const digitar = (papel, texto) => fireEvent.change(campo(papel), { target: { value: texto } });

function preencherOSaldoReal() {
  digitar(PARC_PASSIVO, "12.000");
  digitar("Principal", "10.000");
  digitar("Juros", "2.000");
}

describe("⚠ a prévia diz COMO o app leu, antes do clique", () => {
  it("`12.000` aparece como 12.000,00 — nunca 12,00", async () => {
    await montar();
    digitar(PARC_PASSIVO, "12.000");
    expect(screen.getByTestId("rescisao-previa-0")).toHaveTextContent("= 12.000,00");
    expect(screen.getByTestId("rescisao-previa-0")).not.toHaveTextContent("= 12,00");
  });

  it("`6.900,00` — que o parser antigo lia como ZERO — aparece como 6.900,00", async () => {
    await montar();
    digitar(PARC_PASSIVO, "6.900,00");
    expect(screen.getByTestId("rescisao-previa-0")).toHaveTextContent("= 6.900,00");
  });

  it("campo em branco não mostra prévia nenhuma — vazio é o estado inicial, não erro", async () => {
    await montar();
    expect(screen.queryByTestId("rescisao-previa-0")).not.toBeInTheDocument();
  });

  it("valor ilegível mostra o motivo no lugar do número", async () => {
    await montar();
    digitar(PARC_PASSIVO, "1,234.56");   // en-US colado de planilha
    expect(screen.getByTestId("rescisao-previa-0")).toHaveTextContent(/vírgula ou o ponto/i);
  });
});

describe("⚠ o rodapé deixou de carimbar ✓ sobre uma soma incompleta", () => {
  it("o Σ Débito é o valor LIDO, e o lote do incidente soma 12.000,00", async () => {
    await montar();
    preencherOSaldoReal();
    expect(screen.getByText(/Σ Débito/)).toHaveTextContent("12.000,00");
    expect(screen.getByText(/Σ Débito/)).toHaveTextContent("✓");
  });

  it("com campo ilegível o rodapé diz que a soma está incompleta, sem ✓", async () => {
    await montar();
    preencherOSaldoReal();
    digitar("Juros", "1.23.4");
    const rodape = screen.getByText(/Σ Débito/);
    expect(rodape).toHaveTextContent(/ilegível/i);
    expect(rodape).not.toHaveTextContent("✓");
  });
});

describe("⚠ o gate do botão", () => {
  const botao = () => screen.getByRole("button", { name: /Rescindir e lançar/i });

  it("valor ilegível BLOQUEIA — antes ele virava 0 em silêncio", async () => {
    await montar();
    preencherOSaldoReal();
    expect(botao()).toBeEnabled();
    digitar("Juros", "abc");
    expect(botao()).toBeDisabled();
    expect(botao()).toHaveAttribute("title", expect.stringMatching(/não dá para ler/i));
  });

  // As duas guardas que já existiam continuam exatamente como estavam.
  it("rescisão zerada continua recusada", async () => {
    await montar();
    expect(botao()).toBeDisabled();
    expect(botao()).toHaveAttribute("title", expect.stringMatching(/sem valor/i));
  });

  it("D ≠ C continua recusado", async () => {
    await montar();
    digitar(PARC_PASSIVO, "12.000");
    digitar("Principal", "10.000");
    expect(botao()).toBeDisabled();
    expect(botao()).toHaveAttribute("title", expect.stringMatching(/Σ Débito ≠ Σ Crédito/i));
  });
});

describe("⚠ o número que SOBE — o servidor não re-deriva nada, grava o que recebe", () => {
  it("a confirmação repete DOZE MIL, e é isso que vai no payload", async () => {
    const { onConfirm } = await montar();
    preencherOSaldoReal();

    fireEvent.click(screen.getByRole("button", { name: /Rescindir e lançar/i }));

    // 2ª etapa: a confirmação repete os dados sobre os quais o ato irreversível sai.
    expect(screen.getByText(/Serão gravados/)).toHaveTextContent("12.000,00");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirmar rescisão/i }));
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const { rescisaoLines } = onConfirm.mock.calls[0][0];
    expect(rescisaoLines.map((l) => l.valor)).toEqual([12000, 10000, 2000]);
    // ⚠ A FORMA DO LANÇAMENTO NÃO MUDOU: os mesmos três papéis, nos mesmos lados.
    expect(rescisaoLines.map((l) => `${l.tipo}:${l.tipoLinha}`))
      .toEqual(["D:PARC", "C:PRINCIPAL", "C:JUROS"]);
  });

  // ⚠ O índice de `leituras` é o da linha na TELA. Filtrar antes de mapear faria cada linha herdar
  // o valor de outra — e a rescisão iria ao razão com os números trocados, balanceada.
  it("linha vazia sai do payload sem deslocar o valor das outras", async () => {
    const { onConfirm } = await montar();
    preencherOSaldoReal();
    fireEvent.click(screen.getByTitle("Adicionar linha"));  // linha 4, vazia
    fireEvent.click(screen.getByRole("button", { name: /Rescindir e lançar/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirmar rescisão/i }));
      await Promise.resolve();
    });
    const { rescisaoLines } = onConfirm.mock.calls[0][0];
    expect(rescisaoLines).toHaveLength(3);
    expect(rescisaoLines.map((l) => l.valor)).toEqual([12000, 10000, 2000]);
  });
});
