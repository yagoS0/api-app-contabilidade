// O `Modal` entrou sem um teste sequer — e ele é justamente o primitivo que concentra as três
// coisas que ninguém confere no olho: para onde vai o foco, para onde ele VOLTA, e o que o Tab faz.
//
// Os dois primeiros casos deste arquivo nasceram de defeitos reais achados na revisão, não de
// hipótese:
//
//   1. o foco inicial ia para o ✕ (primeiro focável em ordem de documento, porque `.modal-topo`
//      vem antes de `.modal-corpo`), e com isso ele SOBRESCREVIA o `autoFocus` que o conteúdo
//      declarava. No modal "Qual documento é este?" o foco caía no botão que DESCARTA a fila de
//      arquivos arrastados;
//   2. o trap de Tab devolvia sem fazer nada quando não havia focável nenhum — que é exatamente o
//      estado de `ocupado` (o ✕ some, os botões do rodapé ficam `disabled`). O teclado escapava
//      para a página atrás do overlay no único momento em que o diálogo diz que está travado.

import { useRef, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "../Modal.jsx";

function abrir(props = {}, corpo = null) {
  return render(
    <Modal titulo="Um diálogo" aoFechar={() => {}} {...props}>
      {corpo}
    </Modal>,
  );
}

describe("Modal — o foco entra no CORPO, nunca no ✕", () => {
  it("⚠ respeita o `autoFocus` do conteúdo", () => {
    abrir({}, <input autoFocus aria-label="campo" />);
    expect(document.activeElement).toBe(screen.getByLabelText("campo"));
  });

  it("sem `autoFocus`, vai para o primeiro focável do corpo — não para o botão Fechar", () => {
    abrir({}, (
      <>
        <button type="button">primeiro do corpo</button>
        <button type="button">segundo</button>
      </>
    ));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "primeiro do corpo" }));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Fechar" }));
  });

  it("corpo sem nada focável cai na própria caixa — nunca fora do diálogo", () => {
    const { container } = abrir({}, <p>só texto</p>);
    // Com corpo inerte o ✕ é o único focável, e ele serve: o foco continua DENTRO.
    expect(container.querySelector(".modal-caixa").contains(document.activeElement)).toBe(true);
  });
});

describe("Modal — as três saídas", () => {
  it("Esc fecha", () => {
    const aoFechar = jest.fn();
    abrir({ aoFechar });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("clique no FUNDO fecha; clique dentro da caixa não", () => {
    const aoFechar = jest.fn();
    const { container } = abrir({ aoFechar });
    fireEvent.click(container.querySelector(".modal-caixa"));
    expect(aoFechar).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector(".modal-fundo"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("⚠ `ocupado` desliga as TRÊS de uma vez — e o ✕ some, em vez de virar botão morto", () => {
    const aoFechar = jest.fn();
    const { container } = abrir({ aoFechar, ocupado: true });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.querySelector(".modal-fundo"));
    expect(aoFechar).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
  });
});

describe("Modal — o Tab não escapa, nem quando não há o que focar", () => {
  it("⚠⚠ com ZERO focáveis (o estado de `ocupado`), o Tab é engolido e o foco fica na caixa", () => {
    const { container } = render(
      <Modal titulo="Gravando" aoFechar={() => {}} ocupado rodape={<button type="button" disabled>Salvando…</button>}>
        <p>sem nada focável aqui</p>
      </Modal>,
    );
    const caixa = container.querySelector(".modal-caixa");
    expect(caixa.querySelectorAll("button:not([disabled]), input:not([disabled]), a[href]")).toHaveLength(0);

    const evento = fireEvent.keyDown(document, { key: "Tab" });
    // `fireEvent` devolve `false` quando algum handler chamou `preventDefault`.
    expect(evento).toBe(false);
    expect(document.activeElement).toBe(caixa);
  });

  it("com focáveis, o Tab circula do último para o primeiro", () => {
    render(
      <Modal titulo="Dois botões" aoFechar={() => {}} rodape={<button type="button">último</button>}>
        <button type="button">primeiro</button>
      </Modal>,
    );
    screen.getByRole("button", { name: "último" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fechar" }));
  });
});

describe("Modal — o foco VOLTA para quem abriu", () => {
  function Palco() {
    const [aberto, setAberto] = useState(false);
    const botaoRef = useRef(null);
    return (
      <>
        <button type="button" ref={botaoRef} onClick={() => setAberto(true)}>Abrir</button>
        {aberto ? (
          <Modal titulo="Diálogo" aoFechar={() => setAberto(false)}>
            <button type="button">dentro</button>
          </Modal>
        ) : null}
      </>
    );
  }

  it("⚠ fechar devolve o foco ao gatilho — senão a próxima tecla não tem para onde ir", () => {
    render(<Palco />);
    const gatilho = screen.getByRole("button", { name: "Abrir" });
    gatilho.focus();
    fireEvent.click(gatilho);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "dentro" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(gatilho);
  });
});

describe("Modal — tamanho", () => {
  it.each([["sm", 460], ["md", 640], ["lg", 900]])("`%s` vale %ipx", (tamanho, px) => {
    const { container } = abrir({ tamanho });
    expect(container.querySelector(".modal-caixa").style.maxWidth).toBe(`${px}px`);
  });

  it("⚠ tamanho inválido cai em `md`, NUNCA em `lg` — diálogo maior que o necessário come a tela", () => {
    const { container } = abrir({ tamanho: "gigante" });
    expect(container.querySelector(".modal-caixa").style.maxWidth).toBe("640px");
  });
});
