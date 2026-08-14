// OS TRÊS CAMPOS DE EMISSÃO NO FORMULÁRIO — a ligação, não a regra de novo (essa é de
// `lib/nfse/__tests__/cadastroEmissaoNfse.test.js`).
//
// ⚠ O que este arquivo tranca:
//   1. os três campos EXISTEM em tela. Eles estavam no model, na API e no `legacyCompanySelect`, e
//      não tinham campo em formulário nenhum: `buildMissingFields` recusava a emissão por eles e
//      não havia por onde preenchê-los;
//   2. NADA vem pré-preenchido — nem a série, que é a mais tentadora ("1" parece inofensivo e entra
//      no identificador de toda nota emitida);
//   3. a ausência DIZ o que impede, no próprio cadastro, em vez de esperar a recusa da emissão;
//   4. o corte dos últimos 3 dígitos do código municipal é anunciado antes de salvar.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CamposEmissaoNfse } from "../CamposEmissaoNfse";
import { PROBLEMA_CTRIB_NAC, PROBLEMA_RPS_SERIE } from "../../../../../lib/nfse/cadastroEmissaoNfse";

function abrir(props = {}) {
  const onChange = jest.fn();
  render(
    <CamposEmissaoNfse
      codigoServicoNacional=""
      codigoServicoMunicipal=""
      rpsSerie=""
      onChange={onChange}
      {...props}
    />
  );
  return { onChange };
}

const CAMPOS = [
  "Código nacional do serviço",
  "Código municipal do serviço",
  "Série da DPS",
];

describe("os três campos existem em tela e nascem vazios", () => {
  it("os três aparecem, e nenhum traz valor", () => {
    abrir();
    for (const rotulo of CAMPOS) {
      expect(screen.getByLabelText(rotulo, { exact: false })).toHaveValue("");
    }
  });

  it("⚠ a série NÃO nasce em 1 — um valor escolhido pelo sistema seria indistinguível de um conferido", () => {
    abrir();
    expect(screen.getByLabelText("Série da DPS", { exact: false })).toHaveValue("");
  });

  it("digitar avisa o formulário com o nome do campo", () => {
    const { onChange } = abrir();
    fireEvent.change(screen.getByLabelText("Código nacional do serviço", { exact: false }), {
      target: { value: "171201" },
    });
    expect(onChange).toHaveBeenCalledWith("codigoServicoNacional", "171201");
  });
});

describe("a ausência diz o que impede, aqui e não na recusa da emissão", () => {
  it("vazio: o aviso nomeia os três e diz que a empresa não emite", () => {
    abrir();
    const aviso = screen.getByText(/não emite nota de serviço/).closest("div");
    expect(aviso).toHaveTextContent(
      "Falta o código nacional do serviço, o código municipal do serviço e a série da DPS."
    );
  });

  it("faltando um só, o aviso nomeia SÓ ele", () => {
    abrir({ codigoServicoNacional: "171201", codigoServicoMunicipal: "001" });
    const aviso = screen.getByText(/não emite nota de serviço/).closest("div");
    expect(aviso).toHaveTextContent("Falta a série da DPS.");
  });

  it("configurada: o aviso some", () => {
    abrir({ codigoServicoNacional: "171201", codigoServicoMunicipal: "001", rpsSerie: "1" });
    expect(screen.queryByText(/não emite nota de serviço/)).not.toBeInTheDocument();
  });
});

describe("valida FORMA, e a forma aparece no campo", () => {
  // ⚠ As mensagens vêm da MESMA lib que o backend espelha (`lib/nfse/cadastroEmissaoNfse.js`) —
  // e são comparadas literalmente, não por trecho: "6 dígitos" e "E0010" também aparecem no texto
  // de ajuda do campo, e um regex frouxo daria verde mesmo sem o erro ter sido mostrado.
  it("código nacional curto: o problema é dito, com o número de dígitos", () => {
    abrir({ codigoServicoNacional: "1712" });
    expect(screen.getByText(PROBLEMA_CTRIB_NAC)).toBeInTheDocument();
  });

  it("série fora da faixa cita a RN E0010 — a faixa é do emissor por aplicativo próprio", () => {
    abrir({ rpsSerie: "50000" });
    expect(screen.getByText(PROBLEMA_RPS_SERIE)).toBeInTheDocument();
  });

  it('série "UNICA" é recusada, não convertida', () => {
    abrir({ rpsSerie: "UNICA" });
    expect(screen.getByText(/numérica/)).toBeInTheDocument();
  });

  it("⚠ campo vazio NÃO é erro — a maioria da carteira não emite NFS-e e não pode ficar vermelha", () => {
    abrir();
    expect(screen.queryByText(/6 dígitos \(ex/)).not.toBeInTheDocument();
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

describe("⚠ a tela não sugere código de serviço nenhum", () => {
  it("não há lista, nem datalist, nem opção para escolher — as listas não estão no projeto", () => {
    // O município virou seletor porque a lista do IBGE está versionada aqui. A lista da LC 116 e a
    // do município NÃO estão, e oferecer uma lista inventada seria pior que não oferecer nada.
    const { container } = render(
      <CamposEmissaoNfse
        codigoServicoNacional=""
        codigoServicoMunicipal=""
        rpsSerie=""
        onChange={() => {}}
      />
    );
    expect(container.querySelectorAll("datalist")).toHaveLength(0);
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(screen.getByText(/não tem a lista de serviços da LC 116/)).toBeInTheDocument();
  });
});
