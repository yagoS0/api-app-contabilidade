// A NBS 2.0 — a tabela, e o fato de ela ser INERTE de propósito.

import fs from "node:fs";
import path from "node:path";
import { NBS, nbsPorCodigo, descricaoNbs, normalizarCodigoNbs } from "../index.js";

const IMPORTA_NBS = /from\s+["'][^"']*fiscal\/nbs/;

describe("⚠ a tabela veio inteira", () => {
  it("1.210 códigos, sem repetido", () => {
    expect(NBS).toHaveLength(1210);
    expect(new Set(NBS.map((n) => n.codigo)).size).toBe(1210);
  });

  it("⚠⚠ os 102 códigos que o Excel guardou como NÚMERO estão pontuados", () => {
    // `1.0101` virava o inteiro `10101` — o Excel come os pontos. A remontagem é `C.PPPP`, e o
    // gerador exige que TODO remontado tenha filho na lista em texto (102 de 102). Sem isso, seriam
    // 102 códigos sem pontuação nenhuma no meio de uma lista pontuada.
    expect(nbsPorCodigo("1.0101")).not.toBeNull();
    expect(NBS.every((n) => /^\d\.\d{4}(\.\d{1,2}){0,2}$/.test(n.codigo))).toBe(true);
  });

  it("⚠ os códigos vieram sem espaço no fim — 112 os tinham na planilha", () => {
    expect(NBS.every((n) => n.codigo === n.codigo.trim())).toBe(true);
  });

  it("⚠ as duas linhas SEM descrição continuam sem — a fonte não as descreve", () => {
    const semDesc = NBS.filter((n) => n.descricao === null).map((n) => n.codigo);
    expect(semDesc).toEqual(["9.9999", "9.9999.99.99"]);
    expect(descricaoNbs("9.9999")).toBeNull();
  });

  it("acentos preservados", () => {
    expect(NBS.some((n) => /[áàâãéêíóôõúüç]/i.test(n.descricao || ""))).toBe(true);
    expect(NBS.every((n) => !/�/.test(n.descricao || ""))).toBe(true);
  });
});

describe("⚠ normalização tolerante, nunca inventiva", () => {
  it("aceita espaço em volta", () => expect(normalizarCodigoNbs(" 1.0101.11.00 ")).toBe("1.0101.11.00"));
  it.each(["", null, undefined, "10101", "abc", "1.010", "17.06"])(
    "%p não vira código", (b) => expect(normalizarCodigoNbs(b)).toBeNull(),
  );
  it("⚠⚠ um item da LC 116 não é aceito como NBS — são listas diferentes", () => {
    expect(nbsPorCodigo("17.06")).toBeNull();
  });
});

describe("⚠⚠ A TABELA DEIXOU DE SER INERTE EM 02/09/2026 — e a porta É UMA SÓ", () => {
  // ⚠⚠ ESTE BLOCO SE CHAMAVA "ELA É INERTE, E ISSO ESTÁ TRAVADO" e exigia ZERO importadores em
  // `application/nfse/`. Ele existia para que ligar o `cNBS` fosse ATO DO DONO, e não consequência
  // de a tabela existir — e cumpriu o papel: caiu no commit que a ligou.
  //
  // A decisão mudou, com data e motivo. O dono escolheu **migrar para o leiaute 1.01 e construir
  // IBS/CBS junto**, e a regra **E0322** do Padrão Nacional torna o `cNBS` OBRIGATÓRIO quando o
  // bloco IBS/CBS é informado (ANEXO_I, aba `RN DPS_NFS-e`, linha 324). Ou seja: escolher IBS/CBS
  // **é** escolher ligar a NBS. A decisão de 25/08/2026 não foi revogada por conveniência — ela
  // foi superada por um requisito que a norma amarra.
  //
  // ⚠⚠ O QUE SUBSTITUI A INÉRCIA NÃO É NADA: é uma porta ÚNICA. Só `ibscbsDaDps.js` pode importar
  // a NBS dentro de `application/nfse/`. `buildDpsXml` **não a importa** — ele recebe o valor já
  // decidido —, e é isso que mantém um lugar só respondendo "este código pode ir à DPS?".
  const importadoresEmNfse = () => {
  // ⚠ A pergunta é "quem IMPORTA", não "quem MENCIONA". A primeira versão varria o texto inteiro e
  // acusou `campos.js`, que só cita o nome `nbsParaDps` num comentário explicando quem converte.
  // Guarda que acusa documentação correta é guarda que alguém desliga.
    const dir = path.resolve(__dirname, "../../../nfse");
    const arquivos = [];
    const varrer = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") varrer(p); }
        else if (e.name.endsWith(".js")) arquivos.push(p);
      }
    };
    varrer(dir);
    expect(arquivos.length).toBeGreaterThan(5);
    return arquivos
      .filter((f) => IMPORTA_NBS.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.basename(f));
  };

  it("⚠⚠ exatamente UM arquivo do caminho de emissão importa a NBS", () => {
    expect(importadoresEmNfse()).toEqual(["ibscbsDaDps.js"]);
  });

  it("⚠⚠ `NfseService` NÃO importa a NBS — ele recebe a decisão pronta", () => {
    // Se o gerador passar a consultar a tabela por conta própria, existem duas respostas para
    // "este código pode ir à DPS?" — e elas divergem na primeira correção.
    const fonte = fs.readFileSync(path.resolve(__dirname, "../../../nfse/NfseService.js"), "utf-8");
    expect(fonte).not.toMatch(IMPORTA_NBS);
    expect(fonte).toMatch(/ibscbsDaDps/);
  });
});
