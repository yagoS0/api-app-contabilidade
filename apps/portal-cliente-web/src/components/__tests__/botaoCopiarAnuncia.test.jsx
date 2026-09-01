// ⚠⚠ O DESFECHO DA CÓPIA PRECISA SER OUVIDO, NÃO SÓ VISTO — achado em teste de usabilidade
// (31/08/2026).
//
// O `aria-label` do `BotaoCopiar` é FIXO ("Copiar a linha digitável…") e **sobrescreve** o texto
// visível. O rótulo trocava para "Copiado" / "Não deu" na tela, e o leitor de tela continuava
// anunciando a mesma coisa de sempre — ou seja, exatamente o desfecho que este componente existe
// para não esconder ficava invisível para quem não vê a tela.
//
// ⚠⚠ E O CASO QUE MAIS IMPORTA É A FALHA. A promessa escrita do componente é *"o retorno não
// mente"*: `navigator.clipboard` **não existe em contexto inseguro**, e o botão diz "não deu" em
// vez de piscar "copiado". Sem anúncio, quem usa leitor de tela ia ao banco com a área de
// transferência vazia achando que tinha a linha digitável.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { BotaoCopiar } from "../ui";

const LINHA = "858100000005 122601074001 002026070091 640301090306";

function anuncio() {
  return document.querySelector("[data-copia-anuncio]");
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  delete navigator.clipboard;
});

test("⚠ em repouso a região existe e está MUDA — senão cada linha da tabela anuncia ao abrir", () => {
  render(<BotaoCopiar valor={LINHA} rotulo="Copiar a linha digitável" />);
  expect(anuncio()).not.toBeNull();
  expect(anuncio().textContent).toBe("");
  // ⚠ `polite`, nunca `assertive`: copiar é ação da pessoa, não emergência.
  expect(anuncio().getAttribute("aria-live")).toBe("polite");
});

test("copiou: o anúncio diz que copiou", async () => {
  navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
  render(<BotaoCopiar valor={LINHA} rotulo="Copiar a linha digitável" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINHA);
  expect(anuncio().textContent).toMatch(/Copiado/i);
});

test("⚠⚠ NÃO COPIOU: o anúncio diz que não deu E diz o que fazer", async () => {
  // Sem `navigator.clipboard` — é literalmente o que acontece em contexto inseguro (http://).
  render(<BotaoCopiar valor={LINHA} rotulo="Copiar a linha digitável" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });

  const texto = anuncio().textContent;
  expect(texto).toMatch(/não foi possível copiar/i);
  // A saída — a mesma que o `title` já dava a quem vê a tela.
  expect(texto).toMatch(/copie à mão|selecione/i);
});

test("⚠ a região fica FORA do botão — dentro, o `aria-label` a engoliria", () => {
  render(<BotaoCopiar valor={LINHA} rotulo="Copiar a linha digitável" />);
  expect(screen.getByRole("button").contains(anuncio())).toBe(false);
});

test("⚠ e o NOME do botão continua nomeando a ação — o anúncio não o substitui", async () => {
  navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
  render(<BotaoCopiar valor={LINHA} rotulo="Copiar a linha digitável" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
  // Sem isso, uma tabela com várias linhas viraria vários botões chamados "Copiado".
  expect(screen.getByRole("button", { name: "Copiar a linha digitável" })).toBeInTheDocument();
});

test("⚠ passado o tempo, a região volta a ficar muda", async () => {
  navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
  render(<BotaoCopiar valor={LINHA} rotulo="Copiar a linha digitável" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
  expect(anuncio().textContent).not.toBe("");

  act(() => {
    jest.advanceTimersByTime(2000);
  });
  expect(anuncio().textContent).toBe("");
});
