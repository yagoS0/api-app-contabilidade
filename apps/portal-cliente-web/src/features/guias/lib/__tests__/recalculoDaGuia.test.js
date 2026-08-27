// PEDIR UMA GUIA ATUALIZADA, PELO CLIENTE.
//
// ⚠⚠ É o primeiro botão do portal do cliente que gasta dinheiro do escritório: cada clique é uma
// chamada PAGA ao SERPRO, contra o teto mensal da carteira inteira.

import {
  podePedirGuiaAtualizada, avisoAntesDePedir, leituraDaRecusa, avisoDosAcrescimos,
  podeConfirmarPagamento, avisoAntesDeConfirmar,
} from "../recalculoDaGuia";

const VENCIDA = {
  guideId: "g1",
  canRecalculate: true,
  vencida: true,
  avisoDeRecalculo: {
    titulo: "Esta guia está vencida",
    texto: "Ela venceu em 20/07/2026. Recalcular NÃO atualiza esta guia: a Receita gera uma guia NOVA, "
      + "com juros e multa, e o valor a pagar será maior. O pedido é feito ao sistema da Receita e "
      + "pode demorar alguns segundos.",
    tom: "atencao",
    vencida: true,
  },
};

describe("⚠⚠ O BOTÃO SÓ APARECE NA GUIA VENCIDA", () => {
  it("guia vencida e recalculável: aparece", () => {
    expect(podePedirGuiaAtualizada(VENCIDA)).toBe(true);
  });

  it("⚠⚠ guia EM ABERTO não aparece — decisão do dono", () => {
    // O valor seria o mesmo, e o gasto, não.
    expect(podePedirGuiaAtualizada({ ...VENCIDA, vencida: false })).toBe(false);
  });

  it("guia que a regra não deixa recalcular não aparece", () => {
    expect(podePedirGuiaAtualizada({ ...VENCIDA, canRecalculate: false })).toBe(false);
  });

  it("⚠⚠ CONTRATO ANTIGO (sem os campos) NÃO oferece — ausência de campo não é permissão", () => {
    for (const g of [{}, null, undefined, { guideId: "x" }, { vencida: true }, { canRecalculate: true }]) {
      expect(podePedirGuiaAtualizada(g)).toBe(false);
    }
  });

  it("⚠ sem o texto do aviso também não aparece — não se oferece o ato sem dizer o que ele faz", () => {
    expect(podePedirGuiaAtualizada({ ...VENCIDA, avisoDeRecalculo: { titulo: "x" } })).toBe(false);
    expect(podePedirGuiaAtualizada({ ...VENCIDA, avisoDeRecalculo: null })).toBe(false);
  });

  it("⚠ `vencida` só vale como booleano — string 'true' não abre o botão", () => {
    // `Boolean("false")` é `true`: leitura frouxa aqui abriria um gasto por causa de um tipo.
    expect(podePedirGuiaAtualizada({ ...VENCIDA, vencida: "true" })).toBe(false);
    expect(podePedirGuiaAtualizada({ ...VENCIDA, canRecalculate: 1 })).toBe(false);
  });
});

describe("⚠⚠ O AVISO VEM PRONTO DO SERVIDOR", () => {
  it("título e texto são os do payload — a tela não escreve os seus", () => {
    const a = avisoAntesDePedir(VENCIDA);
    expect(a.titulo).toBe(VENCIDA.avisoDeRecalculo.titulo);
    expect(a.texto).toBe(VENCIDA.avisoDeRecalculo.texto);
  });

  it("⚠ e ele diz o que interessa a quem vai pagar", () => {
    const a = avisoAntesDePedir(VENCIDA);
    expect(a.texto).toMatch(/guia NOVA, com juros e multa/);
    expect(a.texto).toMatch(/valor a pagar será maior/);
  });

  it("⚠⚠ e NÃO diz teto, custo por chamada nem o nome do fornecedor", () => {
    // Orçamento do escritório não é assunto do cliente. Quem garante isso é o backend
    // (`PUBLICO.CLIENTE`), e este teste prende o contrato do lado de cá.
    expect(avisoAntesDePedir(VENCIDA).texto).not.toMatch(/chamada PAGA|teto|escritório|SERPRO/i);
  });

  it("⚠ o rótulo de confirmar NOMEIA o ato, e não é 'OK'", () => {
    expect(avisoAntesDePedir(VENCIDA).rotuloConfirmar).toBe("Pedir guia atualizada");
  });

  it("sem oferta não há aviso", () => {
    expect(avisoAntesDePedir({ ...VENCIDA, vencida: false })).toBeNull();
  });
});

describe("⚠ A RECUSA — 'tentar de novo' não é sempre a resposta", () => {
  it("teto estourado: a mensagem do servidor, sem oferecer repetição", () => {
    const r = leituraDaRecusa({ message: "Não foi possível recalcular agora. Fale com o seu contador.", podeTentarDeNovo: false });
    expect(r.texto).toMatch(/Fale com o seu contador/);
    expect(r.podeTentarDeNovo).toBe(false);
  });

  it("repetição em pouco tempo: oferece esperar e tentar", () => {
    const r = leituraDaRecusa({ message: "Esta guia foi pedida à Receita há pouco.", podeTentarDeNovo: true });
    expect(r.podeTentarDeNovo).toBe(true);
  });

  it("⚠⚠ campo ausente NÃO vira 'pode tentar' — repetir contra teto estourado não resolve nada", () => {
    for (const r of [{}, { message: "x" }, { podeTentarDeNovo: "true" }, { podeTentarDeNovo: 1 }]) {
      expect(leituraDaRecusa(r).podeTentarDeNovo).toBe(false);
    }
  });

  it("⚠ e sem mensagem há uma frase, nunca vazio", () => {
    expect(leituraDaRecusa({}).texto).toMatch(/Não foi possível pedir a guia atualizada/);
    expect(leituraDaRecusa(null)).toBeNull();
  });
});

describe("⚠⚠ A GUIA NOVA PODE TER VINDO SEM JUROS E MULTA — e o cliente precisa saber ANTES de pagar", () => {
  it("acréscimos presentes: nada a avisar", () => {
    expect(avisoDosAcrescimos({ estado: "presentes", texto: "veio com juros" })).toBeNull();
  });

  it("⚠⚠ ausentes: avisa, com o texto do servidor", () => {
    const a = avisoDosAcrescimos({ estado: "ausentes", texto: "A guia nova veio SEM juros e multa." });
    expect(a.titulo).toMatch(/Confira esta guia antes de pagar/);
    expect(a.texto).toMatch(/SEM juros e multa/);
    expect(a.tom).toBe("atencao");
  });

  it("⚠⚠ NÃO LEGÍVEIS também avisa — 'não deu para ler' não é 'está tudo certo'", () => {
    const a = avisoDosAcrescimos({ estado: "nao_legiveis", texto: "Não foi possível ler a composição." });
    expect(a).not.toBeNull();
    expect(a.texto).toMatch(/Não foi possível ler/);
  });

  it("sem o bloco, nada é dito", () => {
    expect(avisoDosAcrescimos(null)).toBeNull();
    expect(avisoDosAcrescimos(undefined)).toBeNull();
  });
});

describe("⚠⚠ CONFIRMAR QUE PAGOU — e o que a confirmação NÃO faz", () => {
  it("guia em aberto oferece; guia paga não", () => {
    expect(podeConfirmarPagamento({ canConfirmPayment: true })).toBe(true);
    expect(podeConfirmarPagamento({ canConfirmPayment: false })).toBe(false);
  });

  it("⚠ campo ausente NÃO oferece — ausência não é permissão", () => {
    for (const g of [{}, null, undefined, { canConfirmPayment: 1 }, { canConfirmPayment: "true" }]) {
      expect(podeConfirmarPagamento(g)).toBe(false);
    }
  });

  it("⚠⚠ a confirmação diz que a BAIXA CONTÁBIL continua com o contador", () => {
    // Um "confirmar pagamento?" seco faria o cliente achar que o assunto está encerrado dos dois
    // lados — e não está.
    const a = avisoAntesDeConfirmar({ canConfirmPayment: true });
    expect(a.texto).toMatch(/baixa na contabilidade continua sendo feita por ele/i);
    expect(a.texto).toMatch(/sua confirmação não a lança/i);
  });

  it("⚠ e diz que NÃO precisa anexar comprovante (decisão do dono)", () => {
    expect(avisoAntesDeConfirmar({ canConfirmPayment: true }).texto).toMatch(/Não é preciso anexar comprovante/i);
  });

  it("⚠ o rótulo do botão é a AFIRMAÇÃO dele, não um 'OK'", () => {
    expect(avisoAntesDeConfirmar({ canConfirmPayment: true }).rotuloConfirmar).toBe("Já paguei esta guia");
  });

  it("sem oferta não há aviso", () => {
    expect(avisoAntesDeConfirmar({ canConfirmPayment: false })).toBeNull();
  });
});
