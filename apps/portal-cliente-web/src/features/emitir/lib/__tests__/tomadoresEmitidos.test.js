// A MEMÓRIA DE TOMADORES NA TELA — a regra.
//
// ⚠ A LIGAÇÃO (o seletor aparece, escolher preenche, e nada é emitido) é medida em
// `__tests__/tomadorEmitidoNaTela.ligacao.test.jsx`. Aqui só a regra pura.

import {
  normalizarTomadores,
  buscarTomadores,
  camposDoTomador,
  aplicarTomadorEmitido,
  textoDosPreservados,
  enderecoVeioDaMemoria,
  formatarDocumento,
} from "../tomadoresEmitidos";

const ACME = {
  documento: "12345678000190",
  nome: "ACME SERVICOS LTDA",
  email: "financeiro@acme.com.br",
  cMun: "3550308",
  cep: "01001000",
  xLgr: "RUA DAS FLORES",
  nro: "100",
  xCpl: "SALA 2",
  xBairro: "CENTRO",
  ultimaEmissaoEm: "2026-08-19T10:00:00.000Z",
};

const JOSE = {
  documento: "12219079724",
  nome: "José da Silva Júnior",
  email: null,
  cMun: "3304557",
  cep: "20000000",
  xLgr: "AV ATLANTICA",
  nro: "5",
  xCpl: null,
  xBairro: "COPACABANA",
  ultimaEmissaoEm: "2026-07-01T10:00:00.000Z",
};

const FORM_VAZIO = {
  tomadorDoc: "",
  tomadorNome: "",
  tomadorEmail: "",
  cep: "",
  cMun: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  descricao: "já escrito",
  valorServicos: "1.500,00",
};

describe("normalizarTomadores — o que entra na lista", () => {
  test("aceita `{data}` (a rota) e array cru (o mock)", () => {
    expect(normalizarTomadores({ data: [ACME] })).toHaveLength(1);
    expect(normalizarTomadores([ACME])).toHaveLength(1);
    expect(normalizarTomadores(null)).toEqual([]);
    expect(normalizarTomadores({})).toEqual([]);
  });

  test("⚠ registro sem documento ou sem nome é DESCARTADO — linha em branco clicável preenche nada e parece ter preenchido", () => {
    const lista = normalizarTomadores([
      ACME,
      { documento: "", nome: "SEM DOC" },
      { documento: "11122233344", nome: "   " },
    ]);
    expect(lista.map((t) => t.nome)).toEqual(["ACME SERVICOS LTDA"]);
  });

  test("o documento fica só com dígitos — é a forma que a emissão compara", () => {
    const [t] = normalizarTomadores([{ ...ACME, documento: "12.345.678/0001-90" }]);
    expect(t.documento).toBe("12345678000190");
  });

  test("`null` do banco vira `\"\"`, e não a string 'null'", () => {
    const [t] = normalizarTomadores([JOSE]);
    expect(t.email).toBe("");
    expect(t.xCpl).toBe("");
  });
});

describe("buscarTomadores — ENCONTRA, e a ordem é a da rota", () => {
  const lista = normalizarTomadores([ACME, JOSE]);

  test("⚠ termo vazio mostra a lista, na ordem em que chegou (mais recente primeiro)", () => {
    const r = buscarTomadores(lista, "");
    expect(r.itens.map((t) => t.documento)).toEqual(["12345678000190", "12219079724"]);
    expect(r.total).toBe(2);
  });

  test("casa por nome, sem acento e sem caixa", () => {
    expect(buscarTomadores(lista, "jose").itens.map((t) => t.nome)).toEqual(["José da Silva Júnior"]);
    expect(buscarTomadores(lista, "JUNIOR").itens).toHaveLength(1);
    expect(buscarTomadores(lista, "acme").itens).toHaveLength(1);
  });

  test("casa por DOCUMENTO, com ou sem máscara — quem tem o CNPJ na mão o digita", () => {
    expect(buscarTomadores(lista, "12345678").itens).toHaveLength(1);
    expect(buscarTomadores(lista, "12.345.678/0001-90").itens).toHaveLength(1);
  });

  test("nada encontrado devolve lista vazia com total 0 — não devolve tudo", () => {
    expect(buscarTomadores(lista, "zzzz")).toEqual({ itens: [], total: 0 });
  });

  test("⚠ o recorte volta nomeado — lista parcial que se apresenta como inteira faz escolher errado", () => {
    const muitos = normalizarTomadores(
      Array.from({ length: 10 }, (_, i) => ({ ...ACME, documento: String(10000000000000 + i) }))
    );
    const r = buscarTomadores(muitos, "", { limite: 3 });
    expect(r.itens).toHaveLength(3);
    expect(r.total).toBe(10);
  });
});

describe("formatarDocumento", () => {
  test("CNPJ, CPF e o que não é nenhum dos dois", () => {
    expect(formatarDocumento("12345678000190")).toBe("12.345.678/0001-90");
    expect(formatarDocumento("12219079724")).toBe("122.190.797-24");
    expect(formatarDocumento("123")).toBe("123");
  });
});

describe("⚠ A ESCOLHA PREENCHE O TOMADOR INTEIRO — documento, nome, e-mail e o endereço todo", () => {
  test("num formulário em branco, os nove campos chegam", () => {
    const { form, aplicados } = aplicarTomadorEmitido({ form: FORM_VAZIO, registro: normalizarTomadores([ACME])[0] });

    expect(form.tomadorDoc).toBe("12345678000190");
    expect(form.tomadorNome).toBe("ACME SERVICOS LTDA");
    expect(form.tomadorEmail).toBe("financeiro@acme.com.br");
    expect(form.cep).toBe("01001000");
    expect(form.cMun).toBe("3550308");
    expect(form.logradouro).toBe("RUA DAS FLORES");
    expect(form.numero).toBe("100");
    expect(form.complemento).toBe("SALA 2");
    expect(form.bairro).toBe("CENTRO");
    expect(aplicados).toContain("tomadorDoc");
    expect(aplicados).toContain("bairro");
  });

  test("⚠ o resto do formulário NÃO é tocado — escolher tomador não mexe no serviço nem no valor", () => {
    const { form } = aplicarTomadorEmitido({ form: FORM_VAZIO, registro: normalizarTomadores([ACME])[0] });
    expect(form.descricao).toBe("já escrito");
    expect(form.valorServicos).toBe("1.500,00");
  });

  test("⚠ o que o registro NÃO tem não apaga o que está na tela", () => {
    const jose = normalizarTomadores([JOSE])[0];
    const partida = { ...FORM_VAZIO, tomadorEmail: "eu@escrevi.com" };
    const { form, preservados } = aplicarTomadorEmitido({ form: partida, registro: jose });
    // O registro tem `email: null` (a emissão anterior não teve e-mail). Isso não é ordem de apagar.
    expect(form.tomadorEmail).toBe("eu@escrevi.com");
    expect(preservados).not.toContain("tomadorEmail");
  });

  test("registro nulo não faz nada", () => {
    const r = aplicarTomadorEmitido({ form: FORM_VAZIO, registro: null });
    expect(r.form).toBe(FORM_VAZIO);
    expect(r.aplicados).toEqual([]);
  });
});

describe("⚠⚠ O DIGITADO VENCE — escolher não apaga sem a pessoa ver", () => {
  const acme = normalizarTomadores([ACME])[0];
  const jaDigitado = {
    ...FORM_VAZIO,
    tomadorNome: "ACME SERVICOS LTDA - FILIAL",
    logradouro: "RUA NOVA",
  };

  test("campo com conteúdo diferente é PRESERVADO", () => {
    const { form, preservados } = aplicarTomadorEmitido({ form: jaDigitado, registro: acme });
    expect(form.tomadorNome).toBe("ACME SERVICOS LTDA - FILIAL");
    expect(form.logradouro).toBe("RUA NOVA");
    expect(preservados).toEqual(["tomadorNome", "logradouro"]);
  });

  test("⚠ e os campos vazios ao lado dele são preenchidos assim mesmo — preservar não é desistir", () => {
    const { form } = aplicarTomadorEmitido({ form: jaDigitado, registro: acme });
    expect(form.bairro).toBe("CENTRO");
    expect(form.cMun).toBe("3550308");
  });

  test("⚠ o que foi preservado volta NOMEADO, com os dois lados, para a tela poder dizer", () => {
    const { divergentes } = aplicarTomadorEmitido({ form: jaDigitado, registro: acme });
    expect(divergentes).toEqual([
      { campo: "tomadorNome", rotulo: "o nome", atual: "ACME SERVICOS LTDA - FILIAL", daMemoria: "ACME SERVICOS LTDA" },
      { campo: "logradouro", rotulo: "o logradouro", atual: "RUA NOVA", daMemoria: "RUA DAS FLORES" },
    ]);
    expect(textoDosPreservados(divergentes)).toBe("Mantivemos o nome e o logradouro como você já tinha preenchido.");
  });

  test("`forcar` é a SEGUNDA decisão da pessoa — aí sim substitui", () => {
    const { form, preservados } = aplicarTomadorEmitido({ form: jaDigitado, registro: acme, forcar: true });
    expect(form.tomadorNome).toBe("ACME SERVICOS LTDA");
    expect(form.logradouro).toBe("RUA DAS FLORES");
    expect(preservados).toEqual([]);
  });

  test("valor igual não conta como preservado nem como aplicado — nada mudou", () => {
    const igual = { ...FORM_VAZIO, bairro: "CENTRO" };
    const { preservados, aplicados } = aplicarTomadorEmitido({ form: igual, registro: acme });
    expect(preservados).not.toContain("bairro");
    expect(aplicados).not.toContain("bairro");
  });

  test("⚠⚠ O DOCUMENTO É A EXCEÇÃO: ele sempre vem da escolha", () => {
    // Preservá-lo deixaria o nome de um tomador com o CNPJ de outro — a nota sairia para a pessoa
    // errada, que é pior do que qualquer sobrescrita.
    const outroDoc = { ...FORM_VAZIO, tomadorDoc: "99999999999999" };
    const { form } = aplicarTomadorEmitido({ form: outroDoc, registro: acme });
    expect(form.tomadorDoc).toBe("12345678000190");
  });

  test("sem nada preservado não há frase", () => {
    expect(textoDosPreservados([])).toBe(null);
    expect(textoDosPreservados(null)).toBe(null);
  });

  test("um preservado só não vira lista com 'e'", () => {
    const um = aplicarTomadorEmitido({
      form: { ...FORM_VAZIO, bairro: "OUTRO" },
      registro: acme,
    });
    expect(textoDosPreservados(um.divergentes)).toBe("Mantivemos o bairro como você já tinha preenchido.");
  });
});

describe("camposDoTomador / enderecoVeioDaMemoria", () => {
  test("camposDoTomador devolve as chaves do FORMULÁRIO, não as do registro", () => {
    const campos = camposDoTomador(normalizarTomadores([ACME])[0]);
    expect(Object.keys(campos).sort()).toEqual(
      ["bairro", "cMun", "cep", "complemento", "logradouro", "numero", "tomadorDoc", "tomadorEmail", "tomadorNome"].sort()
    );
  });

  test("enderecoVeioDaMemoria só é verdade quando algum campo do endereço foi aplicado", () => {
    expect(enderecoVeioDaMemoria(["tomadorDoc", "tomadorNome"])).toBe(false);
    expect(enderecoVeioDaMemoria(["tomadorDoc", "bairro"])).toBe(true);
    expect(enderecoVeioDaMemoria(null)).toBe(false);
  });
});
