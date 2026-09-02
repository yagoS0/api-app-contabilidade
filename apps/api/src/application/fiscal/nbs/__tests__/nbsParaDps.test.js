// A CONVERSÃO DA NBS PARA O `cNBS` DA DPS — e as 292 recusas que NÃO são "código inválido".
//
// ⚠⚠ O QUE ESTE ARQUIVO TRAVA, acima de tudo: **que "não terminal" continue sendo uma resposta
// própria, com saída**. A tentação é colapsá-la em "inválido" — e aí o contador procura erro de
// digitação num código publicado, correto e com descrição, cujo único problema é identificar uma
// FAMÍLIA em vez de um serviço.

import fs from "node:fs";
import path from "node:path";

import { ANEXO_VIII } from "../../ibscbs/anexoViii.data.js";
import { NBS, RECUSA_NBS, descendentesTerminais, nbsParaDps } from "../index.js";

const digitos = (c) => c.replace(/\D/g, "");
const TERMINAIS = NBS.filter((n) => digitos(n.codigo).length === 9);
const INTERMEDIARIOS = NBS.filter((n) => digitos(n.codigo).length !== 9);

describe("⚠ a medição da hierarquia, travada", () => {
  it("918 terminais e 292 níveis intermediários", () => {
    expect(TERMINAIS).toHaveLength(918);
    expect(INTERMEDIARIOS).toHaveLength(292);
    expect(NBS).toHaveLength(1210);
  });

  it("⚠⚠ o `TSCodNBS` do XSD é `[0-9]{9}` — lido do arquivo, não copiado", () => {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      const t = path.join(dir, "docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01");
      if (fs.existsSync(t)) { dir = t; break; }
      dir = path.dirname(dir);
    }
    const xsd = fs.readFileSync(path.join(dir, "tiposSimples_v1.01.xsd"), "utf-8");
    const bloco = /<xs:simpleType name="TSCodNBS">[\s\S]*?<\/xs:simpleType>/.exec(xsd)[0];
    const padrao = /<xs:pattern value="([^"]+)"/.exec(bloco)[1];
    expect(padrao).toBe("[0-9]{9}");

    // E todo `cNBS` que produzimos casa com ele.
    const re = new RegExp(`^(?:${padrao})$`);
    for (const n of TERMINAIS) expect(re.test(nbsParaDps(n.codigo).cNBS)).toBe(true);
  });
});

describe("⚠⚠ converte os 918, recusa os 292 — e a recusa TEM SAÍDA", () => {
  it("todo terminal converte, e a ida e volta fecha", () => {
    for (const n of TERMINAIS) {
      const r = nbsParaDps(n.codigo);
      expect(r.ok).toBe(true);
      expect(r.cNBS).toBe(digitos(n.codigo));
      // ⚠ O CONTRATO É A IDA E VOLTA: a forma de nove dígitos revalida para o mesmo código.
      expect(nbsParaDps(r.cNBS).codigo).toBe(n.codigo);
    }
  });

  it("todo intermediário recusa como NÃO TERMINAL — nunca como inválido", () => {
    for (const n of INTERMEDIARIOS) {
      const r = nbsParaDps(n.codigo);
      expect({ codigo: n.codigo, ok: r.ok, motivo: r.motivo }).toEqual({
        codigo: n.codigo, ok: false, motivo: RECUSA_NBS.NAO_TERMINAL,
      });
    }
  });

  it("⚠⚠ NENHUM dos 292 fica sem saída — todos têm descendente terminal", () => {
    // É o que separa uma recusa de um beco. Se algum dia um nível ficar sem folha, este caso cai e
    // a mensagem "escolha um mais específico" passa a ser mentira para aquele código.
    for (const n of INTERMEDIARIOS) {
      const r = nbsParaDps(n.codigo);
      expect(r.descendentes.length).toBeGreaterThan(0);
      for (const d of r.descendentes) expect(nbsParaDps(d).ok).toBe(true);
    }
  });

  it("⚠ o não-terminal É um código legítimo — está na tabela e tem descrição", () => {
    // A prova de que `NAO_TERMINAL` não pode virar "inválido": `1.0101` existe, é publicado e
    // descrito. O que falta não é conserto, é escolha.
    const galho = NBS.find((n) => n.codigo === "1.0101");
    expect(galho).toBeTruthy();
    expect(galho.descricao).toBeTruthy();
    expect(descendentesTerminais("1.0101")).toContain("1.0101.11.00");
  });

  it("terminal não tem descendente, e isso é resposta", () => {
    expect(descendentesTerminais("1.0101.11.00")).toEqual([]);
  });

  it("⚠ o parentesco é por PREFIXO DE DÍGITOS, não por contagem de pontos", () => {
    // A NBS mistura grupos de um e de dois dígitos (`1.0101.1` e `1.0101.11.00` convivem), então
    // contar separadores erraria o parentesco.
    expect(descendentesTerminais("1.0101.1")).toEqual(
      expect.arrayContaining(["1.0101.11.00", "1.0101.12.00"]),
    );
    expect(descendentesTerminais("1.0101.1")).not.toContain("1.0101.21.00");
  });
});

describe("⚠ as outras duas recusas", () => {
  it("nove dígitos bem formados fora da tabela são recusados — a lista é a autoridade", () => {
    // O `[0-9]{9}` do XSD é FORMA; a tabela é CONTEÚDO. Emitir um código que cabe no pattern e não
    // existe na NBS seria a mesma classe do código de serviço fora do cadastro.
    const r = nbsParaDps("123456789");
    expect(r).toEqual({ ok: false, motivo: RECUSA_NBS.FORA_DA_TABELA, codigo: "123456789" });
  });

  it("forma inválida recusa sem inventar nada", () => {
    for (const v of ["", "  ", "abc", "1.15", "1.1502.10.00.1", "11502100"]) {
      expect(nbsParaDps(v).motivo).toBe(RECUSA_NBS.FORMA_INVALIDA);
    }
  });

  it("⚠⚠ NÚMERO não é aceito — o zero à esquerda sumiria em silêncio", () => {
    // Guarda por TIPO ACEITO, a mesma lição de `dispensadaPeloPiso`.
    for (const v of [115021000, 1.150210, null, undefined, {}, ["1.1502.10.00"]]) {
      expect(nbsParaDps(v)).toEqual({ ok: false, motivo: RECUSA_NBS.FORMA_INVALIDA, codigo: null });
    }
  });

  it("⚠⚠ NENHUM `padStart`: cinco dígitos não viram nove", () => {
    // Completar `1.0101` até nove fabricaria um código plausível e errado — a classe do
    // `cLocEmi="0000000"`. Ele recusa, e recusa pelo motivo CERTO.
    const r = nbsParaDps("1.0101");
    expect(r.ok).toBe(false);
    expect(r.cNBS).toBeUndefined();
    expect(r.motivo).toBe(RECUSA_NBS.NAO_TERMINAL);
  });
});

describe("⚠⚠ o `9.9999.99.99` converte, e NÃO tem descrição", () => {
  it("o 'não classificado' é terminal e passa — com `descricao: null`", () => {
    // ⚠ Emiti-lo declara ao fisco um serviço sem classificação. NÃO é bloqueado aqui (é código
    // publicado, e recusá-lo seria inventar regra), mas a descrição nula viaja para que a tela
    // possa DIZER isso. É a família do `990101` da classificação e do `99.01.01` do ANEXO VIII.
    expect(nbsParaDps("9.9999.99.99")).toEqual({
      ok: true, cNBS: "999999999", codigo: "9.9999.99.99", descricao: null,
    });
  });

  it("⚠ e são só DOIS os códigos sem descrição na fonte", () => {
    expect(NBS.filter((n) => !n.descricao).map((n) => n.codigo)).toEqual(["9.9999", "9.9999.99.99"]);
  });

  it("código descrito carrega a descrição", () => {
    expect(nbsParaDps("1.1502.10.00").descricao).toMatch(/[a-zà-ú]/i);
  });
});

describe("⚠⚠ o cruzamento com o ANEXO VIII — duas tabelas geradas em separado", () => {
  it("os 731 códigos que a correlação do IBS/CBS aponta CONVERTEM todos", () => {
    // A prova de que as duas tabelas falam a mesma língua. Se a correlação apontasse um nível
    // intermediário, o `cNBS` da nota seria irrepresentável e o defeito só apareceria na emissão.
    const doAnexo = [...new Set(ANEXO_VIII.flatMap((i) => i.nbs))];
    expect(doAnexo).toHaveLength(731);
    const recusados = doAnexo.filter((c) => !nbsParaDps(c).ok);
    expect(recusados).toEqual([]);
  });
});

describe("⚠ a tabela continua INERTE no caminho de emissão", () => {
  it("nenhum arquivo de `application/nfse/` importa a NBS", () => {
    // Ligar o `cNBS` MUDA o XML de nota fiscal em produção — ato do dono, não consequência de a
    // conversão existir. Quem ligar faz este caso cair, e a decisão fica à vista.
    const raiz = path.resolve(__dirname, "../../../nfse");
    const achados = [];
    const varrer = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") varrer(p); continue; }
        if (!e.name.endsWith(".js")) continue;
        if (/fiscal\/nbs|nbsParaDps/.test(fs.readFileSync(p, "utf-8"))) achados.push(e.name);
      }
    };
    varrer(raiz);
    expect(achados).toEqual([]);
  });
});
