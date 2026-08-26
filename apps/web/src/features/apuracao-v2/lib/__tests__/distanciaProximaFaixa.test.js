// QUANTO FALTA PARA A PRÓXIMA FAIXA.
//
// A pergunta que o contador faz toda competência ("estou perto de subir de faixa?") e que nenhum
// código deste projeto respondia — varredura em 26/08/2026: zero ocorrências de `faltam`,
// `proximaFaixa` ou equivalente em `apps/web` e `apps/api` (os acertos de `faltam` eram de
// parcelamento e de campos de classificação).
//
// ⚠⚠ O RISCO DESTA FUNÇÃO NÃO É ERRAR A SUBTRAÇÃO — é a FRASE. "Faltam R$ 80.000" lido como
// "posso faturar R$ 80.000 antes de mudar de faixa" é falso nos dois sentidos, porque o RBT12 é
// soma MÓVEL: ele anda `mês que entra − mês que sai`. Metade dos testes abaixo é sobre isso.

import {
  distanciaAteAProximaFaixa, SITUACAO_PROXIMA_FAIXA,
} from "../anexoDaEmpresa";

describe("⚠⚠ A DISTÂNCIA É DO RBT12, E O RETORNO É OBRIGADO A DIZER ISSO", () => {
  it("todo retorno traz `sobreRbt12: true` — inclusive os que não têm distância", () => {
    // A tela não pode escrever "faltam R$ X" sem dizer de que número fala. O campo existe em TODOS
    // os desfechos de propósito: um campo que só aparece às vezes obriga o consumidor a adivinhar
    // o que a ausência quer dizer (a mesma decisão do `viradaDeMes` da auditoria).
    for (const rbt12 of [null, 0, 500_000, 4_000_000, 9_000_000]) {
      expect(distanciaAteAProximaFaixa("III", rbt12).sobreRbt12).toBe(true);
    }
  });

  it("⚠⚠ NÃO existe projeção, prazo, média nem 'meses até virar'", () => {
    // Dizer QUANDO a empresa cruza exigiria a série dos 12 meses da janela; projetar por média
    // seria o portal chutando o mês da virada de alíquota — num número que decide imposto.
    const r = distanciaAteAProximaFaixa("III", 500_000);
    for (const proibido of ["meses", "mesesAteVirar", "projecao", "previsao", "mediaMensal", "estimativa", "prazo"]) {
      expect(r).not.toHaveProperty(proibido);
    }
  });
});

describe("a distância, quando há próxima faixa", () => {
  it("Anexo III com RBT12 de 500.000 está na 3ª faixa e faltam 220.000 para a 4ª", () => {
    // 3ª faixa vai até 720.000 → 720.000 − 500.000.
    const r = distanciaAteAProximaFaixa("III", 500_000);
    expect(r).toMatchObject({
      situacao: SITUACAO_PROXIMA_FAIXA.HA_PROXIMA,
      faixaAtual: 3, proximaFaixa: 4, falta: 220_000,
    });
  });

  it("⚠ e traz as DUAS alíquotas nominais — 'faltam X' sem dizer para quanto vai não decide nada", () => {
    const r = distanciaAteAProximaFaixa("III", 500_000);
    expect(r.aliquotaNominalAtual).toBe(0.1350);
    expect(r.aliquotaNominalProxima).toBe(0.1600);
  });

  it("exatamente NO limite da faixa, falta zero — e a faixa ainda é a de baixo", () => {
    // `ate: 720_000` é inclusivo; a 4ª começa em 720_000.01.
    const r = distanciaAteAProximaFaixa("III", 720_000);
    expect(r).toMatchObject({ faixaAtual: 3, proximaFaixa: 4, falta: 0 });
  });

  it("⚠⚠ a distância nunca é negativa — e a prova é a INVARIANTE, não um clamp", () => {
    // Este teste começou como `expect(falta).toBeGreaterThanOrEqual(0)` sobre um `Math.max(0, …)`
    // na regra. O experimento que desligava o clamp deu ZERO vermelhos: ele era código morto se
    // defendendo de um caso que não existe, e o teste ao lado não podia falhar — vacuoso.
    //
    // O que de fato garante o sinal é `faixaDoRbt12`: `v <= f.ate` é condição do `find`, logo a
    // faixa devolvida SEMPRE contém o valor. É isso que se mede aqui — inclusive nos pontos onde
    // ela é frágil: os limites exatos e o "vão" entre faixas, que a tolerância de ±0,005 fecha.
    const pontos = [
      1, 180_000, 180_000.005, 180_000.01, 360_000, 720_000, 720_000.01,
      1_800_000, 3_600_000, 3_600_000.01, 4_799_999.99, 4_800_000,
    ];
    for (const anexo of ["I", "II", "III", "IV", "V"]) {
      for (const v of pontos) {
        const r = distanciaAteAProximaFaixa(anexo, v);
        // Nenhum ponto pode cair FORA de faixa: sem faixa a regra responderia "não sabemos" sobre
        // um RBT12 perfeitamente conhecido, e é assim que um vão vira "sem alíquota".
        expect(r.situacao).not.toBe(SITUACAO_PROXIMA_FAIXA.RBT12_DESCONHECIDO);
        if (r.falta != null) expect(r.falta).toBeGreaterThanOrEqual(0);
        if (r.faltaParaODesenquadramento != null) {
          expect(r.faltaParaODesenquadramento).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it.each(["I", "II", "III", "IV", "V"])("ANEXO %s — 1ª faixa aponta para a 2ª", (anexo) => {
    expect(distanciaAteAProximaFaixa(anexo, 100_000)).toMatchObject({ faixaAtual: 1, proximaFaixa: 2 });
  });
});

describe("⚠⚠ CRUZAR PARA A 6ª FAIXA NÃO É SÓ ALÍQUOTA MAIOR — É O SUBLIMITE", () => {
  // LC 123/2006, art. 13-A: acima de R$ 3,6 mi o ICMS/ISS SAI do DAS e passa a ser recolhido por
  // fora, para o estado ou o município. Uma tela que anuncie só "a alíquota sobe" esconde uma
  // obrigação NOVA — que é a consequência mais cara da virada.
  it("da 5ª para a 6ª, o aviso do sublimite acende e nomeia o tributo que sai", () => {
    const r = distanciaAteAProximaFaixa("III", 3_000_000);
    expect(r).toMatchObject({ faixaAtual: 5, proximaFaixa: 6, cruzaOSublimite: true });
    expect(r.tributosQueSaemDoDas).toContain("iss"); // serviços → ISS
  });

  it("no Anexo I é o ICMS que sai — derivado da tabela, nunca de lista escrita à mão", () => {
    expect(distanciaAteAProximaFaixa("I", 3_000_000).tributosQueSaemDoDas).toContain("icms");
  });

  it("⚠ nas outras viradas o aviso NÃO acende — âmbar permanente treina o olho a ignorar", () => {
    for (const rbt12 of [100_000, 300_000, 500_000, 1_000_000]) {
      const r = distanciaAteAProximaFaixa("III", rbt12);
      expect(r.cruzaOSublimite).toBe(false);
      expect(r.tributosQueSaemDoDas).toEqual([]);
    }
  });
});

describe("⚠⚠ NA 6ª FAIXA NÃO HÁ PRÓXIMA FAIXA — O QUE HÁ É A SAÍDA DO SIMPLES", () => {
  it("a situação é própria, e `falta` fica NULO", () => {
    // Devolver aqui a distância até 4,8 mi com o rótulo de "próxima faixa" faria o contador ler
    // "vai pagar um pouco mais" onde o certo é "vai ter de sair do regime".
    const r = distanciaAteAProximaFaixa("III", 4_000_000);
    expect(r.situacao).toBe(SITUACAO_PROXIMA_FAIXA.NA_ULTIMA_FAIXA);
    expect(r.faixaAtual).toBe(6);
    expect(r.falta).toBeNull();
    expect(r.proximaFaixa).toBeNull();
  });

  it("⚠ e a distância até o teto vem com NOME PRÓPRIO, porque significa outra coisa", () => {
    expect(distanciaAteAProximaFaixa("III", 4_000_000).faltaParaODesenquadramento).toBe(800_000);
  });
});

describe("⚠⚠ AUSÊNCIA E EXCESSO SÃO RESPOSTAS DIFERENTES, E NENHUMA É UMA DISTÂNCIA", () => {
  it.each([null, undefined, "", 0, "abc", NaN, Infinity])(
    "RBT12 %p não vira 'faltam R$ 180.000' da 1ª faixa",
    (v) => {
      // `Number(null) || 0` casa com a 1ª faixa (`de: 0`): sem esta guarda a tela afirmaria uma
      // distância para uma empresa cujo RBT12 ninguém informou. A armadilha mais repetida daqui.
      const r = distanciaAteAProximaFaixa("III", v);
      expect(r.situacao).toBe(SITUACAO_PROXIMA_FAIXA.RBT12_DESCONHECIDO);
      expect(r.falta).toBeNull();
    },
  );

  it("acima de R$ 4,8 mi a pergunta não se aplica — e isso não é 'não sabemos'", () => {
    const r = distanciaAteAProximaFaixa("III", 5_000_000);
    expect(r.situacao).toBe(SITUACAO_PROXIMA_FAIXA.RBT12_ACIMA_DO_LIMITE);
    expect(r.falta).toBeNull();
    expect(r.faltaParaODesenquadramento).toBeUndefined();
  });

  it("anexo inexistente devolve `null` — nada a afirmar", () => {
    for (const a of ["VI", "", null, undefined, "x"]) {
      expect(distanciaAteAProximaFaixa(a, 500_000)).toBeNull();
    }
  });
});
