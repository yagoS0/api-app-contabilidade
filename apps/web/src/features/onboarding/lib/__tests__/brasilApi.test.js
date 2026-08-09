import {
  consultarCnpj,
  formatarCnpj,
  mapearParaFormularioEmpresa,
  mapearParaOnboarding,
  soDigitosCnpj,
} from "../brasilApi";

const RESPOSTA = {
  razao_social: "EMPRESA EXEMPLO LTDA",
  nome_fantasia: "EXEMPLO",
  ddd_telefone_1: "1133334444",
  data_inicio_atividade: "2019-04-01",
  descricao_porte: "EMPRESA DE PEQUENO PORTE",
  codigo_natureza_juridica: "2062",
  municipio: "SAO PAULO",
  uf: "sp",
  cnae_fiscal: 6201501,
  cnaes_secundarios: [{ codigo: 6202300 }, { codigo: "6209-1/00" }],
  descricao_tipo_de_logradouro: "RUA",
  logradouro: "DAS FLORES",
  numero: "100",
  bairro: "CENTRO",
  cep: "01001000",
  descricao_situacao_cadastral: "ATIVA",
};

function fetchFalso({ status = 200, corpo = RESPOSTA, lanca = false } = {}) {
  return jest.fn(async () => {
    if (lanca) throw new TypeError("Failed to fetch");
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
  });
}

describe("formatação", () => {
  test("soDigitosCnpj limita a 14 e descarta máscara", () => {
    expect(soDigitosCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(soDigitosCnpj("112223330001819999")).toBe("11222333000181");
  });
  test("formatarCnpj devolve a entrada quando ainda está incompleta", () => {
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarCnpj("1122")).toBe("1122");
  });
});

describe("consultarCnpj — o caminho de falha é requisito", () => {
  test("sucesso devolve empresa e situação cadastral", async () => {
    const r = await consultarCnpj("11.222.333/0001-81", { fetchImpl: fetchFalso() });
    expect(r.ok).toBe(true);
    expect(r.empresa.razaoSocial).toBe("EMPRESA EXEMPLO LTDA");
    expect(r.empresa.uf).toBe("SP");
    expect(r.situacao).toMatchObject({ texto: "ATIVA", ativa: true });
  });

  // ⚠ Rede corporativa, bloqueador, offline: a chamada sai do BROWSER, sem proxy. Cair aqui é
  // esperado, e a tela precisa oferecer preenchimento à mão em vez de mostrar erro.
  test("falha de rede não lança — devolve motivo e o texto da escapatória manual", async () => {
    const r = await consultarCnpj("11222333000181", { fetchImpl: fetchFalso({ lanca: true }) });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("rede");
    expect(r.mensagem).toMatch(/preencha à mão/i);
  });

  test("404 é 'não encontrado', distinto de indisponível", async () => {
    const r = await consultarCnpj("11222333000181", { fetchImpl: fetchFalso({ status: 404 }) });
    expect(r.motivo).toBe("nao_encontrado");
  });

  test("500 vira indisponível, com a mesma escapatória", async () => {
    const r = await consultarCnpj("11222333000181", { fetchImpl: fetchFalso({ status: 500 }) });
    expect(r.motivo).toBe("indisponivel");
    expect(r.mensagem).toMatch(/preencha à mão/i);
  });

  test("CNPJ incompleto nem chega a chamar a rede", async () => {
    const f = fetchFalso();
    const r = await consultarCnpj("112", { fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("cnpj_incompleto");
    expect(f).not.toHaveBeenCalled();
  });

  // Situação ≠ ATIVA muda a conversa inteira e vem de graça na mesma resposta.
  test("situação BAIXADA volta marcada como não ativa", async () => {
    const corpo = { ...RESPOSTA, descricao_situacao_cadastral: "BAIXADA", motivo_situacao_cadastral: "EXTINCAO" };
    const r = await consultarCnpj("11222333000181", { fetchImpl: fetchFalso({ corpo }) });
    expect(r.situacao).toMatchObject({ texto: "BAIXADA", ativa: false, motivo: "EXTINCAO" });
  });
});

describe("mapeamentos", () => {
  test("o recorte do ONBOARDING não traz endereço nem CNAE — não é o que a ficha pergunta", () => {
    const e = mapearParaOnboarding(RESPOSTA);
    expect(e.porte).toBe("EMPRESA DE PEQUENO PORTE");
    expect(e.endereco).toBeUndefined();
    expect(e.cnaePrincipal).toBeUndefined();
  });

  // ⚠ A conversão exige endereço COMPLETO e `cnaePrincipal`, e a ficha não coleta nenhum dos dois.
  // É por isso que o modal consulta de novo.
  test("o recorte da CONVERSÃO traz os 6 campos de endereço e o CNAE principal", () => {
    const f = mapearParaFormularioEmpresa(RESPOSTA);
    expect(f.cnaePrincipal).toBe("6201501");
    expect(f.cnaesSecundarios).toEqual(["6202300", "6209100"]);
    expect(f.endereco).toEqual({
      rua: "RUA DAS FLORES", numero: "100", complemento: "",
      bairro: "CENTRO", cidade: "SAO PAULO", uf: "SP", cep: "01001000",
    });
  });

  test("porte MICRO EMPRESA é normalizado como na ficha da empresa", () => {
    expect(mapearParaOnboarding({ descricao_porte: "MICRO EMPRESA" }).porte).toBe("MICROEMPRESA");
  });
});
