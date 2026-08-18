// A CARGA TRIBUTÁRIA APROXIMADA ESTÁ LIGADA? — a prova de que o bloco tem CHAMADOR.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE, e por que ele não é o `camposEmissaoNfse.test.jsx` de novo.
// Aquele monta `<CamposEmissaoNfse>` DIRETO, passando as props na mão — ele prova que o
// componente funciona, e continuaria verde com o `CompanyForm` nunca passando `pTotTribFed`. Já
// aconteceu neste projeto: bloco novo que renderizava sempre vazio porque a prop nunca era
// passada, com o teste do componente verde o tempo todo.
//
// Aqui a cadeia inteira é exercida:
//   1. `getInitialCompanyFormState()` tem os três campos (senão o formulário monta com o default
//      `""` do componente e o `onChange` grava numa chave que ninguém lê);
//   2. `mapCompanyToEditForm(company)` traz o que está gravado na `Company` — INCLUSIVE o zero;
//   3. `<CompanyForm form={...}>` renderiza os três campos COM esses valores.
//
// Pedido do dono (18/08/2026): *"as alíquotas efetivas do presumido não precisam ser calculadas a
// não ser o ISS que varia de município, mas deve ser configurado do lado do contador, no portal do
// contador."*

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CompanyForm } from "../renderCompanyForm";
import {
  getInitialCompanyFormState,
  mapCompanyToEditForm,
} from "../../hooks/useManageCompanyForm";

const CAMPOS = ["pTotTribFed", "pTotTribEst", "pTotTribMun"];

function montar(form, onChange = jest.fn()) {
  render(
    <CompanyForm
      form={form}
      onChange={onChange}
      onSubmit={jest.fn()}
      submitting={false}
      submitLabel="Salvar alterações"
      showOwnerPassword={false}
      cnpjReadOnly
    />
  );
  return { onChange };
}

describe("o estado inicial do formulário conhece os três percentuais", () => {
  it("os três nascem VAZIOS — e existem", () => {
    const inicial = getInitialCompanyFormState();
    for (const campo of CAMPOS) {
      // ⚠ `in`, não truthiness: `""` é falsy, e é exatamente o valor esperado. Um campo AUSENTE do
      // estado inicial faria o `onChange` gravar numa chave que o `CompanyForm` não lê de volta.
      expect(campo in inicial).toBe(true);
      expect(inicial[campo]).toBe("");
    }
  });

  it("⚠ nenhum nasce em 0 — zero é uma AFIRMAÇÃO, e ela vai impressa ao tomador", () => {
    const inicial = getInitialCompanyFormState();
    for (const campo of CAMPOS) expect(inicial[campo]).not.toBe("0");
  });
});

describe("o que está gravado na Company volta para o formulário", () => {
  it("traz os três de `legacyCompany`", () => {
    const form = mapCompanyToEditForm({
      legacyCompany: { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 2.5 },
    });
    expect(form.pTotTribFed).toBe("11.33");
    expect(form.pTotTribMun).toBe("2.5");
  });

  it("⚠⚠ O ZERO GRAVADO VOLTA COMO '0', não como campo em branco", () => {
    // Este é o teste que cai se alguém escrever `String(legacy?.pTotTribEst || "")`. O estadual de
    // um serviço é legitimamente 0,00 (a NFS-e real versionada declara assim), e com `||` o zero
    // conferido pelo contador reabriria vazio: ele salvaria de novo, gravaria NULL, e a empresa
    // pararia de emitir sem que nada na tela tivesse mudado.
    const form = mapCompanyToEditForm({ legacyCompany: { pTotTribEst: 0 } });
    expect(form.pTotTribEst).toBe("0");
  });

  it("coluna nula vira campo vazio — NULL é 'não configurado', não zero", () => {
    const form = mapCompanyToEditForm({
      legacyCompany: { pTotTribFed: null, pTotTribEst: null, pTotTribMun: null },
    });
    for (const campo of CAMPOS) expect(form[campo]).toBe("");
  });

  it("empresa sem `legacyCompany` não inventa percentual nenhum", () => {
    const form = mapCompanyToEditForm({});
    for (const campo of CAMPOS) expect(form[campo]).toBe("");
  });
});

describe("⚠ O FORMULÁRIO PASSA AS PROPS — o bloco não renderiza vazio para sempre", () => {
  it("os três campos aparecem dentro do CompanyForm, com o valor do `form`", () => {
    montar({
      ...getInitialCompanyFormState(),
      pTotTribFed: "11,33",
      pTotTribEst: "0",
      pTotTribMun: "2,5",
    });
    expect(screen.getByLabelText("Federal (%)", { exact: false })).toHaveValue("11,33");
    expect(screen.getByLabelText("Estadual (%)", { exact: false })).toHaveValue("0");
    expect(screen.getByLabelText("Municipal (ISS) (%)", { exact: false })).toHaveValue("2,5");
  });

  it("digitar chega ao `onChange` do formulário, com o nome da coluna", () => {
    const { onChange } = montar(getInitialCompanyFormState());
    fireEvent.change(screen.getByLabelText("Municipal (ISS) (%)", { exact: false }), {
      target: { value: "2,5" },
    });
    expect(onChange).toHaveBeenCalledWith("pTotTribMun", "2,5");
  });

  it("⚠ o bloco aparece INDEPENDENTE do regime — quem decide o opSimpNac é o CadastroFiscal", () => {
    // Esconder por `Company.regimeTributario` seria o defeito: a empresa cujo cadastro fiscal diz
    // LUCRO_PRESUMIDO e cuja `Company` ficou em SIMPLES teria a emissão recusada por falta destes
    // percentuais SEM CAMPO ONDE PREENCHÊ-LOS.
    montar({ ...getInitialCompanyFormState(), regimeTributario: "SIMPLES" });
    expect(screen.getByLabelText("Federal (%)", { exact: false })).toBeInTheDocument();
  });
});
