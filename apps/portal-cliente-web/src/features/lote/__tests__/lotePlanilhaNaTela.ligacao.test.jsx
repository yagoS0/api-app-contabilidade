// A LIGAÇÃO DO LOTE POR PLANILHA — da aba Notas até a linha conferida.
//
// > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche; se o
// > CNPJ preenchido for de um tomador que já teve antes, só preencher; se não teve consultamos na
// > API; e se a API não retornar nós avisamos isso em uma tela para ajuste daquela nota."*
//
// ⚠⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO. As regras têm suíte própria
// (`lib/__tests__/`); o que este arquivo prova é a CORRENTE: a casca monta Notas, Notas mostra o
// botão, o botão abre a tela, a tela baixa o modelo por Blob, manda a planilha, mostra os quatro
// estados, consulta a Receita **em série**, ajusta a linha e reclassifica.
//
// ⚠⚠ **NADA EMITE.** `api.emitirNfse` é uma armadilha que explode, e o `fetch` global também.
//
// ⚠ Roda dentro do `StrictMode`, como o app (`src/main.jsx`): o React 19 executa cada efeito duas
// vezes, e é assim que guarda de "já fiz isso" morre.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../../api";
import { definirTokens } from "../../../api/sessionStore";
import { AppShell } from "../../shell/AppShell";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: "11222333000181",
  myRole: "OWNER",
  emissaoNfseLiberada: true,
  legacyCompany: { regimeTributario: "SIMPLES_NACIONAL", inscricaoMunicipal: "1234567", rpsSerie: "1" },
};

const RESPOSTA_DE_NOTAS = {
  data: [],
  page: 1,
  limit: 25,
  total: 0,
  summary: { totalInvoices: 0, totalAmount: 0, pageAmount: 0 },
};

let fetchOriginal;
let cliques;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  cliques = [];
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("⚠ nenhum teste desta suíte pode tocar a rede");
  });
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function interceptar() {
    cliques.push({ href: this.href, download: this.download });
  });

  jest.spyOn(api, "getCompanies").mockResolvedValue([EMPRESA]);
  jest.spyOn(api, "getInvoices").mockResolvedValue(RESPOSTA_DE_NOTAS);
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  // ⚠ As funções do lote NÃO são substituídas: o mock é o backend desta suíte, e é ele que garante
  // que todos os estados de linha existam offline. O espião só observa.
  jest.spyOn(api, "lerPlanilhaDoLote");
  jest.spyOn(api, "baixarModeloDoLote");
  jest.spyOn(api, "consultarCnpj");
  // ⚠ Espiões, não substitutos: o mock continua sendo o backend desta suíte. O que se observa é
  // SE e COM O QUÊ a emissão foi chamada.
  jest.spyOn(api, "emitirLoteDeNotas");
  jest.spyOn(api, "consultarLoteEmissao");
  jest.spyOn(api, "retomarLoteEmissao");
  jest.spyOn(api, "retentarLoteEmissao");
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  window.location.hash = "";
  jest.restoreAllMocks();
});

function planilha(nome = "notas.xlsx") {
  return new File(["conteudo"], nome, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function abrirLote() {
  // ⚠ O MOCK É O BACKEND DESTA SUÍTE, e ele confere a sessão como o servidor confere (é o que
  // impede um mock de responder para quem não está logado). A casca recebe o `user` por prop, mas
  // os tokens precisam existir de verdade.
  const sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });

  render(
    <StrictMode>
      <AppShell user={{ defaultClientId: "pc-001" }} />
    </StrictMode>
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("link", { name: "Notas" }));
  // ⚠ O flush precisa passar por uma TAREFA, não só por microtarefas: as abas são `<a href>` e o
  // `useRota` escuta `hashchange`, que o jsdom entrega numa tarefa. Sem isto o `findByText` abaixo
  // fica dependendo do polling de 1s para a rota trocar — e é daí que vinham os timeouts de 5s
  // desta suíte quando a máquina está ocupada.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await screen.findByText("Notas emitidas");
  fireEvent.click(screen.getByRole("button", { name: /Emissão em Lote/i }));
  await act(async () => {});
  await screen.findByText("Emissão em Lote", { selector: "h1" });
}

async function subirPlanilha() {
  const campo = screen.getByLabelText(/Planilha/i);
  fireEvent.change(campo, { target: { files: [planilha()] } });
  await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalled());
  await screen.findByText(/Confira, linha a linha/i);
  // A conferência do município depende da lista oficial, que entra por `import()` dinâmico.
  await waitFor(() => expect(screen.getAllByText(/Rio de Janeiro \/ RJ/).length).toBeGreaterThan(0));
}

/**
 * ⚠⚠ TETO DE TEMPO DESTE ARQUIVO — 20 s, e ele é DAQUI, nunca do `jest.config` (02/09/2026).
 *
 * ⚠⚠ **O PADRÃO DE 5 s NÃO SOBE NA CONFIGURAÇÃO**, e a razão é concreta: foi ele que expôs, em
 * 01/09/2026, uma rota que PENDURAVA (a varredura de notas consultando o banco sem dublê). Um teto
 * global maior teria transformado aquele defeito em *"a suíte está lenta hoje"* — que é exatamente
 * como esta flutuação foi lida por semanas.
 *
 * ⚠⚠ **A MEDIÇÃO QUE JUSTIFICA O NÚMERO** (`jest --json`, 1.434 casos deste app): **17 casos** levam
 * 3 s ou mais, e eles se concentram em **5 arquivos** — este é um deles. O mais pesado marcou
 * 6,3 s. Ou seja: o corte de 5 s cai NO MEIO de uma população densa, e quem estoura não é o teste
 * errado — é o que estava rodando quando a máquina engasgou. Subir teste a teste seria correr atrás
 * de um alvo que muda a cada execução.
 *
 * ⚠ O custo é jsdom montando tabela de verdade (dezenas de células com estilo próprio, várias
 * renderizações por caso). Não há espera, relógio nem rede aqui — em navegador isto é instantâneo.
 * ⚠ Os outros ~1.417 casos deste app continuam com os 5 s de sempre.
 */
jest.setTimeout(20000);

describe("a corrente: da aba Notas à tela de conferência", () => {
  test("⚠ O BOTÃO EXISTE NA ABA NOTAS e abre a tela do lote", async () => {
    await abrirLote();
    expect(screen.getByText("Emissão em Lote", { selector: "h1" })).toBeInTheDocument();
    // ⚠⚠ O RÓTULO É "Emissão em Lote" desde 21/08/2026 (pedido do dono). O antigo era "Preparar
    // lote por planilha", e o comentário aqui dizia *"a tela do outro lado não emite"* — falso
    // desde 20/08/2026, quando ela passou a emitir. Trocado o texto, a CHAVE de navegação e o
    // `data-*` continuam os mesmos: o despacho deste app é por cadeia de `if` com chave em string.
    expect(screen.queryByText(/Preparar lote por planilha/i)).toBeNull();
  });

  test("⚠⚠ o modelo vem por `fetch` autenticado e é entregue como Blob — nunca por `<a href>`", async () => {
    await abrirLote();
    expect(document.querySelector("a[download]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Baixar modelo/i }));
    await waitFor(() => expect(cliques).toHaveLength(1));
    expect(api.baixarModeloDoLote).toHaveBeenCalledWith("pc-001");
    expect(cliques[0].href).toBe("blob:mock");
    expect(cliques[0].download).toBe("modelo-emissao-em-lote.xlsx");
  });

  test("a planilha escolhida é mandada para a empresa do contexto", async () => {
    await abrirLote();
    await subirPlanilha();
    const [companyId, arquivo] = api.lerPlanilhaDoLote.mock.calls[0];
    expect(companyId).toBe("pc-001");
    expect(arquivo.name).toBe("notas.xlsx");
  });
});

describe("⚠⚠ quantas estão prontas e quantas não — sempre à vista", () => {
  test("os dois números aparecem, e batem com as linhas da tabela", async () => {
    await abrirLote();
    await subirPlanilha();

    const prontas = Number(document.querySelector('[data-lote="prontas"]').textContent);
    const naoProntas = Number(document.querySelector('[data-lote="nao-prontas"]').textContent);
    const linhas = document.querySelectorAll("tr[data-estado-lote]");
    expect(prontas + naoProntas).toBe(linhas.length);
    expect(prontas).toBeGreaterThan(0);
    expect(naoProntas).toBeGreaterThan(0);
  });

  test("os quatro estados aparecem desenhados na tabela", async () => {
    await abrirLote();
    await subirPlanilha();
    for (const estado of ["pronta", "conferir", "consultar", "pendente"]) {
      expect(document.querySelector(`tr[data-estado-lote="${estado}"]`)).not.toBeNull();
    }
  });
});

describe("⚠⚠ a conferência do município acontece AQUI — o servidor não tem a lista", () => {
  test("o código válido é resolvido e a tela mostra município E UF", async () => {
    await abrirLote();
    await subirPlanilha();
    expect(screen.getAllByText(/Rio de Janeiro \/ RJ/).length).toBeGreaterThan(0);
  });

  test("⚠⚠ o código que não existe na lista oficial derruba a linha para PENDENTE na tela", async () => {
    await abrirLote();
    await subirPlanilha();

    const aviso = document.querySelector('[data-codigo="municipio_inexistente"]');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toMatch(/9999999/);
    // A MESMA linha voltou do servidor como `conferir`.
    const doServidor = api.lerPlanilhaDoLote.mock.results[0].value;
    const numero = Number(aviso.closest("tr").dataset.linha);
    await expect(doServidor).resolves.toBeTruthy();
    const resposta = await doServidor;
    expect(resposta.linhas.find((l) => l.numero === numero).estado).toBe("conferir");
    expect(aviso.closest("tr").dataset.estadoLote).toBe("pendente");
  });
});

describe("⚠⚠ o segundo passe da consulta sai do NAVEGADOR, em série", () => {
  test("consulta só os CNPJs da lista, e o CPF nunca é consultado", async () => {
    await abrirLote();
    await subirPlanilha();

    fireEvent.click(screen.getByRole("button", { name: /Consultar \d+ CNPJ/i }));
    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2), { timeout: 5000 });

    const consultados = api.consultarCnpj.mock.calls.map(([d]) => String(d).replace(/\D+/g, ""));
    expect(consultados.length).toBeGreaterThan(0);
    for (const doc of consultados) expect(doc).toHaveLength(14);
    // ⚠ CPF NÃO SE CONSULTA — decisão do dono. Os CPFs da planilha estão plantados no mock.
    expect(consultados).not.toContain("12345678909");
  });

  test("⚠ o resultado volta ao servidor no MESMO pedido, como `consultas`", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(screen.getByRole("button", { name: /Consultar \d+ CNPJ/i }));
    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2), { timeout: 5000 });

    const [, , opcoes] = api.lerPlanilhaDoLote.mock.calls[1];
    expect(Object.keys(opcoes.consultas || {}).length).toBeGreaterThan(0);
    // ⚠ E a consulta que FALHOU virou pendência daquela linha, sem derrubar as outras.
    const resposta = await api.lerPlanilhaDoLote.mock.results[1].value;
    const codigos = resposta.linhas.flatMap((l) => (l.pendencias || []).map((p) => p.codigo));
    expect(codigos).toContain("consulta_falhou");
    expect(resposta.resumo.prontas).toBeGreaterThan(0);
  });

  test("depois de consultar, o botão de consulta some — não há o que consultar", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(screen.getByRole("button", { name: /Consultar \d+ CNPJ/i }));
    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Consultar \d+ CNPJ/i })).toBeNull());
  });
});

describe("⚠ ajustar a linha pendente e reclassificar", () => {
  async function abrirAjusteDaLinha(codigo) {
    await abrirLote();
    await subirPlanilha();
    const aviso = document.querySelector(`[data-codigo="${codigo}"]`);
    expect(aviso).not.toBeNull();
    const tr = aviso.closest("tr");
    fireEvent.click(within(tr).getByRole("button", { name: "Ajustar" }));
    await act(async () => {});
    return Number(tr.dataset.linha);
  }

  /**
   * ⚠⚠ O MUNICÍPIO SE ESCOLHE, NUNCA SE DIGITA. Este helper faz o que uma pessoa faz: busca pelo
   * NOME e clica na opção — que mostra município **e UF**. Nenhum teste desta suíte escreve
   * "3304557" em lugar nenhum, e é essa a prova de que *"código do IBGE é abstração"* virou tela.
   */
  async function escolherMunicipio(termo, rotuloDaOpcao) {
    const busca = await screen.findByLabelText(/Município do tomador/i, {}, { timeout: 5000 });
    await waitFor(() => expect(busca).not.toBeDisabled());
    fireEvent.focus(busca);
    fireEvent.change(busca, { target: { value: termo } });
    const opcao = await screen.findByRole("option", { name: rotuloDaOpcao });
    fireEvent.click(opcao);
    await act(async () => {});
  }

  test("o formulário abre com o que a planilha trouxe — a pessoa vê o que vai corrigir", async () => {
    await abrirAjusteDaLinha("endereco_incompleto");
    expect(screen.getByLabelText(/Logradouro do tomador/i)).toHaveValue("Rua da Assembleia");
  });

  // ⚠⚠ O FORMULÁRIO É MAIOR QUE A PLANILHA, E ISSO É A ENTREGA DE 20/08/2026. As quatro colunas
  // continuam lá, e nome/e-mail/endereço aparecem SÓ aqui — é o *"na hora da revisão nós avisamos e
  // permitimos o preenchimento"* do dono. Montar este formulário com as colunas da planilha
  // deixaria a pessoa sem como corrigir exatamente o que a pendência pede.
  test("⚠⚠ a revisão oferece os campos do tomador, que NÃO são colunas da planilha", async () => {
    await abrirAjusteDaLinha("endereco_incompleto");
    for (const rotulo of [/Nome \/ razão social do tomador/i, /E-mail do tomador/i, /Município do tomador/i]) {
      expect(screen.getByLabelText(rotulo)).toBeInTheDocument();
    }
    // ⚠ E a frase que diz POR QUE eles estão sendo pedidos agora — sem ela, quem preencheu a
    // planilha procuraria por uma coluna que não existe.
    expect(screen.getByText(/Estes campos não vêm da planilha/i)).toBeInTheDocument();
  });

  // ⚠⚠ NINGUÉM DIGITA O CÓDIGO DO IBGE. O campo é o seletor da emissão avulsa: busca por nome,
  // mostra a UF em toda opção e devolve o código junto da escolha. Nada aqui converte nome em
  // código — há cinco "Bom Jesus" no país, e escolher um em silêncio emite a nota no lugar errado.
  test("⚠ só o que MUDOU é enviado, chaveado pelo NÚMERO DA LINHA DO EXCEL", async () => {
    const numero = await abrirAjusteDaLinha("endereco_incompleto");

    await escolherMunicipio("rio de janeiro rj", /Rio de Janeiro/);
    fireEvent.change(screen.getByLabelText(/^Número$/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Bairro$/i), { target: { value: "Centro" } });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar e reclassificar/i }));

    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2));
    const [, , opcoes] = api.lerPlanilhaDoLote.mock.calls[1];
    // ⚠ O código chegou ao ajuste — mas veio da ESCOLHA, não de um campo de sete dígitos.
    expect(opcoes.ajustes).toEqual({ [numero]: { cMun: "3304557", nro: "10", xBairro: "Centro" } });
  });

  test("a linha ajustada deixa de ser pendente e a tela diz que ela foi ajustada aqui", async () => {
    const numero = await abrirAjusteDaLinha("endereco_incompleto");
    await escolherMunicipio("rio de janeiro rj", /Rio de Janeiro/);
    fireEvent.change(screen.getByLabelText(/^Número$/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Bairro$/i), { target: { value: "Centro" } });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar e reclassificar/i }));

    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(document.querySelector(`tr[data-linha="${numero}"]`).dataset.estadoLote).toBe("conferir")
    );
    // ⚠⚠ AUSÊNCIA QUE MUDA DECISÃO: o ajuste vive nesta tela, e a planilha no disco não sabe dele.
    expect(screen.getByText(/a sua planilha continua com o valor antigo/i)).toBeInTheDocument();
  });

  // ⚠⚠ O CASO QUE O DONO NOMEOU: CPF que nunca recebeu nota. Não existe origem para o nome nem para
  // o endereço (CPF NÃO SE CONSULTA), então a revisão pede os DOIS — e a tela diz por quê.
  test("⚠⚠ CPF sem cadastro pede NOME e endereço na revisão, e a frase diz que CPF não se consulta", async () => {
    await abrirAjusteDaLinha("cpf_sem_endereco");
    expect(screen.getByLabelText(/Nome \/ razão social do tomador/i)).toHaveValue("");
    expect(screen.getAllByText(/CPF não se consulta/i).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ QUAL SERVIÇO ESTAS NOTAS DECLARAM — dono, 20/08/2026: *"retire o campo de atividade — o
// cliente não sabe escolher isso; por padrão coloque o código que o contador cadastrou."*
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("o código de serviço do lote", () => {
  test("⚠ não há campo de atividade em lugar nenhum da tela, nem na revisão", async () => {
    await abrirLote();
    await subirPlanilha();
    expect(screen.queryByLabelText(/atividade|código de serviço|cTribNac/i)).toBeNull();
    const tr = document.querySelector('[data-codigo="endereco_incompleto"]').closest("tr");
    fireEvent.click(within(tr).getByRole("button", { name: "Ajustar" }));
    await act(async () => {});
    expect(screen.queryByLabelText(/atividade|código de serviço|cTribNac/i)).toBeNull();
  });

  // ⚠ A `pc-001` do mock tem um código só (é o ramo que renderiza em 33 de 33 empresas medidas).
  // A tela DIZ qual vai — o lote não manda o campo, e quem decide é o cadastro.
  test("a tela diz qual serviço sai, e diz que ele é o do cadastro", async () => {
    await abrirLote();
    await subirPlanilha();
    const bloco = document.querySelector("[data-lote-servico]");
    expect(bloco).not.toBeNull();
    expect(bloco.textContent).toMatch(/cadastrado pelo seu contador|seu contador/i);
  });
});

// ⚠⚠ ESTE BLOCO FOI **INVERTIDO**, NÃO APAGADO (20/08/2026).
//
// Ele travava o oposto: *"não existe nenhum botão que emita"* + *"e a ausência é DITA"*. Existia
// para ninguém "consertar" por conta própria uma fase que ainda não tinha as regras da emissão em
// série. As regras foram construídas, e a trava mudou de lado — agora ela prende o desenho novo:
// o ato existe, mas **atrás de uma confirmação**, e nunca a um clique de distância.
//
// Manter o histórico aqui importa: quem ler daqui a seis meses precisa saber que houve DUAS
// decisões, senão a primeira volta "consertando" a segunda.
describe("⚠⚠ o botão de emitir — existe, e só depois de confirmar", () => {
  test("⚠ o primeiro clique NÃO emite: ele abre a confirmação", async () => {
    await abrirLote();
    await subirPlanilha();

    const botao = await screen.findByRole("button", { name: /emitir \d+ nota/i });
    fireEvent.click(botao);

    // ⚠⚠ A prova de que o ato não aconteceu: a API de emissão não foi chamada.
    expect(api.emitirLoteDeNotas).not.toHaveBeenCalled();
    expect(screen.getByText(/A emissão é definitiva/i)).toBeInTheDocument();
  });

  test("⚠ dá para desistir na confirmação, e nada é emitido", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(await screen.findByRole("button", { name: /emitir \d+ nota/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(api.emitirLoteDeNotas).not.toHaveBeenCalled();
  });

  /**
   * ⚠⚠ TETO DE TEMPO PRÓPRIO — DESTE caso, nunca da suíte (02/09/2026).
   *
   * ⚠⚠ **O PADRÃO DE 5 s NÃO SOBE NO `jest.config`**: foi ele que expôs, em 01/09/2026, uma rota
   * que PENDURAVA (a varredura de notas chamando o banco sem dublê). Um teto global maior teria
   * transformado aquele defeito em "a suíte está lenta hoje".
   *
   * ⚠ MEDIDO: sozinho este caso PASSA — ele só estoura quando a suíte inteira roda antes dele. Ou
   * seja, não há espera nem relógio aqui; é pressão acumulada de jsdom (dezenas de renderizações
   * de tabela num processo só). Em produção este desenho é instantâneo.
   */
  test("⚠⚠ confirmando, o que vai para a API é o ARQUIVO — nunca a lista de linhas", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(await screen.findByRole("button", { name: /emitir \d+ nota/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirmar e emitir/i }));
    });

    expect(api.emitirLoteDeNotas).toHaveBeenCalledTimes(1);
    const [companyId, arquivo, opcoes] = api.emitirLoteDeNotas.mock.calls[0];
    expect(companyId).toBe("pc-001");
    expect(arquivo).toBeInstanceOf(File);
    // ⚠ Nenhuma chave que signifique "estas são as linhas a emitir": quem decide é o servidor,
    // reclassificando a planilha inteira.
    expect(Object.keys(opcoes || {}).sort()).toEqual(["ajustes", "consultas"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O LOTE RECONHECIDO — A FRASE FALSA, E A SAÍDA QUE NÃO EXISTIA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Caso real, 21/08/2026: lote de 3 notas RECUSADO pela Receita por erro de esquema (`E1235`). O
// > erro do XML foi consertado e está em produção. O dono subiu a mesma planilha e leu:
// > *"Esta planilha já havia sido emitida."* — com **Emitidas 0 · Recusadas 3**. A frase era falsa,
// > e não havia botão nenhum para reemitir.
//
// ⚠ O gatilho é a SENTINELA NO NOME DO ARQUIVO (`#tudorecusado#jaemitido`), como todo desfecho do
// mock: sorteio faria "a tela quebrou" e "deu azar" virarem a mesma coisa.

async function subirPlanilhaEEmitir(nomeDoArquivo) {
  const campo = screen.getByLabelText(/Planilha/i);
  fireEvent.change(campo, { target: { files: [planilha(nomeDoArquivo)] } });
  await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalled());
  await screen.findByText(/Confira, linha a linha/i);
  await waitFor(() => expect(screen.getAllByText(/Rio de Janeiro \/ RJ/).length).toBeGreaterThan(0));

  fireEvent.click(await screen.findByRole("button", { name: /emitir \d+ nota/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /confirmar e emitir/i }));
  });
  await screen.findByText(/Emitidas/);
}

describe("⚠⚠ o lote reconhecido: a frase diz o que ACONTECEU, e a saída existe", () => {
  test("⚠⚠ ZERO EMITIDAS: a tela NÃO diz que a planilha já foi emitida", async () => {
    await abrirLote();
    await subirPlanilhaEEmitir("notas#tudorecusado#jaemitido.xlsx");

    const frase = document.querySelector('[data-emissao="reconhecido"]');
    expect(frase).not.toBeNull();
    // ⚠⚠ A REGRESSÃO EM PESSOA. Esta frase era cravada e afirmava o oposto do relatório logo abaixo.
    expect(frase.textContent).not.toMatch(/já havia sido emitida/i);
    expect(frase.textContent).toMatch(/NENHUMA nota foi emitida/i);
    expect(document.querySelector('[data-emissao-conta="emitidas"]').textContent).toBe("0");
  });

  test("⚠⚠ e a retentativa é OFERECIDA, com quantas linhas serão tentadas", async () => {
    await abrirLote();
    await subirPlanilhaEEmitir("notas#tudorecusado#jaemitido.xlsx");

    const bloco = document.querySelector('[data-emissao="retentar"]');
    expect(bloco).not.toBeNull();
    const botao = within(bloco).getByRole("button");
    expect(botao.textContent).toMatch(/Tentar emitir \d+ nota/i);
    // ⚠ Nada bloqueado ⇒ nenhuma ressalva: não há mal-entendido a desfazer, e o dono corta a
    // legenda que só descreve uma ausência já visível.
    expect(document.querySelector('[data-emissao="retentar-ressalva"]')).toBeNull();
  });

  test("⚠⚠ clicar chama a RETENTATIVA — e não uma segunda emissão da planilha", async () => {
    await abrirLote();
    await subirPlanilhaEEmitir("notas#tudorecusado#jaemitido.xlsx");
    api.emitirLoteDeNotas.mockClear();

    await act(async () => {
      fireEvent.click(document.querySelector('[data-emissao="retentar-botao"]'));
    });

    expect(api.retentarLoteEmissao).toHaveBeenCalledTimes(1);
    // ⚠ Reenviar o ARQUIVO cairia na impressão digital e não emitiria nada — a saída é a rota da
    // retentativa, que trabalha sobre o payload congelado de cada linha.
    expect(api.emitirLoteDeNotas).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(Number(document.querySelector('[data-emissao-conta="emitidas"]').textContent)).toBeGreaterThan(0)
    );
    // ⚠ E a frase do reconhecido sai: o relatório na tela passou a ser o da tentativa NOVA.
    expect(document.querySelector('[data-emissao="reconhecido"]')).toBeNull();
  });

  test("⚠⚠ LOTE INTEIRAMENTE EMITIDO NÃO OFERECE RETENTATIVA — é a idempotência de sempre", async () => {
    await abrirLote();
    await subirPlanilhaEEmitir("notas#jaemitido.xlsx");

    expect(document.querySelector('[data-emissao="reconhecido"]').textContent).toMatch(/foram emitidas/i);
    // ⚠⚠ Nenhum botão de retentar. Oferecê-lo aqui seria oferecer nota fiscal duplicada.
    expect(document.querySelector('[data-emissao="retentar"]')).toBeNull();
  });

  test("⚠⚠ O CASO PARCIAL: com nota já emitida no lote, a ressalva aparece ANTES do botão", async () => {
    await abrirLote();
    // `#recusa` recusa a PRIMEIRA linha e emite as demais.
    await subirPlanilhaEEmitir("notas#recusa#jaemitido.xlsx");

    const bloco = document.querySelector('[data-emissao="retentar"]');
    expect(bloco).not.toBeNull();
    const ressalva = document.querySelector('[data-emissao="retentar-ressalva"]');
    expect(ressalva).not.toBeNull();
    expect(ressalva.textContent).toMatch(/já virou nota fiscal|já viraram nota fiscal/i);

    // ⚠ A ORDEM IMPORTA: "tentar de novo" se lê como "refazer o lote", e a ressalva é o que desfaz
    // isso. Depois do botão, ela é lida depois do clique.
    expect(ressalva.compareDocumentPosition(document.querySelector('[data-emissao="retentar-botao"]')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test("⚠⚠ o relatório diz QUANDO — por linha, e o carimbo do lote diz a que se refere", async () => {
    await abrirLote();
    await subirPlanilhaEEmitir("notas#tudorecusado#jaemitido.xlsx");

    // O carimbo do LOTE, nomeado como tal.
    const doLote = document.querySelector('[data-emissao="quando-lote"]');
    expect(doLote.textContent).toMatch(/Lote enviado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);

    // E o de cada linha, na coluna própria.
    expect(screen.getByRole("columnheader", { name: "Quando" })).toBeInTheDocument();
    const linha = document.querySelector('tr[data-desfecho="recusada_receita"]');
    expect(linha.textContent).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  test("⚠⚠ a linha NÃO TENTADA sai com TRAÇO, nunca com a hora do lote", async () => {
    await abrirLote();
    await subirPlanilhaEEmitir("notas#transporte#jaemitido.xlsx");

    const naoTentada = document.querySelector('tr[data-desfecho="nao_tentada"]');
    expect(naoTentada).not.toBeNull();
    // ⚠ Ninguém encostou nesta linha. Carimbá-la com a data do LOTE afirmaria uma tentativa que
    // nunca houve — é a mesma disciplina do `brl(null)` deste app: ausência é traço.
    expect(naoTentada.textContent).not.toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(naoTentada.textContent).toContain("—");
  });
});
