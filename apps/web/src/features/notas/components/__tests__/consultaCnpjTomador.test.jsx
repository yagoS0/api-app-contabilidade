// A LIGAÇÃO entre o assistente de emissão e a consulta de CNPJ do tomador — não a regra de novo
// (essa é de `notas/lib/__tests__/consultaTomador.test.js`).
//
// ⚠ NENHUM TESTE AQUI TOCA A REDE. O `fetch` da consulta é sempre um dublê, injetado por
// `fetchCnpj`; `consultarCnpj` aceita `fetchImpl` exatamente para isto. Um teste que saísse para a
// internet dependeria da BrasilAPI estar no ar para o build passar.
//
// Os quatro caminhos, e não só o feliz:
//   1. CNPJ encontrado          → nome (e endereço, quando dá) OFERECIDOS, com a origem à vista
//   2. CNPJ não encontrado      → a recusa aparece, e a emissão continua possível
//   3. API fora do ar / rede    → idem, com o texto da escapatória manual
//   4. CPF (11 dígitos)         → NADA acontece: sem chamada, sem mensagem, sem piscar

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EmitirNfseWizard } from "../EmitirNfseWizard";

// ⚠ O ESPELHO AO VIVO REPETE O NOME DO TOMADOR NA MESMA TELA. Por isso as buscas por texto que
// existe nos dois lugares são escopadas com `noFormulario`/`painel` — "Found multiple elements"
// aqui é sinal de que o espelho está funcionando, não de defeito.
//
// ⚠ E O ASSISTENTE TEM DOIS PASSOS: tomador, serviço e valores são blocos da MESMA tela. O
// "Continuar" leva à conferência e só habilita com a nota INTEIRA preenchida — então os casos que
// dizem "a consulta não bloqueia" preenchem o resto e conferem o mesmo desfecho de antes.

const noop = () => {};

const CADASTRO_COMPLETO = {
  cnpj: "39254243000191",
  inscricaoMunicipal: "1.234.567-8",
  codigoServicoNacional: "171201",
  codigoServicoMunicipal: "001",
  rpsSerie: "00001",
};

// ⚠ O município e o código são os do Rio, que existe de verdade na lista oficial versionada
// (`lib/municipios/municipiosIbge.data.js`, linha de `3304557`) — é contra ELA que o código da
// resposta é conferido antes de virar `cMun`.
const RESPOSTA = {
  razao_social: "TOMADOR EXEMPLO LTDA",
  nome_fantasia: "EXEMPLO",
  descricao_situacao_cadastral: "ATIVA",
  municipio: "RIO DE JANEIRO",
  uf: "RJ",
  codigo_municipio_ibge: "3304557",
  descricao_tipo_de_logradouro: "RUA",
  logradouro: "DA CONCEICAO",
  numero: "77",
  complemento: "SALA 301",
  bairro: "CENTRO",
  cep: "20051-010",
};

function fetchFalso({ status = 200, corpo = RESPOSTA, lanca = false } = {}) {
  return jest.fn(async () => {
    if (lanca) throw new TypeError("Failed to fetch");
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
  });
}

function abrir({ fetchCnpj } = {}) {
  render(
    <EmitirNfseWizard
      companyId="c-1"
      regime="SIMPLES"
      codigoMunicipioIbge="3304557"
      cadastroEmissao={CADASTRO_COMPLETO}
      fetchCnpj={fetchCnpj}
      onEmitir={jest.fn()}
      onClose={noop}
    />
  );
}

function digitar(rotulo, valor) {
  fireEvent.change(screen.getByLabelText(rotulo, { exact: false }), { target: { value: valor } });
}

/** O painel do espelho ao vivo — `<aside aria-label="A nota como ela vai sair">`. */
function painel() {
  return screen.getByRole("complementary", { name: /A nota como ela vai sair/ });
}

/** Tudo o que NÃO é o espelho: o formulário, os avisos e a lista de pendências. */
function noFormulario(matcher, opcoes) {
  return screen.getAllByText(matcher, opcoes).filter((el) => !painel().contains(el));
}

/** O resto da nota, para o "Continuar" poder responder sobre o que estes casos perguntam. */
function completarORestoDaNota() {
  digitar("Descrição do serviço", "Consultoria contábil");
  digitar("Valor dos serviços", "1500");
  digitar("Total de tributos do Simples Nacional", "6");
}

const CNPJ = "12345678000199";

describe("1) CNPJ encontrado — a consulta OFERECE, e diz de onde veio", () => {
  test("preenche a razão social e marca a origem no rótulo", async () => {
    const f = fetchFalso();
    abrir({ fetchCnpj: f });
    digitar("CNPJ ou CPF do tomador", CNPJ);

    await waitFor(() => expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("TOMADOR EXEMPLO LTDA"));
    // O nome aparece no bloco da consulta E no espelho ao vivo.
    expect(noFormulario(/TOMADOR EXEMPLO LTDA/).length).toBeGreaterThan(0);
    expect(within(painel()).getByText(/TOMADOR EXEMPLO LTDA/)).toBeInTheDocument();
    // A origem aparece em DOIS lugares: no rótulo do nome e no do endereço — os dois vieram da
    // consulta, e cada campo responde por si.
    expect(screen.getAllByText(/\(da Receita\)/)).toHaveLength(2);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain(CNPJ);
  });

  // ⚠ O endereço só é preenchido COMPLETO — os cinco campos que o backend exige.
  test("preenche o endereço inteiro quando os cinco campos vêm, com o cMun conferido no IBGE", async () => {
    abrir({ fetchCnpj: fetchFalso() });
    digitar("CNPJ ou CPF do tomador", CNPJ);

    await screen.findByText(/Endereço preenchido/);
    expect(screen.getByLabelText(/Código do município/)).toHaveValue("3304557");
    expect(screen.getByLabelText(/^CEP/)).toHaveValue("20051010");
    expect(screen.getByLabelText(/Logradouro/)).toHaveValue("RUA DA CONCEICAO");
    expect(screen.getByLabelText(/Número/)).toHaveValue("77");
    expect(screen.getByLabelText(/Bairro/)).toHaveValue("CENTRO");
  });

  // ⚠ O CASO QUE DECIDE O DESENHO DO ENDEREÇO: faltando um pedaço, NADA é preenchido — e o passo 1
  // continua andando. Preencher 4 de 5 deixaria o endereço PARCIAL, que o assistente trata como
  // problema bloqueante: uma consulta bem-sucedida viraria bloqueio da emissão.
  test("resposta sem o número não preenche endereço nenhum, e não trava o Continuar", async () => {
    abrir({ fetchCnpj: fetchFalso({ corpo: { ...RESPOSTA, numero: "" } }) });
    digitar("CNPJ ou CPF do tomador", CNPJ);

    expect(await screen.findByText(/O endereço NÃO foi preenchido/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Logradouro/)).toHaveValue("");
    expect(screen.getByLabelText(/Código do município/)).toHaveValue("");
    // A consulta que falha em parte não acrescenta pendência nenhuma: com o resto preenchido, o
    // caminho segue exatamente como seguiria sem consulta alguma.
    completarORestoDaNota();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
  });

  // Situação ≠ ATIVA vem de graça na mesma resposta e muda a conversa — mas é AVISO, não bloqueio.
  test("tomador BAIXADO na Receita vira aviso, sem impedir a emissão", async () => {
    abrir({ fetchCnpj: fetchFalso({ corpo: { ...RESPOSTA, descricao_situacao_cadastral: "BAIXADA" } }) });
    digitar("CNPJ ou CPF do tomador", CNPJ);

    expect(await screen.findByText(/Situação cadastral do tomador na Receita: BAIXADA/)).toBeInTheDocument();
    completarORestoDaNota();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
  });

  // ⚠ Não dispara a cada tecla, e não repete o mesmo CNPJ.
  test("editar outro campo não dispara uma segunda consulta do mesmo CNPJ", async () => {
    const f = fetchFalso();
    abrir({ fetchCnpj: f });
    digitar("CNPJ ou CPF do tomador", CNPJ);
    await waitFor(() => expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("TOMADOR EXEMPLO LTDA"));

    digitar("E-mail", "contato@exemplo.com.br");
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
  });
});

describe("2) CNPJ não encontrado — a recusa aparece e a emissão segue possível", () => {
  test("404 mostra o motivo e NÃO bloqueia o passo 1", async () => {
    abrir({ fetchCnpj: fetchFalso({ status: 404 }) });
    digitar("CNPJ ou CPF do tomador", CNPJ);

    expect(await screen.findByText(/não encontrado na base da Receita/)).toBeInTheDocument();
    // A frase que impede a consulta de virar portão.
    expect(screen.getByText(/a emissão segue normalmente/)).toBeInTheDocument();

    digitar("Nome ou razão social", "TOMADOR DIGITADO À MÃO");
    completarORestoDaNota();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    // Chegou à conferência: o botão Emitir só existe lá.
    expect(screen.getByRole("button", { name: /Emitir nota/ })).toBeInTheDocument();
  });
});

describe("3) API fora do ar — mesma regra, texto da escapatória manual", () => {
  test("queda de rede não impede emitir", async () => {
    abrir({ fetchCnpj: fetchFalso({ lanca: true }) });
    digitar("CNPJ ou CPF do tomador", CNPJ);

    expect(await screen.findByText(/preencha à mão/)).toBeInTheDocument();
    digitar("Nome ou razão social", "TOMADOR DIGITADO À MÃO");
    completarORestoDaNota();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
  });

  test("500 idem — e o botão permite tentar de novo", async () => {
    const f = fetchFalso({ status: 500 });
    abrir({ fetchCnpj: f });
    digitar("CNPJ ou CPF do tomador", CNPJ);
    await screen.findByText(/preencha à mão/);

    fireEvent.click(screen.getByRole("button", { name: /consultar Receita/i }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });
});

describe("4) CPF — NADA acontece", () => {
  // ⚠ A BrasilAPI é base de CNPJ. Perguntar por CPF devolveria "não encontrado" para todo tomador
  // pessoa física — uma recusa que não significa nada, na tela de quem não fez nada de errado.
  test("11 dígitos não chamam a rede e não escrevem uma linha na tela", async () => {
    const f = fetchFalso();
    abrir({ fetchCnpj: f });
    digitar("CNPJ ou CPF do tomador", "12345678909");

    await waitFor(() => expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled());
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByText(/Receita/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /consultar Receita/i })).not.toBeInTheDocument();
    // O CPF continua valendo como documento do tomador — nada do que falta é por causa dele.
    digitar("Nome ou razão social", "MARIA DA SILVA");
    completarORestoDaNota();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
    expect(f).not.toHaveBeenCalled();
  });

  test("um CNPJ consultado que vira CPF apaga o painel — sem deixar recusa órfã na tela", async () => {
    const f = fetchFalso({ status: 404 });
    abrir({ fetchCnpj: f });
    digitar("CNPJ ou CPF do tomador", CNPJ);
    await screen.findByText(/não encontrado na base da Receita/);

    digitar("CNPJ ou CPF do tomador", "12345678909");
    await waitFor(() =>
      expect(screen.queryByText(/não encontrado na base da Receita/)).not.toBeInTheDocument()
    );
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("o que o contador digitou SOBREVIVE a uma consulta nova", () => {
  test("nome digitado antes da consulta não é sobrescrito, e os dois lados ficam à vista", async () => {
    abrir({ fetchCnpj: fetchFalso() });
    digitar("Nome ou razão social", "NOME QUE O CONTADOR ESCREVEU");
    digitar("CNPJ ou CPF do tomador", CNPJ);

    expect(await screen.findByText(/O nome digitado foi mantido/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("NOME QUE O CONTADOR ESCREVEU");
    expect(screen.getByText(/\(digitado\)/)).toBeInTheDocument();
    // O outro lado não some: a razão social da Receita continua na tela, com um botão para adotá-la.
    expect(noFormulario(/TOMADOR EXEMPLO LTDA/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /usar o da Receita/i }));
    expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("TOMADOR EXEMPLO LTDA");
  });

  test("nome digitado DEPOIS da consulta sobrevive a uma segunda consulta do mesmo CNPJ", async () => {
    const f = fetchFalso();
    abrir({ fetchCnpj: f });
    digitar("CNPJ ou CPF do tomador", CNPJ);
    await waitFor(() => expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("TOMADOR EXEMPLO LTDA"));

    digitar("Nome ou razão social", "CORRIGIDO PELO CONTADOR");
    fireEvent.click(screen.getByRole("button", { name: /consultar Receita/i }));

    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("CORRIGIDO PELO CONTADOR");
  });

  test("endereço digitado à mão não é apagado pela consulta", async () => {
    abrir({ fetchCnpj: fetchFalso() });
    digitar("Código do município", "3550308");
    digitar("CNPJ ou CPF do tomador", CNPJ);

    await waitFor(() => expect(screen.getByLabelText(/Nome ou razão social/)).toHaveValue("TOMADOR EXEMPLO LTDA"));
    expect(screen.getByLabelText(/Código do município/)).toHaveValue("3550308");
    expect(screen.getByLabelText(/Logradouro/)).toHaveValue("");
  });
});
