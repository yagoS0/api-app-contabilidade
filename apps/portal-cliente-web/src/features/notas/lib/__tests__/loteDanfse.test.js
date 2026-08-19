// O DANFSe EM LOTE, na tela: o nome do arquivo e a leitura da recusa.
//
// ⚠ A regra que decide QUAIS notas entram no zip é do SERVIDOR (é ele que resolve o filtro e gera
// os PDFs). O que se mede aqui é o que a tela sabe fazer sozinha: nomear o arquivo que a pessoa
// salva, e traduzir a recusa sem inventar procedimento.

import {
  RECUSA_LOTE,
  lerRecusaLote,
  nomeDoArquivoLoteDanfse,
} from "../loteDanfse";

describe("o nome do arquivo que a pessoa salva", () => {
  test("leva o CNPJ e a competência", () => {
    const nome = nomeDoArquivoLoteDanfse({ cnpj: "12.345.678/0001-99", competencia: "2026-08" });
    expect(nome).toMatch(/^danfse-12345678000199-2026-08-.*\.zip$/);
  });

  test('sem competência, ele diz "todas" — nunca fica com um pedaço vazio', () => {
    expect(nomeDoArquivoLoteDanfse({ cnpj: "12345678000199" })).toMatch(/danfse-12345678000199-todas-/);
  });

  test("sem CNPJ ainda assim sai um nome utilizável", () => {
    expect(nomeDoArquivoLoteDanfse({})).toMatch(/^danfse-empresa-todas-.*\.zip$/);
  });

  // ⚠ O nome vai para o disco de quem baixa; separador ali é problema de verdade.
  test("nada de separador de caminho sobrevive", () => {
    const nome = nomeDoArquivoLoteDanfse({ cnpj: "1/2:3", competencia: "../etc" });
    expect(nome).not.toMatch(/[/\\:]/);
  });
});

describe("a recusa do servidor, traduzida", () => {
  // ⚠⚠ É a única resposta desta ação que a tela precisa EXPLICAR. "Falha ao baixar" esconderia
  // justamente o número que resolve o problema de quem está lendo.
  test("`lote_muito_grande` traz os NÚMEROS e o porquê do teto", () => {
    const err = Object.assign(new Error("Este filtro encontrou 437 notas, e o máximo é 200."), {
      status: 400,
      code: "lote_muito_grande",
      corpo: { error: "lote_muito_grande", encontradas: 437, maximo: 200 },
    });
    const r = lerRecusaLote(err);
    expect(r.codigo).toBe(RECUSA_LOTE.MUITO_GRANDE);
    expect(r.encontradas).toBe(437);
    expect(r.maximo).toBe(200);
    expect(r.texto).toContain("437");
    expect(r.porQue).toMatch(/gerado na hora/);
  });

  // ⚠ A MENSAGEM DO SERVIDOR VENCE. Ela já foi escrita onde a decisão foi tomada.
  test("sem mensagem do servidor, o texto local usa os números do corpo", () => {
    const err = Object.assign(new Error(""), {
      code: "lote_muito_grande",
      corpo: { encontradas: 300, maximo: 200 },
    });
    expect(lerRecusaLote(err).texto).toBe("Este filtro encontrou 300 notas, e o máximo por download é 200.");
  });

  test("`lote_vazio` diz que não há nota, sem sugerir defeito", () => {
    const err = Object.assign(new Error("Nenhuma nota encontrada para este filtro."), {
      code: "lote_vazio",
    });
    const r = lerRecusaLote(err);
    expect(r.codigo).toBe(RECUSA_LOTE.VAZIO);
    expect(r.encontradas).toBe(0);
    expect(r.porQue).toBeNull();
  });

  // ⚠ Mesma regra de `danfseDaNota.js`: código que esta tela não conhece NÃO ganha um "tente de
  // novo" fabricado.
  test("recusa desconhecida não ganha procedimento inventado", () => {
    const r = lerRecusaLote(Object.assign(new Error("estranho"), { code: "coisa_nova" }));
    expect(r.codigo).toBe("coisa_nova");
    expect(r.texto).toBe("estranho");
    expect(r.porQue).toBeNull();
  });

  test("erro sem código nenhum admite que não sabe o motivo", () => {
    expect(lerRecusaLote(new Error("")).texto).toMatch(/não disse por quê/);
  });
});
