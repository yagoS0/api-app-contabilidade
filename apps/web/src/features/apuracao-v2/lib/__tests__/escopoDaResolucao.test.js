// O ALCANCE DE UMA RESOLUÇÃO DE PENDÊNCIA.
//
// A escolha é ASSIMÉTRICA: EMPRESA é o comportamento de sempre; GLOBAL vale para a carteira
// inteira, inclusive para cliente que ainda não existe, e fecha as pendências das outras empresas
// sem que ninguém as revise. Estes testes prendem o que a tela pode OFERECER e o que ela é
// OBRIGADA a dizer antes de o alcance maior acontecer.

import {
  ESCOPO_DA_RESOLUCAO, PAPEL_MINIMO_GLOBAL,
  podeResolverGlobalmente, consequenciaDoEscopo, avisoDeAlcance, escopoParaPayload,
} from "../escopoDaResolucao";

describe("⚠ A TELA NÃO OFERECE O QUE O SERVIDOR VAI RECUSAR", () => {
  it("FIRM_ADMIN pode", () => {
    expect(podeResolverGlobalmente({ myRole: "FIRM_ADMIN" }).pode).toBe(true);
  });

  it("⚠ ACCOUNTANT e STAFF não podem — e o servidor recusaria com 403", () => {
    for (const papel of ["ACCOUNTANT", "STAFF"]) {
      expect(podeResolverGlobalmente({ myRole: papel }).pode).toBe(false);
    }
  });

  it("⚠⚠ e a recusa NOMEIA o papel que resolveria — 'sem permissão' não diz a quem pedir", () => {
    // Mesmo critério de `estadoCredencial.js`, que é o precedente desta casa para papel.
    const r = podeResolverGlobalmente({ myRole: "ACCOUNTANT" });
    expect(r.motivo).toMatch(/administrador do escritório/i);
    expect(r.motivo).toMatch(/Peça a quem tem esse perfil/i);
  });

  it("papel AUSENTE não libera", () => {
    // Contrato antigo ou payload sem `myRole` não pode abrir o alcance maior por omissão.
    for (const v of [undefined, null, "", "  ", 0]) {
      expect(podeResolverGlobalmente({ myRole: v }).pode).toBe(false);
    }
    expect(podeResolverGlobalmente().pode).toBe(false);
  });

  it("⚠ o papel exigido é o MESMO que a rota confere", () => {
    // A rota recusa com `escopo_global_exige_admin` comparando com "FIRM_ADMIN". Dois valores para
    // a mesma regra fariam a tela oferecer e o servidor recusar.
    expect(PAPEL_MINIMO_GLOBAL).toBe("FIRM_ADMIN");
  });
});

describe("⚠⚠ ZERO NÃO É AUSÊNCIA — e as duas frases são diferentes", () => {
  it("com N outras empresas paradas, o ganho é dito com número", () => {
    const c = consequenciaDoEscopo({ esperando: 3 });
    expect(c.GLOBAL.ganho).toMatch(/3 outras empresas/);
    expect(c.GLOBAL.ganho).toMatch(/fecha junto/);
  });

  it("com UMA, a frase fica no singular", () => {
    const c = consequenciaDoEscopo({ esperando: 1 });
    expect(c.GLOBAL.ganho).toMatch(/1 outra empresa está parada/);
    expect(c.GLOBAL.ganho).not.toMatch(/outras empresas/);
  });

  it("⚠ ZERO é uma AFIRMAÇÃO — 'conferi, não há outra', e GLOBAL ainda vale para o futuro", () => {
    const c = consequenciaDoEscopo({ esperando: 0 });
    expect(c.GLOBAL.ganho).toMatch(/Nenhuma outra empresa está parada/);
    expect(c.GLOBAL.ganho).toMatch(/próximas/);
  });

  it("⚠⚠ AUSENTE não vira zero — sem o número, a tela não afirma nada sobre o banco", () => {
    // `Number(null)` é 0 e passaria em `isFinite`: colapsar os dois faria a tela dizer "nenhuma
    // outra empresa" a partir de um campo que não veio. É a armadilha mais repetida deste projeto.
    for (const v of [null, undefined, "", "x", NaN]) {
      expect(consequenciaDoEscopo({ esperando: v }).GLOBAL.ganho).toBeNull();
    }
    expect(consequenciaDoEscopo().GLOBAL.ganho).toBeNull();
  });

  it("⚠ a CONSEQUÊNCIA do alcance é dita sempre — ela não depende do número", () => {
    // Uma frase descreve o alcance (sempre verdadeira); a outra o ganho (depende do dado).
    for (const v of [null, 0, 5]) {
      const c = consequenciaDoEscopo({ esperando: v });
      expect(c.GLOBAL.consequencia).toMatch(/todas as empresas/i);
      expect(c.GLOBAL.consequencia).toMatch(/ainda não existem/i);
      expect(c.EMPRESA.consequencia).toMatch(/apenas para esta empresa/i);
    }
  });

  it("⚠ e a de EMPRESA diz o CUSTO de escolhê-la, não só o alcance", () => {
    // "vale só para esta empresa" não explica que as outras vão pedir a mesma decisão de novo —
    // que é exatamente o O(n) que o escopo global existe para matar.
    expect(consequenciaDoEscopo({ esperando: 3 }).EMPRESA.consequencia)
      .toMatch(/continuam pedindo a mesma decisão/i);
  });
});

describe("⚠⚠ O AVISO DE ALCANCE SÓ APARECE COM GLOBAL ESCOLHIDO", () => {
  it("em EMPRESA não há aviso — âmbar permanente treina o olho a ignorar", () => {
    expect(avisoDeAlcance(ESCOPO_DA_RESOLUCAO.EMPRESA, { esperando: 3 })).toBeNull();
    expect(avisoDeAlcance(undefined, { esperando: 3 })).toBeNull();
  });

  it("em GLOBAL ele diz que outras empresas fecham SEM revisão", () => {
    // É o único efeito desta tela que toca dado de cliente que não está na frente do contador.
    const a = avisoDeAlcance(ESCOPO_DA_RESOLUCAO.GLOBAL, { esperando: 2 });
    expect(a.tom).toBe("warn");
    expect(a.texto).toMatch(/sem que elas sejam revisadas/i);
    expect(a.texto).toMatch(/resolvidas por regra global/i);
  });

  it("⚠ sem outras empresas, o aviso muda de assunto — mas NÃO some", () => {
    // O alcance continua sendo a carteira inteira, inclusive empresas que quem clicou não acessa.
    const a = avisoDeAlcance(ESCOPO_DA_RESOLUCAO.GLOBAL, { esperando: 0 });
    expect(a).not.toBeNull();
    expect(a.texto).toMatch(/que você não acessa/i);
  });
});

describe("⚠ O PAYLOAD: EMPRESA não manda o campo", () => {
  it("GLOBAL manda", () => {
    expect(escopoParaPayload(ESCOPO_DA_RESOLUCAO.GLOBAL)).toEqual({ escopo: "GLOBAL" });
  });

  it("⚠⚠ EMPRESA (e qualquer outra coisa) manda objeto VAZIO", () => {
    // O servidor tem `escopo = "EMPRESA"` como default. Omitir mantém intacta a requisição que já
    // existia — esta mudança não pode ter efeito nenhum sobre quem não escolher nada.
    for (const v of [ESCOPO_DA_RESOLUCAO.EMPRESA, undefined, null, "", "global", "TODOS"]) {
      expect(escopoParaPayload(v)).toEqual({});
    }
  });
});
