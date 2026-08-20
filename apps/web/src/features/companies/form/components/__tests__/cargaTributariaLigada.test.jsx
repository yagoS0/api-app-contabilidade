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

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CompanyForm } from "../renderCompanyForm";
import { EmissaoNfseTab } from "../../../detail/components/renderEmissaoNfseTab";
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

describe("⚠ A ABA PASSA AS PROPS — o bloco não renderiza vazio para sempre", () => {
  // ⚠ ESTE BLOCO MUDOU DE ALVO em 19/08/2026, e o motivo é o pedido do dono: a configuração de
  // emissão saiu do formulário e virou ABA PRÓPRIA, com salvar próprio. O que ele protege é o
  // MESMO defeito de sempre (o componente verde e a tela vazia, porque ninguém passa as props);
  // o que mudou foi quem tem de passá-las.
  it("os três campos aparecem na aba, com o que está gravado na `Company`", () => {
    render(
      <EmissaoNfseTab
        company={{ razao: "ACME", legacyCompany: { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 2.5 } }}
        onSalvar={jest.fn()}
      />
    );
    expect(screen.getByLabelText("Federal (%)", { exact: false })).toHaveValue("11.33");
    // ⚠ O ZERO GRAVADO CHEGA À ABA como "0", não como campo vazio — é a mesma armadilha do `||`,
    // agora atravessando um componente a mais.
    expect(screen.getByLabelText("Estadual (%)", { exact: false })).toHaveValue("0");
    expect(screen.getByLabelText("Municipal (ISS) (%)", { exact: false })).toHaveValue("2.5");
  });

  it("digitar e salvar manda os três ao `onSalvar`, com o nome da coluna", async () => {
    const onSalvar = jest.fn(async () => ({ ok: true }));
    render(<EmissaoNfseTab company={{ razao: "ACME", legacyCompany: {} }} onSalvar={onSalvar} />);

    fireEvent.change(screen.getByLabelText("Municipal (ISS) (%)", { exact: false }), {
      target: { value: "2,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar configuração de emissão/i }));

    await waitFor(() => expect(onSalvar).toHaveBeenCalled());
    const campos = onSalvar.mock.calls[0][0];
    expect(campos.pTotTribMun).toBe("2,5");
    // ⚠ TODOS VIAJAM SEMPRE, e os que não foram tocados vão VAZIOS de propósito: é assim que a
    // tela consegue APAGAR uma configuração errada. Quem separa "não mexer" de "apagar" é a
    // presença da chave no corpo, e a aba manda todas as dela.
    // ⚠ Eram SETE até 20/08/2026; o benefício municipal (dono) acrescentou três. A lista é o
    // espelho de `CAMPOS_EMISSAO_NFSE` (`routes/firm/index.js`) — campo fora dela é recusado
    // nomeando-o, e campo que falte aqui simplesmente não é salvo, sem erro.
    expect(Object.keys(campos).sort()).toEqual([
      "beneficioMunicipalNumero", "beneficioMunicipalPRedBC", "beneficioMunicipalTipoReducao",
      "codigoServicoMunicipal", "codigoServicoNacional", "codigosServicoNacional",
      "pTotTribEst", "pTotTribFed", "pTotTribMun", "rpsSerie",
    ]);
  });

  // ⚠ O salvar da aba NÃO PODE carregar campo do cadastro: a rota recusa o corpo inteiro se vier
  // um campo de fora, e a tela não pode nem tentar.
  it("campo que não é desta aba não entra no que ela salva", async () => {
    const onSalvar = jest.fn(async () => ({ ok: true }));
    render(<EmissaoNfseTab company={{ razao: "ACME", legacyCompany: { telefone: "2199999" } }} onSalvar={onSalvar} />);
    fireEvent.change(screen.getByLabelText("Série da DPS", { exact: false }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar configuração de emissão/i }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalled());
    expect(onSalvar.mock.calls[0][0]).not.toHaveProperty("telefone");
    expect(onSalvar.mock.calls[0][0]).not.toHaveProperty("razaoSocial");
  });

  it("⚠ o bloco aparece INDEPENDENTE do regime — quem decide o opSimpNac é o CadastroFiscal", () => {
    // Esconder por `Company.regimeTributario` seria o defeito: a empresa cujo cadastro fiscal diz
    // LUCRO_PRESUMIDO e cuja `Company` ficou em SIMPLES teria a emissão recusada por falta destes
    // percentuais SEM CAMPO ONDE PREENCHÊ-LOS.
    render(
      <EmissaoNfseTab
        company={{ razao: "ACME", legacyCompany: { regimeTributario: "SIMPLES" } }}
        onSalvar={jest.fn()}
      />
    );
    expect(screen.getByLabelText("Federal (%)", { exact: false })).toBeInTheDocument();
  });
});

describe("o formulário do cadastro em modo EDIÇÃO não edita mais estes campos — mas não os apaga", () => {
  it("os três campos não aparecem no formulário de edição; a aba é NOMEADA no lugar", () => {
    montar({ ...getInitialCompanyFormState(), pTotTribFed: "11,33" });
    expect(screen.queryByLabelText("Federal (%)", { exact: false })).not.toBeInTheDocument();
    // ⚠ Aba que some sem rastro é o que faz recadastrar: a saída fica dita.
    // ⚠ 19/08/2026: o ponteiro deixou de dizer "na aba Fiscal → Emissão de NFS-e" — a aba saiu do
    // menu e a entrada virou a ENGRENAGEM da aba Notas Fiscais. A frase sai de
    // `ONDE_CONFIGURA_EMISSAO`, para não voltar a apontar para uma tela que não existe.
    expect(screen.getByText(/Notas Fiscais → ⚙ Configuração de emissão/)).toBeInTheDocument();
  });

  it("⚠ mas os valores CONTINUAM no `form` — senão o Salvar alterações os apagaria", () => {
    // `buildCompanyPayload` manda a empresa inteira e campo ausente vira `null`. Este é o teste
    // que cai se alguém "limpar" o estado do formulário achando que os campos não servem mais.
    const form = mapCompanyToEditForm({ legacyCompany: { pTotTribEst: 0, rpsSerie: "00001" } });
    expect(form.pTotTribEst).toBe("0");
    expect(form.rpsSerie).toBe("00001");
  });

  it("no cadastro de empresa NOVA o bloco continua no formulário (ainda não há aba)", () => {
    const onChange = jest.fn();
    render(
      <CompanyForm
        form={getInitialCompanyFormState()}
        onChange={onChange}
        onSubmit={jest.fn()}
        submitting={false}
        submitLabel="Cadastrar"
        showOwnerPassword
      />
    );
    expect(screen.getByLabelText("Federal (%)", { exact: false })).toBeInTheDocument();
  });
});
