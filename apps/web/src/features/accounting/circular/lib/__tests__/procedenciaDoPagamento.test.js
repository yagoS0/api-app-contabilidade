// QUEM DISSE QUE A GUIA FOI PAGA — a leitura da Circular.
//
// Até 27/08/2026 o ✓ verde era idêntico para "o SERPRO achou o comprovante" e "o contador marcou à
// mão", com a diferença num `title`. Com uma TERCEIRA origem — o cliente, cuja confirmação **não
// lança baixa contábil** — um ✓ indistinguível faria o contador ler "pago, contabilizado" sobre uma
// linha em que nada foi lançado.

import fs from "node:fs";
import path from "node:path";
import { PROCEDENCIA_PAGAMENTO, leituraDoPagamento, tituloDoPagamento } from "../procedenciaDoPagamento";

const paga = (source) => ({ paymentStatus: "PAID", paymentStatusSource: source });

describe("⚠⚠ AS TRÊS ORIGENS SE DISTINGUEM NA TELA", () => {
  it("cada uma tem marca e rótulo PRÓPRIOS", () => {
    const marcas = Object.values(PROCEDENCIA_PAGAMENTO).map((p) => leituraDoPagamento(paga(p)).marca);
    expect(new Set(marcas).size).toBe(3);
    expect(leituraDoPagamento(paga("SERPRO")).marca).toBe("✓ Receita");
    expect(leituraDoPagamento(paga("MANUAL")).marca).toBe("✓ contador");
    expect(leituraDoPagamento(paga("CLIENTE")).marca).toBe("✓ cliente");
  });

  it("⚠ só a do SERPRO é PROVA", () => {
    expect(leituraDoPagamento(paga("SERPRO")).ehProva).toBe(true);
    expect(leituraDoPagamento(paga("MANUAL")).ehProva).toBe(false);
    expect(leituraDoPagamento(paga("CLIENTE")).ehProva).toBe(false);
  });
});

describe("⚠⚠ A DO CLIENTE DIZ O QUE FALTA", () => {
  it("ela não alcança o contábil, e a frase diz isso", () => {
    const l = leituraDoPagamento(paga("CLIENTE"));
    expect(l.alcancaOContabil).toBe(false);
    expect(l.detalhe).toMatch(/Afirmação do cliente, não comprovante/i);
    expect(l.detalhe).toMatch(/baixa contábil ainda não foi lançada/i);
  });

  it("⚠ as outras duas NÃO ganham essa ressalva — âmbar em tudo não distingue nada", () => {
    expect(leituraDoPagamento(paga("SERPRO")).detalhe).toBeNull();
    expect(leituraDoPagamento(paga("MANUAL")).detalhe).toBeNull();
  });
});

describe("⚠⚠ PROCEDÊNCIA DESCONHECIDA NÃO VIRA UMA DAS TRÊS", () => {
  it("linha antiga sai como 'pagamento confirmado', sem inventar quem", () => {
    const l = leituraDoPagamento({ paymentStatus: "PAID" });
    expect(l.procedencia).toBeNull();
    expect(l.marca).toBe("✓");
    expect(l.detalhe).toMatch(/Não há registro de quem confirmou/i);
  });

  it("⚠⚠ e ela CONTINUA alcançando o contábil — é o comportamento antigo", () => {
    // Mudá-lo mexeria em contabilidade já fechada por causa de um campo que ninguém preencheu.
    expect(leituraDoPagamento({ paymentStatus: "PAID" }).alcancaOContabil).toBe(true);
    for (const v of ["", null, "COISA_NOVA", "constructor"]) {
      expect(leituraDoPagamento(paga(v)).alcancaOContabil).toBe(true);
    }
  });

  it("guia não paga não tem leitura", () => {
    expect(leituraDoPagamento({ paymentStatus: "OPEN" })).toBeNull();
    expect(leituraDoPagamento(null)).toBeNull();
  });
});

describe("⚠ O `title` COMPLEMENTA, não substitui", () => {
  it("ele traz a data e o rótulo", () => {
    const t = tituloDoPagamento(paga("CLIENTE"), { dataFormatada: "20/08/2026" });
    expect(t).toMatch(/em 20\/08\/2026/);
    expect(t).toMatch(/o cliente confirmou/);
    expect(t).toMatch(/baixa contábil ainda não foi lançada/);
  });

  it("o comprovante entra quando existe", () => {
    const t = tituloDoPagamento({ ...paga("SERPRO"), comprovantePdfFileId: "f1" });
    expect(t).toMatch(/Comprovante de arrecadação disponível/);
  });

  it("guia não paga não tem título", () => {
    expect(tituloDoPagamento({ paymentStatus: "OPEN" })).toBeNull();
  });
});

describe("⚠⚠ O ESPELHO DO BACKEND ESTÁ AMARRADO", () => {
  // Os dois apps não compartilham código. Sem a amarração, a tela e o razão discordariam sobre a
  // MESMA guia — e é o razão que decide se o mês pode fechar.
  const FONTE = path.resolve(
    __dirname,
    "../../../../../../../api/src/application/guides/lib/procedenciaDoPagamento.js",
  );

  it("o arquivo-fonte existe (se ele mudar de lugar, este teste cai — que é o ponto)", () => {
    expect(fs.existsSync(FONTE)).toBe(true);
  });

  it("as três procedências têm o mesmo nome nos dois apps", () => {
    const texto = fs.readFileSync(FONTE, "utf-8");
    for (const p of Object.values(PROCEDENCIA_PAGAMENTO)) {
      expect(texto).toContain(`${p}: "${p}"`);
    }
  });

  it("⚠⚠ e o backend continua bloqueando SÓ o CLIENTE no contábil", () => {
    // Se alguém acrescentar `MANUAL` ali, a tela passaria a dizer "baixa lançada" sobre uma linha
    // que o razão não marcou — e o contrário se alguém tirar `CLIENTE`.
    const texto = fs.readFileSync(FONTE, "utf-8");
    expect(texto).toMatch(/return procedenciaDoPagamento\(guide\) !== PROCEDENCIA_PAGAMENTO\.CLIENTE;/);
  });
});
