// A DECLARAÇÃO DE RECORRÊNCIA — o que a tela do cliente recusa antes de mandar.

import {
  EXEMPLOS,
  LADO,
  PERIODICIDADE,
  RECUSA,
  ROTULO_DA_PERIODICIDADE,
  ROTULO_DO_LADO,
  corpoDaDeclaracao,
  faltasDaDeclaracao,
  leituraDoEnvio,
  podeEnviar,
} from "../declaracaoDeRecorrencia";

const cheio = (extra = {}) => ({
  lado: LADO.DESPESA,
  rotulo: "Anuidade do Conselho",
  periodicidade: PERIODICIDADE.ANUAL,
  // ⚠ O campo guarda o MASCARADO, que é o que o teclado produz.
  valor: "1.200,00",
  ...extra,
});

describe("⚠ o que falta para enviar", () => {
  it("com tudo preenchido, nada falta", () => {
    expect(faltasDaDeclaracao(cheio())).toEqual([]);
    expect(podeEnviar(cheio())).toBe(true);
  });

  it("⚠⚠ TODAS as faltas de uma vez — nunca uma por clique", () => {
    const r = faltasDaDeclaracao({});
    expect(r).toContain(RECUSA.SEM_LADO);
    expect(r).toContain(RECUSA.SEM_ROTULO);
    expect(r).toContain(RECUSA.SEM_PERIODICIDADE);
    expect(r).toContain(RECUSA.SEM_VALOR);
  });

  it("⚠ rótulo só com espaços é rótulo vazio", () => {
    expect(faltasDaDeclaracao(cheio({ rotulo: "   " }))).toEqual([RECUSA.SEM_ROTULO]);
  });

  it.each([
    ["lado inventado", { lado: "AMBOS" }, RECUSA.SEM_LADO],
    ["periodicidade inventada", { periodicidade: "SEMESTRAL" }, RECUSA.SEM_PERIODICIDADE],
  ])("⚠ %s cai na mesma recusa de ausente — vocabulário FECHADO", (_n, extra, esperado) => {
    expect(faltasDaDeclaracao(cheio(extra))).toEqual([esperado]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O VALOR — e aqui o erro é de ORDEM DE GRANDEZA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o valor reusa o parser de moeda deste portal", () => {
  it("o mascarado é lido certo", () => {
    expect(corpoDaDeclaracao(cheio({ valor: "1.200,00" })).valor).toBe(1200);
    expect(corpoDaDeclaracao(cheio({ valor: "130,00" })).valor).toBe(130);
  });

  it("⚠⚠ campo vazio é SEM_VALOR, não zero", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(faltasDaDeclaracao(cheio({ valor: v }))).toEqual([RECUSA.SEM_VALOR]);
    }
  });

  it("⚠⚠ ZERO tem recusa PRÓPRIA — os consertos são diferentes", () => {
    // "não preenchi" pede preencher; "digitei zero" pede saber que zero não é recorrência.
    expect(faltasDaDeclaracao(cheio({ valor: "0,00" }))).toEqual([RECUSA.VALOR_ZERO]);
    expect(faltasDaDeclaracao(cheio({ valor: "0" }))).toEqual([RECUSA.VALOR_ZERO]);
  });

  it("⚠⚠ `Number(null)` é 0 e 0 é FINITO — a guarda é `> 0`, e ela morde", () => {
    expect(podeEnviar(cheio({ valor: "0,00" }))).toBe(false);
  });

  it("⚠ e a leitura NÃO é `Number(replace(',', '.'))` — seria erro de mil vezes", () => {
    // `Number("1.500,00")` é NaN e `Number("1.500")` é 1,5. O parser deste portal existe por isso.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "declaracaoDeRecorrencia.js"), "utf8")
      // ⚠ BLOCO antes de LINHA — um `//` dentro de `/* */` apaga o fechamento e o regex engole o
      // código real até o `*/` seguinte.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(fonte).toMatch(/lerValorDoCampo/);
    expect(fonte).not.toMatch(/replace\(\s*","/);
    expect(fonte).not.toMatch(/parseFloat/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE **NÃO** VIAJA NO CORPO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o corpo", () => {
  it("leva os quatro campos, e só", () => {
    expect(Object.keys(corpoDaDeclaracao(cheio())).sort())
      .toEqual(["lado", "periodicidade", "rotulo", "valor"]);
  });

  it("⚠⚠ NENHUMA CONTA — o cliente não tem plano de contas, e isto é sobre CAIXA", () => {
    const corpo = corpoDaDeclaracao(cheio({ contaAplicada: "411020001", conta: "401" }));
    expect(corpo).not.toHaveProperty("conta");
    expect(corpo).not.toHaveProperty("contaAplicada");
  });

  it("⚠⚠ NENHUM ESTADO — a série nasce PENDENTE por construção do servidor", () => {
    // Deixar a tela mandar `estado` abriria o caminho para o cliente pôr a própria declaração no
    // fluxo de caixa.
    expect(corpoDaDeclaracao(cheio({ estado: "ATIVA" }))).not.toHaveProperty("estado");
  });

  it("⚠⚠ NENHUMA CHAVE — quem canoniza é o servidor, num lugar só", () => {
    // Uma segunda canonização diverge da primeira na primeira correção, e aí a declaração de hoje
    // não encontra a de ontem.
    expect(corpoDaDeclaracao(cheio({ chave: "ANUIDADE" }))).not.toHaveProperty("chave");
  });

  it("⚠ o rótulo vai aparado", () => {
    expect(corpoDaDeclaracao(cheio({ rotulo: "  Aluguel  " })).rotulo).toBe("Aluguel");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ OS DOIS DESFECHOS NÃO SE PARECEM.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a leitura do envio", () => {
  it("⚠⚠ o sucesso DIZ que nada entra no fluxo sem o contador", () => {
    const r = leituraDoEnvio({ ok: true, jaDecidida: false }, cheio());
    expect(r.tom).toBe("ok");
    expect(r.frase).toMatch(/depois que ele confirmar/i);
    expect(r.frase).toMatch(/Anuidade do Conselho/);
  });

  it("⚠⚠ `jaDecidida` tem desfecho PRÓPRIO — 'registramos' nos dois casos seria mentira", () => {
    const r = leituraDoEnvio({ ok: true, jaDecidida: true }, cheio());
    expect(r.tom).toBe("aviso");
    expect(r.frase).toMatch(/não mudou nada/i);
    expect(r.frase).toMatch(/fale com ele/i);
  });

  it("⚠ sem o rótulo do formulário, cai no que o servidor devolveu", () => {
    const r = leituraDoEnvio({ ok: true, serie: { rotulo: "Do servidor" } }, {});
    expect(r.frase).toMatch(/Do servidor/);
  });
});

describe("⚠ o vocabulário para quem não é contador", () => {
  it("⚠⚠ 'dinheiro que sai/entra', não 'despesa/receita'", () => {
    // O cliente não fala contabilês, e a declaração é sobre CAIXA.
    expect(ROTULO_DO_LADO[LADO.DESPESA]).toMatch(/sai/i);
    expect(ROTULO_DO_LADO[LADO.RECEITA]).toMatch(/entra/i);
    // ⚠ Sobre os RÓTULOS, não sobre as chaves: as chaves SÃO o vocabulário do servidor
    // (`DESPESA`/`RECEITA`) e têm de continuar sendo — o que não pode falar contabilês é o texto
    // que chega ao cliente.
    for (const rotulo of Object.values(ROTULO_DO_LADO)) {
      expect(rotulo).not.toMatch(/despesa|receita/i);
    }
    expect(Object.keys(ROTULO_DO_LADO).sort()).toEqual(["DESPESA", "RECEITA"]);
  });

  it("⚠ a periodicidade também", () => {
    expect(ROTULO_DA_PERIODICIDADE[PERIODICIDADE.ANUAL]).toBe("Uma vez por ano");
    expect(ROTULO_DA_PERIODICIDADE[PERIODICIDADE.TRIMESTRAL]).toBe("A cada três meses");
  });

  it("⚠⚠ os exemplos são PLACEHOLDER, não valor padrão", () => {
    // Preencher o campo com um exemplo faria o cliente enviar o exemplo achando que era dele.
    expect(EXEMPLOS.length).toBeGreaterThan(0);
    expect(faltasDaDeclaracao({ lado: LADO.DESPESA, periodicidade: PERIODICIDADE.MENSAL, valor: "10,00" }))
      .toContain(RECUSA.SEM_ROTULO);
  });
});

describe("⚠ as três periodicidades são as do servidor", () => {
  it("MENSAL, TRIMESTRAL e ANUAL — não um segundo vocabulário", () => {
    expect(Object.keys(PERIODICIDADE).sort()).toEqual(["ANUAL", "MENSAL", "TRIMESTRAL"]);
  });

  it("⚠⚠ e a ANUAL existe por causa da taxa do Conselho", () => {
    // Um desenho que conte MESES quebra nela: ela nunca teria 3 meses seguidos.
    expect(podeEnviar(cheio({ periodicidade: PERIODICIDADE.ANUAL }))).toBe(true);
  });
});
