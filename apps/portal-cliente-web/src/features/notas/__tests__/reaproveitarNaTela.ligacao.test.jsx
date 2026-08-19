// A LIGAÇÃO DO REAPROVEITAMENTO — clicar numa nota emitida ABRE MESMO a emissão pré-preenchida.
//
// ⚠⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO. `reaproveitarNota.js` já tem a
// suíte da REGRA ao lado (`emitir/lib/__tests__/reaproveitarNota.test.js`, 35 casos, com a
// varredura de identificadores); nada dela é reescrito aqui. O que este arquivo prova é a CORRENTE
// INTEIRA, e ela tem três elos, cada um capaz de existir sozinho e não servir para nada:
//
//     NotasPage (o botão)  →  AppShell (o estado que atravessa a troca de tela)  →  EmitirNotaPage
//
// Por isso o teste renderiza a CASCA, não as páginas soltas: um `aoReaproveitar` que ninguém passa,
// ou um `modelo` que a casca esquece na navegação, passaria em qualquer teste de página isolada.
//
// ⚠⚠ NADA É EMITIDO. `api.emitirNfse` é um espião que EXPLODE se for chamado, e um `afterEach`
// confere que ele continua intocado em todos os casos. O formulário nunca é submetido.
// ⚠ NENHUM TESTE TOCA A REDE: o `fetch` global explode.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { AppShell } from "../../shell/AppShell";

const CNPJ_DA_EMPRESA = "11222333000181";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: CNPJ_DA_EMPRESA,
  myRole: "OWNER",
  emissaoNfseLiberada: true,
  legacyCompany: {
    regimeTributario: "SIMPLES_NACIONAL",
    inscricaoMunicipal: "1234567",
    codigoServicoNacional: "010101",
    codigoServicoMunicipal: "1.01",
    rpsSerie: "1",
  },
};

/** A forma REAL do payload do cliente (`serializeInvoice`, `apps/api/src/routes/portalInvoices.js`). */
function nota(patch = {}) {
  return {
    invoiceId: "inv-1001",
    type: "NFSE",
    numero: "13000",
    competencia: "2026-06",
    issueDate: "2026-06-10T00:00:00.000Z",
    status: "EMITIDA",
    total: 2300,
    emitente: { nome: "ACME SERVICOS LTDA", cnpj: CNPJ_DA_EMPRESA },
    tomador: { nome: "TOMADOR EXEMPLO LTDA", cnpjCpf: "44555666000177" },
    updatedAt: "2026-06-11T00:00:00.000Z",
    hasXml: true,
    hasPdf: false,
    ...patch,
  };
}

function respostaDeNotas(lista) {
  return {
    data: lista,
    page: 1,
    limit: 25,
    total: lista.length,
    summary: { totalInvoices: lista.length, totalAmount: 2300, pageAmount: 2300 },
  };
}

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getCompanies").mockResolvedValue([EMPRESA]);
  jest.spyOn(api, "getInvoices").mockResolvedValue(respostaDeNotas([nota()]));
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "consultarCnpj").mockResolvedValue({
    ok: false,
    motivo: "nao_encontrado",
    mensagem: "CNPJ não encontrado na base da Receita.",
  });
  // ⚠⚠ EMITIR É ATO FISCAL IRREVERSÍVEL. Aqui ele é uma armadilha, não um mock complacente.
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  window.location.hash = "";
  jest.restoreAllMocks();
});

/**
 * Abre o app na aba Notas — pela navegação de verdade, como o cliente faz.
 *
 * ⚠⚠ DENTRO DO `StrictMode`, E ISSO É O CASO DE REGRESSÃO MAIS IMPORTANTE DESTE ARQUIVO. É assim
 * que o app roda de verdade (`src/main.jsx`), e o React 19 executa **cada efeito duas vezes** na
 * montagem. O pré-preenchimento nasceu com uma guarda de "já apliquei" num ref: na segunda passada
 * o efeito que zera o formulário na troca de empresa rodava de novo e limpava tudo, e este não
 * repunha nada — o painel dizia "preenchido a partir da nota nº X" em cima de um formulário
 * VAZIO. **Os testes passavam**, porque `render()` sem `StrictMode` executa cada efeito uma vez; o
 * defeito só apareceu abrindo o portal no navegador. Tirar o `StrictMode` daqui é reabrir essa
 * porta.
 */
async function abrirNotas() {
  render(
    <StrictMode>
      <AppShell user={{ defaultClientId: "pc-001" }} />
    </StrictMode>
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Notas" }));
  await act(async () => {});
  await screen.findByText("Notas emitidas");
}

const botaoModelo = () => screen.getByRole("button", { name: "Usar como modelo" });
const campo = (id) => document.getElementById(id);

describe("clicar numa nota emitida abre a EMISSÃO pré-preenchida", () => {
  test("o tomador vem da nota, e a tela diz de qual nota veio", async () => {
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});

    // Trocou de tela de verdade: quem está montado agora é a emissão.
    await screen.findByRole("button", { name: "Emitir nota" });
    expect(campo("emitir-doc").value).toBe("44555666000177");
    expect(campo("emitir-nome").value).toBe("TOMADOR EXEMPLO LTDA");
    expect(screen.getByText(/Preenchido a partir da nota nº 13000/)).toBeInTheDocument();
  });

  // ⚠⚠ INVERTIDO EM 19/08/2026 — e este é o caso mais caro do arquivo, nas duas versões.
  //
  //   18/08/2026 — o dono pediu *"apenas apagando o valor"*: este caso media `value === ""` e que
  //                o total da original NÃO tivesse vazado para o formulário.
  //   19/08/2026 — ele pediu a nota *"100% idêntica"* e, confrontado com a contradição, respondeu
  //                **"copia"**. O que era vazamento virou o comportamento pedido.
  //
  // ⚠ O caso NÃO foi apagado nem relaxado: ele mede o oposto, e mede a FORMA — que é onde estava o
  // risco real da mudança. O campo é mascarado, e um número cru (`2300`) ou a string do backend
  // (`"2300.00"`) entrariam nele como lixo silencioso.
  test("⚠⚠ o VALOR vem COPIADO, mascarado, e a tela pede CONFERÊNCIA", async () => {
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    // ⚠ A forma canônica do campo, não o número cru nem a string do backend.
    expect(campo("emitir-valor").value).toBe("2.300,00");
    expect(campo("emitir-valor").value).not.toBe("2300");
    expect(campo("emitir-valor").value).not.toBe("2300.00");

    // ⚠ A frase de 18/08 NÃO pode ter sobrevivido ao comportamento — ela já estaria mentindo.
    expect(screen.queryByText(/O valor NÃO foi copiado/i)).not.toBeInTheDocument();
    // ⚠ E a linha nova é conferência, não instrução de digitar.
    expect(screen.getByText(/confira antes de emitir/i)).toBeInTheDocument();
  });

  // ⚠⚠ A PROVA DO PAYLOAD, SEM EMITIR NADA.
  //
  // O risco da mudança de 19/08/2026 não é o campo — é o que sai dele. `validators/nfsePayload.js`
  // espera `valorServicos` NÚMERO, e `montarPayload` faz `lerValorDoCampo(form.valorServicos)`
  // (`EmitirNotaPage.jsx:253`). Se o valor copiado entrasse no campo numa forma que a máscara não
  // lê, `lerValorDoCampo` devolveria `null` e a nota sairia SEM VALOR — em silêncio, porque o campo
  // pareceria preenchido.
  //
  // ⚠ NÃO DÁ PARA MEDIR ISSO SUBMETENDO O FORMULÁRIO: emitir é ato fiscal irreversível, e nesta
  // suíte `api.emitirNfse` é uma armadilha que explode. A medição é pelo RESUMO da tela, e ela é
  // equivalente por construção: o resumo lê `lerValorDoCampo(form.valorServicos)` na MESMA linha de
  // código que o payload (`EmitirNotaPage.jsx:643`, cujo comentário diz "este é o mesmo
  // `lerValorDoCampo` que `montarPayload` usa"). O número que aparece ali É o número que iria.
  test("⚠⚠ o valor copiado é RELIDO como número — o resumo prova o que iria no payload", async () => {
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    // R$ 2.300,00 — a nota de origem vale 2300, e o resumo só mostra isso se a releitura deu 2300.
    const total = document.querySelector(".total strong");
    expect(total.textContent).toBe("R$ 2.300,00");
  });

  test("⚠ e sem total na origem o resumo NÃO inventa zero — fica no traço", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ total: null })]));
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    const total = document.querySelector(".total strong");
    expect(total.textContent).not.toBe("R$ 0,00");
  });

  // ⚠ NOTA SEM TOTAL continua abrindo o campo VAZIO — nunca "0,00", que afirmaria que a nota vale
  // zero. Este ramo é o que sobrou, intacto, da decisão de 18/08.
  test("nota de origem sem total: campo VAZIO, com o motivo certo", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ total: null })]));
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    expect(campo("emitir-valor").value).toBe("");
    expect(campo("emitir-valor").value).not.toBe("0,00");
    // ⚠ A frase do VALOR, não a da descrição — as duas começam igual ("não veio da nota de
    // origem"), e um regex frouxo aqui casaria com a errada e passaria por acidente.
    expect(screen.getByText(/O valor não veio da nota de origem: digite o valor desta nota\./i)).toBeInTheDocument();
  });

  // ⚠⚠ A DESCRIÇÃO CHEGA AO CAMPO — 19/08/2026, pedido do dono.
  //
  // Até aqui ela NUNCA chegava: o contrato do cliente não a trazia, e o campo abria sempre vazio
  // com aviso. Hoje `serializeInvoice` devolve `descricao`, lida da coluna `PortalInvoice.xDescServ`
  // (não de XML parseado na listagem). O que se mede aqui é a CORRENTE: contrato → regra → campo.
  test("⚠⚠ a DESCRIÇÃO da nota de origem chega preenchida no campo", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ descricao: "CONSULTORIA EM GESTAO" })]));
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    expect(campo("emitir-descricao").value).toBe("CONSULTORIA EM GESTAO");
    // ⚠ E o aviso de ausência NÃO aparece, porque não há ausência.
    expect(screen.queryByText(/descrição do serviço não veio da nota de origem/i)).not.toBeInTheDocument();
  });

  test("⚠ nota SEM descrição (anterior ao backfill): campo vazio, com o aviso — o de antes", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ descricao: null })]));
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    expect(campo("emitir-descricao").value).toBe("");
    expect(screen.getByText(/A descrição do serviço não veio da nota de origem/i)).toBeInTheDocument();
  });

  // ⚠ NOTA NOVA É NOTA NOVA: nenhum identificador da original pode virar campo do formulário. A
  // varredura profunda está na suíte da regra; aqui a asserção é sobre o que está NA TELA.
  test("nenhum campo do formulário recebe o número da nota de origem", async () => {
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    const valores = Array.from(document.querySelectorAll("form input, form textarea")).map((e) => e.value);
    expect(valores).not.toContain("13000");
    // O número aparece uma vez só, e é no painel que explica a origem — fora do formulário.
    expect(document.querySelector("form").textContent).not.toMatch(/13000/);
  });

  // ⚠ A competência da original é DELA. O campo abre na data de hoje, como qualquer nota nova.
  test("a competência da original não vira a competência da nota nova", async () => {
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    const hoje = new Date();
    const esperada = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    expect(campo("emitir-competencia").value).toBe(esperada);
  });

  // ⚠ O nome copiado entra como DIGITADO: é o que impede a consulta de CNPJ — que o próprio
  // preenchimento do documento dispara — de trocá-lo sozinho pelo da Receita.
  test("o nome copiado sobrevive à consulta do CNPJ que o preenchimento dispara", async () => {
    api.consultarCnpj.mockResolvedValue({
      ok: true,
      situacao: { texto: "ATIVA", ativa: true, motivo: null, data: null },
      bruto: { razao_social: "OUTRO NOME NA RECEITA LTDA" },
    });
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    await waitFor(() => expect(api.consultarCnpj).toHaveBeenCalledWith("44555666000177"));
    await act(async () => {});
    expect(campo("emitir-nome").value).toBe("TOMADOR EXEMPLO LTDA");
    // ⚠ E os dois lados ficam à vista — o digitado vence, mas "por que o nome mudou?" tem resposta.
    expect(screen.getByText("OUTRO NOME NA RECEITA LTDA")).toBeInTheDocument();
  });

  // ⚠ "Começar do zero" é a saída: o painel some e o formulário volta a ser um formulário em
  // branco. Sem ela, o único jeito de largar o modelo seria apagar campo por campo.
  test("Começar do zero limpa o formulário e tira o painel", async () => {
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    fireEvent.click(screen.getByRole("button", { name: "Começar do zero" }));
    await act(async () => {});

    expect(campo("emitir-doc").value).toBe("");
    expect(campo("emitir-nome").value).toBe("");
    expect(screen.queryByText(/Preenchido a partir da nota/)).not.toBeInTheDocument();
  });
});

describe("botão impossível NÃO SOME — fica desabilitado com o motivo", () => {
  test("NF-e não serve de modelo: este portal não emite nota de venda", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ type: "NFE" })]));
    await abrirNotas();

    expect(botaoModelo()).toBeDisabled();
    expect(screen.getByText("só NFS-e")).toBeInTheDocument();
  });

  // ⚠ Ofereceria a empresa como tomadora dela mesma.
  test("nota em que a tomadora é a própria empresa fica desabilitada", async () => {
    api.getInvoices.mockResolvedValue(
      respostaDeNotas([nota({ tomador: { nome: "ACME SERVICOS LTDA", cnpjCpf: CNPJ_DA_EMPRESA } })])
    );
    await abrirNotas();

    expect(botaoModelo()).toBeDisabled();
    expect(screen.getByText("nota recebida")).toBeInTheDocument();
  });

  // ⚠⚠ O PAR POSITIVO: sem ele, uma tela em que o botão nunca funcionasse passaria nos dois casos
  // acima — que é exatamente a forma de defeito que este arquivo existe para pegar.
  test("a NFS-e emitida pela empresa tem o botão HABILITADO", async () => {
    await abrirNotas();
    expect(botaoModelo()).toBeEnabled();
  });
});

describe("os avisos que não podem faltar", () => {
  test("origem CANCELADA: a tela diz que ela continua cancelada", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ status: "CANCELADA" })]));
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    expect(screen.getByText(/continua cancelada/i)).toBeInTheDocument();
    expect(screen.getByText(/não a corrige nem a substitui/i)).toBeInTheDocument();
  });

  test("origem SUBSTITUÍDA: a tela manda conferir, e diz que esta seria uma terceira nota", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ status: "SUBSTITUIDA" })]));
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    expect(screen.getByText(/TERCEIRO documento/i)).toBeInTheDocument();
  });

  test("sempre diz que é uma nota NOVA — mesmo numa origem sem nenhuma ressalva", async () => {
    await abrirNotas();
    fireEvent.click(botaoModelo());
    await act(async () => {});
    await screen.findByRole("button", { name: "Emitir nota" });

    expect(screen.getByText(/nota NOVA, com número novo reservado na emissão/i)).toBeInTheDocument();
  });
});
