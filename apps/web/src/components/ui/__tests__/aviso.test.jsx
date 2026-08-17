// A trava do `Aviso`: tom inválido cai em `neutro`, NUNCA em `ok`.
//
// O `Button` tem uma trava do tipo oposto (variante inválida cai em `primary`, de propósito, para
// que ninguém ressuscite o botão verde). Aqui a direção se inverte, e a razão é outra: no `Button`
// o pior caso é estético; no `Aviso` o pior caso é a caixa CONCLUIR o que não foi feito.
//
// Este projeto já pagou duas vezes por um ✓ verde afirmando demais — o "✓ Nenhuma pendência
// aberta" da aba Apuração e o "✓ Confere (R$ 0,00)" do modal de Fechamento com folha 0 × 0. Verde
// é conclusão: só sai quando quem chama pediu verde com todas as letras.

import { render, screen } from "@testing-library/react";
import { Aviso, TONS_VALIDOS, tomDoAviso } from "../Aviso.jsx";

describe("tomDoAviso — a trava", () => {
  it.each(TONS_VALIDOS)("mantém o tom válido %s", (tom) => {
    expect(tomDoAviso(tom)).toBe(tom);
  });

  it.each([undefined, null, "", "sucesso", "success", "verde", "ok!", "OK", 0, {}])(
    "⚠ tom inválido (%p) cai em `neutro`, nunca em `ok`",
    (tom) => {
      expect(tomDoAviso(tom)).toBe("neutro");
    },
  );

  it("⚠ `ok` NÃO é alcançável por acidente — só pedindo exatamente `ok`", () => {
    const alcancamOk = [undefined, null, "", "sucesso", "success", "verde", "OK", "Ok", "confere"]
      .filter((t) => tomDoAviso(t) === "ok");
    expect(alcancamOk).toEqual([]);
  });

  it("não herda do protótipo — `toString` não é um tom", () => {
    expect(tomDoAviso("toString")).toBe("neutro");
    expect(tomDoAviso("constructor")).toBe("neutro");
  });
});

describe("Aviso — o título é o que distingue duas caixas do mesmo tom", () => {
  it("renderiza título e corpo", () => {
    render(<Aviso tom="atencao" titulo="Risco de Anexo V">a folha está zerada</Aviso>);
    expect(screen.getByText("Risco de Anexo V")).toBeInTheDocument();
    expect(screen.getByText("a folha está zerada")).toBeInTheDocument();
  });

  it("⚠ duas caixas do MESMO tom continuam distinguíveis pelo título", () => {
    // Era exatamente este o defeito: dois blocos âmbar com os mesmos rgba/hex/tamanho, colados,
    // sem nada que dissesse qual era qual.
    render(
      <>
        <Aviso tom="atencao" titulo="Conferência da folha">um</Aviso>
        <Aviso tom="atencao" titulo="Risco de Anexo V">outro</Aviso>
      </>,
    );
    expect(screen.getByText("Conferência da folha")).toBeInTheDocument();
    expect(screen.getByText("Risco de Anexo V")).toBeInTheDocument();
  });

  it("a cor sai de token, nunca de hex literal", () => {
    render(<Aviso tom="ok" titulo="DAS calculado">R$ 1,00</Aviso>);
    const box = screen.getByText("DAS calculado").parentElement;
    expect(box.getAttribute("style")).toMatch(/var\(--state-ok\)/);
    expect(box.getAttribute("style")).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });

  it("tom inválido pinta de neutro — não de verde", () => {
    render(<Aviso tom="success" titulo="Qualquer coisa">corpo</Aviso>);
    const box = screen.getByText("Qualquer coisa").parentElement;
    expect(box.getAttribute("style")).not.toMatch(/--state-ok/);
    expect(box.getAttribute("style")).toMatch(/var\(--text-muted\)/);
  });

  it("repassa `title` e demais props ao elemento — o hover explicativo não se perde", () => {
    render(<Aviso tom="atencao" titulo="Conferência da folha" title="Somando 4.1.1.01">x</Aviso>);
    expect(screen.getByText("Conferência da folha").parentElement)
      .toHaveAttribute("title", "Somando 4.1.1.01");
  });
});
