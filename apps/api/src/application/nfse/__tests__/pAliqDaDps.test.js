// A ALÍQUOTA DO ISSQN NA DPS — a tabela-verdade, e as duas maneiras de errar.
//
// ⚠⚠ O QUE ESTE ARQUIVO TRAVA: que o campo só saia onde a norma PROVA. Ele é PROIBIDO num cenário
// e OBRIGATÓRIO em outro, e os dois são rejeição — não existe "mandar por via das dúvidas".
//
// ⚠ E trava também o TERCEIRO estado, que é o que impede o chute: onde o discriminante é o status
// do convênio do município (tabela que este projeto não tem), a resposta é `NAO_DECIDIVEL` — não
// `EMITIR` nem `PROIBIDO`. Colapsá-lo em qualquer um dos dois é escolher uma rejeição.

import fs from "node:fs";
import path from "node:path";

import {
  ALIQUOTA_MAXIMA_DO_CAMPO,
  ALIQUOTA_MINIMA_COM_RETENCAO,
  DECISAO,
  formatarPAliq,
  pAliqDaDps,
} from "../pAliqDaDps.js";

const simplesSN = (extra) => ({
  opSimpNac: "3", regApTribSN: "1", tpRetISSQN: "1", aliquota: null, ...extra,
});

describe("⚠⚠ Simples com apuração pelo SN — o ÚNICO ramo decidível sem o convênio", () => {
  it("SEM retenção o campo é PROIBIDO — mesmo com alíquota declarada no perfil", () => {
    // E0625 (convênio ativo) e E0631 (não ativo) dizem a MESMA coisa. É o que torna o ramo
    // decidível: o status do convênio não entra na conta.
    for (const aliquota of [null, 5, "3.5", 2]) {
      const r = pAliqDaDps(simplesSN({ tpRetISSQN: "1", aliquota }));
      expect({ aliquota, ok: r.ok, decisao: r.decisao, informar: r.informar }).toEqual({
        aliquota, ok: true, decisao: DECISAO.PROIBIDO, informar: false,
      });
    }
  });

  it("⚠ e o descarte NÃO é silencioso — o motivo viaja, com as duas regras", () => {
    const r = pAliqDaDps(simplesSN({ aliquota: 5 }));
    expect(r.regras).toEqual(["E0625", "E0631"]);
    expect(r.motivo).toMatch(/proibido/i);
  });

  it("COM retenção o campo é OBRIGATÓRIO, nos dois tipos de retenção", () => {
    for (const tpRetISSQN of ["2", "3"]) {
      const r = pAliqDaDps(simplesSN({ tpRetISSQN, aliquota: 5 }));
      expect({ tpRetISSQN, ok: r.ok, decisao: r.decisao, pAliq: r.pAliq }).toEqual({
        tpRetISSQN, ok: true, decisao: DECISAO.EMITIR, pAliq: "5.00",
      });
      expect(r.regras).toEqual(["E0621", "E0628"]);
    }
  });

  it("⚠⚠ com retenção e SEM alíquota, RECUSA — e diz quem declara", () => {
    const r = pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota: null }));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe("NFSE_PALIQ_OBRIGATORIA_AUSENTE");
    // ⚠ A correção aponta para o CONTADOR: a alíquota é da empresa, não da nota. Decisão do dono.
    expect(r.correcao).toMatch(/contador/i);
    expect(r.correcao).toMatch(/1\.8|1,8/);
  });

  it("⚠⚠ o mínimo de 1,8% é regra, não preferência — e está NAS DUAS regras", () => {
    // A observação é literal em E0621 e E0628: "o percentual da alíquota mínima informada
    // permitida é 1,8%". Recusar aqui evita um round-trip para saber algo que está no nosso disco.
    expect(ALIQUOTA_MINIMA_COM_RETENCAO).toBe(1.8);
    for (const aliquota of [0, 0.5, 1, 1.79]) {
      const r = pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota }));
      expect({ aliquota, codigo: r.codigo }).toEqual({
        aliquota, codigo: "NFSE_PALIQ_ABAIXO_DO_MINIMO",
      });
    }
    // No limite, passa.
    expect(pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota: 1.8 })).pAliq).toBe("1.80");
  });

  it("⚠⚠ 1,8 vira `1.80` — `1.8` NÃO casa com o pattern do leiaute", () => {
    // `TSDec1V2` é `0|[0-9]{1}(\.[0-9]{2})?`: EXATAMENTE duas casas. Uma alíquota "bonita" para
    // olho humano é recusada por schema.
    expect(pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota: 1.8 })).pAliq).toBe("1.80");
    expect(pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota: "2" })).pAliq).toBe("2.00");
    expect(pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota: "3,5" })).pAliq).toBe("3.50");
  });

  it("⚠ alíquota que não CABE no campo recusa, em vez de sair truncada", () => {
    // Um dígito inteiro: 10% ou mais é inexprimível. Não é limite nosso, é o leiaute — e truncar
    // transformaria 12,5% em 2,50% em silêncio.
    expect(ALIQUOTA_MAXIMA_DO_CAMPO).toBe(10);
    for (const aliquota of [10, 12.5, 99]) {
      expect(pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota })).codigo)
        .toBe("NFSE_PALIQ_FORA_DO_CAMPO");
    }
  });
});

describe("⚠⚠ o terceiro estado: NÃO DECIDÍVEL — e ele não vira nem sim nem não", () => {
  it("Simples com apuração FORA do SN depende do convênio, que não temos", () => {
    for (const regApTribSN of ["2", "3"]) {
      const r = pAliqDaDps({ opSimpNac: "3", regApTribSN, tpRetISSQN: "2", aliquota: 5 });
      expect({ regApTribSN, ok: r.ok, decisao: r.decisao, informar: r.informar }).toEqual({
        regApTribSN, ok: true, decisao: DECISAO.NAO_DECIDIVEL, informar: false,
      });
      expect(r.regras).toEqual(["E0635", "E0640"]);
    }
  });

  it("não optante idem", () => {
    const r = pAliqDaDps({ opSimpNac: "1", regApTribSN: null, tpRetISSQN: "2", aliquota: 5 });
    expect(r.decisao).toBe(DECISAO.NAO_DECIDIVEL);
    expect(r.informar).toBe(false);
    expect(r.regras).toEqual(["E0617", "E0619"]);
  });

  it("⚠⚠ NÃO DECIDÍVEL não recusa a emissão — o comportamento fica o de HOJE", () => {
    // Recusar aqui quebraria a emissão que funciona em produção: as notas do Lucro Presumido saem
    // sem `pAliq` e são aceitas. O que se faz é NÃO emitir o campo e NOMEAR o risco — nunca chutar.
    const r = pAliqDaDps({ opSimpNac: "1", regApTribSN: null, tpRetISSQN: "1", aliquota: null });
    expect(r.ok).toBe(true);
    expect(r.motivo).toMatch(/conv[êe]nio/i);
  });

  it("⚠ e o motivo NOMEIA o que falta, sem prometer que resolvemos", () => {
    const r = pAliqDaDps({ opSimpNac: "3", regApTribSN: "2", tpRetISSQN: "1", aliquota: null });
    expect(r.motivo).toMatch(/status do conv[êe]nio n[ãa]o est[áa] neste projeto/i);
  });
});

describe("⚠ a forma do campo, conferida contra o XSD lido do arquivo", () => {
  it("todo `pAliq` que produzimos casa com `TSDec1V2`", () => {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      const t = path.join(dir, "docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01");
      if (fs.existsSync(t)) { dir = t; break; }
      dir = path.dirname(dir);
    }
    const xsd = fs.readFileSync(path.join(dir, "tiposSimples_v1.01.xsd"), "utf-8");
    const bloco = /<xs:simpleType name="TSDec1V2">[\s\S]*?<\/xs:simpleType>/.exec(xsd)[0];
    const padrao = /<xs:pattern value="([^"]+)"/.exec(bloco)[1];
    expect(padrao).toBe("0|[0-9]{1}(\\.[0-9]{2})?");

    const re = new RegExp(`^(?:${padrao})$`);
    for (const v of [0, 1.8, 2, 3.5, 5, 9.99, "4,25"]) {
      const texto = formatarPAliq(v);
      expect({ v, texto, casa: re.test(texto) }).toEqual({ v, texto, casa: true });
    }
  });

  it("⚠ o que não cabe devolve `null`, nunca um número truncado", () => {
    for (const v of [10, 12.5, -1, "abc", null, undefined, {}]) {
      expect(formatarPAliq(v)).toBeNull();
    }
  });

  it("⚠ `0` é valor legítimo do pattern, e é formatado como `0.00`", () => {
    // O pattern aceita `0` puro E `0.00`. Escolhemos a forma de duas casas por uniformidade —
    // as duas casam. ⚠ Isso não quer dizer que alíquota zero seja EMITIDA: no ramo com retenção
    // ela cai no mínimo de 1,8%, e no ramo sem retenção o campo nem sai.
    expect(formatarPAliq(0)).toBe("0.00");
    expect(pAliqDaDps(simplesSN({ tpRetISSQN: "2", aliquota: 0 })).codigo)
      .toBe("NFSE_PALIQ_ABAIXO_DO_MINIMO");
  });
});
