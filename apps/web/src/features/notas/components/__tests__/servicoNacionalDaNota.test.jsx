// NA HORA DE EMITIR APARECEM APENAS OS PRÉ-CADASTRADOS — com o TEXTO, não só o número.
//
// ⚠ Decisão do dono, 16/08/2026: *"na hora de emitir aparecem apenas aqueles pré-cadastrados,
// existe uma lista da LC116 com texto vs o código, devemos mostrar o texto para que facilite a
// escolha."*
//
// ⚠ E o limite de hoje, que a tela DIZ em vez de esconder: a escolha por emissão ainda não chega ao
// XML (`buildDpsXml` monta o `cTribNac` a partir de `company.codigoServicoNacional` e de mais nada).
// Um seletor que parecesse funcionar faria a nota sair com o outro código — erro fiscal silencioso.

import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ServicoNacionalDaNota } from "../ServicoNacionalDaNota";
import { ONDE_CONFIGURA_EMISSAO } from "../../../../lib/nfse/cadastroEmissaoNfse";

describe("o código de serviço da nota", () => {
  it("⚠ com UM cadastrado NÃO faz escolher — mas MOSTRA qual é, com a descrição oficial", async () => {
    render(
      <ServicoNacionalDaNota
        cadastroEmissao={{ codigosServicoNacional: ["010101"], codigoServicoNacional: "010101" }}
      />
    );
    expect(screen.getByText(/o único cadastrado nesta empresa/)).toBeInTheDocument();
    expect(screen.getByText("01.01.01")).toBeInTheDocument();
    // O TEXTO é o pedido do dono: o número sozinho não diz a ninguém o que está sendo declarado.
    expect(await screen.findAllByText(/Análise e desenvolvimento de sistemas/)).not.toHaveLength(0);
    // Sem escolha a fazer, sem radio e sem o aviso da pendência.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/ainda não está ligada/)).not.toBeInTheDocument();
  });

  it("com VÁRIOS, lista todos e diz qual a nota leva — e onde se troca", async () => {
    render(
      <ServicoNacionalDaNota
        cadastroEmissao={{
          codigosServicoNacional: ["171201", "010101"],
          codigoServicoNacional: "010101",
        }}
      />
    );
    expect(screen.getByText(/Códigos de serviço cadastrados nesta empresa \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("17.12.01")).toBeInTheDocument();
    expect(screen.getByText("01.01.01")).toBeInTheDocument();
    expect(screen.getByText("Esta nota vai com este.")).toBeInTheDocument();
    // ⚠ Opção que não existe nunca fica sem explicação — e a explicação é também o caminho.
    // ⚠ O CAMINHO MUDOU EM 19/08/2026 (dono): a configuração saiu do formulário e a entrada
    // virou a ENGRENAGEM da aba Notas Fiscais. O texto sai de `ONDE_CONFIGURA_EMISSAO`
    // (`lib/nfse/cadastroEmissaoNfse.js`) — apontar para "Editar cadastro" mandaria o
    // contador a uma tela onde estes campos não estão mais.
    expect(screen.getByText(ONDE_CONFIGURA_EMISSAO)).toBeInTheDocument();
    // ⚠ A descrição vem da LISTA OFICIAL, não do que alguém supõe que o código seja: `171201` é
    // "Administração em geral, inclusive de bens e negócios de terceiros" — e é justamente por
    // isso que o texto tem de aparecer. Quem lê "171201" não sabe o que está declarando.
    await waitFor(() =>
      expect(screen.getByText(/Administração em geral/)).toBeInTheDocument()
    );
  });

  it("⚠ SÓ os pré-cadastrados aparecem — a lista inteira de 335 códigos não vaza para a emissão", async () => {
    render(
      <ServicoNacionalDaNota
        cadastroEmissao={{ codigosServicoNacional: ["171201"], codigoServicoNacional: "171201" }}
      />
    );
    await waitFor(() => expect(screen.getByText("17.12.01")).toBeInTheDocument());
    expect(screen.queryByText("01.01.01")).not.toBeInTheDocument();
    expect(screen.queryByText("31.01.04")).not.toBeInTheDocument();
  });

  it("empresa no formato antigo (um campo só) continua sendo lida", () => {
    // ⚠ Antes da migration a coluna da lista não existe. Cair para o campo singular é o MESMO dado
    // em outro formato — sem isso a tela diria "nenhum código" para quem tem um.
    render(<ServicoNacionalDaNota cadastroEmissao={{ codigoServicoNacional: "171201" }} />);
    expect(screen.getByText("17.12.01")).toBeInTheDocument();
  });

  it("prop ausente ≠ cadastro vazio — sem o cadastro a tela não afirma nada", () => {
    const { container } = render(<ServicoNacionalDaNota cadastroEmissao={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sem código nenhum, o bloco não aparece — quem diz a falta é o bloqueio do passo 1", () => {
    const { container } = render(
      <ServicoNacionalDaNota cadastroEmissao={{ codigosServicoNacional: [], codigoServicoNacional: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
