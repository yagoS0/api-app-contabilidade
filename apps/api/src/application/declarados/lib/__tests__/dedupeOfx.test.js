// A IDENTIDADE DE UMA TRANSAÇÃO DE EXTRATO.
//
// ⚠⚠ O bloco "AS TRÊS CONTAS DA SOBREPOSIÇÃO" é o que mais importa. Ele prova que o desenho acerta
// nos três casos do mundo real, e é o único jeito de saber que a proteção funciona sem ter um banco
// na frente: o `@@unique` faz o resto, mas só se as chaves saírem certas daqui.

import {
  ANOMALIA,
  CHAVE,
  FRASE_DA_ANOMALIA,
  anomaliasDoExtrato,
  identidadesDoExtrato,
} from "../dedupeOfx";

const CONTA = { bankId: "341", acctId: "12345-6", acctType: "CHECKING" };
const dia = (s) => new Date(`${s}T00:00:00.000Z`);

const trn = (extra = {}) => ({
  fitId: "F1",
  trnType: "DEBIT",
  data: dia("2026-07-15"),
  valor: 1500,
  sinal: "DEBITO",
  historico: "GOOGLE CLOUD BRASIL",
  ...extra,
});

const hashes = (ts, conta = CONTA) => identidadesDoExtrato(ts, conta).map((i) => i.hashDedupe);

describe("⚠⚠ AS TRÊS CONTAS DA SOBREPOSIÇÃO — o caso normal, não a exceção", () => {
  // O cliente baixa 01–31/jan e depois 15/jan–15/fev. A sobreposição é o comportamento esperado de
  // quem usa internet banking.
  const tarifa = (i) => trn({ fitId: null, historico: "TARIFA PACOTE SERVICOS", valor: 29.9, fitIdIgnorado: i });

  it("base 0 · arquivo 2 iguais ⇒ chaves DISTINTAS, as duas entram", () => {
    const [a, b] = hashes([tarifa(1), tarifa(2)]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/#1$/);
    expect(b).toMatch(/#2$/);
  });

  it("⚠⚠ base 1 · arquivo 2 ⇒ o PRIMEIRO repete a chave que já existe, o segundo é novo", () => {
    // É esta a linha que faz "importa 1". O ordinal é POSICIONAL NO ARQUIVO: deslocá-lo pelo que já
    // existe faria a primeira linha nunca colidir, e toda reimportação duplicaria.
    const primeiraImportacao = hashes([tarifa(1)]);
    const segundaImportacao = hashes([tarifa(1), tarifa(2)]);
    expect(segundaImportacao[0]).toBe(primeiraImportacao[0]); // colide ⇒ o banco recusa
    expect(segundaImportacao[1]).not.toBe(primeiraImportacao[0]); // nova ⇒ entra
  });

  it("base 2 · arquivo 2 ⇒ as DUAS chaves repetem, nada entra", () => {
    const antes = hashes([tarifa(1), tarifa(2)]);
    const depois = hashes([tarifa(1), tarifa(2)]);
    expect(depois).toEqual(antes);
  });

  it("⚠⚠ o MESMO ARQUIVO subido de novo gera EXATAMENTE as mesmas chaves", () => {
    const arquivo = [trn({ fitId: "A" }), trn({ fitId: "B" }), tarifa(1), tarifa(2)];
    expect(hashes(arquivo)).toEqual(hashes(arquivo));
  });

  it("⚠ e um arquivo SOBREPOSTO reencontra as chaves das transações comuns", () => {
    const janeiro = [trn({ fitId: "J1" }), trn({ fitId: "J2" }), trn({ fitId: "J3" })];
    const meioJaneiroAteFevereiro = [trn({ fitId: "J2" }), trn({ fitId: "J3" }), trn({ fitId: "F1x" })];
    const [, j2, j3] = hashes(janeiro);
    const [s1, s2, s3] = hashes(meioJaneiroAteFevereiro);
    expect(s1).toBe(j2);
    expect(s2).toBe(j3);
    expect([j2, j3]).not.toContain(s3);
  });
});

describe("as duas chaves", () => {
  it("com `fitId`, a identidade é a do BANCO", () => {
    const [i] = identidadesDoExtrato([trn({ fitId: "202607150001" })], CONTA);
    expect(i.chave).toBe(CHAVE.FITID);
    expect(i.hashDedupe).toBe("OFX:12345-6:202607150001#1");
  });

  it("sem `fitId`, cai na impressão digital", () => {
    const [i] = identidadesDoExtrato([trn({ fitId: null })], CONTA);
    expect(i.chave).toBe(CHAVE.IMPRESSAO);
    expect(i.hashDedupe).toBe("OFXFP:12345-6:2026-07-15:1500.00:DEBITO:GOOGLE CLOUD BRASIL#1");
  });

  it("⚠ `fitId` só de espaços é ausência, não identidade", () => {
    expect(identidadesDoExtrato([trn({ fitId: "   " })], CONTA)[0].chave).toBe(CHAVE.IMPRESSAO);
  });

  it("⚠ o `#n` é SEMPRE escrito, inclusive no primeiro", () => {
    // Omiti-lo no primeiro criaria duas grafias para a mesma coisa, e a segunda importação teria de
    // saber qual delas usar.
    expect(hashes([trn()])[0]).toMatch(/#1$/);
  });
});

describe("⚠⚠ A CONTA BANCÁRIA FAZ PARTE DA IDENTIDADE", () => {
  it("a MESMA transação em contas diferentes tem chaves diferentes", () => {
    // Sem isso, o débito de R$ 1.500 do dia 15 na conta A seria descartado como duplicata do
    // débito de R$ 1.500 do dia 15 na conta B.
    const contaB = { ...CONTA, acctId: "98765-4" };
    expect(hashes([trn({ fitId: null })], CONTA)[0]).not.toBe(hashes([trn({ fitId: null })], contaB)[0]);
  });

  it("⚠ vale também para o `fitId` — ele é único POR CONTA, não globalmente", () => {
    const contaB = { ...CONTA, acctId: "98765-4" };
    expect(hashes([trn()], CONTA)[0]).not.toBe(hashes([trn()], contaB)[0]);
  });

  it("⚠ arquivo sem conta usa um rótulo NOMEADO, não uma string vazia", () => {
    expect(hashes([trn()], null)[0]).toBe("OFX:SEM-CONTA:F1#1");
  });
});

describe("⚠⚠ A NORMALIZAÇÃO É CONGELADA", () => {
  it("maiúsculas e espaços colapsados — e SÓ isso", () => {
    const a = hashes([trn({ fitId: null, historico: "  pagto   google  cloud " })])[0];
    const b = hashes([trn({ fitId: null, historico: "PAGTO GOOGLE CLOUD" })])[0];
    expect(a).toBe(b);
  });

  it("⚠⚠ ACENTO NÃO é removido — e isso é DELIBERADO, não esquecimento", () => {
    // Tirar acento parece melhoria, e é exatamente o tipo de mudança que reescreveria a identidade
    // de TODAS as transações já importadas: o próximo extrato do cliente reimportaria o histórico
    // inteiro em duplicidade, sem erro e sem aviso. Quem quiser mexer tem de derrubar este teste de
    // propósito, e aí lê o porquê.
    const comAcento = hashes([trn({ fitId: null, historico: "SERVIÇOS DE MANUTENÇÃO" })])[0];
    const sem = hashes([trn({ fitId: null, historico: "SERVICOS DE MANUTENCAO" })])[0];
    expect(comAcento).not.toBe(sem);
  });

  it("⚠ o VALOR entra com duas casas fixas — 1500 e 1500.00 são a mesma transação", () => {
    expect(hashes([trn({ fitId: null, valor: 1500 })])[0]).toBe(hashes([trn({ fitId: null, valor: 1500.0 })])[0]);
  });

  it("⚠ o SINAL entra — um débito e um crédito de mesmo valor no mesmo dia são coisas opostas", () => {
    expect(hashes([trn({ fitId: null, sinal: "DEBITO" })])[0])
      .not.toBe(hashes([trn({ fitId: null, sinal: "CREDITO" })])[0]);
  });

  it("⚠ a data entra como DIA em UTC — não como instante", () => {
    expect(hashes([trn({ fitId: null })])[0]).toContain(":2026-07-15:");
  });

  it("data inválida não explode, e vira componente vazio", () => {
    expect(() => hashes([trn({ fitId: null, data: null })])).not.toThrow();
  });
});

describe("⚠ as anomalias — relatam, nunca bloqueiam", () => {
  it("arquivo sem conta bancária avisa que o dedupe ficou mais frouxo", () => {
    const ids = identidadesDoExtrato([trn()], null);
    const a = anomaliasDoExtrato(ids, null);
    expect(a.map((x) => x.codigo)).toContain(ANOMALIA.SEM_CONTA_BANCARIA);
    expect(a.find((x) => x.codigo === ANOMALIA.SEM_CONTA_BANCARIA).frase).toMatch(/sem separar contas/i);
  });

  it("transações sem `fitId` são CONTADAS", () => {
    const ids = identidadesDoExtrato([trn(), trn({ fitId: null }), trn({ fitId: null })], CONTA);
    const a = anomaliasDoExtrato(ids, CONTA);
    expect(a.find((x) => x.codigo === ANOMALIA.SEM_FITID).n).toBe(2);
  });

  it("⚠ banco repetindo o MESMO `fitId` no arquivo é avisado — e as duas entram assim mesmo", () => {
    const ids = identidadesDoExtrato([trn({ fitId: "X" }), trn({ fitId: "X" })], CONTA);
    expect(ids[0].hashDedupe).not.toBe(ids[1].hashDedupe);
    expect(anomaliasDoExtrato(ids, CONTA).find((x) => x.codigo === ANOMALIA.FITID_REPETIDO).n).toBe(1);
  });

  it("extrato limpo não inventa aviso", () => {
    expect(anomaliasDoExtrato(identidadesDoExtrato([trn()], CONTA), CONTA)).toEqual([]);
  });

  it("⚠ TODA anomalia tem frase", () => {
    for (const c of Object.values(ANOMALIA)) {
      expect(typeof FRASE_DA_ANOMALIA[c]).toBe("string");
      expect(FRASE_DA_ANOMALIA[c].length).toBeGreaterThan(20);
    }
  });
});

describe("entrada torta", () => {
  it("lista vazia ou nula não explode", () => {
    expect(identidadesDoExtrato(null, CONTA)).toEqual([]);
    expect(identidadesDoExtrato([], null)).toEqual([]);
    expect(anomaliasDoExtrato(null, CONTA)).toEqual([]);
  });
});

describe("⚠ o módulo é PURO", () => {
  it("não importa prisma, não lê o relógio, e NÃO usa a normalização do matching", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "dedupeOfx.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/from\s+["'].*prisma/i);
    expect(fonte).not.toMatch(/Date\.now\(/);
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
    // ⚠⚠ A trava mais importante do arquivo: importar `normalizeMatchText` aqui amarraria a
    // identidade das transações a uma função que a Fase B2 vai deixar mais esperta — e cada
    // melhoria dela reimportaria o histórico inteiro.
    expect(fonte).not.toMatch(/normalizeMatchText|excelImport/);
  });
});
