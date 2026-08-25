// A NBS 2.0 — a tabela, e o fato de ela ser INERTE de propósito.

import fs from "node:fs";
import path from "node:path";
import { NBS, nbsPorCodigo, descricaoNbs, normalizarCodigoNbs } from "../index.js";

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

describe("⚠⚠ ELA É INERTE, E ISSO ESTÁ TRAVADO", () => {
  // Ligar o `cNBS` na emissão MUDA O XML de nota fiscal em produção. É ato do dono, não
  // consequência de a tabela existir. Se alguém importar isto no caminho de emissão, este teste cai
  // e a decisão fica à vista em vez de acontecer por acidente.
  it("nenhum arquivo do caminho de emissão de NFS-e importa a NBS", () => {
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
    const importam = arquivos.filter((f) => /fiscal\/nbs|nbs\.data/.test(fs.readFileSync(f, "utf-8")));
    expect(importam.map((f) => path.basename(f))).toEqual([]);
  });
});
