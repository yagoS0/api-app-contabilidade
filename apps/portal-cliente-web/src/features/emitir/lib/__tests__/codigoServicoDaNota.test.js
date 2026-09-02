// A REGRA DO CÓDIGO DE SERVIÇO NA TELA — e o AMARRE com a autoridade do backend.
//
// ⚠⚠ ESTE MÓDULO É ESPELHO, e o teste que mais importa é o último bloco: ele roda a MESMA entrada
// pelas DUAS implementações (a da tela e `escolherCodigoServicoNacional`, do backend) e exige o
// mesmo veredito. Sem isso, "espelho" é intenção, não fato — e a divergência apareceria como
// "a tela ofereceu e o servidor recusou", no portal que ninguém do escritório testa.
//
// Mesmo arranjo de `faltasParaEmitir` × `REQUIRED_COMPANY_FIELDS`.

import {
  codigoQueANotaDeclara,
  SITUACAO,
  codigoParaOPayload,
  codigosOferecidos,
  conferirCodigoEscolhido,
  descricaoDoCodigo,
  normalizarCodigoServicoNacional,
  rotuloDoCodigo,
} from "../codigoServicoDaNota";
// ⚠ A AUTORIDADE, importada do backend. Ela é PURA (nenhum Prisma, nenhum `res`) — foi escrita
// assim de propósito, e é isso que permite amarrá-la aqui.
import { escolherCodigoServicoNacional } from "../../../../../../api/src/application/nfse/codigoServicoDaNota.js";

describe("a forma do `cTribNac`: 6 dígitos, SEM padding", () => {
  it("aceita exatamente 6 dígitos", () => {
    expect(normalizarCodigoServicoNacional("010101")).toBe("010101");
    expect(normalizarCodigoServicoNacional("01.01.01")).toBe("010101");
  });

  it("⚠ NÃO completa com zeros — 5 dígitos é recusa, não `0` na frente", () => {
    // Padding fabricaria código plausível a partir de um dígito a menos: a classe do
    // `cLocEmi="0000000"`, que este projeto já pagou.
    expect(normalizarCodigoServicoNacional("10101")).toBeNull();
    expect(normalizarCodigoServicoNacional("31.01")).toBeNull();
    expect(normalizarCodigoServicoNacional("0101011")).toBeNull();
    expect(normalizarCodigoServicoNacional(null)).toBeNull();
    expect(normalizarCodigoServicoNacional("")).toBeNull();
  });
});

describe("o que a tela pode oferecer", () => {
  it("⚠ UM CÓDIGO SÓ — o ramo que renderiza hoje (0 de 33 empresas têm lista plural)", () => {
    const r = codigosOferecidos({ lista: [], singular: "010101" });
    expect(r.situacao).toBe(SITUACAO.UNICO);
    expect(r.oferecidos).toEqual(["010101"]);
  });

  it("a LISTA vence o singular quando existe — a mesma precedência do backend", () => {
    const r = codigosOferecidos({ lista: ["070201", "140201"], singular: "010101" });
    expect(r.situacao).toBe(SITUACAO.VARIOS);
    expect(r.oferecidos).toEqual(["070201", "140201"]);
    expect(r.oferecidos).not.toContain("010101");
  });

  it("lista com UM elemento é UNICO, não VARIOS", () => {
    expect(codigosOferecidos({ lista: ["070201"] }).situacao).toBe(SITUACAO.UNICO);
  });

  it("sem nada: `SEM_CODIGO`, e nada é oferecido", () => {
    const r = codigosOferecidos({ lista: [], singular: null });
    expect(r.situacao).toBe(SITUACAO.SEM_CODIGO);
    expect(r.oferecidos).toEqual([]);
  });

  it("⚠⚠ CÓDIGO FORA DA FORMA NÃO SOME — ele volta em `invalidos`", () => {
    // Sumir faria o cliente achar que a empresa tem MENOS códigos do que tem. A coluna não tem
    // CHECK no banco, então isto acontece de verdade.
    const r = codigosOferecidos({ lista: ["070201", "31.01", "140201"] });
    expect(r.oferecidos).toEqual(["070201", "140201"]);
    expect(r.invalidos).toEqual(["31.01"]);
  });

  it("⚠ mas o inválido NÃO é oferecível — o servidor o recusaria", () => {
    const r = codigosOferecidos({ lista: ["31.01"] });
    expect(r.oferecidos).toEqual([]);
    expect(r.invalidos).toEqual(["31.01"]);
    expect(r.situacao).toBe(SITUACAO.SEM_CODIGO);
  });

  it("repetidos são colapsados", () => {
    expect(codigosOferecidos({ lista: ["070201", "070201"] }).oferecidos).toEqual(["070201"]);
  });
});

describe("⚠⚠ ENCONTRA, NUNCA ESCOLHE", () => {
  it("com VÁRIOS e nada escolhido, o formulário NÃO está pronto — e a tela diz o que falta", () => {
    const r = conferirCodigoEscolhido({ situacao: SITUACAO.VARIOS, oferecidos: ["070201", "140201"] });
    expect(r.ok).toBe(false);
    expect(r.falta).toMatch(/Escolha o código/i);
  });

  it("⚠ nem com dois: 'o primeiro da lista' seria o sistema declarando o serviço ao fisco", () => {
    const r = conferirCodigoEscolhido({ situacao: SITUACAO.VARIOS, oferecidos: ["070201", "140201"] });
    expect(r.ok).toBe(false);
  });

  it("escolha FORA dos oferecidos não passa", () => {
    const r = conferirCodigoEscolhido({
      situacao: SITUACAO.VARIOS, oferecidos: ["070201"], escolhido: "999999",
    });
    expect(r.ok).toBe(false);
  });

  it("escolha válida passa", () => {
    const r = conferirCodigoEscolhido({
      situacao: SITUACAO.VARIOS, oferecidos: ["070201"], escolhido: "070201",
    });
    expect(r.ok).toBe(true);
  });

  it("⚠ UNICO e SEM_CODIGO não exigem escolha — não há o que escolher", () => {
    expect(conferirCodigoEscolhido({ situacao: SITUACAO.UNICO, oferecidos: ["010101"] }).ok).toBe(true);
    expect(conferirCodigoEscolhido({ situacao: SITUACAO.SEM_CODIGO, oferecidos: [] }).ok).toBe(true);
  });
});

describe("⚠⚠ o que vai no PAYLOAD", () => {
  it("VARIOS + escolhido ⇒ o código escolhido é enviado", () => {
    expect(codigoParaOPayload({ situacao: SITUACAO.VARIOS, escolhido: "140201" })).toBe("140201");
  });

  it("⚠ UNICO NÃO manda nada — sem o campo, o servidor usa o cadastro (o caminho de sempre)", () => {
    // Mandar o único trocaria um caminho testado por outro sem necessidade, e nenhuma emissão
    // existente pode mudar de comportamento por esta entrega.
    expect(codigoParaOPayload({ situacao: SITUACAO.UNICO, escolhido: "010101" })).toBeNull();
  });

  it("SEM_CODIGO não manda nada", () => {
    expect(codigoParaOPayload({ situacao: SITUACAO.SEM_CODIGO, escolhido: "010101" })).toBeNull();
  });

  it("VARIOS sem escolha manda `null` — e a trava do formulário impede chegar aqui", () => {
    expect(codigoParaOPayload({ situacao: SITUACAO.VARIOS, escolhido: "" })).toBeNull();
  });
});

describe("a descrição oficial", () => {
  const LISTA = [["010101", "Análise e desenvolvimento de sistemas."], ["070201", "Outra coisa."]];

  it("acha pelo código", () => {
    expect(descricaoDoCodigo(LISTA, "010101")).toBe("Análise e desenvolvimento de sistemas.");
  });

  it("⚠ AUSÊNCIA É RESPOSTA — código fora da lista devolve `null`, e a tela mostra só o número", () => {
    expect(descricaoDoCodigo(LISTA, "999999")).toBeNull();
    expect(descricaoDoCodigo(null, "010101")).toBeNull();
  });

  it("o rótulo cai no número quando a descrição não veio", () => {
    expect(rotuloDoCodigo("010101", "Uma descrição")).toBe("010101 — Uma descrição");
    expect(rotuloDoCodigo("010101", null)).toBe("010101");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠⚠ O AMARRE COM A AUTORIDADE — a tela e o servidor concordam, caso a caso", () => {
  // Cada cenário roda pelas DUAS implementações. A pergunta é sempre a mesma: **este código pode
  // ser emitido por esta empresa?** Se as duas discordarem, o teste acende AQUI, e não em produção
  // como "a tela ofereceu e o servidor recusou".
  const CENARIOS = [
    { nome: "singular só, escolha igual a ele", lista: [], singular: "010101", escolhido: "010101" },
    { nome: "singular só, escolha diferente", lista: [], singular: "010101", escolhido: "070201" },
    { nome: "lista de dois, escolha na lista", lista: ["070201", "140201"], singular: "010101", escolhido: "140201" },
    { nome: "lista de dois, escolha fora", lista: ["070201", "140201"], singular: "010101", escolhido: "999999" },
    { nome: "lista com elemento torto, escolha válida", lista: ["070201", "31.01"], singular: null, escolhido: "070201" },
    { nome: "escolha com forma inválida", lista: ["070201"], singular: null, escolhido: "31.01" },
    { nome: "sem cadastro nenhum", lista: [], singular: null, escolhido: "070201" },
  ];

  it.each(CENARIOS)("$nome", ({ lista, singular, escolhido }) => {
    const daAutoridade = escolherCodigoServicoNacional({ escolhido, lista, singular });
    const daTela = codigosOferecidos({ lista, singular });
    // A tela considera a escolha possível quando ela está entre os oferecidos.
    const telaOferece = daTela.oferecidos.includes(normalizarCodigoServicoNacional(escolhido));

    expect(telaOferece).toBe(daAutoridade.ok);
  });

  it("⚠ os OFERECIDOS da tela são exatamente os HABILITADOS que a autoridade reconhece", () => {
    for (const { lista, singular } of CENARIOS) {
      const daAutoridade = escolherCodigoServicoNacional({ lista, singular });
      const daTela = codigosOferecidos({ lista, singular });
      const habilitados = daAutoridade.habilitados.length
        ? daAutoridade.habilitados
        : daAutoridade.codigo ? [daAutoridade.codigo] : [];
      expect(daTela.oferecidos).toEqual(habilitados);
    }
  });

  it("⚠ a FORMA é a mesma dos dois lados — nenhum dos dois faz padding", () => {
    for (const bruto of ["010101", "01.01.01", "10101", "31.01", "0101011", "", null]) {
      const daTela = normalizarCodigoServicoNacional(bruto);
      // A autoridade recusa a forma inválida com código próprio; a tela devolve `null`.
      const daAutoridade = escolherCodigoServicoNacional({
        escolhido: bruto, lista: ["010101"], singular: null,
      });
      if (bruto === "" || bruto === null) continue; // "não veio nada" é outro caminho
      expect(daTela === null).toBe(daAutoridade.codigo === "NFSE_CODIGO_SERVICO_INVALIDO");
    }
  });
});

// ⚠⚠ O QUE A PRÉVIA MOSTRA É O QUE A NOTA DECLARA (31/08/2026)
//
// Achado em teste de usabilidade: com vários códigos, o espelho da nota mostrava o SINGULAR do
// cadastro e não mudava com a escolha — a nota saía com um código e a prévia afirmava outro. E com
// NADA escolhido ela já afirmava o singular, enquanto a tela recusa emitir: o espelho elegia.
describe("⚠⚠ codigoQueANotaDeclara — a pergunta da PRÉVIA", () => {
  it("⚠⚠ VÁRIOS: devolve o ESCOLHIDO, nunca o singular do cadastro", () => {
    expect(codigoQueANotaDeclara({
      situacao: SITUACAO.VARIOS,
      oferecidos: ["070201", "140201"],
      escolhido: "140201",
      singular: "070201",
    })).toBe("140201");
  });

  it("⚠⚠ VÁRIOS e nada escolhido: `null` — a prévia mostra traço, e para de eleger", () => {
    expect(codigoQueANotaDeclara({
      situacao: SITUACAO.VARIOS,
      oferecidos: ["070201", "140201"],
      escolhido: "",
      singular: "070201",
    })).toBeNull();
  });

  it("⚠ escolha fora dos oferecidos não vira afirmação", () => {
    expect(codigoQueANotaDeclara({
      situacao: SITUACAO.VARIOS,
      oferecidos: ["070201"],
      escolhido: "999999",
      singular: "070201",
    })).toBeNull();
  });

  it("ÚNICO: devolve o código — é o que o servidor vai usar", () => {
    expect(codigoQueANotaDeclara({
      situacao: SITUACAO.UNICO,
      oferecidos: ["070201"],
      escolhido: "",
      singular: "070201",
    })).toBe("070201");
  });

  it("SEM_CODIGO: `null`", () => {
    expect(codigoQueANotaDeclara({ situacao: SITUACAO.SEM_CODIGO, oferecidos: [], singular: null }))
      .toBeNull();
  });

  it("⚠⚠ ela NÃO é `codigoParaOPayload` — no ÚNICO as duas respondem coisas diferentes", () => {
    const entrada = { situacao: SITUACAO.UNICO, oferecidos: ["070201"], escolhido: "", singular: "070201" };
    // "que campo eu MANDO?" → nenhum: o servidor usa o cadastro (o caminho de sempre).
    expect(codigoParaOPayload(entrada)).toBeNull();
    // "o que vai SAIR na nota?" → o código do cadastro.
    expect(codigoQueANotaDeclara(entrada)).toBe("070201");
  });
});
