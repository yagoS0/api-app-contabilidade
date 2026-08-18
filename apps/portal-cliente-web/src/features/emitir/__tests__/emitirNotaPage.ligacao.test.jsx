// A LIGAÇÃO — a tela de emissão USA MESMO as libs, e não só as importa.
//
// ⚠ REGRA DE TELA VIVE EM `lib/` COM TESTE PRÓPRIO; O TESTE DE COMPONENTE COBRE A **LIGAÇÃO**
// (`apps/web/CLAUDE.md`). Nada aqui reescreve a regra: `aliquotaEfetiva`, `consultaTomador` e
// `descricoesRecentes` já têm as suas suítes ao lado. O que se prova aqui é que o resultado delas
// CHEGA ao campo, ao painel e à pré-visualização.
//
// ⚠⚠ **COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO** — já houve bloco novo
// renderizando `null` para sempre porque a prop nunca era passada, e a página de planejamento
// tributário passou meses com o pré-preenchimento pronto e ninguém passando a empresa. Por isso
// cada invariante negativa daqui ("com CPF não consulta") vem acompanhada da positiva ("com CNPJ
// consulta"): sem o par, um componente que nunca consulta nada passaria nos dois.
//
// ⚠⚠ **NADA É EMITIDO, CANCELADO OU TRANSMITIDO.** `api.emitirNfse` é substituído por um espião que
// EXPLODE se for chamado, e um `afterEach` confere que ele continua intocado em todos os casos. O
// formulário nunca é submetido.
//
// ⚠ **NENHUM TESTE TOCA A REDE.** O `fetch` global é substituído por um espião que explode, e as
// respostas entram pelo objeto `api` — o mesmo módulo que a tela importa, sem `jest.mock` de
// fábrica: assim o teste também exercita o `import.meta.env` de `src/api/index.js` e de
// `src/api/real/realApi.js`, que é justamente o que quebraria em tempo de PARSE sem o
// `babel.config.js` (ver o cabeçalho de lá).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { EmitirNotaPage } from "../EmitirNotaPage";
import { janelaDaConsulta } from "../lib/aliquotaEfetiva";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: "11222333000181",
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

/** A competência que a tela abre por padrão é a data de HOJE, pelo relógio local. */
function competenciaDeHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Linha com os DOIS insumos crus — a única forma de a alíquota ser oferecida. */
function linhaComProva(competencia, deReceita) {
  return {
    competencia,
    faturamento: 100000,
    dasExtrato: Number((deReceita * 1000).toFixed(2)),
    impostosPagos: 7260,
    deReceita,
    efetiva: 7.26, // ⚠ inclui INSS — se ela chegar ao campo, a ligação está lendo o campo errado
  };
}

/** Linha como o backend a devolve quando não há extrato do PGDAS-D: `deReceita` é ZERO FABRICADO. */
function linhaComZeroFabricado(competencia) {
  return {
    competencia,
    faturamento: 100000,
    dasExtrato: 0,
    impostosPagos: 0,
    deReceita: 0,
    efetiva: 0,
  };
}

const RESPOSTA_RECEITA = {
  ok: true,
  situacao: { texto: "ATIVA", ativa: true, motivo: null, data: null },
  bruto: {
    razao_social: "TOMADOR EXEMPLO LTDA",
    municipio: "SAO PAULO",
    uf: "SP",
    codigo_municipio_ibge: "3550308",
    descricao_tipo_de_logradouro: "RUA",
    logradouro: "DAS FLORES",
    numero: "100",
    complemento: "SALA 2",
    bairro: "CENTRO",
    cep: "01001-000",
  },
};

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "consultarCnpj").mockResolvedValue({ ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado na base da Receita." });
  // ⚠⚠ EMITIR É ATO FISCAL IRREVERSÍVEL. Aqui ele é uma armadilha, não um mock complacente.
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

/** Renderiza e espera a carga inicial (alíquotas + lista do IBGE) assentar. */
async function renderizar(empresa = EMPRESA) {
  const utils = render(<EmitirNotaPage empresa={empresa} aoNavegar={() => {}} aoRecarregarEmpresas={() => {}} />);
  await act(async () => {});
  return utils;
}

function campoAliquota() {
  return document.getElementById("emitir-ptottribsn");
}

describe("a alíquota efetiva CHEGA ao campo — e é a do DAS", () => {
  test("a janela pedida à rota é a que a lib calcula, para a competência da tela", async () => {
    await renderizar();
    const esperada = janelaDaConsulta(competenciaDeHoje());
    expect(api.getAliquotas).toHaveBeenCalledWith("pc-001", esperada);
  });

  test("com os dois insumos crus, o percentual aparece no campo com a procedência ao lado", async () => {
    const comp = competenciaDeHoje();
    api.getAliquotas.mockResolvedValue([linhaComProva(comp, 6)]);
    await renderizar();

    await waitFor(() => expect(campoAliquota().value).toBe("6"));
    // ⚠ `efetiva` (7,26%) veio na MESMA linha e NÃO pode ter chegado ao campo: ela inclui o INSS de
    // guia separada, que não é tributo do Simples Nacional.
    expect(campoAliquota().value).not.toBe("7.26");
    expect(screen.getByText(/sobre a receita da mesma competência/)).toBeInTheDocument();
    expect(screen.getByText("preenchido pelo portal")).toBeInTheDocument();
  });

  // ⚠ Usar a última apurada é o certo; usá-la SEM DIZER que é de outro mês seria apresentar o
  // número do mês passado como se fosse o deste.
  test("sem a competência da nota, o campo recebe a última apurada E a tela diz que é de outro mês", async () => {
    api.getAliquotas.mockResolvedValue([linhaComProva("2020-01", 6.24)]);
    await renderizar();

    await waitFor(() => expect(campoAliquota().value).toBe("6.24"));
    expect(screen.getByText(/DAS de 01\/2020/)).toBeInTheDocument();
    expect(screen.getByText(/última competência apurada/)).toBeInTheDocument();
    expect(screen.getByText(/Confira antes de emitir/)).toBeInTheDocument();
  });
});

describe("⚠⚠ SEM DADO, O CAMPO FICA VAZIO — nunca '0'", () => {
  // ⚠ O caso de produção: o backend faz `d > 0 ? n/d*100 : 0` e responde `deReceita: 0` quando não
  // há extrato do PGDAS-D. Numa nota, 0% é uma AFIRMAÇÃO sobre carga tributária (Lei 12.741/2012).
  test("o zero fabricado pelo backend não vira 0 no campo — vira campo vazio com o motivo", async () => {
    api.getAliquotas.mockResolvedValue([linhaComZeroFabricado(competenciaDeHoje())]);
    await renderizar();

    await waitFor(() => expect(screen.getByText(/^Não preenchemos: /)).toBeInTheDocument());
    expect(campoAliquota().value).toBe("");
    expect(campoAliquota().value).not.toBe("0");
    expect(screen.queryByText("preenchido pelo portal")).not.toBeInTheDocument();
  });

  test("série vazia também deixa o campo vazio e explica", async () => {
    api.getAliquotas.mockResolvedValue([]);
    await renderizar();

    await waitFor(() => expect(screen.getByText(/^Não preenchemos: /)).toBeInTheDocument());
    expect(campoAliquota().value).toBe("");
  });

  // ⚠ A pré-visualização é o que a pessoa confere antes de emitir: lá o vazio precisa ser TRAÇO, e
  // não "0,00%", pelo mesmo motivo.
  test("na pré-visualização, ausência sai como traço — nunca '0,00%'", async () => {
    api.getAliquotas.mockResolvedValue([linhaComZeroFabricado(competenciaDeHoje())]);
    await renderizar();

    await waitFor(() => expect(campoAliquota().value).toBe(""));
    const previa = screen.getByLabelText("Pré-visualização da nota");
    const linha = Array.from(previa.querySelectorAll("tr")).find((tr) =>
      tr.textContent.includes("Tributos do Simples nesta nota")
    );
    expect(linha).toBeTruthy();
    expect(linha.textContent).toContain("—");
    expect(linha.textContent).not.toContain("0,00%");
  });

  // ⚠ PRÉ-PREENCHIDO ≠ TRAVADO — e a partir do momento em que a pessoa digita, o portal para de
  // escrever no campo, com os dois números à vista.
  test("digitado por cima vence a sugestão, e os dois lados ficam à vista", async () => {
    const comp = competenciaDeHoje();
    api.getAliquotas.mockResolvedValue([linhaComProva(comp, 6)]);
    await renderizar();
    await waitFor(() => expect(campoAliquota().value).toBe("6"));

    fireEvent.change(campoAliquota(), { target: { value: "4.5" } });
    await act(async () => {});

    expect(campoAliquota().value).toBe("4.5");
    expect(screen.getByText("digitado por você")).toBeInTheDocument();
    expect(screen.getByText(/O portal sugeria/)).toBeInTheDocument();
    expect(screen.getByText("6,00%")).toBeInTheDocument();
  });
});

describe("⚠⚠ CPF NÃO SE CONSULTA — a asserção é sobre a AUSÊNCIA da chamada", () => {
  test("11 dígitos: nenhuma consulta sai, e não há painel nem botão na tela", async () => {
    await renderizar();
    const doc = screen.getByLabelText(/CNPJ ou CPF do tomador/);

    fireEvent.change(doc, { target: { value: "123.456.789-09" } });
    await act(async () => {});

    // ⚠ A asserção que importa: a chamada NÃO ACONTECEU. Não é sobre o texto da tela.
    expect(api.consultarCnpj).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    // E, por consequência, nada aparece: nem "não encontrado", nem botão, nem "Consultando…".
    expect(screen.queryByRole("button", { name: /Consultar este CNPJ na Receita/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Consultar de novo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/não encontrado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Consultando o CNPJ na Receita/)).not.toBeInTheDocument();
  });

  test("nem enquanto o CPF está sendo digitado, dígito a dígito", async () => {
    await renderizar();
    const doc = screen.getByLabelText(/CNPJ ou CPF do tomador/);
    const cpf = "12345678909";
    for (let i = 1; i <= cpf.length; i += 1) {
      fireEvent.change(doc, { target: { value: cpf.slice(0, i) } });
    }
    await act(async () => {});
    expect(api.consultarCnpj).not.toHaveBeenCalled();
  });

  // ⚠⚠ O PAR POSITIVO. Sem ele, uma tela que nunca consultasse nada passaria nos casos acima — que
  // é exatamente a forma de defeito que este arquivo existe para pegar.
  test("14 dígitos: a consulta SAI, uma vez, com os dígitos do CNPJ", async () => {
    api.consultarCnpj.mockResolvedValue(RESPOSTA_RECEITA);
    await renderizar();
    const doc = screen.getByLabelText(/CNPJ ou CPF do tomador/);

    fireEvent.change(doc, { target: { value: "11.222.333/0001-81" } });
    await waitFor(() => expect(api.consultarCnpj).toHaveBeenCalledWith("11222333000181"));
    expect(api.consultarCnpj).toHaveBeenCalledTimes(1);
  });

  test("voltar de 14 para 11 dígitos não dispara nada novo", async () => {
    api.consultarCnpj.mockResolvedValue(RESPOSTA_RECEITA);
    await renderizar();
    const doc = screen.getByLabelText(/CNPJ ou CPF do tomador/);

    fireEvent.change(doc, { target: { value: "11222333000181" } });
    await waitFor(() => expect(api.consultarCnpj).toHaveBeenCalledTimes(1));

    fireEvent.change(doc, { target: { value: "12345678909" } });
    await act(async () => {});
    expect(api.consultarCnpj).toHaveBeenCalledTimes(1);
  });
});

describe("a consulta é AJUDA, nunca portão", () => {
  test("o que a Receita devolveu chega aos campos, com a origem no rótulo", async () => {
    api.consultarCnpj.mockResolvedValue(RESPOSTA_RECEITA);
    await renderizar();

    fireEvent.change(screen.getByLabelText(/CNPJ ou CPF do tomador/), {
      target: { value: "11222333000181" },
    });

    await waitFor(() => expect(document.getElementById("emitir-nome").value).toBe("TOMADOR EXEMPLO LTDA"));
    expect(document.getElementById("emitir-cep").value).toBe("01001000");
    expect(document.getElementById("emitir-logradouro").value).toBe("RUA DAS FLORES");
    expect(document.getElementById("emitir-numero").value).toBe("100");
    expect(document.getElementById("emitir-bairro").value).toBe("CENTRO");
    // ⚠ O `cMun` passou pela prova tripla contra a lista OFICIAL do IBGE — a de verdade, não uma
    // fixture: `carregarMunicipiosIbge` não é substituído neste arquivo.
    expect(screen.getByText("São Paulo / SP")).toBeInTheDocument();
    expect(screen.getAllByText("da Receita").length).toBeGreaterThan(0);
  });

  // ⚠ FALHA NÃO BLOQUEIA. É esta a diferença entre ajuda e portão, e ela se prova no BOTÃO.
  test("consulta recusada não desabilita o botão Emitir, e a tela diz isso", async () => {
    api.consultarCnpj.mockResolvedValue({
      ok: false,
      motivo: "rede",
      mensagem: "Não conseguimos consultar a Receita agora — confira e preencha à mão.",
    });
    await renderizar();

    fireEvent.change(screen.getByLabelText(/CNPJ ou CPF do tomador/), {
      target: { value: "11222333000181" },
    });

    await waitFor(() => expect(screen.getByText(/Não conseguimos consultar a Receita agora/)).toBeInTheDocument());
    expect(screen.getByText(/a emissão segue normalmente/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emitir nota" })).toBeEnabled();
  });

  // ⚠ O ENDEREÇO É TUDO-OU-NADA: parcial não escreve NADA, e a tela explica em vez de deixar
  // quatro campos preenchidos e um vazio parecendo esquecimento.
  test("endereço incompleto na resposta não preenche campo nenhum", async () => {
    const bruto = { ...RESPOSTA_RECEITA.bruto };
    delete bruto.bairro;
    api.consultarCnpj.mockResolvedValue({ ...RESPOSTA_RECEITA, bruto });
    await renderizar();

    fireEvent.change(screen.getByLabelText(/CNPJ ou CPF do tomador/), {
      target: { value: "11222333000181" },
    });

    await waitFor(() => expect(screen.getByText(/O endereço NÃO foi preenchido/)).toBeInTheDocument());
    expect(document.getElementById("emitir-cep").value).toBe("");
    expect(document.getElementById("emitir-logradouro").value).toBe("");
    expect(document.getElementById("emitir-numero").value).toBe("");
    // ⚠ O nome, esse, foi aplicado: a recusa é do BLOCO de endereço, não da consulta inteira.
    expect(document.getElementById("emitir-nome").value).toBe("TOMADOR EXEMPLO LTDA");
  });

  // ⚠ O digitado vence — inclusive uma consulta que chega DEPOIS. E os dois lados ficam à vista.
  test("nome digitado sobrevive à consulta, e a tela mostra o da Receita ao lado", async () => {
    let resolver;
    api.consultarCnpj.mockImplementation(() => new Promise((r) => { resolver = r; }));
    await renderizar();

    fireEvent.change(screen.getByLabelText(/CNPJ ou CPF do tomador/), {
      target: { value: "11222333000181" },
    });
    await act(async () => {});
    fireEvent.change(document.getElementById("emitir-nome"), { target: { value: "Padaria do João" } });

    await act(async () => {
      resolver(RESPOSTA_RECEITA);
    });

    expect(document.getElementById("emitir-nome").value).toBe("Padaria do João");
    expect(screen.getByText("TOMADOR EXEMPLO LTDA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /usar o da Receita/ })).toBeInTheDocument();
  });
});

describe("as descrições deste navegador chegam à tela — e são da EMPRESA certa", () => {
  function semear(companyId, descricao) {
    window.localStorage.setItem(
      `pcw.descricoes.${companyId}`,
      JSON.stringify([{ descricao, doc: "11222333000181", nome: "TOMADOR", em: "2026-08-18T12:00:00.000Z" }])
    );
  }

  test("o que foi emitido nesta empresa é oferecido, com o rótulo dizendo que é deste navegador", async () => {
    semear("pc-001", "Consultoria em TI — agosto");
    await renderizar();
    expect(screen.getByText("Consultoria em TI — agosto")).toBeInTheDocument();
    expect(screen.getByText(/neste navegador/)).toBeInTheDocument();
  });

  // ⚠ ESCOPO POR EMPRESA: descrição de uma empresa não pode ser oferecida na nota de outra.
  test("o que foi emitido em OUTRA empresa não aparece aqui", async () => {
    semear("pc-002", "Serviço da outra empresa");
    await renderizar();
    expect(screen.queryByText("Serviço da outra empresa")).not.toBeInTheDocument();
  });

  test("some assim que a pessoa começa a escrever — sugestão nunca é imposição", async () => {
    semear("pc-001", "Consultoria em TI — agosto");
    await renderizar();
    fireEvent.change(document.getElementById("emitir-descricao"), { target: { value: "Outro" } });
    await act(async () => {});
    expect(screen.queryByText("Consultoria em TI — agosto")).not.toBeInTheDocument();
  });
});
