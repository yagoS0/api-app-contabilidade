// O CADASTRO É A AUTORIDADE SOBRE O CÓDIGO DE SERVIÇO — a regra, sozinha.
//
// A ligação (recusa antes de reservar número, e o código saindo no `<cTribNac>`) é exercida em
// `emissaoDps.test.js`, sobre o XML. Aqui é só a decisão.

import {
  escolherCodigoServicoNacional,
  normalizarCodigoServicoNacional,
  CODIGO_FORA_DA_LISTA,
  CODIGO_FORMA_INVALIDA,
  ORIGEM,
} from "../codigoServicoDaNota.js";

describe("forma do cTribNac — 6 dígitos, sem padding", () => {
  it("aceita exatamente 6 dígitos, com ou sem pontuação", () => {
    expect(normalizarCodigoServicoNacional("310104")).toBe("310104");
    expect(normalizarCodigoServicoNacional("31.01.04")).toBe("310104");
    expect(normalizarCodigoServicoNacional(" 010101 ")).toBe("010101");
  });

  it("⚠ NÃO completa com zero — 5 dígitos não viram um código plausível", () => {
    // É a classe de defeito do `cLocEmi=\"0000000\"`: `padStart` fabricando código que ninguém
    // digitou. `10101` é o que a planilha oficial devolve quando a coluna é lida como número —
    // quem tem de dar o padding é o GERADOR da lista, conferindo item/subitem/desdobro.
    expect(normalizarCodigoServicoNacional("10101")).toBeNull();
    expect(normalizarCodigoServicoNacional("3101040")).toBeNull();
    expect(normalizarCodigoServicoNacional("")).toBeNull();
    expect(normalizarCodigoServicoNacional(null)).toBeNull();
  });
});

describe("⚠ o código escolhido tem de estar no cadastro", () => {
  it("dentro da lista: é ele que vale", () => {
    const r = escolherCodigoServicoNacional({
      escolhido: "310104",
      lista: ["171201", "310104"],
      singular: "171201",
    });
    expect(r).toMatchObject({ ok: true, codigo: "310104", origem: ORIGEM.ESCOLHIDO });
  });

  it("⚠ FORA da lista: recusa nomeada, e a mensagem diz quais são os cadastrados", () => {
    const r = escolherCodigoServicoNacional({
      escolhido: "999999",
      lista: ["171201", "310104"],
      singular: "171201",
    });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_FORA_DA_LISTA);
    expect(r.habilitados).toEqual(["171201", "310104"]);
    expect(r.message).toContain("999999");
    expect(r.correcao).toMatch(/cadastr/i);
  });

  it("⚠ NUNCA 'o primeiro da lista' — sem escolha, quem vale é o singular do cadastro", () => {
    // Escolher por conta própria seria o sistema decidindo qual serviço a empresa declara ao fisco.
    const r = escolherCodigoServicoNacional({
      lista: ["171201", "310104"],
      singular: "310104",
    });
    expect(r).toMatchObject({ ok: true, codigo: "310104", origem: ORIGEM.CADASTRO });
  });

  it("a pontuação não muda a resposta — 31.01.04 é 310104", () => {
    const r = escolherCodigoServicoNacional({
      escolhido: "31.01.04",
      lista: ["31.01.04"],
      singular: "310104",
    });
    expect(r).toMatchObject({ ok: true, codigo: "310104" });
  });

  it("forma inválida recusa com código PRÓPRIO — não é o mesmo que 'fora da lista'", () => {
    // Conserto diferente: um é escolher outro item na lista, o outro é a lista não ter o código.
    const r = escolherCodigoServicoNacional({ escolhido: "31.01", lista: ["310104"] });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_FORMA_INVALIDA);
  });
});

describe("⚠ LISTA VAZIA — o caso de 33 das 33 empresas hoje", () => {
  it("sem escolha, o comportamento de hoje fica INTACTO: sai o singular", () => {
    const r = escolherCodigoServicoNacional({ lista: [], singular: "171201" });
    expect(r).toMatchObject({ ok: true, codigo: "171201", origem: ORIGEM.CADASTRO });
  });

  it("lista ausente (`undefined`) é igual a lista vazia", () => {
    const r = escolherCodigoServicoNacional({ singular: "171201" });
    expect(r).toMatchObject({ ok: true, codigo: "171201" });
  });

  it("escolher o PRÓPRIO singular passa — a escolha é redundante, mas verdadeira", () => {
    const r = escolherCodigoServicoNacional({ escolhido: "171201", lista: [], singular: "171201" });
    expect(r).toMatchObject({ ok: true, codigo: "171201", origem: ORIGEM.ESCOLHIDO });
  });

  it("⚠ lista vazia NÃO é 'pode qualquer código' — outro código recusa", () => {
    // Sem esta linha, a trava estaria desligada em toda a carteira: nenhuma empresa tem lista hoje.
    const r = escolherCodigoServicoNacional({ escolhido: "310104", lista: [], singular: "171201" });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_FORA_DA_LISTA);
    expect(r.habilitados).toEqual(["171201"]);
  });

  it("sem lista E sem singular, qualquer escolha recusa — não há cadastro que a autorize", () => {
    const r = escolherCodigoServicoNacional({ escolhido: "310104", lista: [], singular: null });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_FORA_DA_LISTA);
    expect(r.habilitados).toEqual([]);
  });
});

describe("lista com lixo — elemento torto é ignorado, não derruba a emissão", () => {
  it("a coluna não tem CHECK; linha velha não pode parar quem escolheu código legítimo", () => {
    const r = escolherCodigoServicoNacional({
      escolhido: "310104",
      lista: ["", null, "abc", "310104", "310104"],
      singular: "310104",
    });
    expect(r).toMatchObject({ ok: true, codigo: "310104" });
    expect(r.habilitados).toEqual(["310104"]); // deduplicada, na ordem do cadastro
  });
});
