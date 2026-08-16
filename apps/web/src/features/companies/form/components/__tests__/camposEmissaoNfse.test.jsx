// A CONFIGURAÇÃO DE EMISSÃO NO FORMULÁRIO — a ligação, não a regra de novo (essa é de
// `lib/nfse/__tests__/cadastroEmissaoNfse.test.js` e `lib/servicosNacionais/__tests__/`).
//
// ⚠ O que este arquivo tranca:
//   1. os campos EXISTEM em tela. Eles estavam no model, na API e no `legacyCompanySelect`, e não
//      tinham campo em formulário nenhum: `buildMissingFields` recusava a emissão por eles e não
//      havia por onde preenchê-los;
//   2. NADA vem pré-preenchido — nem a série, que é a mais tentadora ("1" parece inofensivo e entra
//      no identificador de toda nota emitida);
//   3. a ausência DIZ o que impede, no próprio cadastro, em vez de esperar a recusa da emissão;
//   4. o corte dos últimos 3 dígitos do código municipal é anunciado antes de salvar;
//   5. ⚠ o código NACIONAL virou LISTA (dono, 16/08/2026) e é ESCOLHIDO, não digitado — e com mais
//      de um código a tela pergunta qual a nota leva, em vez de eleger um sozinha.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CamposEmissaoNfse } from "../CamposEmissaoNfse";
import { PROBLEMA_RPS_SERIE } from "../../../../../lib/nfse/cadastroEmissaoNfse";

function abrir(props = {}) {
  const onChange = jest.fn();
  render(
    <CamposEmissaoNfse
      codigoServicoNacional=""
      codigosServicoNacional={[]}
      codigoServicoMunicipal=""
      rpsSerie=""
      onChange={onChange}
      {...props}
    />
  );
  return { onChange };
}

describe("os campos existem em tela e nascem vazios", () => {
  it("os três blocos aparecem, e nada traz valor", () => {
    abrir();
    expect(screen.getByLabelText("Códigos de serviço", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("Código municipal do serviço", { exact: false })).toHaveValue("");
    expect(screen.getByLabelText("Série da DPS", { exact: false })).toHaveValue("");
  });

  it("⚠ a série NÃO nasce em 1 — um valor escolhido pelo sistema seria indistinguível de um conferido", () => {
    abrir();
    expect(screen.getByLabelText("Série da DPS", { exact: false })).toHaveValue("");
  });

  it("digitar o código municipal avisa o formulário com o nome do campo", () => {
    const { onChange } = abrir();
    fireEvent.change(screen.getByLabelText("Código municipal do serviço", { exact: false }), {
      target: { value: "001" },
    });
    expect(onChange).toHaveBeenCalledWith("codigoServicoMunicipal", "001");
  });
});

describe("a ausência diz o que impede, aqui e não na recusa da emissão", () => {
  it("vazio: o aviso nomeia os três e diz que a empresa não emite", () => {
    abrir();
    const aviso = screen.getByText(/recusa a emissão inteira por falta de configuração/).closest("div");
    expect(aviso).toHaveTextContent(
      "Falta o código nacional do serviço, o código municipal do serviço e a série da DPS."
    );
  });

  it("faltando um só, o aviso nomeia SÓ ele", () => {
    abrir({
      codigoServicoNacional: "171201",
      codigosServicoNacional: ["171201"],
      codigoServicoMunicipal: "001",
    });
    const aviso = screen.getByText(/recusa a emissão inteira por falta de configuração/).closest("div");
    expect(aviso).toHaveTextContent("Falta a série da DPS.");
  });

  it("configurada: o aviso some", () => {
    abrir({
      codigoServicoNacional: "171201",
      codigosServicoNacional: ["171201"],
      codigoServicoMunicipal: "001",
      rpsSerie: "1",
    });
    expect(screen.queryByText(/recusa a emissão inteira por falta de configuração/)).not.toBeInTheDocument();
  });
});

describe("valida FORMA, e a forma aparece no campo", () => {
  // ⚠ As mensagens vêm da MESMA lib que o backend espelha (`lib/nfse/cadastroEmissaoNfse.js`) —
  // e são comparadas literalmente, não por trecho: "E0010" também aparece no texto de ajuda do
  // campo, e um regex frouxo daria verde mesmo sem o erro ter sido mostrado.
  it("série fora da faixa cita a RN E0010 — a faixa é do emissor por aplicativo próprio", () => {
    abrir({ rpsSerie: "50000" });
    expect(screen.getByText(PROBLEMA_RPS_SERIE)).toBeInTheDocument();
  });

  it('série "UNICA" é recusada, não convertida', () => {
    abrir({ rpsSerie: "UNICA" });
    expect(screen.getByText(/numérica/)).toBeInTheDocument();
  });
});

describe("o corte dos últimos 3 dígitos é ANUNCIADO antes de salvar", () => {
  it("código mais longo avisa quais dígitos vão para a nota", () => {
    // ⚠ O corte já existe no backend (`buildDpsXml` faz `.slice(-3)`). Sem este aviso o contador
    // informa 10203 e a nota sai com 203, descoberto só depois da emissão.
    abrir({ codigoServicoMunicipal: "10203" });
    expect(screen.getByText(/últimos 3 dígitos/)).toBeInTheDocument();
    expect(screen.getByText("203")).toBeInTheDocument();
  });

  it("com 3 dígitos o aviso não aparece — repetir o óbvio é ruído", () => {
    abrir({ codigoServicoMunicipal: "001" });
    expect(screen.queryByText(/últimos 3 dígitos/)).not.toBeInTheDocument();
  });
});

describe("a série mostra como vai ficar gravada", () => {
  it('"1" avisa que na nota aparece 00001', () => {
    abrir({ rpsSerie: "1" });
    expect(screen.getByText("00001")).toBeInTheDocument();
  });

  it("já normalizada, não repete o aviso", () => {
    abrir({ rpsSerie: "00001" });
    expect(screen.queryByText(/5 dígitos/)).not.toBeInTheDocument();
  });
});

describe("⚠ o código nacional é ESCOLHIDO na lista oficial, não digitado", () => {
  it("não há campo para digitar o código nacional — a lista oficial está versionada no projeto", () => {
    abrir();
    // O input que existe é o de BUSCA (`codigosServicoNacional`); um campo de digitação do código
    // permitiria gravar um `cTribNac` que não existe na lista da Receita.
    expect(document.getElementById("codigoServicoNacional")).toBeNull();
    expect(document.getElementById("codigosServicoNacional")).not.toBeNull();
  });

  it("a busca acha pelo TEXTO e escolher acrescenta à lista", async () => {
    const { onChange } = abrir();
    const busca = screen.getByLabelText("Códigos de serviço", { exact: false });
    // A lista é carregada por import() dinâmico — o campo só destrava depois.
    await waitFor(() => expect(busca).not.toBeDisabled());

    fireEvent.change(busca, { target: { value: "analise e desenvolvimento" } });
    // ⚠ `findAllBy`: o texto aparece duas vezes de propósito — na descrição do desdobramento E no
    // nome do grupo (subitem), que a planilha oficial repete. Os dois são a mesma linha da lista.
    const opcoes = await screen.findAllByText("Análise e desenvolvimento de sistemas.");
    fireEvent.click(opcoes[0].closest("button"));

    // ⚠ Avisa o formulário com a LISTA, e — por ser o único — também com o código que a nota leva.
    expect(onChange).toHaveBeenCalledWith("codigosServicoNacional", ["010101"]);
    expect(onChange).toHaveBeenCalledWith("codigoServicoNacional", "010101");
  });

  it("⚠ com UM código cadastrado a tela NÃO pergunta qual a nota leva — não há escolha a fazer", async () => {
    abrir({ codigosServicoNacional: ["171201"], codigoServicoNacional: "171201" });
    await waitFor(() => expect(screen.queryByText(/Qual destes a nota leva/)).not.toBeInTheDocument());
  });

  it("⚠ com MAIS DE UM, a tela pergunta qual a nota leva — e não elege um sozinha", async () => {
    const { onChange } = abrir({ codigosServicoNacional: ["171201", "010101"], codigoServicoNacional: "" });
    expect(await screen.findByText(/Qual destes a nota leva/)).toBeInTheDocument();
    // Nenhum marcado: o sistema não escolheu por ninguém, e diz o que falta.
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(screen.getByText(/Escolha qual código a nota leva/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("remover o marcado LIMPA o código da nota — não promove o vizinho", async () => {
    const { onChange } = abrir({ codigosServicoNacional: ["171201", "010101"], codigoServicoNacional: "171201" });
    fireEvent.click(await screen.findByLabelText("Remover 17.12.01"));
    expect(onChange).toHaveBeenCalledWith("codigosServicoNacional", ["010101"]);
    // Sobrou UM: aí sim ele é o da nota, porque não há escolha a fazer.
    expect(onChange).toHaveBeenCalledWith("codigoServicoNacional", "010101");
  });

  it("⚠ código gravado fora da forma NÃO some da tela", async () => {
    // Descartar em silêncio faria o contador achar que a empresa tem menos códigos do que tem.
    abrir({ codigosServicoNacional: ["171201", "1234567"], codigoServicoNacional: "171201" });
    expect(await screen.findByText(/não têm a forma de um código de tributação nacional/)).toBeInTheDocument();
  });
});
