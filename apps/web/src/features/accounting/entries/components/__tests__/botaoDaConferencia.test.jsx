// ⚠⚠ O BOTÃO DA CONFERÊNCIA NA BARRA DE LANÇAMENTOS (29/08/2026).
//
// > Dono: *"essas saídas que o cliente digitar aparecem para o contador na aba de conferência, aba
// > essa que deve estar dentro dos lançamentos, como um botão com aviso quando há conferência a ser
// > feita, como notas recebidas"*.
//
// ⚠⚠ O que este arquivo protege é o NÚMERO. A Conferência tem TRÊS filas, e um selo que contasse só
// a primeira faria o contador **nunca ver o que o cliente digitou** no fluxo dele — que é
// exatamente o que o pedido existe para resolver.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BotaoDaConferencia } from "../renderAccountingEntriesTab";

const cheio = { ok: true, total: 6, declarados: 3, series: 1, saidas: 2, indisponiveis: [] };

const botao = () => screen.getByRole("button", { name: /Conferência/ });

describe("⚠⚠ o número soma AS TRÊS filas", () => {
  it("o selo mostra o TOTAL, não a fila dos declarados", () => {
    render(<BotaoDaConferencia pendencias={cheio} onOpenConferencia={jest.fn()} />);
    expect(botao()).toHaveAttribute("data-pendencias", "6");
    expect(botao().textContent).toMatch(/6/);
    // ⚠ 3 é a fila dos declarados. Se o selo mostrasse 3, as saídas do cliente estariam invisíveis.
    expect(botao().textContent).not.toMatch(/\b3\b/);
  });

  it("⚠ e o `title` nomeia as três, porque elas pedem trabalhos diferentes", () => {
    render(<BotaoDaConferencia pendencias={cheio} onOpenConferencia={jest.fn()} />);
    const t = botao().getAttribute("title");
    expect(t).toMatch(/3 lançamento\(s\) declarado\(s\)/);
    expect(t).toMatch(/1 recorrência\(s\)/);
    expect(t).toMatch(/2 saída\(s\) do cliente/);
  });

  it("⚠⚠ só as saídas do cliente pendentes já acendem o selo", () => {
    // É o caso do pedido: o cliente escreveu, e o contador precisa ver.
    render(<BotaoDaConferencia
      pendencias={{ total: 2, declarados: 0, series: 0, saidas: 2 }}
      onOpenConferencia={jest.fn()}
    />);
    expect(botao().textContent).toMatch(/2/);
  });
});

describe("⚠⚠ âmbar SÓ quando há o que conferir", () => {
  it("com fila zerada o botão FICA, sem selo", () => {
    // ⚠ Âmbar permanente treina o olho a ignorar a cor que significa "falta fazer" — a mesma regra
    // que o chip de guia já segue nesta casa.
    render(<BotaoDaConferencia
      pendencias={{ total: 0, declarados: 0, series: 0, saidas: 0 }}
      onOpenConferencia={jest.fn()}
    />);
    expect(botao()).toBeInTheDocument();
    expect(botao().querySelector("span")).toBeNull();
    expect(botao().getAttribute("title")).toMatch(/fila de conferência/i);
  });

  it("⚠⚠ SEM contagem (falha de rede) o botão também fica, e sem selo", () => {
    // Esconder o botão esconderia que a tela existe; um selo por erro de rede seria aviso falso.
    render(<BotaoDaConferencia pendencias={null} onOpenConferencia={jest.fn()} />);
    expect(botao()).toBeInTheDocument();
    expect(botao().querySelector("span")).toBeNull();
    expect(botao().getAttribute("data-pendencias")).toBeNull();
  });

  it("⚠⚠ a guarda é por TIPO, não por verdade — `Number(null)` é 0 e 0 é finito", () => {
    // Contagem AUSENTE e contagem ZERO dão no mesmo desenho, por caminhos diferentes: uma não sabe,
    // a outra sabe que não há nada. O `data-pendencias` distingue as duas no DOM.
    render(<BotaoDaConferencia pendencias={{ total: 0 }} onOpenConferencia={jest.fn()} />);
    expect(botao()).toHaveAttribute("data-pendencias", "0");
  });
});

describe("⚠ a porta", () => {
  it("clicar leva para a Conferência", () => {
    const abrir = jest.fn();
    render(<BotaoDaConferencia pendencias={cheio} onOpenConferencia={abrir} />);
    fireEvent.click(botao());
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ SEM handler ele NÃO renderiza — botão que não responde é pior que ausência", () => {
    // É a mesma regra do seletor de competência do portal do cliente: prop esquecida vira algo
    // visível (a ausência do botão), nunca um controle morto.
    const { container } = render(<BotaoDaConferencia pendencias={cheio} />);
    expect(container.innerHTML).toBe("");
  });
});
