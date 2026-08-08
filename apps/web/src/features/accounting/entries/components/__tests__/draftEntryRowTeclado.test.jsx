// A LINHA DE LANÇAMENTO PELO TECLADO — e os dois defeitos que voltam calados.
//
// Esta suíte não testa "o autocomplete funciona". Testa as duas coisas que já quebraram e que
// nenhum outro teste veria:
//
//   1. O DROPDOWN QUE ABRIA SOZINHO. A lista de sugestões era aberta de DENTRO de um `useEffect`,
//      que reage ao valor do campo sem saber quem o escreveu. Abrir a linha em modo edição, ou
//      escolher uma sugestão (o preenchimento é programático), reabria a lista ~300 ms depois —
//      em cima do campo seguinte, que a essa altura já era outro. Quem "consertasse" recolocando
//      um `setOpen(true)` no efeito não quebraria nenhum teste de valor, prévia ou payload.
//
//   2. O ESCAPE QUE FECHAVA A LINHA INTEIRA. As caixas de sugestão vivem dentro do `<tr>` do
//      `DraftEntryRow`, que trata Escape como "sair da linha". Sem `stopPropagation`, fechar o
//      dropdown e perder tudo o que já foi digitado eram a mesma tecla.
//
// Junto vai o contrato de teclado unificado (↑↓ destacam, Enter/Tab confirmam o DESTACADO, Tab sem
// destaque segue para o próximo campo) e o `tabIndex={-1}` que tira as sugestões da tabulação.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { DraftEntryRow } from "../renderAccountingEntriesParts.jsx";

const CONTAS = [
  { codigo: "426", nome: "Pró-labore", tipo: "DESPESA", natureza: "DEVEDORA" },
  { codigo: "4261", nome: "Pró-labore sócio 2", tipo: "DESPESA", natureza: "DEVEDORA" },
  { codigo: "5", nome: "Caixa", tipo: "ATIVO", natureza: "DEVEDORA" },
];

const HISTORICO = {
  id: "h1",
  text: "PAGAMENTO DE PRO-LABORE",
  contaDebito: "426",
  contaCredito: "5",
  scope: "EMPRESA",
};

const ENTRY_EDICAO = {
  id: "e1",
  data: "2026-07-10",
  historico: "PAGAMENTO DE PRO-LABORE",
  tipo: "DESPESA",
  lines: [
    { tipo: "D", conta: "426", valor: 100 },
    { tipo: "C", conta: "5", valor: 100 },
  ],
};

function montar(props = {}) {
  const onSave = jest.fn().mockResolvedValue({ id: "x" });
  const onClose = jest.fn();
  const onGetHistoricosByCode = jest.fn().mockResolvedValue([HISTORICO]);
  const onSearchHistoricos = jest.fn().mockResolvedValue([HISTORICO]);
  render(
    <table><tbody>
      <DraftEntryRow
        accounts={CONTAS}
        onSave={onSave}
        saving={false}
        activeComp="2026-07"
        onClose={onClose}
        onGetHistoricosByCode={onGetHistoricosByCode}
        onSearchHistoricos={onSearchHistoricos}
        {...props}
      />
    </tbody></table>,
  );
  return { onSave, onClose, onGetHistoricosByCode, onSearchHistoricos };
}

// As buscas de sugestão são debounced (300 ms na conta, 250 ms no histórico) e resolvem promessa.
async function deixarAsSugestoesChegarem() {
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

// O rótulo COMPLETO da seção, com o travessão: "fora do plano de contas desta empresa" é o aviso de
// conta inexistente, que aparece na mesma célula e casaria com um `/plano de contas/i` solto.
function listaDeContasVisivel() {
  return screen.queryByText(/Plano de contas —/i) !== null;
}
function listaDeHistoricosVisivel() {
  return screen.queryByText(/Históricos (salvos|do código|com)/i) !== null;
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("o dropdown só abre quando alguém pede", () => {
  it("⚠ NÃO abre sozinho ao montar a linha em modo edição", async () => {
    // A linha de edição nasce com conta e histórico preenchidos. O efeito de busca dispara por
    // causa do VALOR, não de um usuário: antes, 300 ms depois de abrir para editar, dois dropdowns
    // apareciam sem ninguém ter tocado no teclado.
    montar({ mode: "edit", entry: ENTRY_EDICAO });
    await deixarAsSugestoesChegarem();

    expect(listaDeContasVisivel()).toBe(false);
    expect(listaDeHistoricosVisivel()).toBe(false);
  });

  it("⚠ NÃO reabre depois que a sugestão já foi escolhida", async () => {
    // Este é o caso que enlouquecia: escolher a conta fechava a lista, o valor mudava por
    // consequência, o efeito rodava de novo e ~300 ms depois a lista voltava — normalmente já com o
    // foco em outro campo.
    montar();
    const campoD = screen.getByPlaceholderText("D");

    fireEvent.change(campoD, { target: { value: "426" } });
    expect(listaDeContasVisivel()).toBe(true);

    fireEvent.mouseDown(screen.getByText("Pró-labore"));
    expect(listaDeContasVisivel()).toBe(false);

    await deixarAsSugestoesChegarem();
    expect(listaDeContasVisivel()).toBe(false);
    expect(listaDeHistoricosVisivel()).toBe(false);
    expect(campoD.value).toBe("426");
  });

  it("abre quando o contador digita — e o ↓ abre a lista fechada", async () => {
    // O contrapeso dos dois testes acima: fechar demais é tão defeito quanto abrir sozinho.
    montar();
    const campoD = screen.getByPlaceholderText("D");

    fireEvent.change(campoD, { target: { value: "42" } });
    expect(listaDeContasVisivel()).toBe(true);

    fireEvent.keyDown(campoD, { key: "Escape" });
    expect(listaDeContasVisivel()).toBe(false);

    fireEvent.keyDown(campoD, { key: "ArrowDown" });
    expect(listaDeContasVisivel()).toBe(true);
  });
});

describe("a lista fica ancorada no campo", () => {
  it("⚠ acompanha o scroll — `position: fixed` sozinho a deixaria parada sobre outra linha", () => {
    // O dropdown precisa ser `fixed` (a tabela tem overflow e recortaria um `absolute`), mas
    // coordenada fixa é relativa à JANELA: com a lista aberta, rolar a tabela fazia o campo subir e
    // a lista ficar onde estava — em cima de OUTRO lançamento. Quem escolhesse ali preencheria o
    // campo de cima com a sugestão que parecia ser de baixo.
    //
    // jsdom não faz layout, então o retângulo do campo é simulado: o que o teste prova é que a
    // posição da lista é RE-MEDIDA no evento de scroll, e não congelada na abertura.
    const original = Element.prototype.getBoundingClientRect;
    let topoDoCampo = 100;
    Element.prototype.getBoundingClientRect = function retanguloSimulado() {
      return { left: 10, top: topoDoCampo, bottom: topoDoCampo + 20, right: 110, width: 100, height: 20, x: 10, y: topoDoCampo, toJSON() {} };
    };
    try {
      montar();
      fireEvent.change(screen.getByPlaceholderText("D"), { target: { value: "42" } });
      const lista = () => document.querySelector('div[style*="position: fixed"]');
      expect(lista().style.top).toBe("123px"); // 100 + 20 de altura + 3 de folga

      topoDoCampo = 40; // a linha subiu 60px
      act(() => { window.dispatchEvent(new Event("scroll")); });
      expect(lista().style.top).toBe("63px");
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});

describe("Escape fecha a lista antes de fechar a linha", () => {
  it("⚠ com o dropdown do HISTÓRICO aberto, Escape não cancela o lançamento", async () => {
    const { onClose } = montar();
    const campoHist = screen.getByPlaceholderText(/Histórico/i);

    fireEvent.change(campoHist, { target: { value: "pag" } });
    await deixarAsSugestoesChegarem();
    expect(listaDeHistoricosVisivel()).toBe(true);

    fireEvent.keyDown(campoHist, { key: "Escape" });
    expect(listaDeHistoricosVisivel()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    // Sem lista aberta, o Escape volta a ser "sair da linha" — o segundo toque fecha.
    fireEvent.keyDown(campoHist, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("⚠ com o dropdown da CONTA aberto, Escape não cancela o lançamento", () => {
    const { onClose } = montar();
    const campoD = screen.getByPlaceholderText("D");

    fireEvent.change(campoD, { target: { value: "42" } });
    expect(listaDeContasVisivel()).toBe(true);

    fireEvent.keyDown(campoD, { key: "Escape" });
    expect(listaDeContasVisivel()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(campoD, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Tab é do formulário, não da lista", () => {
  it("⚠ nenhuma sugestão entra na ordem de tabulação", async () => {
    // São `<button>`: sem `tabIndex={-1}` o Tab caía DENTRO da lista, e como o handler é
    // `onMouseDown` a sugestão focada não podia ser aceita por tecla nenhuma — beco sem saída.
    montar();
    fireEvent.change(screen.getByPlaceholderText("D"), { target: { value: "42" } });
    await deixarAsSugestoesChegarem();

    const sugestoes = screen.getAllByRole("button").filter((b) => /Pró-labore|PAGAMENTO/.test(b.textContent));
    expect(sugestoes.length).toBeGreaterThan(0);
    sugestoes.forEach((b) => expect(b).toHaveAttribute("tabindex", "-1"));
  });

  it("Tab SEM destaque não escolhe nada por conta própria — só fecha a lista", () => {
    // A decisão explicada no componente: num campo de conta contábil, deixar o Tab confirmar o
    // primeiro palpite troca em silêncio o código digitado. "426" casa por prefixo com "4261".
    montar();
    const campoD = screen.getByPlaceholderText("D");

    fireEvent.change(campoD, { target: { value: "426" } });
    expect(listaDeContasVisivel()).toBe(true);

    fireEvent.keyDown(campoD, { key: "Tab" });
    expect(campoD.value).toBe("426");
    expect(listaDeContasVisivel()).toBe(false);
  });

  it("Tab COM destaque confirma a sugestão destacada", () => {
    montar();
    const campoD = screen.getByPlaceholderText("D");

    fireEvent.change(campoD, { target: { value: "426" } });
    fireEvent.keyDown(campoD, { key: "ArrowDown" }); // destaca "426 · Pró-labore"
    fireEvent.keyDown(campoD, { key: "ArrowDown" }); // destaca "4261 · Pró-labore sócio 2"
    fireEvent.keyDown(campoD, { key: "Tab" });

    expect(campoD.value).toBe("4261");
    expect(listaDeContasVisivel()).toBe(false);
  });

  it("⚠ Enter COM sugestão destacada confirma a sugestão e NÃO navega para o próximo campo", () => {
    // O contrapeso da cadeia de Enter (abaixo): a navegação só pode valer quando o Enter não tem
    // trabalho a fazer na lista. Confirmar a sugestão E pular de campo na mesma tecla levaria o
    // foco embora junto com a escolha, e quem quisesse conferir o que aceitou já estaria noutro
    // campo.
    montar();
    const campoD = screen.getByPlaceholderText("D");
    const campoC = screen.getByPlaceholderText("C");

    fireEvent.change(campoD, { target: { value: "426" } });
    fireEvent.keyDown(campoD, { key: "ArrowDown" });
    fireEvent.keyDown(campoD, { key: "Enter" });

    expect(campoD.value).toBe("426");
    expect(listaDeContasVisivel()).toBe(false);
    expect(document.activeElement).not.toBe(campoC);
  });

  it("Enter com sugestão destacada aplica o histórico e as duas contas", async () => {
    // O caminho que preenche o lançamento inteiro sem mouse: um histórico salvo traz D e C junto.
    montar();
    const campoHist = screen.getByPlaceholderText(/Histórico/i);

    fireEvent.change(campoHist, { target: { value: "pag" } });
    await deixarAsSugestoesChegarem();

    fireEvent.keyDown(campoHist, { key: "ArrowDown" });
    fireEvent.keyDown(campoHist, { key: "Enter" });

    expect(campoHist.value).toBe("PAGAMENTO DE PRO-LABORE");
    expect(screen.getByPlaceholderText("D").value).toBe("426");
    expect(screen.getByPlaceholderText("C").value).toBe("5");
    expect(listaDeHistoricosVisivel()).toBe(false);
  });
});

// A competência de teste ("2026-07") só nasce no dia 1 quando NÃO é o mês corrente
// (`getCompRange` usa o dia de hoje se ele cair dentro da competência). Congelar o relógio é o que
// impede a suíte de contar uma história diferente em julho de 2026.
const RELOGIO = new Date("2026-08-07T12:00:00Z");

describe("o campo do dia não corrige em silêncio", () => {
  it("⚠ nasce preenchido com 1 e SELECIONA o conteúdo ao focar — digitar 15 não pode virar 115", () => {
    // A causa raiz do "115": o campo herda o dia 1 da competência e o cursor caía DEPOIS dele.
    // Selecionar no foco faz o primeiro dígito digitado substituir o que estava lá.
    jest.setSystemTime(RELOGIO);
    montar();
    const dia = screen.getByPlaceholderText("Dia");
    expect(dia.value).toBe("1");

    act(() => { dia.focus(); });
    expect(dia.selectionStart).toBe(0);
    expect(dia.selectionEnd).toBe(1);
  });

  it("⚠ 115 é preso em 31 — e o CAMPO passa a dizer 31, em vez de exibir 115 e guardar 31", () => {
    // Este é o defeito inteiro: `handleDayChange` sempre prendeu o dia no último do mês, mas o
    // texto continuava sendo o que a pessoa digitou. A tela dizia uma coisa, o payload levava
    // outra, e nada na interface apontava a diferença — numa DATA de lançamento contábil.
    jest.setSystemTime(RELOGIO);
    montar();
    const dia = screen.getByPlaceholderText("Dia");

    fireEvent.change(dia, { target: { value: "115" } });
    expect(screen.getByText("→ dia 31")).toBeInTheDocument(); // a correção aparece antes de sair

    fireEvent.blur(dia);
    expect(dia.value).toBe("31"); // e o campo passa a mostrar o que o sistema guardou
  });

  it("dia que coube não ganha aviso nenhum — o sinal só existe quando houve correção", () => {
    jest.setSystemTime(RELOGIO);
    montar();
    const dia = screen.getByPlaceholderText("Dia");

    fireEvent.change(dia, { target: { value: "15" } });
    expect(screen.queryByText(/→ dia/)).toBeNull();

    fireEvent.blur(dia);
    expect(dia.value).toBe("15");
  });
});

describe("o Enter segue a MESMA ordem do Tab", () => {
  it("⚠ Dia → D → C → Histórico → Valor — e não Dia → Histórico → beco sem saída", () => {
    // A ordem visual e de tabulação (`COLS`) sempre foi essa. O Enter ia Dia → Histórico e MORRIA
    // ali, porque o campo de histórico não repassava tecla nenhuma ao formulário: quem lançava
    // pelo Enter ficava preso no meio da linha, quem usava Tab passava.
    jest.setSystemTime(RELOGIO);
    montar();
    const dia = screen.getByPlaceholderText("Dia");
    const campoD = screen.getByPlaceholderText("D");
    const campoC = screen.getByPlaceholderText("C");
    const campoHist = screen.getByPlaceholderText(/Histórico/i);
    const campoValor = screen.getByPlaceholderText(/R\$ 0,00/);

    fireEvent.keyDown(dia, { key: "Enter" });
    expect(document.activeElement).toBe(campoD);

    fireEvent.keyDown(campoD, { key: "Enter" });
    expect(document.activeElement).toBe(campoC);

    fireEvent.keyDown(campoC, { key: "Enter" });
    expect(document.activeElement).toBe(campoHist);

    fireEvent.keyDown(campoHist, { key: "Enter" });
    expect(document.activeElement).toBe(campoValor);
  });

  it("no Histórico com a lista ABERTA e nada destacado, o Enter segue para o Valor", async () => {
    // Sem destaque não há o que confirmar, então vale o fluxo normal do campo — mesma regra que os
    // campos de conta já seguiam. Fechar a lista fica por conta do blur.
    jest.setSystemTime(RELOGIO);
    montar();
    const campoHist = screen.getByPlaceholderText(/Histórico/i);

    fireEvent.change(campoHist, { target: { value: "pag" } });
    await deixarAsSugestoesChegarem();
    expect(listaDeHistoricosVisivel()).toBe(true);

    fireEvent.keyDown(campoHist, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/R\$ 0,00/));
  });
});

describe("no último campo o Enter salva — ou diz por que não salvou", () => {
  function preencherLinha() {
    fireEvent.change(screen.getByPlaceholderText("Dia"), { target: { value: "15" } });
    fireEvent.change(screen.getByPlaceholderText("D"), { target: { value: "426" } });
    fireEvent.change(screen.getByPlaceholderText(/Histórico/i), { target: { value: "PAGAMENTO" } });
    fireEvent.change(screen.getByPlaceholderText(/R\$ 0,00/), { target: { value: "100" } });
  }

  it("linha completa: o Enter no Valor salva o lançamento", async () => {
    jest.setSystemTime(RELOGIO);
    const { onSave } = montar();
    preencherLinha();

    fireEvent.keyDown(screen.getByPlaceholderText(/R\$ 0,00/), { key: "Enter" });
    await act(async () => {});

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ data: "2026-07-15", historico: "PAGAMENTO" });
  });

  it("⚠ linha incompleta: o Enter NÃO falha em silêncio — o motivo aparece na tela", () => {
    // Trocar "Enter não leva a lugar nenhum" por "Enter não faz nada e não diz por quê" seria
    // trocar um defeito por outro. O gate do Salvar virou um MOTIVO justamente para isto.
    jest.setSystemTime(RELOGIO);
    const { onSave } = montar();
    fireEvent.change(screen.getByPlaceholderText(/R\$ 0,00/), { target: { value: "100" } });

    fireEvent.keyDown(screen.getByPlaceholderText(/R\$ 0,00/), { key: "Enter" });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Informe o histórico.")).toBeInTheDocument();
  });

  it("o aviso some sozinho quando o que faltava é preenchido", () => {
    jest.setSystemTime(RELOGIO);
    montar();
    fireEvent.keyDown(screen.getByPlaceholderText(/R\$ 0,00/), { key: "Enter" });
    expect(screen.getByText(/Informe/)).toBeInTheDocument();

    preencherLinha();
    expect(screen.queryByText(/Informe/)).toBeNull();
  });
});
