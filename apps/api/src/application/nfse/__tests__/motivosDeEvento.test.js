// AS LISTAS FECHADAS DE `cMotivo` — uma por evento, e elas NÃO são a mesma.
//
// ⚠⚠ ESTA SUÍTE GUARDA CONSTANTES DE LEIAUTE, e é por isso que ela repete os valores em vez de
// derivá-los do módulo: um teste que faz `expect(MOTIVOS).toEqual(MOTIVOS)` não protege nada. Os
// números aqui foram lidos do XSD oficial versionado, e quem os mudar tem de mudar duas vezes.
//
// Fonte: `docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01/tiposSimples_v1.01.xsd`
//   • `TSCodJustCanc`  (linha 219) — cancelamento — "1" "2" "9"
//   • `TSCodJustSubst` (linha 235) — substituição — "01".."05" "99"
//   • `TSMotivo`       (linha 348) — `xMotivo` — minLength 15, maxLength 255

import {
  JUSTIFICATIVA,
  MOTIVOS_CANCELAMENTO,
  MOTIVOS_SUBSTITUICAO,
  motivosDoEvento,
  motivoValido,
  validarJustificativa,
} from "../motivosDeEvento.js";

describe("as duas listas, conferidas contra o XSD", () => {
  it("cancelamento (`TSCodJustCanc`): exatamente 1, 2 e 9 — UM caractere", () => {
    expect(MOTIVOS_CANCELAMENTO.map((m) => m.codigo)).toEqual(["1", "2", "9"]);
    for (const m of MOTIVOS_CANCELAMENTO) expect(m.codigo).toHaveLength(1);
  });

  it("substituição (`TSCodJustSubst`): 01..05 e 99 — DOIS caracteres", () => {
    expect(MOTIVOS_SUBSTITUICAO.map((m) => m.codigo)).toEqual(["01", "02", "03", "04", "05", "99"]);
    for (const m of MOTIVOS_SUBSTITUICAO) expect(m.codigo).toHaveLength(2);
  });

  it("todo motivo tem rótulo legível — a tela oferece o texto, não o número", () => {
    for (const m of [...MOTIVOS_CANCELAMENTO, ...MOTIVOS_SUBSTITUICAO]) {
      expect(String(m.rotulo).length).toBeGreaterThan(3);
    }
  });

  it("`motivosDoEvento` devolve a lista certa, e `null` para evento desconhecido", () => {
    expect(motivosDoEvento("e101101")).toBe(MOTIVOS_CANCELAMENTO);
    expect(motivosDoEvento("E101101")).toBe(MOTIVOS_CANCELAMENTO);
    expect(motivosDoEvento("e105102")).toBe(MOTIVOS_SUBSTITUICAO);
    expect(motivosDoEvento("e999999")).toBeNull();
    expect(motivosDoEvento(null)).toBeNull();
  });
});

describe("⚠⚠ as listas NÃO se misturam — e a comparação é EXATA", () => {
  it.each(["1", "2", "9"])("`%s` vale no cancelamento e NÃO na substituição", (codigo) => {
    expect(motivoValido("e101101", codigo)).toBe(true);
    expect(motivoValido("e105102", codigo)).toBe(false);
  });

  it.each(["01", "02", "03", "04", "05", "99"])(
    "`%s` vale na substituição e NÃO no cancelamento",
    (codigo) => {
      expect(motivoValido("e105102", codigo)).toBe(true);
      expect(motivoValido("e101101", codigo)).toBe(false);
    }
  );

  it("⚠ NÃO há normalização: `01` não passa por `1`, nem `1` por `01`", () => {
    // Normalizar aqui é o que faria um código de outra lista atravessar — e a rejeição chegaria
    // como erro de schema, sem dizer que o motivo era da lista errada.
    expect(motivoValido("e101101", "01")).toBe(false);
    expect(motivoValido("e105102", "1")).toBe(false);
    expect(motivoValido("e101101", 1)).toBe(true); // número vira string, e "1" está na lista
    expect(motivoValido("e105102", 1)).toBe(false);
  });

  it("ausência, vazio e lixo nunca valem", () => {
    for (const v of [undefined, null, "", " ", "abc", "3", "0", "10"]) {
      expect(motivoValido("e101101", v)).toBe(false);
    }
  });

  it("evento desconhecido não valida nada", () => {
    expect(motivoValido("e999999", "1")).toBe(false);
  });
});

describe("⚠ `xMotivo` — o TAMANHO é do leiaute, não nosso", () => {
  it("menos de 15 recusa, dizendo o mínimo e o que foi digitado", () => {
    const r = validarJustificativa("erro");
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe("NFSE_JUSTIFICATIVA_CURTA");
    expect(r.mensagem).toMatch(/15/);
    expect(r.mensagem).toMatch(/tem 4/);
    // ⚠ E ela DIZ de quem é a regra — senão vira capricho do portal.
    expect(r.mensagem).toMatch(/leiaute nacional/i);
  });

  it("exatamente 15 passa; 14 não", () => {
    expect(validarJustificativa("a".repeat(15)).ok).toBe(true);
    expect(validarJustificativa("a".repeat(14)).ok).toBe(false);
  });

  it("exatamente 255 passa; 256 não", () => {
    expect(validarJustificativa("a".repeat(255)).ok).toBe(true);
    const r = validarJustificativa("a".repeat(256));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe("NFSE_JUSTIFICATIVA_LONGA");
  });

  it("⚠ o espaço em volta NÃO conta — 20 espaços têm tamanho 0", () => {
    const r = validarJustificativa(" ".repeat(20));
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/tem 0/);
  });

  it("os limites batem com as constantes exportadas", () => {
    expect(JUSTIFICATIVA).toEqual({ MIN: 15, MAX: 255 });
  });
});
