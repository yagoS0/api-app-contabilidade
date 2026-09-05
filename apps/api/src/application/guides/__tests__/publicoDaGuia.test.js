// ⚠⚠ `toGuideResponse` SERVE OS DOIS PORTAIS — e isso não é óbvio olhando nenhum dos dois arquivos
// de rota. `routes/client/index.js` monta a listagem do CLIENTE com ele, e `routes/firm/index.js` a
// do ESCRITÓRIO.
//
// O que passou a viajar nele em 27/08/2026 é o aviso de recálculo, e ele diz, do lado do escritório,
// *"cada recálculo é uma chamada PAGA ao SERPRO, contra o teto mensal do escritório"*. Orçamento
// interno não é assunto do cliente — e esta é a mesma classe do `emissaoClienteLiberadaEm`, que a
// casa já proíbe de vazar no payload do cliente.

import fs from "node:fs";
import path from "node:path";
import { toGuideResponse, PUBLICO } from "../GuideService.js";

const VENCIDA = {
  id: "g1",
  source: "SERPRO",
  tipo: "SIMPLES",
  paymentStatus: "OPEN",
  competencia: "2026-01",
  vencimento: new Date("2026-02-20T00:00:00Z"),
};

describe("⚠⚠ O ORÇAMENTO DO ESCRITÓRIO NÃO CHEGA AO CLIENTE", () => {
  it("o escritório vê o custo da chamada, com todas as letras", () => {
    const r = toGuideResponse(VENCIDA, { publico: PUBLICO.ESCRITORIO });
    expect(r.avisoDeRecalculo.texto).toMatch(/chamada PAGA ao SERPRO/);
    expect(r.avisoDeRecalculo.texto).toMatch(/teto mensal do escritório/);
  });

  it("⚠⚠ o cliente NÃO vê teto, custo por chamada nem o nome do fornecedor", () => {
    const r = toGuideResponse(VENCIDA, { publico: PUBLICO.CLIENTE });
    expect(r.avisoDeRecalculo.texto).not.toMatch(/chamada PAGA|teto|escritório|SERPRO/i);
  });

  it("⚠ mas o que interessa a ELE continua dito — a guia é outra, e vai custar mais", () => {
    // Esconder o custo do escritório não pode virar esconder o efeito no bolso do cliente.
    const r = toGuideResponse(VENCIDA, { publico: PUBLICO.CLIENTE });
    expect(r.avisoDeRecalculo.texto).toMatch(/juros e multa/);
    expect(r.avisoDeRecalculo.texto).toMatch(/valor a pagar será maior/);
  });

  it("⚠⚠ O DEFAULT É O PÚBLICO MAIS ESTREITO — chamador que esquecer o parâmetro NÃO vaza", () => {
    // Com o default no lado largo, um chamador novo vazaria em silêncio. Com ele no estreito, o
    // escritório perde a frase do custo — visível e barato de consertar. Falha para o lado seguro.
    expect(toGuideResponse(VENCIDA).avisoDeRecalculo.texto).not.toMatch(/teto|escritório/i);
    expect(toGuideResponse(VENCIDA).avisoDeRecalculo.texto)
      .toBe(toGuideResponse(VENCIDA, { publico: PUBLICO.CLIENTE }).avisoDeRecalculo.texto);
  });

  it("⚠ público desconhecido também cai no lado do cliente", () => {
    for (const p of ["FIRM", "admin", "", null, 0, 1]) {
      expect(toGuideResponse(VENCIDA, { publico: p }).avisoDeRecalculo.texto).not.toMatch(/teto|escritório/i);
    }
  });
});

describe("⚠⚠ NENHUMA ROTA USA `.map(toGuideResponse)` CRU", () => {
  // O `map` passa o ÍNDICE como 2º argumento, e o 2º argumento é `{ publico }`: a guia de índice 0
  // seria serializada com `publico: 0`. Hoje isso cairia no lado seguro por acidente — e acidente
  // não é garantia; no dia em que o default mudar, a listagem inteira muda de público sem ninguém
  // tocar nela.
  const ARQUIVOS = [
    "../../../routes/firm/index.js",
    "../../../routes/client/index.js",
  ];

  // ⚠ A varredura ignora COMENTÁRIO, e não é detalhe: o comentário que explica esta armadilha
  // contém a própria string `.map(toGuideResponse)`. Sem o filtro, o teste caía sobre a explicação
  // do defeito em vez do defeito. (Mesmo molde de `categoriaPresumido.test.js`.)
  const semComentarios = (texto) => texto
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  it("as duas listagens passam o público explicitamente", () => {
    for (const rel of ARQUIVOS) {
      const codigo = semComentarios(fs.readFileSync(path.resolve(__dirname, rel), "utf-8"));
      expect(codigo).not.toMatch(/\.map\(toGuideResponse\)/);
      expect(codigo).toMatch(/toGuideResponse\(g, \{ publico: PUBLICO\.(ESCRITORIO|CLIENTE) \}\)/);
    }
  });

  it("⚠ e a rota do CLIENTE nunca pede o público do escritório", () => {
    const codigo = semComentarios(fs.readFileSync(path.resolve(__dirname, "../../../routes/client/index.js"), "utf-8"));
    expect(codigo).not.toMatch(/PUBLICO\.ESCRITORIO/);
  });
});

// ── ⚠⚠ O ESTADO DE ENVIO É DO ESCRITÓRIO (05/09/2026) ───────────────────────────────────────────
//
// A aba Guias passou a receber `envio` — canal, destino, erro da Meta, se chegou. Nada disso é do
// cliente que abre o portal dele: `destino` é o telefone ou o e-mail de OUTRO destinatário (o
// sócio, o financeiro) e `erroCodigo` é material de diagnóstico. Mesmo argumento que já mantém
// `valorRecalculado` fora do lado do cliente.

describe("⚠⚠ o bloco `envio` não atravessa para o cliente", () => {
  const guiaComEnvio = {
    id: "g1",
    portalClientId: "emp1",
    competencia: "2026-07",
    tipo: "SIMPLES",
    valor: 100,
    status: "PROCESSED",
    emailStatus: "SENT",
    envios: [
      {
        canal: "WHATSAPP",
        status: "entregue",
        destino: "5521999998888",
        enviadoEm: new Date(),
        entregueEm: new Date(),
        erroCodigo: null,
        erroMensagemUsuario: null,
        tentativas: 1,
      },
    ],
  };

  it("o ESCRITÓRIO recebe o bloco, com o canal e o destino", () => {
    const r = toGuideResponse(guiaComEnvio, { publico: PUBLICO.ESCRITORIO });
    expect(r.envio).toBeTruthy();
    expect(r.envio.canais[0]).toMatchObject({ canal: "WHATSAPP", status: "entregue", destino: "5521999998888" });
    expect(r.envio.chegouAoCliente).toBe(true);
  });

  it("⚠⚠ o CLIENTE não recebe NADA disso", () => {
    const r = toGuideResponse(guiaComEnvio, { publico: PUBLICO.CLIENTE });
    expect(r.envio).toBeUndefined();
    // ⚠ Nem por acidente noutro campo: o telefone de outro destinatário não pode estar no JSON.
    expect(JSON.stringify(r)).not.toContain("5521999998888");
  });

  it("⚠ e o default é o público mais ESTREITO — chamador que esquecer o parâmetro não vaza", () => {
    expect(toGuideResponse(guiaComEnvio).envio).toBeUndefined();
  });
});

// ── ⚠⚠ "ACEITO PELA META" NÃO É "CHEGOU" ───────────────────────────────────────────────────────
//
// `enviado` significa apenas que a Meta aceitou a chamada — e foi exatamente isso que a tela
// mostrou como sucesso no dia em que a Meta aceitou e DESCARTOU a mensagem (limite de template de
// marketing por pessoa, `META_131049`, cinco segundos depois, pelo webhook).

describe("⚠⚠ chegouAoCliente é por CANAL", () => {
  const comEnvio = (envios) => toGuideResponse(
    { id: "g1", portalClientId: "e1", status: "PROCESSED", envios },
    { publico: PUBLICO.ESCRITORIO },
  ).envio;

  it("WhatsApp `enviado` NÃO é chegada — é espera", () => {
    const e = comEnvio([{ canal: "WHATSAPP", status: "enviado", tentativas: 1 }]);
    expect(e.chegouAoCliente).toBe(false);
    expect(e.aguardandoConfirmacao).toBe(true);
    // ⚠ Mas continua contando como enviada para o resto do sistema (reenvio, card, compliance).
    expect(e.jaEnviada).toBe(true);
  });

  it("WhatsApp `entregue` e `lido` são chegada", () => {
    expect(comEnvio([{ canal: "WHATSAPP", status: "entregue" }]).chegouAoCliente).toBe(true);
    expect(comEnvio([{ canal: "WHATSAPP", status: "lido" }]).chegouAoCliente).toBe(true);
  });

  it("⚠ e-mail `enviado` É chegada — não existe confirmação de entrega em e-mail", () => {
    // Inventar uma seria a mentira invertida: o e-mail não tem ✓✓, e exigir um deixaria toda guia
    // enviada por e-mail eternamente "aguardando".
    const e = comEnvio([{ canal: "EMAIL", status: "enviado" }]);
    expect(e.chegouAoCliente).toBe(true);
    expect(e.aguardandoConfirmacao).toBe(false);
  });

  it("falha aparece mesmo ao lado de um sucesso — ela não some atrás do melhor", () => {
    const e = comEnvio([
      { canal: "WHATSAPP", status: "entregue", destino: "5521999998888" },
      { canal: "WHATSAPP", status: "falhou", destino: "5521988887777", erroCodigo: "META_131049" },
    ]);
    expect(e.chegouAoCliente).toBe(true);
    expect(e.algumFalhou).toBe(true);
    expect(e.canais).toHaveLength(2);
  });

  it("⚠ `podeTentarDeNovo` sobe com as TRÊS respostas, e `null` não vira `false`", () => {
    const e = comEnvio([{ canal: "WHATSAPP", status: "falhou", erroCodigo: "META_131049" }]);
    // 131049 é retentável segundo a documentação (esperar 24h).
    expect(e.canais[0].podeTentarDeNovo).toBe(true);
    const desconhecido = comEnvio([{ canal: "WHATSAPP", status: "falhou", erroCodigo: "META_999999" }]);
    expect(desconhecido.canais[0].podeTentarDeNovo).toBeNull();
  });
});
