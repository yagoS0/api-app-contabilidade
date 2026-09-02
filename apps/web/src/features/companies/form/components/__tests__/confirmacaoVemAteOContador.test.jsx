// ⚠⚠ O PAINEL DE CONFIRMAÇÃO PRECISA VIR ATÉ O CONTADOR — achado da auditoria de 02/09/2026.
//
// O painel nasce COLADO ao campo do e-mail do responsável, no TOPO do formulário; o botão Salvar
// fica na barra fixa do rodapé; e o `Feedback` fica mudo de propósito (não é erro). Num formulário
// desta altura, quem clica embaixo não vê o que nasceu em cima. Relato do dono: *"clico em salvar
// e não acontece nada"* / *"o responsável mudou mas apenas na tela de edição"* — a confirmação
// estava lá, fora da tela, esperando um clique que nunca veio.
//
// ⚠ O jsdom não faz layout: `scrollIntoView` não existe nele. O teste instala um dublê e mede a
// CHAMADA; o foco, esse, o jsdom mede de verdade (`document.activeElement`).

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ConfirmacaoAcessoProprio } from "../ResponsavelCompartilhado";

const OUTRAS = [{ id: "pc-2", razao: "LENTE - MEDICAL MARKETING LTDA", cnpj: "24352609000198" }];

function detalhesDeVinculo() {
  return {
    modo: "VINCULO",
    emailAtual: "contato@agencialente.com",
    emailNovo: "liz@hotmail.com",
    nomeDaContaDestino: "JULIA PACHECO",
    empresasDoDestino: 1,
    outras: OUTRAS,
    contaDestinoJaTemSenha: true,
    acessoAntigoPerdeEstaEmpresa: true,
  };
}

function detalhesDeAcessoProprio() {
  return {
    modo: "ACESSO_PROPRIO",
    emailAtual: "liz@hotmail.com",
    emailNovo: "novo@empresa.com",
    empresasDaConta: 2,
    outrasEmpresas: 1,
    outras: OUTRAS,
    contaNovaSemSenha: true,
  };
}

describe("⚠⚠ o painel rola até si e recebe o FOCO ao aparecer", () => {
  let scrollIntoView;

  beforeEach(() => {
    scrollIntoView = jest.fn();
    // ⚠ Instalado no protótipo porque o elemento ainda não existe quando o teste começa.
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    delete Element.prototype.scrollIntoView;
  });

  it("chama scrollIntoView centrado E move o foco para o alertdialog", () => {
    render(
      <ConfirmacaoAcessoProprio
        detalhes={detalhesDeVinculo()}
        razaoSocial="KLAUS NIGRO TRAFEGO PAGO LTDA"
        onConfirmar={jest.fn()}
        onCancelar={jest.fn()}
      />
    );
    const painel = screen.getByRole("alertdialog");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: "center" });
    // ⚠ Foco de verdade: é o que faz o leitor de tela anunciar e o teclado já estar dentro.
    expect(document.activeElement).toBe(painel);
  });

  it("⚠ sem `scrollIntoView` no ambiente (jsdom cru), o painel ainda renderiza — o `?.` é a rede", () => {
    delete Element.prototype.scrollIntoView;
    expect(() =>
      render(
        <ConfirmacaoAcessoProprio detalhes={detalhesDeVinculo()} onConfirmar={jest.fn()} onCancelar={jest.fn()} />
      )
    ).not.toThrow();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("sem detalhes, nada é renderizado e nada é rolado", () => {
    render(<ConfirmacaoAcessoProprio detalhes={null} onConfirmar={jest.fn()} onCancelar={jest.fn()} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("⚠ o botão diz o ATO — vincular ≠ criar acesso próprio", () => {
  it("no modo VINCULO o botão fala em vincular à conta existente", () => {
    render(<ConfirmacaoAcessoProprio detalhes={detalhesDeVinculo()} onConfirmar={jest.fn()} onCancelar={jest.fn()} />);
    expect(screen.getByRole("button", { name: /vincular esta empresa à conta existente/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar acesso próprio/i })).toBeNull();
  });

  it("no modo ACESSO_PROPRIO o botão continua dizendo que CRIA acesso próprio", () => {
    render(<ConfirmacaoAcessoProprio detalhes={detalhesDeAcessoProprio()} onConfirmar={jest.fn()} onCancelar={jest.fn()} />);
    expect(screen.getByRole("button", { name: /criar acesso próprio para esta empresa/i })).toBeInTheDocument();
  });
});
