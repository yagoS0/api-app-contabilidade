// O BOTÃO "BUSCAR NF-e" PARA DE PROMETER O QUE A SEFAZ NÃO DÁ.
//
// A NT 2014.002 permite UMA consulta por CNPJ por hora na distribuição DFe. Como a captura
// automática já consulta toda empresa de hora em hora, a janela quase sempre está fechada — e o
// clique, mesmo sendo o PRIMEIRO do dia, devolvia `cStat=656` e bloqueava a empresa por 1 hora.
//
// ⚠ Desabilitar e pronto deixaria o botão cinza para sempre, sem explicação — e o contador acharia
// que o sistema quebrou (ou que a culpa é dele). O que a tela precisa dizer é que o SISTEMA já
// consulta sozinho, com as horas. E o botão fica VISÍVEL: botão que some esconde que a ação existe.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DfeCapturePanel } from "../DfeCapturePanel";

const agora = new Date("2026-08-23T13:20:00-03:00");
const ultima = new Date("2026-08-23T13:05:00-03:00");
const proxima = new Date("2026-08-23T14:05:00-03:00");

function montar(dfeState) {
  render(
    <DfeCapturePanel dfeState={dfeState} dfeSyncing={false} onSync={jest.fn()} onClearError={jest.fn()} />
  );
  return screen.getByRole("button", { name: /Buscar NF-e/i });
}

describe("janela da SEFAZ na aba Notas Fiscais", () => {
  it("dentro da janela: o botão continua VISÍVEL, desabilitado, e o motivo está no title", () => {
    const botao = montar({
      podeConsultarAgora: false,
      ultimaConsultaEm: ultima.toISOString(),
      proximaConsultaEm: proxima.toISOString(),
      intervaloConsultaMin: 60,
    });

    expect(botao).toBeInTheDocument();
    expect(botao).toBeDisabled();
    // ⚠ O texto tem de dizer que quem consome a janela é o NOSSO sistema — não o contador. Na
    // Situação Fiscal a janela é NOSSA (4 h, chamada paga); aqui é da SEFAZ e quem a gasta é o
    // worker. Sem isso o contador procura culpado (foi o que a mensagem antiga do 656 causou).
    expect(botao.getAttribute("title")).toMatch(/já consulta esta empresa automaticamente/i);
    expect(botao.getAttribute("title")).toMatch(/SEFAZ permite 1 consulta por CNPJ por hora/i);
  });

  it("dentro da janela: a tela mostra a última e a próxima consulta, com hora", () => {
    montar({
      podeConsultarAgora: false,
      ultimaConsultaEm: ultima.toISOString(),
      proximaConsultaEm: proxima.toISOString(),
    });

    const aviso = screen.getByText(/Captura automática ativa/i);
    expect(aviso.textContent).toContain(ultima.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    expect(aviso.textContent).toContain(proxima.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  });

  it("fora da janela: o botão volta a funcionar e o aviso some", () => {
    const botao = montar({
      podeConsultarAgora: true,
      ultimaConsultaEm: new Date(agora.getTime() - 90 * 60000).toISOString(),
      proximaConsultaEm: new Date(agora.getTime() - 30 * 60000).toISOString(),
    });

    expect(botao).toBeEnabled();
    expect(screen.queryByText(/Captura automática ativa/i)).not.toBeInTheDocument();
  });

  it("estado ainda não carregado NÃO vira bloqueio — quem recusa de verdade é o serviço, com o motivo nomeado", () => {
    expect(montar(null)).toBeEnabled();
  });

  it("backoff após erro continua desabilitando (e não é confundido com a janela)", () => {
    const botao = montar({
      dfeBackoffUntil: new Date(Date.now() + 30 * 60000).toISOString(),
      podeConsultarAgora: true,
    });

    expect(botao).toBeDisabled();
    expect(screen.queryByText(/Captura automática ativa/i)).not.toBeInTheDocument();
  });
});
