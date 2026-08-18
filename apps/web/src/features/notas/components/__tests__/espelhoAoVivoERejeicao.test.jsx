// A LIGAÇÃO das quatro coisas que subiram o assistente ao nível do protótipo aprovado — não as
// regras de novo (essas são de `lib/__tests__/tributosDaNota.test.js`,
// `rejeicaoDaEmissao.test.js` e `tomadoresRecentes.test.js`).
//
//   1. o espelho reage a cada tecla, e não afirma zero enquanto o campo está vazio;
//   2. o líquido aparece com o que NÃO sai dele;
//   3. cada pendência leva ao campo — e campo vazio não é vermelho;
//   4. a recusa diz o que fazer, e a que não sabe o desfecho TRAVA o botão Emitir.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EmitirNfseWizard } from "../EmitirNfseWizard";

const noop = () => {};
const FETCH_QUE_NUNCA_RESPONDE = () => new Promise(() => {});

const CADASTRO_COMPLETO = {
  cnpj: "39254243000191",
  inscricaoMunicipal: "1.234.567-8",
  codigoServicoNacional: "171201",
  codigoServicoMunicipal: "001",
  rpsSerie: "00001",
};

function abrir({ onEmitir = jest.fn(), notasDaEmpresa = null } = {}) {
  render(
    <EmitirNfseWizard
      companyId="c-1"
      regime="SIMPLES"
      codigoMunicipioIbge="3304557"
      cadastroEmissao={CADASTRO_COMPLETO}
      notasDaEmpresa={notasDaEmpresa}
      fetchCnpj={FETCH_QUE_NUNCA_RESPONDE}
      onEmitir={onEmitir}
      onClose={noop}
    />
  );
  return { onEmitir };
}

const painel = () => screen.getByRole("complementary", { name: /A nota como ela vai sair/ });

function digitar(rotulo, valor) {
  fireEvent.change(screen.getByLabelText(rotulo, { exact: false }), { target: { value: valor } });
}

function preencherTudo() {
  digitar("CNPJ ou CPF do tomador", "12345678000199");
  digitar("Nome ou razão social", "ACME LTDA");
  digitar("Descrição do serviço", "Consultoria contábil");
  digitar("Valor dos serviços", "1500");
  digitar("Alíquota de ISS", "2");
  digitar("Total de tributos do Simples Nacional", "6,84");
}

describe("1) o espelho reage a cada tecla", () => {
  it("o nome digitado aparece no espelho sem apertar nada", () => {
    abrir();
    digitar("Nome ou razão social", "ACME");
    expect(within(painel()).getByText(/ACME/)).toBeInTheDocument();
    digitar("Nome ou razão social", "ACME LTDA");
    expect(within(painel()).getByText(/ACME LTDA/)).toBeInTheDocument();
  });

  // ⚠ O ESPELHO PASSOU A SER LIDO COM OS CAMPOS VAZIOS, o que antes não acontecia (só se chegava
  // nele com tudo validado). "R$ 0,00" aqui afirmaria que a nota vale zero.
  it("com o valor em branco o espelho diz 'não informado', não R$ 0,00", () => {
    abrir();
    expect(within(painel()).queryByText("R$ 0,00")).not.toBeInTheDocument();
    expect(within(painel()).getAllByText("não informado").length).toBeGreaterThan(0);
  });
});

describe("2) o líquido, e o que não sai dele", () => {
  it("sem retenção: ISS calculado, líquido cheio e a linha que explica a diferença", () => {
    abrir();
    digitar("Valor dos serviços", "1500");
    digitar("Alíquota de ISS", "2");

    const p = within(painel());
    expect(p.getByText(/ISS \(recolhido pelo prestador\)/)).toBeInTheDocument();
    expect(p.getAllByText("R$ 30,00").length).toBeGreaterThan(0);
    expect(p.getByText("Líquido a receber")).toBeInTheDocument();
    expect(p.getAllByText("R$ 1.500,00").length).toBeGreaterThan(0);
    // A linha sem a qual o número parece erro de conta.
    expect(p.getByText(/Não sai do líquido:/)).toBeInTheDocument();
    expect(p.getByText(/quem recolhe o ISS é o prestador/)).toBeInTheDocument();
  });

  it("com retenção o líquido cai — e o ISS sai da lista do 'não sai'", () => {
    abrir();
    digitar("Valor dos serviços", "1500");
    digitar("Alíquota de ISS", "2");
    fireEvent.click(screen.getByRole("checkbox"));

    const p = within(painel());
    expect(p.getByText(/ISS \(retido pelo tomador\)/)).toBeInTheDocument();
    expect(p.getAllByText("R$ 1.470,00").length).toBeGreaterThan(0);
    expect(p.queryByText(/quem recolhe o ISS é o prestador/)).not.toBeInTheDocument();
  });
});

describe("3) as pendências: cor certa, e cada uma leva ao campo", () => {
  // ⚠ Juntar três passos num só faria o assistente abrir com cinco linhas VERMELHAS. Campo vazio
  // é o estado normal de um formulário recém-aberto.
  it("assistente recém-aberto diz 'Falta preencher', não 'corrija'", () => {
    abrir();
    expect(screen.getByText("Falta preencher:")).toBeInTheDocument();
    expect(screen.queryByText("Antes de emitir, corrija:")).not.toBeInTheDocument();
  });

  it("dado preenchido e errado vira 'corrija'", () => {
    abrir();
    digitar("E-mail", "isto-nao-e-email");
    expect(screen.getByText("Antes de emitir, corrija:")).toBeInTheDocument();
  });

  it("o 'ir para o campo' põe o foco no campo que falta", () => {
    abrir();
    const item = screen.getByText(/descreva o serviço prestado/).closest("li");
    fireEvent.click(within(item).getByRole("button", { name: /ir para o campo/ }));
    expect(screen.getByLabelText(/Descrição do serviço/)).toHaveFocus();
  });
});

describe("4) a recusa do servidor", () => {
  async function emitirEFalhar(erro) {
    const onEmitir = jest.fn(async () => { throw erro; });
    jest.spyOn(window, "confirm").mockReturnValue(true);
    abrir({ onEmitir });
    preencherTudo();
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Emitir nota/ }));
    await screen.findByRole("alert");
    window.confirm.mockRestore();
    return onEmitir;
  }

  it("diz o que fazer e oferece o caminho até o campo", async () => {
    await emitirEFalhar(Object.assign(new Error("valor inválido"), {
      code: "servico_valor_invalido",
      payload: { error: "servico_valor_invalido", message: "valor inválido" },
    }));

    const alerta = screen.getByRole("alert");
    expect(within(alerta).getByText(/O que fazer:/)).toBeInTheDocument();
    expect(within(alerta).getByText(/maior que zero/)).toBeInTheDocument();

    fireEvent.click(within(alerta).getByRole("button", { name: /Ir para “Valor dos serviços”/ }));
    expect(screen.getByLabelText(/Valor dos serviços/)).toHaveFocus();
  });

  // ⚠⚠ O CASO QUE MAIS IMPORTA. Antes o botão Emitir continuava clicável depois de qualquer erro —
  // inclusive o que quer dizer "não se sabe se a nota saiu".
  it("falha de TRANSPORTE trava o botão Emitir e manda consultar antes", async () => {
    await emitirEFalhar(Object.assign(new Error("timeout ao falar com o ADN"), {
      code: "nfse_falha_transporte",
      payload: { error: "nfse_falha_transporte", camada: "TRANSPORTE", message: "timeout ao falar com o ADN" },
    }));

    expect(screen.getByText(/o desfecho é DESCONHECIDO/i)).toBeInTheDocument();
    const botao = screen.getByRole("button", { name: /Emitir nota/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringContaining("consulte antes"));
    expect(screen.getAllByText(/Buscar NFS-e/).length).toBeGreaterThan(0);
  });

  it("recusa que a tela não conhece NÃO ganha procedimento inventado", async () => {
    await emitirEFalhar(new Error("codigo_que_ninguem_mapeou"));
    const alerta = screen.getByRole("alert");
    expect(within(alerta).queryByText(/O que fazer:/)).not.toBeInTheDocument();
    expect(within(alerta).getByText(/não conhece este motivo/)).toBeInTheDocument();
    // Corrigir e tentar de novo continua permitido — o desfecho não é desconhecido aqui.
    expect(screen.getByRole("button", { name: /Emitir nota/ })).toBeEnabled();
  });
});

describe("5) sugestão de tomador — encontra, não escolhe", () => {
  const NOTAS = [
    { tomadorNome: "ACME CONSULTORIA LTDA", tomadorDoc: "12345678000199" },
    { tomadorNome: "BETA SERVIÇOS ME", tomadorDoc: "98765432000111" },
  ];

  it("sem notas na aba o campo é um input simples — nada de lista vazia prometendo cadastro", () => {
    abrir({ notasDaEmpresa: [] });
    fireEvent.focus(screen.getByLabelText(/Nome ou razão social/));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("escolher preenche NOME e DOCUMENTO, e diz de onde a lista vem", async () => {
    abrir({ notasDaEmpresa: NOTAS });
    fireEvent.focus(screen.getByLabelText(/Nome ou razão social/));
    expect(screen.getByText(/não é um cadastro de clientes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /ACME CONSULTORIA LTDA/ }));
    expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("ACME CONSULTORIA LTDA");
    await waitFor(() =>
      expect(screen.getByLabelText(/CNPJ ou CPF do tomador/)).toHaveValue("12345678000199"));
  });

  // ⚠ A regra que vale em todo seletor deste projeto: resultado único NÃO se autosseleciona.
  it("Enter sem item marcado não elege ninguém, mesmo com um resultado só", () => {
    abrir({ notasDaEmpresa: NOTAS });
    const input = screen.getByLabelText(/Nome ou razão social/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "BETA" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("BETA");
    expect(screen.getByLabelText(/CNPJ ou CPF do tomador/)).toHaveValue("");
  });
});
