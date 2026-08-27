// QUAL ABA DE APURAÇÃO ESTA EMPRESA TEM.
//
// Até 27/08/2026 o regime só ESCONDIA a aba. Agora ele escolhe QUAL DAS DUAS telas renderiza — e o
// erro deixou de custar uma aba a menos para custar a apuração de outro regime na tela.

import fs from "node:fs";
import path from "node:path";
import {
  APURACAO, apuracaoDoRegime, apuracaoDaEmpresa, regimeDaEmpresa,
  telaDeApuracao, mostraApuracaoDoSimples, mostraApuracaoDoPresumido,
} from "../regimeDaAba";

describe("⚠ os valores que EXISTEM em produção", () => {
  // Medido em 27/08/2026: `Company.regimeTributario` tem exatamente SIMPLES (23) e
  // LUCRO_PRESUMIDO (11), e zero nulos.
  it("SIMPLES e LUCRO_PRESUMIDO respondem o que se espera", () => {
    expect(apuracaoDoRegime("SIMPLES")).toBe(APURACAO.SIMPLES);
    expect(apuracaoDoRegime("LUCRO_PRESUMIDO")).toBe(APURACAO.PRESUMIDO);
  });
});

describe("⚠⚠ A LEITURA É POR PADRÃO, NUNCA POR IGUALDADE", () => {
  it("`SIMPLES_NACIONAL` é lido igual a `SIMPLES`", () => {
    // A `Company` grava `SIMPLES` e o `CadastroFiscal` grava `SIMPLES_NACIONAL`. O
    // `=== "SIMPLES"` que a tela usava faz a MESMA empresa ter dois regimes conforme a fonte lida.
    expect(apuracaoDoRegime("SIMPLES_NACIONAL")).toBe(APURACAO.SIMPLES);
  });

  it("caixa, espaço e espaçamento não mudam a resposta", () => {
    for (const v of ["lucro_presumido", "  Lucro Presumido  ", "LUCRO PRESUMIDO"]) {
      expect(apuracaoDoRegime(v)).toBe(APURACAO.PRESUMIDO);
    }
  });

  it("LUCRO REAL cai na tela do Presumido — os dois apuram por trimestre", () => {
    expect(apuracaoDoRegime("LUCRO_REAL")).toBe(APURACAO.PRESUMIDO);
  });

  it("⚠ MEI antes de SIMPLES — o MEI É optante, e um texto com as duas palavras é MEI", () => {
    expect(apuracaoDoRegime("SIMPLES NACIONAL - MEI")).toBe(APURACAO.SIMPLES);
  });

  it("⚠⚠ texto que existe e não se reconhece NÃO vira Simples por descarte", () => {
    for (const v of ["LUCRO ARBITRADO", "IMUNE", "xyz"]) {
      expect(apuracaoDoRegime(v)).toBe(APURACAO.DESCONHECIDO);
    }
  });

  it("ausente e vazio respondem DESCONHECIDO", () => {
    for (const v of [null, undefined, "", "   "]) expect(apuracaoDoRegime(v)).toBe(APURACAO.DESCONHECIDO);
  });
});

describe("⚠ DE ONDE SAI O REGIME — a cadeia de quatro campos foi PRESERVADA", () => {
  it("lê os quatro caminhos, na mesma ordem de `isSimplesCompany`", () => {
    expect(regimeDaEmpresa({ regimeTributario: "SIMPLES" })).toBe("SIMPLES");
    expect(regimeDaEmpresa({ tipoTributario: "SIMPLES" })).toBe("SIMPLES");
    expect(regimeDaEmpresa({ legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO" } })).toBe("LUCRO_PRESUMIDO");
    expect(regimeDaEmpresa({ legacyCompany: { tipoTributario: "LUCRO_PRESUMIDO" } })).toBe("LUCRO_PRESUMIDO");
  });

  it("empresa ausente não quebra", () => {
    expect(regimeDaEmpresa(null)).toBeNull();
    expect(apuracaoDaEmpresa(undefined)).toBe(APURACAO.DESCONHECIDO);
  });
});

describe("⚠⚠ QUAL TELA — e `DESCONHECIDO` continua no Simples, DE PROPÓSITO", () => {
  it("Presumido e Real vão para a tela do Presumido", () => {
    for (const v of ["LUCRO_PRESUMIDO", "LUCRO_REAL"]) {
      expect(telaDeApuracao({ regimeTributario: v })).toBe(APURACAO.PRESUMIDO);
    }
  });

  it("⚠⚠ sem regime, a tela é a do SIMPLES — o comportamento antigo fica INTACTO", () => {
    // Era `if (!regime) return true` em `isSimplesCompany`. Mudar isso tiraria a aba de Apuração de
    // quem a tem hoje, por causa de um dado que ninguém preencheu.
    for (const c of [{}, null, { regimeTributario: "" }, { regimeTributario: "xyz" }]) {
      expect(telaDeApuracao(c)).toBe(APURACAO.SIMPLES);
    }
  });

  it("⚠ as duas perguntas são COMPLEMENTARES — nunca as duas abas, nunca nenhuma", () => {
    for (const v of ["SIMPLES", "LUCRO_PRESUMIDO", "MEI", "", "xyz", "LUCRO_REAL"]) {
      const c = { regimeTributario: v };
      expect(mostraApuracaoDoSimples(c)).toBe(!mostraApuracaoDoPresumido(c));
    }
  });
});

describe("⚠⚠ O ESPELHO DO BACKEND ESTÁ AMARRADO", () => {
  // `regimeDoPresumido.js` mora no `apps/api` e não é importável daqui (os dois apps não
  // compartilham código). A amarração é TEXTUAL, no molde de `duasTabelasDeAnexo.test.js`. Sem ela,
  // a tela ofereceria uma aba que a rota recusa — ou esconderia uma que ela aceita.
  const FONTE = path.resolve(
    __dirname,
    "../../../../../../api/src/application/fiscal/lp/lib/regimeDoPresumido.js",
  );

  it("o arquivo-fonte existe (se ele mudar de lugar, este teste cai — que é o ponto)", () => {
    expect(fs.existsSync(FONTE)).toBe(true);
  });

  it("⚠⚠ os PADRÕES de leitura são os mesmos, na mesma ordem", () => {
    // Ordem importa: `MEI` tem de vir antes de `SIMPLES`. Invertida, "SIMPLES NACIONAL - MEI"
    // responderia diferente nos dois lados.
    const texto = fs.readFileSync(FONTE, "utf-8");
    const bloco = texto.slice(texto.indexOf("export function apuracaoDoRegime"));
    const padroes = [...bloco.matchAll(/if \(\/([^/]+)\/\.test\(t\)\) return APURACAO\.(\w+);/g)]
      .map((m) => `${m[1]}=>${m[2]}`);
    expect(padroes).toEqual(["MEI\\b=>SIMPLES", "PRESUMID=>PRESUMIDO", "REAL=>PRESUMIDO", "SIMPLES=>SIMPLES"]);
  });

  it("⚠ as três respostas têm o mesmo nome nos dois apps", () => {
    const texto = fs.readFileSync(FONTE, "utf-8");
    for (const chave of Object.keys(APURACAO)) {
      expect(texto).toContain(`${chave}: "${APURACAO[chave]}"`);
    }
  });

  it("⚠⚠ e o backend continua NÃO tendo o default do `mapRegime`", () => {
    // Ele termina em `return APURACAO.DESCONHECIDO`. Se alguém puser `SIMPLES` ali, a rota do
    // Presumido passaria a recusar toda empresa sem regime — e esta tela não teria como saber.
    const texto = fs.readFileSync(FONTE, "utf-8");
    const bloco = texto.slice(texto.indexOf("export function apuracaoDoRegime"));
    const fim = bloco.slice(0, bloco.indexOf("\n}"));
    expect(fim.trimEnd().endsWith("return APURACAO.DESCONHECIDO;")).toBe(true);
  });
});
