// O BENEFÍCIO MUNICIPAL ESTÁ LIGADO? — a prova de que o bloco tem CHAMADOR.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE, e por que ele não é o teste da regra de novo. A regra está em
// `lib/nfse/__tests__/beneficioMunicipal.test.js`; um teste que monte `<CamposEmissaoNfse>` com as
// props na mão continuaria VERDE com a `EmissaoNfseTab` nunca passando `beneficioMunicipalNumero`
// — que é o defeito favorito deste projeto (bloco novo renderizando vazio para sempre).
//
// A cadeia inteira é exercida aqui:
//   1. `getInitialCompanyFormState()` conhece os três campos;
//   2. `mapCompanyToEmissaoNfseForm(company)` traz o que está gravado na `Company`;
//   3. a `<EmissaoNfseTab>` renderiza os campos com esses valores e os MANDA no salvar;
//   4. o assistente de emissão DIZ que o benefício não entra na nota.
//
// Pedido do dono (20/08/2026): *"do lado do contador ainda, o seletor de benefício, caso o cliente
// tenha algum benefício fiscal."*

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EmissaoNfseTab } from "../../../detail/components/renderEmissaoNfseTab";
import { BeneficioMunicipalDaNota } from "../../../../notas/components/BeneficioMunicipalDaNota";
import {
  getInitialCompanyFormState,
  mapCompanyToEmissaoNfseForm,
} from "../../hooks/useManageCompanyForm";

const CAMPOS = [
  "beneficioMunicipalNumero",
  "beneficioMunicipalTipoReducao",
  "beneficioMunicipalPRedBC",
];

describe("o estado inicial e a leitura conhecem os três campos", () => {
  it("os três nascem VAZIOS — e existem", () => {
    const inicial = getInitialCompanyFormState();
    for (const campo of CAMPOS) {
      // ⚠ `in`, não truthiness: `""` é o valor esperado. Campo AUSENTE do estado inicial faria o
      // `onChange` gravar numa chave que ninguém lê de volta.
      expect(campo in inicial).toBe(true);
      expect(inicial[campo]).toBe("");
    }
  });

  it("⚠ NADA é pré-preenchido — nem o tipo de redução", () => {
    // Qual redução vale depende de como o MUNICÍPIO cadastrou o benefício (E0565/E0577). Um tipo
    // escolhido pelo sistema seria indistinguível de um conferido pelo contador — e este campo
    // decide se a nota sai com imposto a menos.
    expect(getInitialCompanyFormState().beneficioMunicipalTipoReducao).toBe("");
  });

  it("o que está gravado na `Company` volta para o formulário", () => {
    const form = mapCompanyToEmissaoNfseForm({
      legacyCompany: {
        beneficioMunicipalNumero: "33045570200123",
        beneficioMunicipalTipoReducao: "PERCENTUAL",
        beneficioMunicipalPRedBC: 40,
      },
    });
    expect(form.beneficioMunicipalNumero).toBe("33045570200123");
    expect(form.beneficioMunicipalTipoReducao).toBe("PERCENTUAL");
    expect(form.beneficioMunicipalPRedBC).toBe("40");
  });

  it("empresa sem benefício não inventa nenhum", () => {
    const form = mapCompanyToEmissaoNfseForm({ legacyCompany: {} });
    for (const campo of CAMPOS) expect(form[campo]).toBe("");
  });
});

describe("⚠ A ABA PASSA AS PROPS — o bloco não renderiza vazio para sempre", () => {
  function abrirAba(legacyCompany = {}, onSalvar = jest.fn(async () => ({ ok: true }))) {
    render(<EmissaoNfseTab company={{ razao: "ACME", legacyCompany }} onSalvar={onSalvar} />);
    return { onSalvar };
  }

  it("o campo do número aparece na aba, com o que está gravado", () => {
    abrirAba({ beneficioMunicipalNumero: "33045570200123" });
    expect(screen.getByLabelText("Número do benefício (nBM)", { exact: false }))
      .toHaveValue("33045570200123");
  });

  it("⚠ a leitura do número aparece para CONFERÊNCIA — município, tipo e sequencial", () => {
    abrirAba({ beneficioMunicipalNumero: "33045570200123" });
    expect(screen.getByText(/Lendo o que você digitou/)).toBeInTheDocument();
    expect(screen.getByText("3304557")).toBeInTheDocument();
    // A tela LÊ o que foi digitado; ela não afirma que o benefício existe.
    expect(screen.getByText(/este sistema não tem a lista de benefícios/)).toBeInTheDocument();
  });

  it("⚠ o campo de percentual só existe para o tipo PERCENTUAL", () => {
    // Um campo desabilitado ao lado de um tipo que não o admite convida a preenchê-lo — e
    // preencher os dois é o que o `xs:choice` do XSD proíbe.
    abrirAba({ beneficioMunicipalNumero: "33045570200123", beneficioMunicipalTipoReducao: "VALOR" });
    expect(screen.queryByLabelText("Redução da base de cálculo (%)", { exact: false }))
      .not.toBeInTheDocument();
  });

  it("com o tipo PERCENTUAL o campo aparece, com o valor gravado", () => {
    abrirAba({
      beneficioMunicipalNumero: "33045570200123",
      beneficioMunicipalTipoReducao: "PERCENTUAL",
      beneficioMunicipalPRedBC: 40,
    });
    expect(screen.getByLabelText("Redução da base de cálculo (%)", { exact: false }))
      .toHaveValue("40");
  });

  it("⚠⚠ com benefício cadastrado, a aba DIZ que ele ainda não chega à nota", () => {
    // Esta é a asserção que impede a crença falsa: sem ela o contador configura a redução e a nota
    // sai com o ISS cheio, descoberto só depois da emissão.
    abrirAba({ beneficioMunicipalNumero: "33045570200123" });
    expect(screen.getByText(/ISS cheio/)).toBeInTheDocument();
  });

  it("empresa SEM benefício não vê o aviso — avisar quem não tem nada é ruído", () => {
    abrirAba({});
    expect(screen.queryByText(/ISS cheio/)).not.toBeInTheDocument();
  });

  it("digitar e salvar manda os três campos, com o nome da coluna", async () => {
    const { onSalvar } = abrirAba({});
    fireEvent.change(screen.getByLabelText("Número do benefício (nBM)", { exact: false }), {
      target: { value: "3304557.02.00123" },
    });
    fireEvent.change(screen.getByLabelText("O que este benefício faz com a base de cálculo", { exact: false }), {
      target: { value: "SEM_REDUCAO" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar configuração de emissão/i }));

    await waitFor(() => expect(onSalvar).toHaveBeenCalled());
    const campos = onSalvar.mock.calls[0][0];
    // ⚠ O TEXTO VAI CRU: quem normaliza a máscara é o backend, num lugar só.
    expect(campos.beneficioMunicipalNumero).toBe("3304557.02.00123");
    expect(campos.beneficioMunicipalTipoReducao).toBe("SEM_REDUCAO");
    // ⚠ O campo vazio VIAJA — é assim que a tela consegue APAGAR uma configuração errada.
    expect(campos).toHaveProperty("beneficioMunicipalPRedBC", "");
  });

  it("⚠ a tela avisa antes de salvar quando o cadastro está incoerente", async () => {
    const { onSalvar } = abrirAba({});
    fireEvent.change(screen.getByLabelText("O que este benefício faz com a base de cálculo", { exact: false }), {
      target: { value: "PERCENTUAL" },
    });
    // Tipo declarado sem o número: o servidor recusa com `company_beneficio_municipal_sem_numero`,
    // e a tela diz isso ANTES da tentativa.
    expect(await screen.findByText(/Informe o número do benefício municipal/)).toBeInTheDocument();
    expect(onSalvar).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ O ASSISTENTE DE EMISSÃO DIZ QUE O BENEFÍCIO NÃO ENTRA NA NOTA", () => {
  it("com benefício cadastrado, o aviso aparece e nomeia o desfecho", () => {
    render(<BeneficioMunicipalDaNota cadastroEmissao={{
      beneficioMunicipalNumero: "33045570200123",
      beneficioMunicipalTipoReducao: "PERCENTUAL",
      beneficioMunicipalPRedBC: 40,
    }} />);
    expect(screen.getByText(/NÃO entra nesta nota/)).toBeInTheDocument();
    expect(screen.getByText(/33045570200123/)).toBeInTheDocument();
    expect(screen.getByText(/ISS cheio/)).toBeInTheDocument();
  });

  it("empresa sem benefício: o bloco não renderiza", () => {
    const { container } = render(<BeneficioMunicipalDaNota cadastroEmissao={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("⚠ prop ausente ≠ cadastro vazio — sem o cadastro esta tela não afirma nada", () => {
    const { container } = render(<BeneficioMunicipalDaNota cadastroEmissao={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
