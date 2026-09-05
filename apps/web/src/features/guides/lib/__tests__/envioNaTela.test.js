// A COLUNA "ENVIO" — a leitura que separa "mandamos" de "chegou".
//
// ⚠⚠ O CASO QUE ORIGINOU ESTE ARQUIVO: em 05/09/2026 a tela disse "WhatsApp enviado" em VERDE e a
// mensagem nunca chegou. A Meta aceitou a chamada, devolveu o `wamid`, e descartou a mensagem cinco
// segundos depois (limite de template de marketing por pessoa), avisando pelo webhook. O estado
// verdadeiro chegou ao banco; a tela nunca mais olhou.

import {
  SITUACAO_ENVIO,
  DESENHO_ENVIO,
  lerEnvioDaGuia,
  frasePorCanal,
  rotuloDoCanal,
  devePolir,
} from "../envioNaTela";

const comCanais = (canais, extra = {}) => ({
  envio: {
    jaEnviada: canais.some((c) => ["enviado", "entregue", "lido"].includes(c.status)),
    canais,
    ...extra,
  },
});

describe("⚠⚠ aceito pela Meta NÃO é chegou", () => {
  it("WhatsApp em `enviado` é AGUARDANDO — e o tom NÃO é verde", () => {
    const r = lerEnvioDaGuia(comCanais([{ canal: "WHATSAPP", status: "enviado", destino: "5521999998888" }]));
    expect(r.situacao).toBe(SITUACAO_ENVIO.AGUARDANDO_CONFIRMACAO);
    expect(r.chegou).toBe(false);
    expect(r.aguardando).toBe(true);
    // ⚠ Verde é CONCLUÍDO neste portal. Foi verde aqui que afirmou uma entrega que não houve.
    expect(r.tom).not.toContain("state-ok");
    expect(r.titulo).toMatch(/sem confirmação de entrega/);
  });

  it("`entregue` e `lida` são chegada, com ✓✓", () => {
    expect(lerEnvioDaGuia(comCanais([{ canal: "WHATSAPP", status: "entregue" }])).situacao)
      .toBe(SITUACAO_ENVIO.ENTREGUE);
    const lida = lerEnvioDaGuia(comCanais([{ canal: "WHATSAPP", status: "lido" }]));
    expect(lida.situacao).toBe(SITUACAO_ENVIO.LIDA);
    expect(lida.icone).toBe("✓✓");
    expect(lida.chegou).toBe(true);
  });

  it("⚠ e-mail em `enviado` É chegada — aquele canal não tem confirmação para dar", () => {
    const r = lerEnvioDaGuia(comCanais([{ canal: "EMAIL", status: "enviado", destino: "a@b.com" }]));
    expect(r.situacao).toBe(SITUACAO_ENVIO.ENVIADA_EMAIL);
    expect(r.chegou).toBe(true);
    // Exigir ✓✓ do e-mail deixaria toda guia por e-mail eternamente "aguardando".
    expect(r.aguardando).toBe(false);
  });
});

describe("⚠⚠ a falha não some atrás do sucesso", () => {
  it("um entregue + um falhado = PARCIAL, em vermelho, com a contagem", () => {
    const r = lerEnvioDaGuia(comCanais([
      { canal: "WHATSAPP", status: "entregue", destino: "5521999998888" },
      { canal: "WHATSAPP", status: "falhou", destino: "5521988887777", erroMensagem: "sem opt-in" },
    ]));
    expect(r.situacao).toBe(SITUACAO_ENVIO.PARCIAL);
    expect(r.algumFalhou).toBe(true);
    expect(r.resumo).toMatch(/1\/2/);
    // O motivo de quem falhou tem de estar legível em algum lugar.
    expect(r.titulo).toMatch(/sem opt-in/);
  });

  it("todos falharam = FALHOU", () => {
    const r = lerEnvioDaGuia(comCanais([{ canal: "WHATSAPP", status: "falhou", erroMensagem: "x" }]));
    expect(r.situacao).toBe(SITUACAO_ENVIO.FALHOU);
    expect(r.icone).toBe("✖");
  });
});

describe("ausência tem três significados diferentes", () => {
  it("⚠ SEM o bloco `envio` não se afirma nada — DESCONHECIDA, nunca 'não enviada'", () => {
    // Contrato antigo, ou o portal do cliente (que não recebe o bloco). Dizer "não enviada" seria
    // afirmar que ninguém tentou.
    const r = lerEnvioDaGuia({ guideId: "g1" });
    expect(r.situacao).toBe(SITUACAO_ENVIO.DESCONHECIDA);
    expect(r.chegou).toBe(false);
  });

  it("bloco presente e vazio, sem legado = NÃO ENVIADA", () => {
    const r = lerEnvioDaGuia({ envio: { jaEnviada: false, canais: [] } });
    expect(r.situacao).toBe(SITUACAO_ENVIO.NAO_ENVIADA);
  });

  it("⚠ bloco vazio COM legado = enviada por e-mail — é a tolerância das guias antigas", () => {
    // Guia anterior a `envios_guia`: não há linha, e quem responde é o `emailStatus`. Medido em
    // produção: 83 guias nessa situação.
    const r = lerEnvioDaGuia({ envio: { jaEnviada: true, canais: [] } });
    expect(r.situacao).toBe(SITUACAO_ENVIO.ENVIADA_EMAIL);
  });

  it("estado fora da lista não vira 'enviada' por semelhança", () => {
    const r = lerEnvioDaGuia(comCanais([{ canal: "WHATSAPP", status: "estado_novo_da_meta" }]));
    expect(r.situacao).toBe(SITUACAO_ENVIO.DESCONHECIDA);
  });
});

describe("as frases por canal", () => {
  it("dizem o canal, o desfecho e PARA QUEM", () => {
    expect(frasePorCanal({ canal: "WHATSAPP", status: "entregue", destino: "5521999998888" }))
      .toBe("WhatsApp: entregue para 5521999998888");
    expect(frasePorCanal({ canal: "EMAIL", status: "enviado", destino: "a@b.com" }))
      .toBe("e-mail: enviada para a@b.com");
  });

  it("⚠ WhatsApp em `enviado` diz o que É: aceita pela Meta, sem confirmação", () => {
    expect(frasePorCanal({ canal: "WHATSAPP", status: "enviado" }))
      .toMatch(/aceita pela Meta.*sem confirmação/);
  });

  it("canal desconhecido aparece como veio — não vira o nome do vizinho", () => {
    expect(rotuloDoCanal("SMS")).toBe("SMS");
    expect(rotuloDoCanal(null)).toBe("canal");
  });
});

describe("⚠ o polling para sozinho", () => {
  const aguardando = comCanais([{ canal: "WHATSAPP", status: "enviado" }]);
  const entregue = comCanais([{ canal: "WHATSAPP", status: "entregue" }]);

  it("pergunta enquanto há guia aguardando confirmação", () => {
    expect(devePolir([entregue, aguardando], 0)).toBe(true);
  });

  it("para quando nenhuma está aguardando", () => {
    expect(devePolir([entregue], 0)).toBe(false);
    expect(devePolir([], 0)).toBe(false);
  });

  it("⚠ e para no TETO, mesmo com guia aguardando — tela aberta o dia todo não vira carga", () => {
    expect(devePolir([aguardando], 24)).toBe(false);
    expect(devePolir([aguardando], 23)).toBe(true);
  });
});

describe("⚠ o desenho é fechado e distinguível sem cor", () => {
  it("toda situação tem desenho", () => {
    for (const s of Object.values(SITUACAO_ENVIO)) expect(DESENHO_ENVIO[s]).toBeTruthy();
  });

  it("⚠ os ícones separam os estados mesmo dessaturados", () => {
    // A regra de aceite deste portal: um screenshot em preto e branco continua legível.
    const perigo = [SITUACAO_ENVIO.FALHOU, SITUACAO_ENVIO.PARCIAL].map((s) => DESENHO_ENVIO[s].icone);
    expect(perigo.every((i) => i === "✖")).toBe(true);
    expect(DESENHO_ENVIO[SITUACAO_ENVIO.ENTREGUE].icone).not.toBe(DESENHO_ENVIO[SITUACAO_ENVIO.NAO_ENVIADA].icone);
    expect(DESENHO_ENVIO[SITUACAO_ENVIO.AGUARDANDO_CONFIRMACAO].icone)
      .not.toBe(DESENHO_ENVIO[SITUACAO_ENVIO.ENTREGUE].icone);
  });
});
