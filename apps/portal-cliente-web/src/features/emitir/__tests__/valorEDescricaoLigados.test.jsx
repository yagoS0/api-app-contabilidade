// A LIGAÇÃO no PORTAL DO CLIENTE — a tela de emissão usa mesmo `valorDaNota` e `descricaoSugerida`,
// e o resultado chega ao campo, à pré-visualização e ao payload.
//
// ⚠ REGRA DE TELA VIVE EM `lib/` COM TESTE PRÓPRIO; O TESTE DE COMPONENTE COBRE A LIGAÇÃO. As duas
// regras já têm suíte ao lado (`lib/__tests__/valorDaNota.test.js`,
// `lib/__tests__/descricaoSugerida.test.js`) e nada é reescrito aqui.
//
// ⚠⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO — por isso cada invariante negativa
// ("sem atividade, campo vazio") vem com a positiva ("com atividade, campo preenchido").
//
// ⚠⚠ NADA É EMITIDO: `api.emitirNfse` é substituído por um espião que EXPLODE, e um `afterEach`
// confere que ele continua intocado. ⚠ NENHUM TESTE TOCA A REDE: `fetch` global explode.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { EmitirNotaPage } from "../EmitirNotaPage";

const EMPRESA_BASE = {
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

// As atividades REAIS de produção (33 empresas medidas, só leitura).
const KLAUS = ["73.19-0-03 - Marketing direto"];
const KAIZEN = ["71.12-0-00", "4120400", "4399101", "4399103"];

/** A competência da tela é a data de HOJE (`dCompet` é dia, não mês). */
function mmAaaaDeHoje() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function comAtividades(atividades, cnaePrincipal) {
  return {
    ...EMPRESA_BASE,
    legacyCompany: { ...EMPRESA_BASE.legacyCompany, atividades, cnaePrincipal },
  };
}

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "consultarCnpj").mockResolvedValue({ ok: false, motivo: "nao_encontrado", mensagem: "não encontrado" });
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

async function renderizar(empresa = EMPRESA_BASE) {
  const utils = render(<EmitirNotaPage empresa={empresa} aoNavegar={() => {}} aoRecarregarEmpresas={() => {}} />);
  await act(async () => {});
  return utils;
}

const campoValor = () => document.getElementById("emitir-valor");
const campoDescricao = () => document.getElementById("emitir-descricao");
const digitar = (el, value) => fireEvent.change(el, { target: { value } });
const colar = (el, texto) => fireEvent.paste(el, { clipboardData: { getData: () => texto } });

describe("o VALOR: campo de moeda, uma leitura só", () => {
  // ⚠ O campo era `type="number"` (separador PONTO). O dono pediu vírgula, e a máscara é o que
  // torna a grafia ambígua impossível de escrever.
  test("é campo de texto mascarado, não mais `type=number`", async () => {
    await renderizar();
    expect(campoValor().getAttribute("type")).toBe("text");
    digitar(campoValor(), "150000");
    expect(campoValor().value).toBe("1.500,00");
  });

  test("o ponto não entra — não há duas grafias a decidir", async () => {
    await renderizar();
    digitar(campoValor(), "1500.00");
    expect(campoValor().value).toBe("1.500,00");
  });

  // ⚠ ZERO DIGITADO ≠ CAMPO VAZIO: a máscara não pode fabricar "0,00" num campo em branco.
  test("apagar tudo devolve o campo vazio, não 0,00", async () => {
    await renderizar();
    digitar(campoValor(), "150000");
    digitar(campoValor(), "");
    expect(campoValor().value).toBe("");
  });

  // ⚠ A PRÉ-VISUALIZAÇÃO é onde o cliente confere antes de emitir. Ela lê o MESMO
  // `lerValorDoCampo` do payload — o número que ele vê é, por construção, o que vai na nota.
  test("a pré-visualização mostra o valor formatado que o campo contém", async () => {
    await renderizar();
    digitar(campoValor(), "150000");
    await waitFor(() => expect(screen.getAllByText("R$ 1.500,00").length).toBeGreaterThan(0));
  });

  test("colar 1500 de uma planilha vira mil e quinhentos, não quinze reais", async () => {
    await renderizar();
    colar(campoValor(), "1500");
    expect(campoValor().value).toBe("1.500,00");
  });

  test("colar R$ 1.500,00 e 1,500.00 dão o mesmo valor", async () => {
    await renderizar();
    colar(campoValor(), "R$ 1.500,00");
    expect(campoValor().value).toBe("1.500,00");
    digitar(campoValor(), "");
    colar(campoValor(), "1,500.00");
    expect(campoValor().value).toBe("1.500,00");
  });

  // ⚠⚠ A COLAGEM AMBÍGUA NÃO ENTRA, e a tela diz por quê. Converter em silêncio é o erro de ordem
  // de grandeza que esta entrega existe para impedir.
  test("colar 1.500 é RECUSADO: o campo fica como estava e a recusa aparece", async () => {
    await renderizar();
    digitar(campoValor(), "20000");
    colar(campoValor(), "1.500");
    expect(campoValor().value).toBe("200,00");
    expect(screen.getByRole("status")).toHaveTextContent(/duas leituras/i);
  });

  test("digitar depois da recusa limpa a recusa", async () => {
    await renderizar();
    colar(campoValor(), "1.500");
    expect(screen.getByRole("status")).toHaveTextContent(/duas leituras/i);
    digitar(campoValor(), "30000");
    expect(screen.queryByText(/duas leituras/i)).not.toBeInTheDocument();
  });
});

describe("a DESCRIÇÃO chega sugerida, com a origem à vista", () => {
  // ⚠ A competência da tela é a data de HOJE, então a frase já nasce com a cláusula.
  test("com atividade cadastrada, o campo abre preenchido", async () => {
    await renderizar(comAtividades(KLAUS, "7319003"));
    expect(campoDescricao().value).toBe(`Serviço prestado: Marketing direto — competência ${mmAaaaDeHoje()}`);
    expect(screen.getByText(/Sugerido a partir da única atividade/i)).toBeInTheDocument();
  });

  test("o digitado vence, e a origem some junto", async () => {
    await renderizar(comAtividades(KLAUS, "7319003"));
    digitar(campoDescricao(), "Consultoria contábil");
    expect(campoDescricao().value).toBe("Consultoria contábil");
    expect(screen.queryByText(/Sugerido a partir/i)).not.toBeInTheDocument();
  });

  // ⚠⚠ SEM DADO, CAMPO VAZIO — e a tela diz a quem pedir. O cliente não edita o próprio cadastro.
  test("só códigos nus: campo VAZIO, com o motivo e a quem pedir", async () => {
    await renderizar(comAtividades(KAIZEN, "7112000"));
    expect(campoDescricao().value).toBe("");
    expect(screen.getByText(/não deduzimos o texto a partir do número/i)).toBeInTheDocument();
    expect(screen.getByText(/seu escritório de contabilidade/i)).toBeInTheDocument();
  });

  test("sem atividade nenhuma: campo VAZIO, com o motivo", async () => {
    await renderizar(comAtividades([], "7112000"));
    expect(campoDescricao().value).toBe("");
    expect(screen.getByText(/não tem atividade cadastrada/i)).toBeInTheDocument();
  });

  // ⚠ PROP AUSENTE ≠ CADASTRO VAZIO. A empresa base não tem `atividades` porque esta tela pode não
  // ter recebido o `legacyCompany` — mas aqui ela recebeu, e sem atividade o motivo é legítimo.
  test("sem `legacyCompany`, a tela não afirma nada sobre atividades", async () => {
    await renderizar({ ...EMPRESA_BASE, legacyCompany: null });
    expect(screen.queryByText(/não tem atividade cadastrada/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sugerido a partir/i)).not.toBeInTheDocument();
  });
});

// ⚠⚠ A COLISÃO REAL ENTRE AS DUAS FONTES DE SUGESTÃO, e o motivo de este caso existir:
// `sugerirDescricoes` some quando o campo já tem texto. Com o campo pré-preenchido desde a
// abertura, passar `form.descricao` cru MATARIA a lista de recentes para sempre — a sugestão nova
// teria comido a antiga em silêncio, e ninguém notaria.
describe("a sugestão do cadastro CONVIVE com as descrições deste navegador", () => {
  function semearHistorico() {
    window.localStorage.setItem(
      "pcw.descricoes.pc-001",
      JSON.stringify([{ descricao: "Consultoria do mês passado", doc: "", nome: "TOMADOR X", em: "2026-07-01T00:00:00.000Z" }])
    );
  }

  test("as duas aparecem: o campo vem do cadastro, e os botões continuam ofertados", async () => {
    semearHistorico();
    await renderizar(comAtividades(KLAUS, "7319003"));
    expect(campoDescricao().value).toMatch(/^Serviço prestado: Marketing direto/);
    expect(screen.getByRole("button", { name: /Consultoria do mês passado/ })).toBeInTheDocument();
  });

  // ⚠ CLIQUE É ESCOLHA, E ESCOLHA VENCE — e a partir dela o pré-preenchimento não escreve mais.
  test("clicar numa descrição recente vence a sugestão do cadastro", async () => {
    semearHistorico();
    await renderizar(comAtividades(KLAUS, "7319003"));
    fireEvent.click(screen.getByRole("button", { name: /Consultoria do mês passado/ }));
    expect(campoDescricao().value).toBe("Consultoria do mês passado");
    expect(screen.queryByText(/Sugerido a partir/i)).not.toBeInTheDocument();
  });

  test("depois de digitar, a lista de recentes some — como sempre fez", async () => {
    semearHistorico();
    await renderizar(comAtividades(KLAUS, "7319003"));
    digitar(campoDescricao(), "Outra coisa");
    expect(screen.queryByRole("button", { name: /Consultoria do mês passado/ })).not.toBeInTheDocument();
  });
});
