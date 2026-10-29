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
  it("suspenso não intercepta Escape/Tab nem clique enquanto outro modal está em primeiro plano", () => {
    const aoFechar = jest.fn();
    const { container } = abrir({ aoFechar, suspenso: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container.querySelector(".modal-fundo")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(true);
    fireEvent.click(container.querySelector(".modal-fundo"));
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("formulários podem preservar o preenchimento no clique acidental do fundo", () => {
    const aoFechar = jest.fn();
    const { container } = abrir({ aoFechar, fecharAoClicarFundo: false });
    fireEvent.click(container.querySelector(".modal-fundo"));
    expect(aoFechar).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
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

it('ignora campos desabilitados pelo fieldset no foco inicial e Tab', () => {
  const { container } = abrir({ ocupado: true }, <fieldset disabled><input data-modal-autofocus aria-label="indisponível" /><button>Salvar</button></fieldset>);
  const caixa = container.querySelector('.modal-caixa');
  expect(document.activeElement).toBe(caixa);
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(caixa);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(caixa);
});

it('pode preservar fechamento explícito sem Escape', () => { const fechar=jest.fn(); abrir({aoFechar:fechar,fecharAoEscape:false}); fireEvent.keyDown(document,{key:'Escape'}); expect(fechar).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button',{name:'Fechar'})); expect(fechar).toHaveBeenCalledTimes(1); });

describe('Modal — foco durante gravação e retorno após erro', () => {
  function Conteudo({ ocupado = false, suspenso = false, aoFechar = () => {}, fieldset = false }) {
    return <Modal titulo="Edição" ocupado={ocupado} suspenso={suspenso} aoFechar={aoFechar}
      rodape={fieldset
        ? <fieldset disabled={ocupado}><button>Guardar</button></fieldset>
        : <button disabled={ocupado}>Guardar</button>}>
      <p>{ocupado ? 'Guardando' : 'Confira os dados'}</p>
      {!ocupado && <p role="alert">Falha recuperável</p>}
    </Modal>;
  }

  it.each([false, true])('ação desabilitada transfere foco sem Tab e volta após erro; fieldset=%s', fieldset => {
    const fechar = jest.fn();
    const { container, rerender } = render(<Conteudo fieldset={fieldset} aoFechar={fechar}/>);
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    guardar.focus();
    rerender(<Conteudo fieldset={fieldset} ocupado aoFechar={fechar}/>);
    const caixa = container.querySelector('.modal-caixa');
    expect(document.activeElement).toBe(caixa);
    expect(guardar).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('.modal-fundo'));
    expect(fechar).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(caixa);
    rerender(<Conteudo fieldset={fieldset} aoFechar={fechar}/>);
    expect(document.activeElement).toBe(guardar);
    expect(guardar).not.toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(fechar).not.toHaveBeenCalled();
  });

  it('Fechar removido em ocupado não deixa foco no body nem recupera elemento desconectado', () => {
    const { container, rerender } = render(<Conteudo/>);
    const fechar = screen.getByRole('button', { name: 'Fechar' });
    fechar.focus();
    rerender(<Conteudo ocupado/>);
    const caixa = container.querySelector('.modal-caixa');
    expect(fechar.isConnected).toBe(false);
    expect(document.activeElement).toBe(caixa);
    rerender(<Conteudo/>);
    expect(document.activeElement).toBe(caixa);
    expect(screen.getByRole('button', { name: 'Fechar' })).not.toBe(fechar);
  });

  it('foco perdido para body antes de busy é recuperado sem uma tecla artificial', () => {
    const { container, rerender } = render(<Conteudo/>);
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    guardar.focus();
    // jsdom não reproduz todos os blurs nativos ao desabilitar um controle.
    guardar.blur();
    expect(document.activeElement).toBe(document.body);
    rerender(<Conteudo ocupado/>);
    expect(document.activeElement).toBe(container.querySelector('.modal-caixa'));
  });

  it('não rouba foco de outro controle significativo fora do diálogo', () => {
    const view = ocupado => <><input aria-label="Outra área"/><Conteudo ocupado={ocupado}/></>;
    const { rerender } = render(view(false));
    screen.getByRole('button', { name: 'Guardar' }).focus();
    const externo = screen.getByLabelText('Outra área');externo.focus();
    rerender(view(true));
    expect(document.activeElement).toBe(externo);
    rerender(view(false));
    expect(document.activeElement).toBe(externo);
  });

  it.each([false, true])('confirmação irmã mantém foco com pai suspenso=%s', suspenso => {
    const view = ocupado => <><Conteudo ocupado={ocupado} suspenso={suspenso}/>
      <Modal titulo="Confirmação" aoFechar={() => {}}><input aria-label="Confirmação atual"/></Modal></>;
    const { rerender } = render(view(false));
    const atual = screen.getByLabelText('Confirmação atual');atual.focus();
    rerender(view(true));
    expect(document.activeElement).toBe(atual);
    rerender(view(false));
    expect(document.activeElement).toBe(atual);
  });

  it('campo interno habilitado conserva seu foco durante a gravação', () => {
    const view = ocupado => <Modal titulo="Campo mantido" aoFechar={() => {}} ocupado={ocupado}>
      <input aria-label="Campo habilitado"/>
    </Modal>;
    const { rerender } = render(view(false));
    const input = screen.getByLabelText('Campo habilitado');input.focus();
    rerender(view(true));expect(document.activeElement).toBe(input);
    rerender(view(false));expect(document.activeElement).toBe(input);
  });
});
