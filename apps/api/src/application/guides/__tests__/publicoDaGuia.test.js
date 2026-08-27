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
