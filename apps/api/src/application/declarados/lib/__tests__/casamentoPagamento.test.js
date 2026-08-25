// O DÉBITO DO EXTRATO CASANDO COM A NOTA QUE ELE PAGOU.
//
// ⚠⚠ Os dois blocos que mais importam são "AMBIGUIDADE NÃO SE RESOLVE ESCOLHENDO" e "A PISTA DO
// FORNECEDOR É OBRIGATÓRIA". Sem o primeiro, o sistema põe a despesa na conta errada em silêncio;
// sem o segundo, duas mensalidades do mesmo valor no mesmo mês casam com o fornecedor trocado.

import {
  DIAS_ANTES_DA_EMISSAO,
  DIAS_DEPOIS_DA_EMISSAO,
  FRASE_DA_PISTA,
  FRASE_DO_SEM_CASAMENTO,
  PISTA,
  SEM_CASAMENTO,
  TOLERANCIA_VALOR,
  casarDebitoComNotas,
  casarLote,
  debitoPagaNota,
  palavrasQueIdentificam,
} from "../casamentoPagamento";

const dia = (s) => new Date(`${s}T00:00:00.000Z`);

const debito = (extra = {}) => ({
  id: "ofx-1",
  origem: "OFX_CLIENTE",
  valor: 1500,
  dataPagamento: dia("2026-07-20"),
  descricaoOriginal: "PAGTO GOOGLE CLOUD BRASIL",
  ...extra,
});

const nota = (extra = {}) => ({
  id: "nota-1",
  origem: "NOTA_RECEBIDA",
  valor: 1500,
  dataDocumento: dia("2026-07-15"),
  descricaoOriginal: "GOOGLE CLOUD BRASIL COMPUTACAO E SERVICOS DE DADOS LTDA",
  cnpjFornecedor: "12345678000190",
  ...extra,
});

describe("o casamento básico", () => {
  it("mesmo valor, dentro da janela, nome no memo ⇒ casa", () => {
    const r = debitoPagaNota(debito(), nota());
    expect(r.casa).toBe(true);
    expect(r.pista).toBe(PISTA.NOME_NO_MEMO);
    expect(r.palavra).toBe("GOOGLE");
  });

  it("⚠ o CNPJ no memo é a pista mais forte, e vence o nome", () => {
    const r = debitoPagaNota(debito({ descricaoOriginal: "TED 12.345.678/0001-90" }), nota());
    expect(r.pista).toBe(PISTA.CNPJ_NO_MEMO);
  });

  it("⚠ o CNPJ casa mesmo com pontuação diferente — a comparação é por dígitos", () => {
    expect(debitoPagaNota(debito({ descricaoOriginal: "PIX 12345678000190" }), nota()).casa).toBe(true);
  });
});

describe("⚠⚠ A PISTA DO FORNECEDOR É OBRIGATÓRIA", () => {
  it("valor e data batendo, SEM pista ⇒ NÃO casa", () => {
    // Duas notas do mesmo valor no mesmo mês são comuns (mensalidade, assinatura). Casar por valor
    // e data poria a despesa no fornecedor errado.
    expect(debitoPagaNota(debito({ descricaoOriginal: "DEBITO AUTOMATICO" }), nota()).casa).toBe(false);
  });

  it("⚠⚠ palavra que NÃO IDENTIFICA ninguém não vale como pista", () => {
    // "SERVICOS" está em metade das razões sociais do país. Sem a lista, um memo com essa palavra
    // casaria com toda nota de toda empresa de serviço.
    const r = debitoPagaNota(
      debito({ descricaoOriginal: "PAGAMENTO DE SERVICOS LTDA" }),
      nota({ descricaoOriginal: "ALGUMA COISA SERVICOS LTDA", cnpjFornecedor: null }),
    );
    expect(r.casa).toBe(false);
  });

  it("⚠ `palavrasQueIdentificam` descarta o ruído corporativo", () => {
    expect(palavrasQueIdentificam("GOOGLE CLOUD BRASIL COMPUTACAO E SERVICOS DE DADOS LTDA"))
      .toEqual(["GOOGLE", "CLOUD", "COMPUTACAO", "DADOS"]);
  });

  it("⚠ e devolve VAZIO quando o nome é só ruído — a ausência é a resposta", () => {
    // Fornecedor cujo nome é só ruído não PODE ser casado pelo nome, e quem chama precisa saber
    // disso em vez de achar que simplesmente não casou.
    expect(palavrasQueIdentificam("COMERCIO E SERVICOS LTDA ME")).toEqual([]);
  });

  it("⚠ sigla de 3 letras não identifica — com 3, 'TEC' casaria meia lista", () => {
    expect(palavrasQueIdentificam("TEC SOLUCOES")).toEqual(["SOLUCOES"]);
  });

  it("⚠⚠ a comparação usa FRONTEIRA DE PALAVRA, não `includes` cru", () => {
    // Sem ela, "CASA" casaria dentro de "CASADO", e memo de banco é cheio de palavra colada.
    const r = debitoPagaNota(
      debito({ descricaoOriginal: "PAGTO DESCASADO" }),
      nota({ descricaoOriginal: "CASA MATERIAIS", cnpjFornecedor: null }),
    );
    expect(r.casa).toBe(false);
  });

  it("acento não impede o casamento", () => {
    const r = debitoPagaNota(
      debito({ descricaoOriginal: "PAGTO MANUTENCAO PREDIAL" }),
      nota({ descricaoOriginal: "MANUTENÇÃO PREDIAL LTDA", cnpjFornecedor: null }),
    );
    expect(r.casa).toBe(true);
  });
});

describe("⚠ o VALOR — tolerância em CENTAVOS, nunca percentual", () => {
  it("cinco centavos passam", () => {
    expect(debitoPagaNota(debito({ valor: 1500.05 }), nota()).casa).toBe(true);
    expect(debitoPagaNota(debito({ valor: 1499.95 }), nota()).casa).toBe(true);
  });

  it("⚠⚠ seis centavos NÃO passam, e 2% muito menos", () => {
    // Tolerância percentual casaria uma nota de R$ 10.000 com um débito de R$ 9.800, que é outra
    // coisa. Os centavos cobrem arredondamento, e nada mais.
    expect(debitoPagaNota(debito({ valor: 1500.06 }), nota()).casa).toBe(false);
    expect(debitoPagaNota(debito({ valor: 1470 }), nota()).casa).toBe(false);
    expect(TOLERANCIA_VALOR).toBe(0.05);
  });

  it("valor ausente ou torto não casa", () => {
    for (const v of [null, undefined, 0, "abc", NaN]) {
      expect(debitoPagaNota(debito({ valor: v }), nota()).casa).toBe(false);
      expect(debitoPagaNota(debito(), nota({ valor: v })).casa).toBe(false);
    }
  });
});

describe("⚠ a JANELA", () => {
  it("pagamento no dia da emissão casa", () => {
    expect(debitoPagaNota(debito({ dataPagamento: dia("2026-07-15") }), nota()).casa).toBe(true);
  });

  it(`até ${DIAS_DEPOIS_DA_EMISSAO} dias depois casa; um dia além, não`, () => {
    expect(debitoPagaNota(debito({ dataPagamento: dia("2026-10-13") }), nota()).casa).toBe(true);
    expect(debitoPagaNota(debito({ dataPagamento: dia("2026-10-14") }), nota()).casa).toBe(false);
  });

  it(`⚠ até ${DIAS_ANTES_DA_EMISSAO} dias ANTES casa — serviço pago adiantado, nota emitida depois`, () => {
    expect(debitoPagaNota(debito({ dataPagamento: dia("2026-07-10") }), nota()).casa).toBe(true);
    expect(debitoPagaNota(debito({ dataPagamento: dia("2026-07-09") }), nota()).casa).toBe(false);
  });

  it("⚠ sem data dos dois lados não casa — não se inventa proximidade", () => {
    expect(debitoPagaNota(debito({ dataPagamento: null }), nota()).casa).toBe(false);
    expect(debitoPagaNota(debito(), nota({ dataDocumento: null })).casa).toBe(false);
  });
});

describe("⚠⚠ AMBIGUIDADE NÃO SE RESOLVE ESCOLHENDO", () => {
  it("UM candidato vira sugestão", () => {
    const r = casarDebitoComNotas(debito(), [nota()]);
    expect(r.sugestao.nota.id).toBe("nota-1");
    expect(r.motivo).toBeNull();
  });

  it("⚠⚠ DOIS candidatos ⇒ NENHUM é eleito, e os dois aparecem", () => {
    // Casar o pagamento com a nota errada põe a despesa na conta errada, em silêncio.
    const r = casarDebitoComNotas(debito(), [nota({ id: "a" }), nota({ id: "b" })]);
    expect(r.sugestao).toBeNull();
    expect(r.candidatos).toHaveLength(2);
    expect(r.motivo).toBe(SEM_CASAMENTO.AMBIGUO);
    expect(r.frase).toMatch(/não escolhe/i);
  });

  it("⚠ nenhum candidato tem motivo PRÓPRIO — 'não achei' ≠ 'achei demais'", () => {
    const r = casarDebitoComNotas(debito({ descricaoOriginal: "TARIFA" }), [nota()]);
    expect(r.motivo).toBe(SEM_CASAMENTO.NENHUM_CANDIDATO);
    expect(r.frase).toMatch(/despesa sem nota|ainda não chegou/i);
  });

  it("lista vazia não explode", () => {
    expect(casarDebitoComNotas(debito(), []).motivo).toBe(SEM_CASAMENTO.NENHUM_CANDIDATO);
    expect(casarDebitoComNotas(debito(), null).candidatos).toEqual([]);
  });
});

describe("⚠⚠ UMA NOTA NÃO PODE SER SUGERIDA A DOIS DÉBITOS", () => {
  it("dois débitos disputando a mesma nota ⇒ ambos ficam ambíguos", () => {
    // Ela foi paga uma vez. Oferecê-la duas vezes convidaria o contador a fundir as duas, e a nota
    // sumiria de uma delas DEPOIS do fato — com o segundo débito voltando a parecer despesa sem
    // nota, e ninguém entendendo por quê.
    const r = casarLote([debito({ id: "d1" }), debito({ id: "d2" })], [nota()]);
    expect(r.map((x) => x.sugestao)).toEqual([null, null]);
    expect(r.every((x) => x.motivo === SEM_CASAMENTO.AMBIGUO)).toBe(true);
  });

  it("⚠ e os candidatos CONTINUAM visíveis — a disputa não esconde a nota", () => {
    const r = casarLote([debito({ id: "d1" }), debito({ id: "d2" })], [nota()]);
    expect(r[0].candidatos).toHaveLength(1);
  });

  it("dois débitos com notas DIFERENTES continuam com sugestão cada um", () => {
    const r = casarLote(
      [
        debito({ id: "d1", descricaoOriginal: "PAGTO GOOGLE CLOUD" }),
        debito({ id: "d2", valor: 300, descricaoOriginal: "PAGTO NASAJON SISTEMAS" }),
      ],
      [nota({ id: "n1" }), nota({ id: "n2", valor: 300, descricaoOriginal: "NASAJON SISTEMAS LTDA", cnpjFornecedor: null })],
    );
    expect(r[0].sugestao.nota.id).toBe("n1");
    expect(r[1].sugestao.nota.id).toBe("n2");
  });

  it("lote vazio não explode", () => {
    expect(casarLote(null, [nota()])).toEqual([]);
    expect(casarLote([debito()], null)[0].motivo).toBe(SEM_CASAMENTO.NENHUM_CANDIDATO);
  });
});

describe("os vocabulários", () => {
  it("⚠ TODA pista e TODO motivo têm frase", () => {
    for (const p of Object.values(PISTA)) expect(FRASE_DA_PISTA[p].length).toBeGreaterThan(10);
    for (const m of Object.values(SEM_CASAMENTO)) expect(FRASE_DO_SEM_CASAMENTO[m].length).toBeGreaterThan(20);
  });

  it("são congelados", () => {
    for (const o of [PISTA, FRASE_DA_PISTA, SEM_CASAMENTO, FRASE_DO_SEM_CASAMENTO]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
  });
});

describe("⚠ o módulo é PURO, e NÃO decide nada sozinho", () => {
  it("não importa prisma, não lê o relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "casamentoPagamento.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/from\s+["'].*prisma/i);
    expect(fonte).not.toMatch(/Date\.now\(|new Date\(\s*\)/);
    // ⚠⚠ E não muda estado nenhum: ele não sabe o que é `CONTABILIZADO` nem escreve campo de
    // declarado. Quem funde é o serviço, com o contador tendo confirmado.
    expect(fonte).not.toMatch(/CONTABILIZADO|FUNDIDO|estado\s*[:=]/);
  });
});

describe("⚠⚠ OS BUGS DO CASAMENTO ACHADOS POR AUDITORIA (25/08/2026)", () => {
  const { TOLERANCIA_EM_CENTAVOS } = require("../casamentoPagamento.js");

  it("⚠⚠ CINCO CENTAVOS PASSAM — em QUALQUER valor, não só nos que o float favorece", () => {
    // Medido: `Math.abs(1500 - 1500.05)` = 0,04999… (passava) e `|1500.10 - 1500.15|` = 0,05000…
    // (não passava). A mesma diferença, resultado oposto, conforme os centavos.
    for (const [a, b] of [[1500, 1500.05], [1500.1, 1500.15], [333.33, 333.38], [0.01, 0.06]]) {
      const r = debitoPagaNota(
        { valor: a, dataPagamento: dia("2026-07-18"), descricaoOriginal: "PAGTO KODA BEAR" },
        { valor: b, dataDocumento: dia("2026-07-15"), descricaoOriginal: "KODA BEAR LTDA" },
      );
      expect(r.casa).toBe(true);
    }
  });

  it("⚠ seis centavos NÃO passam, também em qualquer valor", () => {
    for (const [a, b] of [[1500, 1500.06], [1500.1, 1500.16], [333.33, 333.39]]) {
      const r = debitoPagaNota(
        { valor: a, dataPagamento: dia("2026-07-18"), descricaoOriginal: "PAGTO KODA BEAR" },
        { valor: b, dataDocumento: dia("2026-07-15"), descricaoOriginal: "KODA BEAR LTDA" },
      );
      expect(r.casa).toBe(false);
    }
  });

  it("a tolerância em centavos é a mesma dos reais declarados", () => {
    expect(TOLERANCIA_EM_CENTAVOS).toBe(Math.round(TOLERANCIA_VALOR * 100));
  });

  it("⚠⚠ DOCUMENTO CURTO NÃO VIRA PISTA DE CNPJ — 'casa por acaso' não é identidade", () => {
    // Medido: `cnpjFornecedor: "90"` casava com o memo "TARIFA MENSAL PACOTE 90".
    for (const doc of ["90", "0", "1234567890"]) {
      const r = debitoPagaNota(
        { valor: 175, dataPagamento: dia("2026-07-18"), descricaoOriginal: "TARIFA MENSAL PACOTE 90" },
        { valor: 175, dataDocumento: dia("2026-07-15"), descricaoOriginal: "ACME", cnpjFornecedor: doc },
      );
      expect(r.pista).not.toBe(PISTA.CNPJ_NO_MEMO);
    }
  });

  it("⚠ CPF (11) e CNPJ (14) continuam identificando", () => {
    for (const doc of ["12345678901", "12345678000190"]) {
      const r = debitoPagaNota(
        { valor: 175, dataPagamento: dia("2026-07-18"), descricaoOriginal: `PAGTO ${doc} MENSAL` },
        { valor: 175, dataDocumento: dia("2026-07-15"), descricaoOriginal: "ACME", cnpjFornecedor: doc },
      );
      expect(r).toMatchObject({ casa: true, pista: PISTA.CNPJ_NO_MEMO });
    }
  });
});
