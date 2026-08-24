// A NOTA RECEBIDA VIRANDO DESPESA.
//
// ⚠ Os números citados aqui saíram de `scripts/diag-notas-viram-despesa.mjs` contra produção em
// 24/08/2026, com piso 01/07/2026: 229 notas virariam declarado (R$ 765 mil, 114 fornecedores),
// **0 sem competência**, **0 sem CNPJ**, 32 sem `xDescServ`; e ficaram de fora 1.595 pelo piso,
// **62 sem valor** e **60 canceladas**.

import {
  FRASE_DO_NAO_VIRA,
  NAO_VIRA,
  hashDaNota,
  notaViraDeclarado,
  separarNotas,
} from "../notaViraDeclarado";

const EMISSAO = new Date("2026-07-15T00:00:00.000Z");

const nota = (extra = {}) => ({
  id: "pi-1",
  type: "NFSE",
  papel: "DEST",
  total: 1500,
  issueDate: EMISSAO,
  // ⚠⚠ DateTime, como no banco — NÃO string.
  competencia: new Date("2026-07-01T00:00:00.000Z"),
  emitenteNome: "  KODA BEAR  ",
  emitenteDoc: "12345678000190",
  xDescServ: "Servicos de consultoria em TI",
  ...extra,
});

describe("⚠⚠ A NOTA NÃO VIRA LANÇAMENTO — vira declarado ESPERANDO o pagamento", () => {
  const { ok, dados } = notaViraDeclarado(nota(), { situacao: "autorizada" });

  it("vira", () => expect(ok).toBe(true));

  it("⚠⚠ NÃO traz data de pagamento — é a ausência dela que segura o lançamento", () => {
    expect(dados).not.toHaveProperty("dataPagamento");
    expect(dados).not.toHaveProperty("origemPagamento");
  });

  it("a data do DOCUMENTO é a emissão", () => {
    expect(dados.dataDocumento).toBe(EMISSAO);
  });

  it("origem e tipo", () => {
    expect(dados.origem).toBe("NOTA_RECEBIDA");
    expect(dados.tipo).toBe("SAIDA");
  });
});

describe("⚠⚠ A COMPETÊNCIA É DateTime NA NOTA E STRING NO DECLARADO", () => {
  it('vira "AAAA-MM"', () => {
    // ⚠ `String(new Date(...))` daria "Wed Jul 01 2026…", que PASSA no Prisma (a coluna é texto) e
    // só aparece como lançamento que nenhum filtro de competência encontra.
    const { dados } = notaViraDeclarado(nota(), { situacao: "autorizada" });
    expect(dados.competencia).toBe("2026-07");
  });

  it("⚠ a fatia é da ISO em UTC — o dia 1º não pode cair no mês anterior", () => {
    const { dados } = notaViraDeclarado(
      nota({ competencia: new Date("2026-07-01T00:00:00.000Z") }),
      { situacao: "autorizada" },
    );
    expect(dados.competencia).toBe("2026-07");
  });

  it("⚠⚠ competência NULA fica NULA — não se deduz o mês da emissão", () => {
    // Deduzi-la seria o sistema decidindo em qual apuração a despesa entra.
    const { dados } = notaViraDeclarado(nota({ competencia: null }), { situacao: "autorizada" });
    expect(dados.competencia).toBeNull();
    expect(dados.dataDocumento).toBe(EMISSAO); // ⚠ a emissão está lá, e mesmo assim não vira competência
  });

  it("competência ilegível também vira null, nunca uma data torta", () => {
    expect(notaViraDeclarado(nota({ competencia: "banana" }), { situacao: "autorizada" }).dados.competencia)
      .toBeNull();
  });
});

describe("⚠ o que NÃO vira despesa — e cada motivo tem nome", () => {
  it("nota EMITIDA pela empresa é receita, não despesa", () => {
    const r = notaViraDeclarado(nota({ papel: "EMIT" }), { situacao: "autorizada" });
    expect(r.motivo).toBe(NAO_VIRA.NAO_E_RECEBIDA);
  });

  it("⚠⚠ CANCELADA não vira — medido: 60 na base", () => {
    expect(notaViraDeclarado(nota(), { situacao: "cancelada" }).motivo).toBe(NAO_VIRA.CANCELADA);
  });

  it("⚠ SUBSTITUÍDA não vira", () => {
    expect(notaViraDeclarado(nota(), { situacao: "substituida" }).motivo).toBe(NAO_VIRA.SUBSTITUIDA);
  });

  it("⚠⚠ quem manda é a situação do CICLO, não a coluna crua da nota", () => {
    // `statusEfetivo` só guarda `autorizada|cancelada` — substituição não cabe nela. Quem separa as
    // duas é `derivarCiclo`. Esta regra recebe o veredito PRONTO e não relê a coluna: aqui o campo
    // cru diz cancelada, o ciclo diz autorizada, e a regra segue o ciclo.
    expect(notaViraDeclarado(nota({ statusEfetivo: "cancelada" }), { situacao: "autorizada" }).ok).toBe(true);
    // E o inverso: coluna limpa, ciclo dizendo substituída (a nota irmã denuncia) => não vira.
    expect(notaViraDeclarado(nota({ statusEfetivo: "autorizada" }), { situacao: "substituida" }).motivo)
      .toBe(NAO_VIRA.SUBSTITUIDA);
  });

  it("⚠⚠ SEM VALOR não vira — medido: 62 na base", () => {
    for (const t of [null, undefined, 0, -1, "abc"]) {
      expect(notaViraDeclarado(nota({ total: t }), { situacao: "autorizada" }).motivo)
        .toBe(NAO_VIRA.SEM_VALOR);
    }
  });

  it("⚠⚠ sem data de emissão não vira — e `null` é o caso que engana", () => {
    // `new Date(null)` é 1970-01-01, uma data VÁLIDA. Sem a guarda explícita, a nota viraria
    // despesa datada de 1970 — ordenando a fila inteira e abrindo uma janela de meio século no
    // casamento com o pagamento. `undefined` e texto sujo já seriam pegos por serem inválidos.
    for (const d of [null, undefined, "", "banana"]) {
      expect(notaViraDeclarado(nota({ issueDate: d }), { situacao: "autorizada" }).motivo)
        .toBe(NAO_VIRA.SEM_DATA);
    }
  });

  it("⚠ e a prova de que era `null` que passava: 1970 nunca sai como dataDocumento", () => {
    const r = notaViraDeclarado(nota({ issueDate: null }), { situacao: "autorizada" });
    expect(r.dados).toBeNull();
  });

  it("⚠⚠ SEM EMITENTE não vira — o nome dele É o histórico do lançamento", () => {
    for (const n of [null, "", "   "]) {
      const r = notaViraDeclarado(nota({ emitenteNome: n }), { situacao: "autorizada" });
      expect(r.motivo).toBe(NAO_VIRA.SEM_EMITENTE);
      expect(r.frase).toMatch(/razão|histórico/i);
    }
  });

  it("⚠ nenhum motivo devolve `dados` — não se fabrica despesa parcial", () => {
    for (const r of [
      notaViraDeclarado(nota({ total: 0 }), { situacao: "autorizada" }),
      notaViraDeclarado(nota(), { situacao: "cancelada" }),
    ]) {
      expect(r.dados).toBeNull();
    }
  });
});

describe("⚠⚠ A DATA-PISO", () => {
  it("nota anterior ao piso fica de fora, NOMEADA", () => {
    const r = notaViraDeclarado(nota({ issueDate: new Date("2026-06-30T00:00:00.000Z") }), {
      situacao: "autorizada",
      dataPiso: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(r.motivo).toBe(NAO_VIRA.ANTES_DA_DATA_PISO);
  });

  it("⚠ a nota DO DIA do piso entra — o piso é inclusivo", () => {
    const r = notaViraDeclarado(nota({ issueDate: new Date("2026-07-01T00:00:00.000Z") }), {
      situacao: "autorizada",
      dataPiso: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(r.ok).toBe(true);
  });

  it("sem piso, nada é cortado por data", () => {
    expect(notaViraDeclarado(nota({ issueDate: new Date("2020-01-01T00:00:00.000Z") }), { situacao: "autorizada" }).ok)
      .toBe(true);
  });
});

describe("o que a nota dá ao declarado", () => {
  it("⚠⚠ o HISTÓRICO é o NOME DO FORNECEDOR, não o `xDescServ`", () => {
    // Medido: os 130 lançamentos vindos do Excel gravam exatamente o nome. O `xDescServ` é mais
    // rico, e trocar o formato do histórico mudaria o que o razão mostra.
    const { dados } = notaViraDeclarado(nota(), { situacao: "autorizada" });
    expect(dados.descricaoOriginal).toBe("KODA BEAR");
    expect(dados.detalheServico).toBe("Servicos de consultoria em TI");
  });

  it("⚠ NF-e é RESUMO e não traz descrição — nulo quer dizer 'o documento não traz'", () => {
    const { dados } = notaViraDeclarado(nota({ type: "NFE", xDescServ: null }), { situacao: "autorizada" });
    expect(dados.detalheServico).toBeNull();
    expect(dados.ok).toBeUndefined();
  });

  it("⚠ o CNPJ do fornecedor viaja — é a âncora FORTE do aprendizado", () => {
    const { dados } = notaViraDeclarado(nota(), { situacao: "autorizada" });
    expect(dados.cnpjFornecedor).toBe("12345678000190");
  });

  it("a conta sugerida entra quando o aprendizado a der, e é null quando não", () => {
    expect(notaViraDeclarado(nota(), { situacao: "autorizada" }).dados.contaSugerida).toBeNull();
    expect(notaViraDeclarado(nota(), { situacao: "autorizada", contaSugerida: "411020008" }).dados.contaSugerida)
      .toBe("411020008");
  });
});

describe("⚠⚠ a impressão digital", () => {
  it("sai do id da nota", () => {
    expect(hashDaNota("pi-1")).toBe("NOTA:pi-1");
    expect(notaViraDeclarado(nota(), { situacao: "autorizada" }).dados.hashDedupe).toBe("NOTA:pi-1");
  });

  it("⚠ NÃO sai da chave de acesso — as NF-e recebidas são resumos e podem vir sem chave", () => {
    const { dados } = notaViraDeclarado(nota({ chaveAcesso: null }), { situacao: "autorizada" });
    expect(dados.hashDedupe).toBe("NOTA:pi-1");
  });

  it("notas diferentes têm digitais diferentes", () => {
    expect(hashDaNota("a")).not.toBe(hashDaNota("b"));
  });
});

describe("⚠⚠ separarNotas — nada some em silêncio", () => {
  const lote = [
    nota({ id: "a" }),
    nota({ id: "b", total: null }),
    nota({ id: "c", total: 0 }),
    nota({ id: "d" }),
    nota({ id: "e", papel: "EMIT" }),
  ];

  it("separa o que vira do que não vira", () => {
    const r = separarNotas(lote, () => ({ situacao: "autorizada" }));
    expect(r.viram.map((v) => v.nota.id)).toEqual(["a", "d"]);
  });

  it("⚠⚠ o que ficou de fora volta AGRUPADO POR MOTIVO, com contagem", () => {
    // Uma varredura que só dissesse "criei 2" faria as outras 3 desaparecerem sem ninguém saber por
    // quê — e "não veio nada" ficaria indistinguível de "deu erro".
    const r = separarNotas(lote, () => ({ situacao: "autorizada" }));
    const porMotivo = Object.fromEntries(r.fora.map((g) => [g.motivo, g.n]));
    expect(porMotivo[NAO_VIRA.SEM_VALOR]).toBe(2);
    expect(porMotivo[NAO_VIRA.NAO_E_RECEBIDA]).toBe(1);
  });

  it("⚠ ordenado do motivo mais frequente para o menos — é a ordem em que se age", () => {
    const r = separarNotas(lote, () => ({ situacao: "autorizada" }));
    expect(r.fora[0].motivo).toBe(NAO_VIRA.SEM_VALOR);
  });

  it("⚠ a amostra é PEQUENA — lista de 1.885 ids ninguém lê", () => {
    const muitas = Array.from({ length: 50 }, (_, i) => nota({ id: `x${i}`, total: 0 }));
    const r = separarNotas(muitas, () => ({ situacao: "autorizada" }));
    expect(r.fora[0].n).toBe(50);
    expect(r.fora[0].exemplos).toHaveLength(5);
  });

  it("⚠ a situação é resolvida POR NOTA — um lote misto não usa a situação de uma só", () => {
    const r = separarNotas(
      [nota({ id: "viva" }), nota({ id: "morta" })],
      (n) => ({ situacao: n.id === "morta" ? "cancelada" : "autorizada" }),
    );
    expect(r.viram.map((v) => v.nota.id)).toEqual(["viva"]);
  });

  it("lote vazio / torto não explode", () => {
    expect(separarNotas(null).viram).toEqual([]);
    expect(separarNotas([]).fora).toEqual([]);
  });
});

describe("os vocabulários", () => {
  it("⚠ TODO motivo tem frase", () => {
    for (const m of Object.values(NAO_VIRA)) {
      expect(typeof FRASE_DO_NAO_VIRA[m]).toBe("string");
      expect(FRASE_DO_NAO_VIRA[m].length).toBeGreaterThan(10);
    }
  });

  it("são congelados", () => {
    expect(Object.isFrozen(NAO_VIRA)).toBe(true);
    expect(Object.isFrozen(FRASE_DO_NAO_VIRA)).toBe(true);
  });
});

describe("⚠ o módulo é PURO", () => {
  it("não importa prisma e não lê o relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "notaViraDeclarado.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/from\s+["'].*prisma/i);
    expect(fonte).not.toMatch(/Date\.now\(/);
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });
});
