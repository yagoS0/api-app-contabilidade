// A LIGAÇÃO do wizard "Novo parcelamento" — a aritmética já é exercida em
// `lib/__tests__/wizardParcelamento.test.js`; aqui o que se prova é que a TELA está ligada nela.
//
// O caso exercido é o aceite literal da fase: um parcelamento MIGRADO (23ª de 60, saldo declarado,
// débito automático) registrado SEM NENHUM PDF.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ParcelamentoWizard } from "../ParcelamentoWizard.jsx";

function montar(over = {}) {
  const onIngest = jest.fn().mockResolvedValue({ ok: true, data: { parcelamentoId: "novo" } });
  const onClose = jest.fn();
  const getContasProvisao = jest.fn().mockResolvedValue({ PRINCIPAL: "265", PARC: "553", JUROS: "501", CAIXA: "111" });
  render(
    <ParcelamentoWizard
      onIngest={onIngest}
      onClose={onClose}
      getContasProvisao={getContasProvisao}
      onConsultSerpro={over.onConsultSerpro}
      accounts={[]}
      onSearchHistoricos={jest.fn().mockResolvedValue([])}
      onGetHistoricosByCode={jest.fn().mockResolvedValue([])}
    />,
  );
  return { onIngest, onClose, getContasProvisao };
}

const digitar = (label, valor) => fireEvent.change(screen.getByLabelText(label), { target: { value: valor } });
const clicar = (nome) => fireEvent.click(screen.getByRole("button", { name: nome }));

async function preencherPasso1() {
  digitar(/Nº do parcelamento/, "1234567");
  digitar(/Data de adesão/, "2024-10-15");
  fireEvent.click(screen.getByRole("radio", { name: /Em andamento/ }));
  await act(async () => { clicar(/Continuar/); });
}

async function preencherPasso2() {
  digitar(/Saldo consolidado atual/, "45600");
  digitar(/Valor da parcela/, "1200");
  digitar(/Total de parcelas/, "60");
  digitar(/Parcelas já pagas/, "22");
  digitar(/Competência da 1ª parcela/, "2024-10");
  digitar(/Vencimento mensal/, "20");
  fireEvent.click(screen.getByRole("radio", { name: /Débito automático/ }));
}

describe("aceite literal — migrado 23ª de 60, débito automático, sem PDF", () => {
  it("percorre os 3 passos e cria o contrato SEM guia", async () => {
    const { onIngest, onClose } = montar();

    await preencherPasso1();
    // O passo 1 fica marcado como concluído (✓) e o 2 vira o atual.
    expect(screen.getByText(/Saldo consolidado atual/)).toBeInTheDocument();

    await preencherPasso2();
    // ⚠ O rodapé recalcula a cada tecla.
    expect(screen.getByText(/O sistema vai gerenciar: 38 parcelas restantes/)).toBeInTheDocument();
    expect(screen.getByText(/22 já pagas/)).toBeInTheDocument();

    await act(async () => { clicar(/Continuar/); });

    // Passo 3: a provisão precisa do valor. As contas vieram da memória da modalidade.
    const valores = screen.getAllByPlaceholderText("0,00");
    fireEvent.change(valores[0], { target: { value: "45600" } });

    await act(async () => { clicar(/Criar parcelamento/); });

    expect(onIngest).toHaveBeenCalledTimes(1);
    const body = onIngest.mock.calls[0][0];
    // ⚠ SEM GUIA — é a entrega.
    expect(body.guideId).toBeNull();
    expect(body.parcelasJaPagas).toBe(22);
    expect(body.header.numeroParcela).toBe(23);
    expect(body.header.quantidadeParcelas).toBe(60);
    expect(body.header.diaPagamento).toBe(20);
    expect(body.header.formaPagamento).toBe("DEBITO_AUTOMATICO");
    expect(body.header.saldoConsolidado).toBe(45600);
    // A competência da 1ª parcela, não a da atual.
    expect(body.header.anoMesParcela).toBe("202410");
    expect(onClose).toHaveBeenCalled();
  });

  it("voltar preserva os dados", async () => {
    montar();
    await preencherPasso1();
    await preencherPasso2();
    await act(async () => { clicar(/Continuar/); });
    await act(async () => { clicar(/Voltar/); });
    expect(screen.getByLabelText(/Total de parcelas/).value).toBe("60");
    expect(screen.getByLabelText(/Parcelas já pagas/).value).toBe("22");
    await act(async () => { clicar(/Voltar/); });
    expect(screen.getByLabelText(/Nº do parcelamento/).value).toBe("1234567");
  });
});

describe("guardas do passo 2", () => {
  it("não avança sem o dia do vencimento, e diz o motivo", async () => {
    montar();
    await preencherPasso1();
    digitar(/Saldo consolidado atual/, "45600");
    digitar(/Valor da parcela/, "1200");
    digitar(/Total de parcelas/, "60");
    digitar(/Parcelas já pagas/, "22");
    digitar(/Competência da 1ª parcela/, "2024-10");
    await act(async () => { clicar(/Continuar/); });
    expect(screen.getByText(/Falta preencher/)).toBeInTheDocument();
    // A mensagem aparece duas vezes de propósito: colada no campo e no resumo do rodapé.
    expect(screen.getAllByText(/Informe o dia do vencimento mensal/i).length).toBeGreaterThan(0);
  });

  it("⚠ divergência saldo × parcelas é ALERTA e deixa continuar", async () => {
    montar();
    await preencherPasso1();
    await preencherPasso2();
    digitar(/Saldo consolidado atual/, "39000");
    expect(screen.getByText(/Juros embutidos/)).toBeInTheDocument();
    await act(async () => { clicar(/Continuar/); });
    // chegou ao passo 3
    expect(screen.getByText(/Provisão da adesão/)).toBeInTheDocument();
  });
});

describe("passo 3", () => {
  it("⚠ D ≠ C bloqueia a criação, com o motivo na tela", async () => {
    const { onIngest } = montar();
    await preencherPasso1();
    await preencherPasso2();
    await act(async () => { clicar(/Continuar/); });

    const valores = screen.getAllByPlaceholderText("0,00");
    fireEvent.change(valores[0], { target: { value: "45600" } });
    // Entra em edição e desbalanceia o crédito à mão.
    await act(async () => { clicar(/Editar lançamentos/); });
    const valoresEdit = screen.getAllByPlaceholderText("0,00");
    fireEvent.change(valoresEdit[1], { target: { value: "1" } });

    await act(async () => { clicar(/Criar parcelamento/); });
    expect(onIngest).not.toHaveBeenCalled();
    expect(screen.getByText(/trava o fechamento do mês/)).toBeInTheDocument();
  });

  it("⚠ NÃO existe checkbox 'salvar como padrão da modalidade' — o texto diz que é global", async () => {
    montar();
    await preencherPasso1();
    await preencherPasso2();
    await act(async () => { clicar(/Continuar/); });
    expect(screen.queryByLabelText(/salvar como padrão/i)).toBeNull();
    expect(screen.getByText(/todas as\s+empresas do escritório/)).toBeInTheDocument();
  });

  it("o bloco de pagamento não tem valores — a coluna diz 'da baixa'", async () => {
    montar();
    await preencherPasso1();
    await preencherPasso2();
    await act(async () => { clicar(/Continuar/); });
    expect(screen.getAllByText("da baixa").length).toBeGreaterThanOrEqual(3);
  });
});

describe("primeira vez de uma modalidade", () => {
  it("sem template, o passo 3 abre em modo EDIÇÃO", async () => {
    const semMemoria = jest.fn().mockResolvedValue({ PRINCIPAL: "", PARC: "" });
    render(
      <ParcelamentoWizard
        onIngest={jest.fn()}
        onClose={jest.fn()}
        getContasProvisao={semMemoria}
        accounts={[]}
        onSearchHistoricos={jest.fn().mockResolvedValue([])}
        onGetHistoricosByCode={jest.fn().mockResolvedValue([])}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    await preencherPasso1();
    await preencherPasso2();
    await act(async () => { clicar(/Continuar/); });
    expect(screen.getByRole("button", { name: /Concluir edição/ })).toBeInTheDocument();
    expect(screen.getByText(/primeira vez/i)).toBeInTheDocument();
  });
});

describe("⚠ fechar com dados preenchidos NOMEIA o que se perde", () => {
  it("a confirmação repete os dados, e 'Continuar preenchendo' não fecha", async () => {
    const { onClose } = montar();
    await preencherPasso1();
    await preencherPasso2();

    await act(async () => { clicar(/^Cancelar$/); });
    expect(screen.getByText(/Descartar este parcelamento\?/)).toBeInTheDocument();
    expect(screen.getByText(/nº do parcelamento 1234567/)).toBeInTheDocument();
    expect(screen.getByText(/60 parcelas/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { clicar(/Continuar preenchendo/); });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { clicar(/^Cancelar$/); });
    await act(async () => { clicar(/Descartar/); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wizard vazio fecha direto — não há o que confirmar", async () => {
    const { onClose } = montar();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { clicar(/^Cancelar$/); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("⚠ o atalho do SERPRO é caminho de FALHA ESPERADA", () => {
  it("flag desligada devolve 400 e o MOTIVO fica na tela, sem travar o wizard", async () => {
    const erro = new Error("Integração SERPRO de parcelamento está desligada");
    erro.error = "SERPRO_PARC_FLAG_OFF";
    montar({ onConsultSerpro: jest.fn().mockRejectedValue(erro) });

    digitar(/Nº do parcelamento/, "1234567");
    await act(async () => { clicar(/Consultar no SERPRO/); });

    expect(screen.getByText(/Consulta não realizada/)).toBeInTheDocument();
    expect(screen.getByText(/está desligada neste ambiente/)).toBeInTheDocument();
    // e o wizard segue utilizável
    expect(screen.getByLabelText(/Nº do parcelamento/).value).toBe("1234567");
  });

  it("sem nº do parcelamento, a consulta nem sai — e diz por quê", async () => {
    const onConsultSerpro = jest.fn();
    montar({ onConsultSerpro });
    await act(async () => { clicar(/Consultar no SERPRO/); });
    expect(onConsultSerpro).not.toHaveBeenCalled();
    expect(screen.getByText(/Informe o nº do parcelamento/)).toBeInTheDocument();
  });
});
