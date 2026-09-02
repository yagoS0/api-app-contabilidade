// O ANEXO VIII — a tabela do IBS/CBS, e a regra que a impede de virar um de-para.
//
// ⚠⚠ O QUE ESTE ARQUIVO TRAVA, ACIMA DE TUDO: **que a tabela continue OFERECENDO e nunca ELEGENDO**.
// A tentação é a mesma que o plano desta entrega cometeu — tratar o ANEXO VIII como
// `item → cIndOp → cClassTrib` e devolver "a" resposta. Medido: só 89 dos 208 itens têm UMA
// combinação. Nos outros 118, escolher é ato do contador.

import fs from "node:fs";
import path from "node:path";

import {
  ANEXO_VIII,
  RESPOSTA,
  conferirCombinacao,
  correlacaoDoItem,
  itemLc116DoCodigoNacional,
  nbsDoItem,
  normalizarItemLc116,
} from "../index.js";

describe("⚠ a medição da fonte, travada", () => {
  it("208 itens e 400 combinações", () => {
    // Se a planilha for atualizada, o gerador aborta ANTES de reescrever. Este caso é a segunda
    // trava: ele cai mesmo que alguém edite o `.data.js` à mão, que o cabeçalho de lá proíbe.
    expect(ANEXO_VIII).toHaveLength(208);
    expect(ANEXO_VIII.flatMap((i) => i.combinacoes)).toHaveLength(400);
  });

  it("⚠ 89 itens respondem sozinhos; 118 dependem do contador; 1 não responde nada", () => {
    const uma = ANEXO_VIII.filter((i) => i.combinacoes.length === 1).length;
    const varias = ANEXO_VIII.filter((i) => i.combinacoes.length > 1).length;
    const nenhuma = ANEXO_VIII.filter((i) => !i.combinacoes.length);
    expect({ uma, varias, nenhuma: nenhuma.length }).toEqual({ uma: 89, varias: 118, nenhuma: 1 });
    expect(nenhuma[0].item).toBe("99.01.01");
  });

  it("⚠⚠ os códigos casam com os padrões do XSD 1.01 — lidos do arquivo, não copiados", () => {
    // A amarração com o leiaute. `TSRTCCodIndOp` e `TSRTCCodClassTrib` são `[0-9]{6}`; se o pacote
    // de esquema mudar a forma, este caso cai junto com a tabela.
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      const t = path.join(dir, "docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01");
      if (fs.existsSync(t)) { dir = t; break; }
      dir = path.dirname(dir);
    }
    const xsd = fs.readFileSync(path.join(dir, "tiposSimples_v1.01.xsd"), "utf-8");
    const padraoDe = (tipo) => {
      const bloco = new RegExp(`<xs:simpleType name="${tipo}">[\\s\\S]*?</xs:simpleType>`).exec(xsd);
      return /<xs:pattern value="([^"]+)"/.exec(bloco[0])[1];
    };
    const indOp = new RegExp(`^(?:${padraoDe("TSRTCCodIndOp")})$`);
    const classTrib = new RegExp(`^(?:${padraoDe("TSRTCCodClassTrib")})$`);

    for (const c of ANEXO_VIII.flatMap((i) => i.combinacoes)) {
      expect(indOp.test(c.cIndOp)).toBe(true);
      expect(classTrib.test(c.cClassTrib)).toBe(true);
    }
  });
});

describe("⚠⚠ o par NÃO pode ser achatado em duas listas — a fonte não autoriza tudo", () => {
  it("em 7 itens o produto cartesiano inventa combinação", () => {
    const inventam = ANEXO_VIII.filter((i) => {
      const ind = new Set(i.combinacoes.map((c) => c.cIndOp));
      const cct = new Set(i.combinacoes.map((c) => c.cClassTrib));
      return ind.size && cct.size && i.combinacoes.length < ind.size * cct.size;
    });
    expect(inventam).toHaveLength(7);
  });

  it("⚠⚠ o caso canônico: `10.05` autoriza DOIS pares, e achatado ofereceria QUATRO", () => {
    // É o exemplo que decide o desenho do módulo. A fonte diz "020301 com 200046" e "100301 com
    // 000001"; duas listas soltas passariam a oferecer também "020301 com 000001", que é uma
    // classificação tributária que ninguém escreveu.
    const { combinacoes } = correlacaoDoItem("10.05");
    const pares = combinacoes.map((c) => `${c.cIndOp}|${c.cClassTrib}`).sort();
    expect(pares).toEqual(["020301|200046", "100301|000001"]);

    expect(conferirCombinacao("10.05", { cIndOp: "020301", cClassTrib: "200046" }).ok).toBe(true);
    expect(conferirCombinacao("10.05", { cIndOp: "100301", cClassTrib: "000001" }).ok).toBe(true);

    const inventada = conferirCombinacao("10.05", { cIndOp: "020301", cClassTrib: "000001" });
    expect(inventada.ok).toBe(false);
    expect(inventada.motivo).toBe("COMBINACAO_NAO_AUTORIZADA");
    // ⚠ A recusa DIZ o que valeria — recusa sem saída manda o contador adivinhar.
    expect(inventada.autorizadas).toHaveLength(2);
  });
});

describe("⚠⚠ oferece, nunca elege", () => {
  it("com VÁRIAS, devolve todas e não marca nenhuma", () => {
    const r = correlacaoDoItem("01.01");
    expect(r.resposta).toBe(RESPOSTA.VARIAS);
    expect(r.combinacoes.length).toBeGreaterThan(1);
    // Nada de `padrao`, `escolhida`, `principal` ou `sugerida`. Um campo desses faria a ordem da
    // planilha decidir a tributação da nota.
    for (const c of r.combinacoes) {
      expect(Object.keys(c).sort()).toEqual([
        "adquiridoDoExterior", "cClassTrib", "cIndOp", "localIncidencia", "nomeClassTrib", "onerosa",
      ]);
    }
  });

  it("⚠ `UMA` também devolve LISTA — quem decide se isso dispensa a pergunta é o consumidor", () => {
    const unico = ANEXO_VIII.find((i) => i.combinacoes.length === 1);
    const r = correlacaoDoItem(unico.item);
    expect(r.resposta).toBe(RESPOSTA.UMA);
    expect(Array.isArray(r.combinacoes)).toBe(true);
    expect(r.combinacoes).toHaveLength(1);
  });

  it("⚠ item sem correlação e item inexistente são respostas DIFERENTES", () => {
    // `SEM_CORRELACAO` é fato sobre a TABELA ("a norma não correlaciona nada para o não
    // classificado"); `SEM_ITEM` é fato sobre a PERGUNTA. Colapsá-las apagaria a distinção entre
    // "a norma não diz" e "não sei do que você está falando".
    expect(correlacaoDoItem("99.01.01").resposta).toBe(RESPOSTA.SEM_CORRELACAO);
    expect(correlacaoDoItem("77.77").resposta).toBe(RESPOSTA.SEM_ITEM);
    expect(conferirCombinacao("99.01.01", { cIndOp: "100301", cClassTrib: "000001" })).toEqual({
      ok: false, motivo: "ITEM_SEM_CORRELACAO", item: "99.01.01",
    });
  });
});

describe("⚠ as duas grafias do código, e o zero que só o ITEM ganha", () => {
  it("`1.01` e `01.01` são o mesmo item", () => {
    expect(normalizarItemLc116("1.01")).toBe("01.01");
    expect(normalizarItemLc116("01.01")).toBe("01.01");
    expect(correlacaoDoItem("1.01").item).toBe("01.01");
  });

  it("⚠⚠ `1.1` NÃO é `01.01` — o subitem não ganha zero", () => {
    // O defeito que este gate pegou no próprio gerador: normalizar as duas metades transforma
    // `01.01` em `1.1`, e `1.1` é outro subitem. Aqui a forma é recusada, nunca adivinhada.
    expect(normalizarItemLc116("1.1")).toBeNull();
    expect(correlacaoDoItem("1.1").resposta).toBe(RESPOSTA.SEM_ITEM);
  });

  it("o item de três partes da família 99 é aceito", () => {
    expect(normalizarItemLc116("99.01.01")).toBe("99.01.01");
  });

  it("forma inválida devolve `null`, nunca palpite", () => {
    for (const v of [null, undefined, "", "  ", "abc", "1", "1.011", "1.0.1"]) {
      expect(normalizarItemLc116(v)).toBeNull();
    }
  });

  it("⚠⚠ NÚMERO não é aceito — nem o que 'daria certo'", () => {
    // Achado por este próprio teste: `1.01` como número virava `"01.01"` e passava, enquanto
    // `01.10` chega ao runtime como `1.1` e era recusado. Aceitação incoerente de código fiscal é
    // pior que recusa: o caso que quebra é o do zero à esquerda, que é justamente o comum aqui.
    for (const v of [1.01, 1.1, 101, {}, [], ["01.01"]]) {
      expect(normalizarItemLc116(v)).toBeNull();
    }
    expect(itemLc116DoCodigoNacional(10101)).toBeNull();
    expect(itemLc116DoCodigoNacional(101010)).toBeNull();
  });
});

describe("⚠ o item embutido no `cTribNac`", () => {
  it("os quatro primeiros dígitos são o item; o desdobro nacional não entra", () => {
    expect(itemLc116DoCodigoNacional("010101")).toBe("01.01");
    expect(itemLc116DoCodigoNacional("310104")).toBe("31.01");
    expect(correlacaoDoItem(itemLc116DoCodigoNacional("010101")).resposta).not.toBe(RESPOSTA.SEM_ITEM);
  });

  it("⚠ SEM `padStart`: 6 dígitos ou `null`", () => {
    // Completar `10101` para `010101` fabricaria um item plausível a partir de um dígito a menos —
    // a classe do `cLocEmi="0000000"`.
    for (const v of ["10101", "0101011", "01010a", "", null, undefined]) {
      expect(itemLc116DoCodigoNacional(v)).toBeNull();
    }
  });
});

describe("⚠ o que este módulo NÃO faz", () => {
  it("não monta XML, não fala com o banco e não conhece a DPS", () => {
    // Varredura da fonte, não teste de comportamento: um dublê passaria. Montar o grupo `IBSCBS`
    // muda documento fiscal em produção e é ato do dono, atrás de `INTEGRACAO_NFSE_IBSCBS`.
    const fonte = fs.readFileSync(path.join(__dirname, "../index.js"), "utf-8");
    const semComentarios = fonte
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(semComentarios).not.toMatch(/prisma|axios|fetch\(/);
    expect(semComentarios).not.toMatch(/<[a-zA-Z]+>/);
    expect(semComentarios).not.toMatch(/buildDps|NfseService/);
  });

  it("⚠ os NBS saem na forma PONTUADA — não são o `cNBS` da DPS", () => {
    // `TSCodNBS` é `[0-9]{9}`. A tabela guarda `1.1502.10.00`, e 292 dos 1.210 códigos da NBS são
    // níveis intermediários que não cabem na DPS. A conversão é `nbsParaDps`, que ainda não existe.
    const nbs = nbsDoItem("01.01");
    expect(nbs.length).toBeGreaterThan(1);
    for (const n of nbs) expect(n).toMatch(/^\d\.\d{4}(\.\d{1,2}){0,2}$/);
    expect(nbs.some((n) => /^\d{9}$/.test(n))).toBe(false);
  });

  it("item sem correlação também não tem NBS", () => {
    expect(nbsDoItem("99.01.01")).toEqual([]);
    expect(nbsDoItem("77.77")).toEqual([]);
  });
});
