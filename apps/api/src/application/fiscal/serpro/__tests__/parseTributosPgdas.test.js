// AS FIXTURES SÃO EXCERTOS DO TEXTO REAL — não transcrição.
//
// Capturadas da produção em 17/08/2026 com `scripts/diag-tributos-extrato-pgdas.mjs` (só leitura),
// que imprime o **match inteiro** da regex: o cabeçalho com o espaçamento real mais a linha de
// valores. É de onde vem `CABECALHO`, e ele é a razão de este teste existir na forma em que está:
// o cabeçalho sai **totalmente colado** (`IRPJCSLLCOFINS…`), e uma fixture escrita à mão teria
// posto espaços — passaria pela regex (que usa `\s*` em toda junta) e não descreveria o leiaute.
//
// ⚠ NÃO HÁ IDENTIFICADOR AQUI. Razão social, CNPJ e inscrição ficaram de fora; os trechos abaixo
// são só números. Valores, datas e códigos **não** se anonimizam — são estrutura, mesma disciplina
// de `parseSitfisRelatorio.test.js`.

import {
  parseTributosPgdas,
  tributosPorTributoParaColuna,
  ROTULOS_DO_CABECALHO,
  MOTIVO,
} from "../parseTributosPgdas.js";

// O cabeçalho, exatamente como o `rawText` o traz (medido em 3 extratos distintos, idêntico nos 3).
const CABECALHO = "IRPJCSLLCOFINSPIS/PasepINSS/CPPICMSIPIISSTotal";

// As cinco linhas de valores, literais da produção.
const VALORES = Object.freeze({
  comInss: "28,8025,2092,3020,02312,480,000,00241,20720,00",
  semInss: "284,56218,45295,3363,950,000,000,00574,861.437,15",
  outroComInss: "21,4018,7368,5914,87232,210,000,00179,24535,04",
  milharesA: "52,4445,88168,0636,44568,930,000,00439,151.310,90",
  milharesB: "488,72293,23275,6459,62563,980,000,00273,681.954,87",
});

/** O extrato como ele chega: cabeçalho, quebra de linha, valores colados. */
const linhaReal = (valores) => `${CABECALHO}\n${valores}`;

describe("a linha de tributos do extrato, sobre o texto REAL", () => {
  it("parte em 9 valores e fecha a soma nas cinco amostras de produção", () => {
    for (const [nome, valores] of Object.entries(VALORES)) {
      const r = parseTributosPgdas(linhaReal(valores));
      expect(`${nome}: ${r.valores.length}`).toBe(`${nome}: 9`);
      expect(`${nome}: ${r.somaConfere}`).toBe(`${nome}: true`);
      expect(`${nome}: ${r.motivo}`).toBe(`${nome}: null`);
      // A autoverificação, dita como número: os oito somam o último.
      expect(r.soma).toBe(r.total);
    }
  });

  it("os oito rótulos saem na ordem do cabeçalho, com os valores da amostra", () => {
    const r = parseTributosPgdas(linhaReal(VALORES.comInss));
    expect(r.reparticao).toEqual({
      IRPJ: 28.8,
      CSLL: 25.2,
      COFINS: 92.3,
      "PIS/Pasep": 20.02,
      "INSS/CPP": 312.48,
      ICMS: 0,
      IPI: 0,
      ISS: 241.2,
    });
    expect(r.total).toBe(720);
  });

  it("⚠ o separador de milhar do último valor não parte o número (1.437,15, não 1 + 437,15)", () => {
    const r = parseTributosPgdas(linhaReal(VALORES.semInss));
    expect(r.total).toBe(1437.15);
    expect(r.reparticao.ISS).toBe(574.86);
    // INSS/CPP zerado é real nesta amostra — e é o caso que prova que zero não vira ausência.
    expect(r.reparticao["INSS/CPP"]).toBe(0);
  });

  it("ICMS e IPI vieram 0,00 em TODAS as amostras — sinal a favor da ordem, nunca prova", () => {
    for (const valores of Object.values(VALORES)) {
      const r = parseTributosPgdas(linhaReal(valores));
      expect(r.reparticao.ICMS).toBe(0);
      expect(r.reparticao.IPI).toBe(0);
    }
  });

  it("o cabeçalho REAL é colado — e é isso que a fixture precisa reproduzir", () => {
    // Se alguém "arrumar" a fixture pondo espaços, este teste continua passando (a regex tem \s*),
    // mas o de baixo cai: o cabeçalho colado é o leiaute, e ele está travado aqui.
    expect(CABECALHO).not.toMatch(/\s/);
    expect(parseTributosPgdas(linhaReal(VALORES.comInss)).somaConfere).toBe(true);
  });
});

describe("o que NÃO vira repartição", () => {
  it("texto sem a linha de tributos", () => {
    const r = parseTributosPgdas("Receita Bruta Informada: R$ 1.000,00");
    expect(r.reparticao).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_LINHA_DE_TRIBUTOS);
    expect(r.total).toBeNull();
  });

  it("texto vazio / nulo não explode e não inventa nada", () => {
    for (const entrada of ["", null, undefined]) {
      const r = parseTributosPgdas(entrada);
      expect(r.reparticao).toBeNull();
      expect(r.total).toBeNull();
    }
  });

  it("⚠ soma que não fecha NÃO grava repartição parcial — mas o total continua saindo", () => {
    // Mesmo cabeçalho real, com o ISS adulterado (241,20 -> 241,30) para a soma não bater.
    // ⚠ O desvio precisa passar de 1 centavo: essa é a tolerância. É o caso que a
    // autoverificação existe para pegar: split colado em que um número foi lido errado.
    const adulterado = "28,8025,2092,3020,02312,480,000,00241,30720,00";
    const r = parseTributosPgdas(linhaReal(adulterado));
    expect(r.reparticao).toBeNull();
    expect(r.somaConfere).toBe(false);
    expect(r.motivo).toBe(MOTIVO.SOMA_NAO_FECHA);
    // ⚠ O total NÃO é perdido: ele é a regra que já está em produção e não depende da soma.
    expect(r.total).toBe(720);
  });

  it("⚠ contagem diferente de 9 recusa a repartição e preserva o total", () => {
    const r = parseTributosPgdas(`${CABECALHO}\n28,8025,20720,00`);
    expect(r.valores).toHaveLength(3);
    expect(r.reparticao).toBeNull();
    expect(r.motivo).toBe(MOTIVO.CONTAGEM_INESPERADA);
    expect(r.total).toBe(720);
  });
});

describe("a forma da coluna tributosPorTributo", () => {
  it("carrega procedência, âncora do total e a marca de ordem NÃO verificada", () => {
    const leitura = parseTributosPgdas(linhaReal(VALORES.comInss));
    const col = tributosPorTributoParaColuna(leitura, { lidoEm: new Date("2026-08-17T12:00:00Z") });
    expect(col).toEqual({
      fonte: "EXTRATO_PGDAS_D",
      lidoEm: "2026-08-17T12:00:00.000Z",
      total: 720,
      somaConfere: true,
      ordemVerificada: false,
      tributos: {
        IRPJ: 28.8, CSLL: 25.2, COFINS: 92.3, "PIS/Pasep": 20.02,
        "INSS/CPP": 312.48, ICMS: 0, IPI: 0, ISS: 241.2,
      },
    });
  });

  it("⚠ `ordemVerificada` é SEMPRE false — é o `verificadoTrial:false` desta coluna", () => {
    for (const valores of Object.values(VALORES)) {
      const col = tributosPorTributoParaColuna(parseTributosPgdas(linhaReal(valores)));
      expect(col.ordemVerificada).toBe(false);
      expect(col.somaConfere).toBe(true); // nunca false: o que não fecha não vira coluna
    }
  });

  it("⚠ as chaves são os rótulos do cabeçalho VERBATIM (PIS/Pasep e INSS/CPP com a barra)", () => {
    const col = tributosPorTributoParaColuna(parseTributosPgdas(linhaReal(VALORES.comInss)));
    expect(Object.keys(col.tributos)).toEqual([...ROTULOS_DO_CABECALHO]);
    expect(Object.keys(col.tributos)).toContain("PIS/Pasep");
    expect(Object.keys(col.tributos)).toContain("INSS/CPP");
    // Encurtar para PIS/CPP é decisão do dono, não do código.
    expect(Object.keys(col.tributos)).not.toContain("PIS");
    expect(Object.keys(col.tributos)).not.toContain("CPP");
  });

  it("soma que não fecha devolve null — não há coluna parcial", () => {
    const ruim = parseTributosPgdas(linhaReal("28,8025,2092,3020,02312,480,000,00241,30720,00"));
    expect(tributosPorTributoParaColuna(ruim)).toBeNull();
    expect(tributosPorTributoParaColuna(parseTributosPgdas(""))).toBeNull();
  });
});

describe("⚠ o total lido aqui é o MESMO que a produção já gravava em dasTotal", () => {
  // Esta é a garantia de não-regressão do `impostoApurado`: a regra é "o último valor", sem
  // exigência de soma — exatamente `values[values.length - 1]` do serviço.
  it.each(Object.entries(VALORES))("%s", (_nome, valores) => {
    const r = parseTributosPgdas(linhaReal(valores));
    const ultimoBruto = valores.match(/\d+(?:\.\d{3})*,\d{2}/g).slice(-1)[0];
    const esperado = Number(ultimoBruto.replace(/\./g, "").replace(",", "."));
    expect(r.total).toBe(esperado);
  });
});
