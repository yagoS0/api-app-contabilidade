// O SELETOR DE MUNICÍPIO EMISSOR — a ligação, não a regra de novo (essa é de
// `lib/__tests__/municipioIbge.test.js`).
//
// ⚠ O que este arquivo tranca é a DECISÃO DO DONO: "as configurações desse tipo sempre serão à
// mão, assim o contador configura corretamente". A lista do IBGE tira a transcrição de sete
// dígitos das mãos dele; ela não pode tirar a ESCOLHA. Então: nada nasce selecionado, a busca
// nunca escolhe sozinha (nem com um resultado só), e o município que o cadastro já tem em texto
// aparece como CONFERÊNCIA — nunca como valor.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SeletorMunicipioIbge } from "../SeletorMunicipioIbge";

function abrir(props = {}) {
  const onChange = jest.fn();
  render(
    <SeletorMunicipioIbge
      valor=""
      onChange={onChange}
      municipioCadastrado="Rio de Janeiro"
      ufCadastrado="RJ"
      {...props}
    />
  );
  return { onChange };
}

// A lista de 5.571 linhas entra por `import()` dinâmico; até ela chegar o campo fica desabilitado.
async function esperarALista() {
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
}

function buscar(termo) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: termo } });
}

describe("nada vem pré-selecionado", () => {
  it("empresa sem município mostra o que a ausência IMPEDE, e nenhum valor", async () => {
    abrir({ valor: "" });
    await esperarALista();

    expect(screen.getByText(/Município emissor não cadastrado/)).toBeInTheDocument();
    expect(screen.getByText(/não emite nota de serviço/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("⚠ o município do cadastro aparece para CONFERIR e não vira escolha", async () => {
    const { onChange } = abrir({ valor: "", municipioCadastrado: "Rio de Janeiro", ufCadastrado: "RJ" });
    await esperarALista();

    // O texto está na tela…
    expect(screen.getByText("Rio de Janeiro / RJ")).toBeInTheDocument();
    // …e mesmo assim nada foi escolhido. Derivar o código a partir deste texto é o erro que o
    // seletor existe para impedir (homônimo → nota emitida no município errado).
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a busca ENCONTRA; quem escolhe é o contador", () => {
  it("um único resultado NÃO se autosseleciona", async () => {
    const { onChange } = abrir();
    await esperarALista();

    buscar("mangaratiba");
    await screen.findByRole("listbox");

    expect(within(screen.getByRole("listbox")).getAllByRole("button")).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicar na opção é o que grava o código", async () => {
    const { onChange } = abrir();
    await esperarALista();

    buscar("mangaratiba");
    const opcao = await screen.findByRole("button", { name: /Mangaratiba/ });
    fireEvent.click(opcao);

    expect(onChange).toHaveBeenCalledWith("3302601");
  });

  it("⚠ homônimo: cada opção mostra a UF, que é o que os distingue", async () => {
    abrir();
    await esperarALista();

    buscar("bom jesus");
    const lista = await screen.findByRole("listbox");
    const opcoes = within(lista).getAllByRole("button").map((b) => b.textContent);

    // Cinco municípios chamados exatamente "Bom Jesus", em cinco estados. Nenhuma opção aparece
    // sem UF — sem ela a lista ofereceria cinco linhas visualmente idênticas.
    const exatos = opcoes.filter((t) => t.startsWith("Bom Jesus /"));
    expect(exatos.length).toBeGreaterThanOrEqual(5);
    expect(new Set(exatos).size).toBe(exatos.length);
  });

  it("o recorte se anuncia quando há mais resultados do que cabem", async () => {
    abrir();
    await esperarALista();

    buscar("santa");
    await screen.findByRole("listbox");
    // Sem este aviso o contador escolheria dentro de uma lista parcial achando ser a lista inteira.
    expect(screen.getByText(/Mostrando 40 de \d+/)).toBeInTheDocument();
  });

  it("nada encontrado diz isso — e não oferece um “parecido”", async () => {
    const { onChange } = abrir();
    await esperarALista();

    buscar("municipio que nao existe");
    await screen.findByText(/Nenhum município com/);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("o que já está escolhido", () => {
  it("mostra município, UF e o código — e dá como desfazer", async () => {
    const { onChange } = abrir({ valor: "3304557" });
    await waitFor(() => expect(screen.getByText("Rio de Janeiro / RJ")).toBeInTheDocument());

    expect(screen.getByText("3304557")).toBeInTheDocument();
    expect(screen.queryByText(/Município emissor não cadastrado/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Limpar/ }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("divergência com o endereço do cadastro é AVISO, não correção", async () => {
    // A empresa pode ter mudado de município, ou o endereço pode estar velho. A tela mostra os dois
    // e não mexe em nenhum.
    const { onChange } = abrir({ valor: "3302601", municipioCadastrado: "Rio de Janeiro", ufCadastrado: "RJ" });
    await waitFor(() => expect(screen.getByText("Mangaratiba / RJ")).toBeInTheDocument());

    expect(screen.getByText(/é diferente do que está no endereço do cadastro/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
