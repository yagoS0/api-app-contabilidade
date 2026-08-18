// A LIGAÇÃO ENTRE O ASSISTENTE E A DECLARAÇÃO — não a regra de novo (essa é de
// `notas/lib/__tests__/declaracaoNfse.test.js`).
//
// Os quatro defeitos que este arquivo tranca:
//   1. o payload saía SEM `totTrib.pTotTribSN`, exigido quando a nota é declarada como Simples.
//      Sem ele, `MISSING_P_TOT_TRIB_SN` — que a rota não mapeia, então a nota era gravada como
//      `rejected`, parecendo rejeição fiscal da prefeitura;
//   2. a tela não mostrava o regime que a nota vai DECLARAR (`opSimpNac`), nem as recusas que ele
//      provoca — o contador só descobria depois de gastar a emissão;
//   3. o `confirm` repetia dois campos de sete;
//   4. a tela de resultado prometia que a nota apareceria "na lista assim que houver resposta" —
//      impossível: a lista vem de `PortalInvoice` (captura do ADN) e a nota vai para `ServiceInvoice`.

import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EmitirNfseWizard } from "../EmitirNfseWizard";

// ⚠ O ASSISTENTE TEM DOIS PASSOS, NÃO QUATRO — tomador, serviço e valores são blocos da MESMA
// tela, com o espelho ao vivo ao lado. Estes testes deixaram de contar cliques em "Continuar"
// (eram três) e passaram a preencher a nota e conferir o desfecho, que é o que eles sempre
// quiseram dizer.
//
// ⚠ E O ESPELHO REPETE OS DADOS DA NOTA NA MESMA TELA, DE PROPÓSITO. Por isso as buscas por texto
// que existe nos dois lugares são escopadas: `noFormulario` exclui o painel. Sem isso, "o nome
// aparece" viraria "Found multiple elements" — que é sinal de que o espelho está funcionando, não
// de defeito.

const noop = () => {};

// ⚠ O município emissor vem PREENCHIDO por padrão aqui porque, sem ele, a empresa não emite e o
// assistente trava no primeiro passo — os demais testes falariam pelo motivo errado. O caso da
// ausência tem teste próprio, no fim do arquivo.
// ⚠ E o cadastro de emissão também vem COMPLETO por padrão, pelo mesmo motivo: `buildMissingFields`
// recusa a emissão sem ele, e o assistente passou a dizer isso no passo 1. Os valores são os do
// exemplo real de `docs/nfse-preenchimento.md` §12.
const CADASTRO_COMPLETO = {
  cnpj: "39254243000191",
  inscricaoMunicipal: "1.234.567-8",
  codigoServicoNacional: "171201",
  codigoServicoMunicipal: "001",
  rpsSerie: "00001",
};

// ⚠ NENHUM TESTE PODE TOCAR A REDE. O assistente consulta o CNPJ do tomador ao completar os 14
// dígitos, e `ateOsValores` digita um CNPJ — então o `fetch` da consulta é SEMPRE injetado. Aqui
// ele é um dublê que nunca resolve: estes testes são sobre a emissão, não sobre a consulta (essa
// tem arquivo próprio, `consultaCnpjTomador.test.jsx`), e uma promessa pendente mantém a tela
// exatamente como estes casos a descrevem.
const FETCH_QUE_NUNCA_RESPONDE = () => new Promise(() => {});

function abrir({
  onEmitir = jest.fn(async () => ({ status: "issued", nfse: {} })),
  regime = "SIMPLES",
  codigoMunicipioIbge = "3304557",
  cadastroEmissao = CADASTRO_COMPLETO,
  fetchCnpj = FETCH_QUE_NUNCA_RESPONDE,
} = {}) {
  render(
    <EmitirNfseWizard
      companyId="c-1"
      regime={regime}
      codigoMunicipioIbge={codigoMunicipioIbge}
      cadastroEmissao={cadastroEmissao}
      fetchCnpj={fetchCnpj}
      onEmitir={onEmitir}
      onClose={noop}
    />
  );
  return { onEmitir };
}

function digitar(rotulo, valor) {
  fireEvent.change(screen.getByLabelText(rotulo, { exact: false }), { target: { value: valor } });
}

function continuar() {
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
}

/** O painel do espelho ao vivo — `<aside aria-label="A nota como ela vai sair">`. */
function painel() {
  return screen.getByRole("complementary", { name: /A nota como ela vai sair/ });
}

/** Tudo o que NÃO é o espelho: o formulário, os avisos e a lista de pendências. */
function noFormulario(matcher, opcoes) {
  return screen.getAllByText(matcher, opcoes).filter((el) => !painel().contains(el));
}

// Preenche a nota inteira MENOS o percentual do Simples — o campo que os primeiros casos exercitam.
function ateOsValores() {
  digitar("CNPJ ou CPF do tomador", "12345678000199");
  digitar("Nome ou razão social", "ACME LTDA");
  digitar("Descrição do serviço", "Consultoria contábil");
  digitar("Competência", "2026-08");
  digitar("Valor dos serviços", "1500");
  digitar("Alíquota de ISS", "2");
}

describe("o campo que faltava — pTotTribSN", () => {
  it("sem o percentual o assistente NÃO deixa avançar, e o botão diz por quê", () => {
    abrir();
    ateOsValores();
    const botao = screen.getByRole("button", { name: /Continuar/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringContaining("percentual total de tributos"));
    expect(screen.getByText(/recusa a emissão sem ele/)).toBeInTheDocument();
  });

  it("o payload leva `totTrib.pTotTribSN` e o `issRetido` como booleano explícito", async () => {
    const onEmitir = jest.fn(async () => ({ status: "issued", nfse: { numeroNfse: "1001" } }));
    jest.spyOn(window, "confirm").mockReturnValue(true);
    abrir({ onEmitir });
    ateOsValores();
    digitar("Total de tributos do Simples Nacional", "6,84");
    fireEvent.click(screen.getByRole("checkbox"));
    continuar();
    fireEvent.click(screen.getByRole("button", { name: /Emitir nota/ }));
    await screen.findByText(/Nota autorizada|Nota registrada/);

    const payload = onEmitir.mock.calls[0][0];
    expect(payload.totTrib).toEqual({ pTotTribSN: 6.84 });
    expect(payload.servico.issRetido).toBe(true);
    expect(payload.companyId).toBe("c-1");
    window.confirm.mockRestore();
  });
});

describe("as recusas do servidor aparecem ANTES do clique", () => {
  it("Simples resolve e mostra o opSimpNac que vai no XML", () => {
    abrir({ regime: "SIMPLES" });
    ateOsValores();
    // No bloco do regime E no espelho ao vivo — a mesma leitura, nos dois lugares onde ela é lida.
    expect(noFormulario(/Simples Nacional — ME\/EPP \(opSimpNac 3\)/)).toHaveLength(1);
    expect(within(painel()).getByText(/Simples Nacional — ME\/EPP \(opSimpNac 3\)/)).toBeInTheDocument();
  });

  // ⚠ A empresa do Lucro Presumido saía declarada como Simples ME/EPP. Hoje ela declara
  // `opSimpNac 1` — e a emissão para, porque o grupo `totTrib` do não optante não está confirmado.
  it("Lucro Presumido declara opSimpNac 1 e a emissão fica bloqueada com o motivo", () => {
    abrir({ regime: "LUCRO_PRESUMIDO" });
    ateOsValores();
    expect(noFormulario(/Não optante pelo Simples Nacional \(opSimpNac 1\)/)).toHaveLength(1);
    expect(screen.getByText("Presumido")).toBeInTheDocument();
    // A explicação inteira aparece UMA vez (no bloco do regime); a lista de pendências e o
    // `title` do botão levam a versão curta.
    expect(screen.getAllByText(/estrutura desse grupo no XML ainda não foi confirmada/)).toHaveLength(1);
    expect(screen.getByText(/ainda não está liberada \(falta confirmar/)).toBeInTheDocument();
    // O percentual do Simples não é pedido a quem não é do Simples.
    expect(screen.queryByLabelText(/Total de tributos do Simples Nacional/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
  });

  it("empresa sem regime cadastrado não é dada como Simples, e não avança", () => {
    abrir({ regime: null });
    ateOsValores();
    expect(screen.getByText("não cadastrado")).toBeInTheDocument();
    expect(screen.getAllByText(/não tem regime tributário cadastrado/)).toHaveLength(1);
    const botao = screen.getByRole("button", { name: /Continuar/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringContaining("Fiscal → Cadastro"));
  });

  // ⚠ Com retenção o provedor exige alíquota > 0 (E0625). Recusar aqui poupa uma emissão.
  it("ISS retido sem alíquota é recusado na tela, não no servidor", () => {
    abrir();
    digitar("CNPJ ou CPF do tomador", "12345678000199");
    digitar("Nome ou razão social", "ACME LTDA");
    digitar("Descrição do serviço", "Consultoria");
    digitar("Valor dos serviços", "1500");
    digitar("Total de tributos do Simples Nacional", "6");
    fireEvent.click(screen.getByRole("checkbox"));
    const botao = screen.getByRole("button", { name: /Continuar/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringContaining("alíquota"));
  });
});

describe("o confirm repete a declaração inteira", () => {
  it("o texto do confirm traz alíquota, retenção, competência, regime e percentual", () => {
    const confirmar = jest.spyOn(window, "confirm").mockReturnValue(false);
    abrir();
    ateOsValores();
    digitar("Total de tributos do Simples Nacional", "6");
    continuar();
    fireEvent.click(screen.getByRole("button", { name: /Emitir nota/ }));

    const texto = confirmar.mock.calls[0][0];
    expect(texto).toContain("ACME LTDA");
    expect(texto).toContain("12.345.678/0001-99");
    expect(texto).toContain("2,00%");
    expect(texto).toContain("PRESTADOR");
    expect(texto).toContain("2026-08");
    expect(texto).toContain("6,00%");
    expect(texto).toContain("opSimpNac 3");
    confirmar.mockRestore();
  });

  it("recusar no confirm NÃO emite", () => {
    const onEmitir = jest.fn();
    jest.spyOn(window, "confirm").mockReturnValue(false);
    abrir({ onEmitir });
    ateOsValores();
    digitar("Total de tributos do Simples Nacional", "6");
    continuar();
    fireEvent.click(screen.getByRole("button", { name: /Emitir nota/ }));
    expect(onEmitir).not.toHaveBeenCalled();
    window.confirm.mockRestore();
  });
});

describe("depois de emitida, a tela não promete o que não pode acontecer", () => {
  async function emitir(resposta) {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    abrir({ onEmitir: jest.fn(async () => resposta) });
    ateOsValores();
    digitar("Total de tributos do Simples Nacional", "6");
    continuar();
    fireEvent.click(screen.getByRole("button", { name: /Emitir nota/ }));
    await screen.findByText(/Nota autorizada|Nota registrada/);
    window.confirm.mockRestore();
  }

  it("a frase antiga sumiu e a nova explica POR QUE a nota não está na lista", async () => {
    await emitir({ status: "pending" });
    expect(screen.queryByText(/aguardando o retorno da prefeitura/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aparece na lista assim que houver resposta/)).not.toBeInTheDocument();
    expect(screen.getByText(/Esta nota ainda não aparece na lista/)).toBeInTheDocument();
    expect(screen.getByText(/Padrão Nacional \(ADN\)/)).toBeInTheDocument();
    expect(screen.getByText(/Buscar NFS-e/)).toBeInTheDocument();
  });

  // ⚠ Quando o SERVIDOR diz que nada saiu, é o servidor que fala — o recado não pode ser trocado
  // por texto genérico de espera.
  it('"pending" com recado do servidor continua dizendo que a nota NÃO foi emitida', async () => {
    await emitir({ status: "pending", message: "certificado/endpoint NFSe não configurado" });
    expect(screen.getByText(/A nota ainda NÃO foi emitida/)).toBeInTheDocument();
    expect(screen.getByText(/certificado\/endpoint NFSe não configurado/)).toBeInTheDocument();
  });

  it("o resultado repete tomador, documento, valor e a chave", async () => {
    await emitir({ status: "issued", nfse: { numeroNfse: "1001", chaveAcesso: "3304abc" } });
    const lista = screen.getByText("Documento").closest("dl");
    expect(within(lista).getByText("ACME LTDA")).toBeInTheDocument();
    expect(within(lista).getByText("12.345.678/0001-99")).toBeInTheDocument();
    expect(within(lista).getByText("1001")).toBeInTheDocument();
    expect(within(lista).getByText("R$ 1.500,00")).toBeInTheDocument();
    expect(within(lista).getByText("3304abc")).toBeInTheDocument();
  });
});

// ⚠ SEM MUNICÍPIO EMISSOR A EMPRESA NÃO EMITE — e o servidor recusa com
// `NFSE_MUNICIPIO_NAO_CONFIGURADO` (`resolverCLocEmi`), depois de já ter reservado o número.
// O impedimento é da EMPRESA, não da nota: ele aparece no PRIMEIRO passo, antes de o contador
// preencher tomador, serviço e valores para só então ouvir "não".
describe("empresa sem município emissor não chega ao botão Emitir", () => {
  it("bloqueia já no passo 1, com o motivo e onde resolver", () => {
    abrir({ codigoMunicipioIbge: null });

    expect(screen.getByText(/Esta empresa ainda não pode emitir nota de serviço/)).toBeInTheDocument();
    // A explicação inteira aparece UMA vez (no bloco do impedimento); a lista de pendências do
    // passo leva a versão curta. As duas dizem onde resolver — é o que o contador precisa.
    expect(screen.getAllByText(/recusa a emissão inteira/)).toHaveLength(1);
    expect(screen.getAllByText(/Editar cadastro → Inscrições/)).toHaveLength(2);

    const botao = screen.getByRole("button", { name: /Continuar/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringContaining("município emissor"));
  });

  it("com o município cadastrado o bloqueio some e a nota anda até a conferência", () => {
    abrir({ codigoMunicipioIbge: "3304557" });

    expect(screen.queryByText(/Esta empresa ainda não pode emitir nota de serviço/)).not.toBeInTheDocument();
    ateOsValores();
    digitar("Total de tributos do Simples Nacional", "6");
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
  });
});

// ⚠ A RECUSA `company_missing_fields` NÃO TINHA LEITOR NA INTERFACE.
// `buildMissingFields` (`api/application/nfse/NfseService.js`) recusa a emissão sem `cnpj`,
// `inscricaoMunicipal`, `codigoServicoNacional`, `codigoServicoMunicipal` e `rpsSerie`; a rota
// devolve `400 { error: "company_missing_fields", missing: [...] }` — e essa lista morria ali.
// Três dos cinco campos, ainda por cima, não existiam em formulário nenhum: a emissão recusava por
// eles e não havia por onde preenchê-los. Metade do defeito era o campo; a outra metade era esta.
describe("empresa sem a configuração de emissão não chega ao botão Emitir", () => {
  it("bloqueia no passo 1 nomeando CADA campo que falta e ONDE preenchê-lo", () => {
    abrir({ cadastroEmissao: { cnpj: "39254243000191", inscricaoMunicipal: "1.234.567-8" } });

    const bloco = screen.getByText(/Esta empresa ainda não pode emitir nota de serviço/).closest("div");
    // Nome de coluna (`codigoServicoNacional`) não diz nada a ninguém; rótulo e lugar, sim.
    expect(bloco).toHaveTextContent("Código nacional do serviço");
    expect(bloco).toHaveTextContent("Código municipal do serviço");
    expect(bloco).toHaveTextContent("Série da DPS");
    expect(bloco).toHaveTextContent("Editar cadastro → Emissão de NFS-e");
    // E não acusa o que ESTÁ preenchido.
    expect(bloco).not.toHaveTextContent("Inscrição municipal");

    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
  });

  it("a inscrição municipal também é exigida — ela está na lista do servidor", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_COMPLETO, inscricaoMunicipal: null } });

    const bloco = screen.getByText(/Esta empresa ainda não pode emitir nota de serviço/).closest("div");
    expect(bloco).toHaveTextContent("Inscrição municipal");
    expect(bloco).toHaveTextContent("Editar cadastro → Inscrições");
  });

  it("município ausente E configuração ausente aparecem JUNTOS — são recusas diferentes", () => {
    // O município é recusado por `resolverCLocEmi` (`NFSE_MUNICIPIO_NAO_CONFIGURADO`) e o resto por
    // `buildMissingFields`. Mostrar um de cada vez faria o contador resolver, voltar e levar outro
    // "não" — que é a experiência que este bloco existe para acabar.
    abrir({ codigoMunicipioIbge: null, cadastroEmissao: {} });

    const bloco = screen.getByText(/Esta empresa ainda não pode emitir nota de serviço/).closest("div");
    expect(bloco).toHaveTextContent("recusa a emissão inteira");
    expect(bloco).toHaveTextContent("Série da DPS");
  });

  it("com tudo cadastrado o bloqueio some e a nota anda até a conferência", () => {
    abrir();

    expect(screen.queryByText(/Esta empresa ainda não pode emitir nota de serviço/)).not.toBeInTheDocument();
    ateOsValores();
    digitar("Total de tributos do Simples Nacional", "6");
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
  });

  it("⚠ sem a prop o assistente NÃO afirma que falta tudo — quem não sabe, cala", () => {
    // A prop ausente quer dizer "esta tela não recebeu o cadastro", não "o cadastro está vazio".
    // Tratar as duas como a mesma coisa bloquearia a emissão de empresa configurada.
    abrir({ cadastroEmissao: null });
    expect(screen.queryByText(/Esta empresa ainda não pode emitir nota de serviço/)).not.toBeInTheDocument();
  });
});
