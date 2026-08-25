// ⚠⚠ `aria-modal="true"` É UMA AFIRMAÇÃO, E ELA NÃO ESTAVA IMPLEMENTADA.
//
// Os três diálogos deste app declaravam `role="dialog"` + `aria-modal="true"` desde que nasceram, e
// os três mandavam o foco para a caixa. Nenhum PRENDIA o foco: com Tab, quem navega por teclado saía
// do diálogo e ia passear pela página atrás — que continua inteira no DOM, viva e clicável.
//
// ⚠ No `ConfirmarCancelamento` isso não é conforto: dava para acionar o "Cancelar" de OUTRA nota da
// lista com o diálogo de cancelamento aberto por cima.
//
// ⚠⚠ ESTE TESTE É DE LIGAÇÃO, e tinha de ser: a regra sozinha não prova nada, porque o que estava
// errado era ninguém a ter. Ele renderiza os diálogos DE VERDADE, com um botão-isca fora deles.
//
// ⚠ O jsdom NÃO move o foco no Tab — ele não implementa a ordem de tabulação. Por isso as asserções
// são sobre o que o NOSSO handler faz: `preventDefault` (o `fireEvent.keyDown` devolve `false`
// quando o padrão foi cancelado) e para onde ele MANDA o foco. Medir "o Tab andou" aqui seria medir
// uma emulação que não existe — a mesma armadilha que `cliqueDeLink.js` já registra.

import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SeletorEmpresa } from "../../features/shell/SeletorEmpresa";
import { PainelDoDia } from "../../features/painel/PainelDoDia";
import { useDialogoModal } from "../hooks";

const tab = (opcoes = {}) => fireEvent.keyDown(window, { key: "Tab", ...opcoes });

/** Um botão FORA do diálogo, que é para onde o foco vazava. */
function ComIsca({ children }) {
  return (
    <>
      <button type="button">Isca da página atrás</button>
      {children}
    </>
  );
}

function empresas() {
  return [
    { companyId: "pc-001", razao: "ACME SERVICOS LTDA", cnpj: "11222333000181" },
    { companyId: "pc-002", razao: "BETA COMERCIO LTDA", cnpj: "11222333000182" },
  ];
}

function diasDeUmMes() {
  return [
    { dia: "2026-08-01", entradas: 0, saidas: 0, saldo: 0, lancamentos: [] },
    { dia: "2026-08-02", entradas: 100, saidas: 0, saldo: 100, lancamentos: [] },
    { dia: "2026-08-03", entradas: 0, saidas: 50, saldo: 50, lancamentos: [] },
  ];
}

describe("⚠⚠ o foco não sai do diálogo pelo Tab", () => {
  it("SeletorEmpresa — vindo de fora, o Tab traz o foco para DENTRO", () => {
    render(
      <ComIsca>
        <SeletorEmpresa empresas={empresas()} ativaId="pc-001" aoEscolher={() => {}} aoFechar={() => {}} />
      </ComIsca>,
    );

    // O foco começa na caixa (o diálogo o levou para lá ao montar).
    const caixa = document.querySelector(".modal");
    expect(document.activeElement).toBe(caixa);

    expect(tab()).toBe(false); // preventDefault: o handler assumiu
    expect(caixa.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(caixa);
  });

  it("⚠⚠ e o Shift+Tab TAMBÉM não sai — o sentido que quase ninguém testa", () => {
    // Este era o furo real: `contains` inclui o próprio nó, então o foco NA CAIXA cairia fora do
    // ramo de captura e o Shift+Tab voltaria para a página atrás.
    render(
      <ComIsca>
        <SeletorEmpresa empresas={empresas()} ativaId="pc-001" aoEscolher={() => {}} aoFechar={() => {}} />
      </ComIsca>,
    );
    const caixa = document.querySelector(".modal");

    expect(tab({ shiftKey: true })).toBe(false);
    expect(caixa.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.textContent).not.toMatch(/Isca/);
  });

  it("a volta é circular: do ÚLTIMO focável, o Tab vai para o PRIMEIRO", () => {
    render(
      <ComIsca>
        <SeletorEmpresa empresas={empresas()} ativaId="pc-001" aoEscolher={() => {}} aoFechar={() => {}} />
      </ComIsca>,
    );
    const caixa = document.querySelector(".modal");
    const focaveis = [...caixa.querySelectorAll("button, a[href]")].filter((el) => !el.disabled);
    expect(focaveis.length).toBeGreaterThan(1);

    act(() => focaveis[focaveis.length - 1].focus());
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(focaveis[0]);

    act(() => focaveis[0].focus());
    expect(tab({ shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(focaveis[focaveis.length - 1]);
  });

  it("no meio da lista o handler NÃO interfere — o navegador é que tabula", () => {
    render(
      <ComIsca>
        <SeletorEmpresa empresas={empresas()} ativaId="pc-001" aoEscolher={() => {}} aoFechar={() => {}} />
      </ComIsca>,
    );
    const caixa = document.querySelector(".modal");
    const focaveis = [...caixa.querySelectorAll("button, a[href]")].filter((el) => !el.disabled);
    act(() => focaveis[0].focus());
    // Sem `preventDefault`: prender o foco não é conduzi-lo.
    expect(tab()).toBe(true);
  });
});

describe("⚠ PainelDoDia — a lista de focáveis MUDA, e por isso ela é recalculada a cada Tab", () => {
  // Os ‹ › desabilitam nas bordas do mês. Uma lista congelada na montagem mandaria o foco para um
  // botão desabilitado — que não o aceita — e o Tab pareceria morto.
  it("no PRIMEIRO dia, o botão desabilitado fica fora do anel", () => {
    render(<PainelDoDia dias={diasDeUmMes()} indice={0} aoFechar={() => {}} aoIr={() => {}} />);
    const caixa = document.querySelector(".modal");
    const anterior = screen.getByRole("button", { name: /dia anterior/i });
    expect(anterior.disabled).toBe(true);

    act(() => caixa.focus());
    tab();
    expect(document.activeElement).not.toBe(anterior);
    expect(caixa.contains(document.activeElement)).toBe(true);
  });

  it("no ÚLTIMO dia é o 'Próximo dia' que sai do anel", () => {
    render(<PainelDoDia dias={diasDeUmMes()} indice={2} aoFechar={() => {}} aoIr={() => {}} />);
    const caixa = document.querySelector(".modal");
    const proximo = screen.getByRole("button", { name: /pr[óo]ximo dia/i });
    expect(proximo.disabled).toBe(true);

    act(() => caixa.focus());
    tab({ shiftKey: true });
    expect(document.activeElement).not.toBe(proximo);
    expect(caixa.contains(document.activeElement)).toBe(true);
  });
});

describe("⚠ o foco VOLTA para quem abriu o diálogo", () => {
  // Sem isso, fechar devolve o foco ao `<body>` e quem usa teclado recomeça do topo da página.
  function Abridor() {
    const [aberto, setAberto] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setAberto(true)}>Trocar empresa</button>
        {aberto ? (
          <SeletorEmpresa
            empresas={empresas()}
            ativaId="pc-001"
            aoEscolher={() => {}}
            aoFechar={() => setAberto(false)}
          />
        ) : null}
      </>
    );
  }

  it("abre pelo botão, fecha no Esc, e o foco retorna ao botão", () => {
    render(<Abridor />);
    const gatilho = screen.getByRole("button", { name: "Trocar empresa" });
    act(() => gatilho.focus());
    fireEvent.click(gatilho);
    expect(document.querySelector(".modal")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".modal")).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });
});

describe("⚠ `escFecha: false` — o Esc não fecha, mas o foco continua preso", () => {
  // É o estado do `ConfirmarCancelamento` com o pedido em voo: o desfecho pode estar em trânsito, e
  // fechar a caixa esconderia a resposta. ⚠ Isso NÃO afrouxa a prisão do foco.
  function Caixa({ escFecha, aoFechar }) {
    const { caixaRef } = useDialogoModal({ aoFechar, escFecha });
    return (
      <div className="modal" role="dialog" aria-modal="true" tabIndex={-1} ref={caixaRef}>
        <button type="button">Um</button>
        <button type="button">Dois</button>
      </div>
    );
  }

  it("Esc é ignorado e o Tab continua circulando", () => {
    const fechou = jest.fn();
    render(
      <ComIsca>
        <Caixa escFecha={false} aoFechar={fechou} />
      </ComIsca>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(fechou).not.toHaveBeenCalled();

    const caixa = document.querySelector(".modal");
    expect(tab({ shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dois" }));
    expect(caixa.contains(document.activeElement)).toBe(true);
  });

  it("e com `escFecha` ligado ele fecha, como sempre fechou", () => {
    const fechou = jest.fn();
    render(<Caixa escFecha aoFechar={fechou} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(fechou).toHaveBeenCalledTimes(1);
  });
});

describe("⚠ diálogo sem nada focável dentro", () => {
  it("o Tab não sai — o foco fica na caixa, e o Esc continua sendo a saída", () => {
    function Vazia() {
      const { caixaRef } = useDialogoModal({ aoFechar: () => {} });
      return (
        <div className="modal" role="dialog" aria-modal="true" tabIndex={-1} ref={caixaRef}>
          só texto
        </div>
      );
    }
    render(
      <ComIsca>
        <Vazia />
      </ComIsca>,
    );
    const caixa = document.querySelector(".modal");
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(caixa);
  });
});
