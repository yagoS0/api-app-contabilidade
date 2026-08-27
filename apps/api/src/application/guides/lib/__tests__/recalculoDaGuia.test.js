// RECALCULAR UMA GUIA — a regra que decide se a Receita gera uma guia COM juros e multa.
//
// ⚠⚠ `isGuideOverdue` existia desde sempre, decide qual serviço do SERPRO é chamado
// (`GERARDASCOBRANCA17` × `GERARDAS12`) e **nunca teve um único teste**: ela morava num arquivo que
// carrega o Prisma no topo. Este arquivo é a primeira medição dela.

import {
  vencimentoDaGuia, getGuideDueDate, isGuidePaid, isGuideOverdue, canGuideConfirmPayment,
  canGuideRecalculate, especieDoRecalculo, ESPECIE_RECALCULO, PREFIXO_DARF_LP,
  avisoDeRecalculo, leituraDosAcrescimos, ACRESCIMOS,
} from "../recalculoDaGuia.js";

const AGORA = new Date("2026-08-27T12:00:00Z");
const DAS = { source: "SERPRO", tipo: "SIMPLES", paymentStatus: "OPEN", competencia: "2026-06" };
const DARF_LP = {
  source: "SERPRO",
  tipo: "OUTRA",
  paymentStatus: "OPEN",
  competencia: "2026-06",
  sourceFileId: "serpro:dctfweb:lp:12345678000199:2026-06",
};

describe("⚠⚠ O VENCIMENTO PODE SER DERIVADO — e a marca disso é o produto", () => {
  it("com `vencimento` gravado, a data é a dele e NÃO é derivada", () => {
    const v = vencimentoDaGuia({ vencimento: "2026-07-20T00:00:00Z" }, AGORA);
    expect(v.derivado).toBe(false);
    expect(v.data.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("⚠⚠ sem `vencimento`, ela é ASSUMIDA no dia 20 do mês seguinte — e sai marcada", () => {
    // Esse número é uma suposição sobre um prazo real, e é ele que decide qual serviço do SERPRO
    // é chamado. Sem a marca, a tela diria "venceu em 20/07" sobre uma data que ninguém registrou.
    const v = vencimentoDaGuia({ competencia: "2026-06" }, AGORA);
    expect(v.derivado).toBe(true);
    expect(v.data.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("competência ilegível não produz data inventada", () => {
    for (const c of [null, "", "2026", "xx-yy"]) {
      expect(vencimentoDaGuia({ competencia: c }, AGORA).data).toBeNull();
    }
  });

  it("⚠ `getGuideDueDate` continua devolvendo `Date|null` — a assinatura antiga não mudou", () => {
    expect(getGuideDueDate({ competencia: "2026-06" }, AGORA)).toBeInstanceOf(Date);
    expect(getGuideDueDate({ competencia: "" }, AGORA)).toBeNull();
  });
});

describe("⚠ VENCIDA — a pergunta que decide o valor a pagar", () => {
  it("`paymentStatus: OVERDUE` vence sozinho, sem olhar data", () => {
    expect(isGuideOverdue({ paymentStatus: "OVERDUE", competencia: "2099-01" }, AGORA)).toBe(true);
  });

  it("pela DATA: competência de junho já venceu em agosto; a de agosto ainda não", () => {
    expect(isGuideOverdue({ competencia: "2026-06" }, AGORA)).toBe(true);
    expect(isGuideOverdue({ competencia: "2026-08" }, AGORA)).toBe(false);
  });

  it("⚠ sem data conhecida, NÃO se afirma vencimento", () => {
    // Ausência de prazo não é prova de atraso.
    expect(isGuideOverdue({ competencia: null }, AGORA)).toBe(false);
  });

  it("paga é paga; não paga pode confirmar pagamento", () => {
    expect(isGuidePaid({ paymentStatus: "paid" })).toBe(true);
    expect(canGuideConfirmPayment({ paymentStatus: "PAID" })).toBe(false);
    expect(canGuideConfirmPayment({ paymentStatus: "OPEN" })).toBe(true);
  });
});

describe("⚠⚠ QUAIS GUIAS SE RECALCULAM — lista de INCLUSÃO", () => {
  it("o DAS do Simples, como sempre", () => {
    expect(especieDoRecalculo(DAS)).toBe(ESPECIE_RECALCULO.DAS_SIMPLES);
    expect(canGuideRecalculate(DAS)).toBe(true);
  });

  it("⚠⚠ a DARF do Presumido entra — e é o `sourceFileId` que a identifica, NUNCA o tipo", () => {
    // A guia de INSS/DCTFWeb também é `tipo: "OUTRA"` com `source: "SERPRO"`. Aceitar por tipo
    // mandaria a guia de INSS para o serviço errado.
    expect(especieDoRecalculo(DARF_LP)).toBe(ESPECIE_RECALCULO.DARF_PRESUMIDO);
    expect(especieDoRecalculo({ ...DARF_LP, sourceFileId: "serpro:dctfweb:inss:123:2026-06" })).toBeNull();
    expect(especieDoRecalculo({ ...DARF_LP, sourceFileId: null })).toBeNull();
  });

  it("o prefixo é o MESMO que a provisão escreve", () => {
    expect(PREFIXO_DARF_LP).toBe("serpro:dctfweb:lp:");
  });

  it("guia paga nunca se recalcula", () => {
    expect(canGuideRecalculate({ ...DAS, paymentStatus: "PAID" })).toBe(false);
    expect(canGuideRecalculate({ ...DARF_LP, paymentStatus: "PAID" })).toBe(false);
  });

  it("guia que não é do SERPRO não se recalcula", () => {
    expect(canGuideRecalculate({ ...DAS, source: "UPLOAD" })).toBe(false);
  });

  it("⚠⚠ PARCELA é recusada no SERVIDOR — a tela já a bloqueava, a porta nova não", () => {
    // `renderCompanyGuidesTable` desabilita o botão para parcela desde sempre. A rota passa a ser
    // alcançável pelo portal do cliente, e regra que só mora na tela não protege porta nenhuma.
    expect(canGuideRecalculate({ ...DAS, parcelamentoId: "p1" })).toBe(false);
    expect(especieDoRecalculo({ ...DAS, parcelamentoId: "p1" })).toBeNull();
  });
});

describe("⚠⚠ O AVISO ANTES DO CLIQUE", () => {
  it("guia VENCIDA diz que a Receita gera OUTRA guia, com juros e multa", () => {
    const a = avisoDeRecalculo({ guide: { ...DAS, vencimento: "2026-07-20T00:00:00Z" }, now: AGORA });
    expect(a.vencida).toBe(true);
    expect(a.texto).toMatch(/NÃO atualiza esta guia/);
    expect(a.texto).toMatch(/guia NOVA, com juros e multa/);
    expect(a.texto).toMatch(/venceu em 20\/07\/2026/);
    expect(a.tom).toBe("atencao");
  });

  it("⚠⚠ com vencimento DERIVADO, a palavra ESTIMADA vem ANTES da data", () => {
    // Quem lê rápido lê o começo; a ressalva numa nota de rodapé não é lida.
    const a = avisoDeRecalculo({ guide: { ...DAS, competencia: "2026-06" }, now: AGORA });
    expect(a.texto).toMatch(/não está gravado/i);
    expect(a.texto).toMatch(/ESTIMADA/);
    expect(a.texto).not.toMatch(/Ela venceu em/);
  });

  it("guia EM ABERTO tem outra frase, e tom neutro", () => {
    const a = avisoDeRecalculo({ guide: { ...DAS, competencia: "2026-08" }, now: AGORA });
    expect(a.vencida).toBe(false);
    expect(a.tom).toBe("neutro");
    expect(a.texto).toMatch(/mesmos valores/);
    expect(a.texto).not.toMatch(/juros e multa/);
  });

  it("⚠⚠ o CUSTO é dito diferente para o cliente — ele não vê orçamento do escritório", () => {
    const contador = avisoDeRecalculo({ guide: DAS, now: AGORA });
    const cliente = avisoDeRecalculo({ guide: DAS, now: AGORA, ehCliente: true });
    expect(contador.texto).toMatch(/chamada PAGA ao SERPRO/);
    expect(contador.texto).toMatch(/teto mensal do escritório/);
    // ⚠ Nada de orçamento chega ao cliente — teto, custo por chamada e o nome do fornecedor são
    // assunto interno. ⚠ O padrão é ESTREITO de propósito: `/PAGA/i` casava com "a PAGAr", e o
    // valor a pagar É o que o cliente precisa ler. Regex larga aqui proibiria a frase certa.
    expect(cliente.texto).not.toMatch(/chamada PAGA|teto|escritório|SERPRO/i);
    expect(cliente.texto).toMatch(/pode demorar/i);
    // ⚠ Mas o que interessa a ELE continua dito: a guia é outra, e vai custar mais.
    expect(cliente.texto).toMatch(/juros e multa/);
    expect(cliente.texto).toMatch(/valor a pagar será maior/);
  });

  it("⚠ o tom NUNCA é `erro` — vermelho, nesta casa, BLOQUEIA, e isto informa", () => {
    for (const g of [DAS, DARF_LP, { ...DAS, competencia: "2026-08" }]) {
      expect(avisoDeRecalculo({ guide: g, now: AGORA }).tom).not.toBe("erro");
    }
  });

  it("guia que não se recalcula não tem aviso — nada a dizer é dizer nada", () => {
    expect(avisoDeRecalculo({ guide: { ...DAS, paymentStatus: "PAID" }, now: AGORA })).toBeNull();
    expect(avisoDeRecalculo({ guide: { source: "UPLOAD" }, now: AGORA })).toBeNull();
    expect(avisoDeRecalculo()).toBeNull();
  });
});

describe("⚠⚠ OS ACRÉSCIMOS VIERAM? — três respostas, e a terceira impede a mentira", () => {
  it("multa ou juros > 0 ⇒ PRESENTES, com os totais", () => {
    const r = leituraDosAcrescimos({ itens: [{ principal: 100, multa: 7.26, juros: 1 }] });
    expect(r.estado).toBe(ACRESCIMOS.PRESENTES);
    expect(r.multa).toBe(7.26);
    expect(r.juros).toBe(1);
  });

  it("⚠⚠ itens LIDOS e todos zerados ⇒ AUSENTES, e a tela é mandada CONFERIR", () => {
    // Este é o desfecho que a entrega existe para tornar visível: não está confirmado que o
    // `GERARGUIA31` gere a DARF com acréscimos. Vindo sem, o contador não pode receber a guia
    // apresentada como "recalculada" — pagaria a menor e ficaria devendo a diferença.
    const r = leituraDosAcrescimos({ itens: [{ principal: 100, multa: 0, juros: 0 }] });
    expect(r.estado).toBe(ACRESCIMOS.AUSENTES);
    expect(r.texto).toMatch(/SEM juros e multa/);
    expect(r.texto).toMatch(/confira no documento/i);
    expect(r.tom).toBe("atencao");
  });

  it("⚠⚠ composição ILEGÍVEL NÃO vira 'sem acréscimos' — e os totais ficam `null`", () => {
    // A composição sai de uma heurística sobre o TEXTO do PDF. Falha de leitura não é prova de
    // ausência de juros, e colapsar as duas afirmaria sobre o documento a partir do nosso defeito.
    for (const c of [null, undefined, {}, { itens: [] }, { itens: "x" }]) {
      const r = leituraDosAcrescimos(c);
      expect(r.estado).toBe(ACRESCIMOS.NAO_LEGIVEIS);
      expect(r.multa).toBeNull();
      expect(r.juros).toBeNull();
      expect(r.texto).toMatch(/NÃO quer dizer que a guia veio sem acréscimos/i);
    }
  });

  it("⚠ valor torto num item não vira acréscimo — ele conta como zero", () => {
    const r = leituraDosAcrescimos({ itens: [{ multa: "abc", juros: null }] });
    expect(r.estado).toBe(ACRESCIMOS.AUSENTES);
  });

  it("soma os itens, e não olha só o primeiro", () => {
    const r = leituraDosAcrescimos({ itens: [{ multa: 0, juros: 0 }, { multa: 5, juros: 2 }] });
    expect(r.estado).toBe(ACRESCIMOS.PRESENTES);
    expect(r.multa).toBe(5);
  });
});
