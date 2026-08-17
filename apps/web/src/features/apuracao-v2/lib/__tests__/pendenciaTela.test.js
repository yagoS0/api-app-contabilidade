// A tela imprimia `[ITEM_SEM_REGRA]` — nome de enum do banco, em caixa alta e entre colchetes, na
// aba que decide o que vai para a declaração.
import { leituraDaPendencia, humanizarTipo, FRASE_PENDENCIA } from "../pendenciaTela";

describe("o enum não chega mais à tela", () => {
  it("ITEM_SEM_REGRA vira frase em português", () => {
    const r = leituraDaPendencia("ITEM_SEM_REGRA");
    expect(r.rotulo).toBe("Sem regra de classificação");
    expect(r.conhecida).toBe(true);
    expect(r.explicacao).toMatch(/ensina o sistema/i);
  });

  it("⚠ nenhum rótulo carrega colchete, underline ou caixa alta de enum", () => {
    for (const tipo of ["ITEM_SEM_REGRA", "FATOR_R_AMBIGUO", "COISA_NOVA", "", null, undefined]) {
      const { rotulo } = leituraDaPendencia(tipo);
      expect(rotulo).not.toMatch(/[[\]_]/);
      expect(rotulo).not.toBe(rotulo.toUpperCase());
    }
  });

  it("⚠ o enum cru NÃO se perde — vive no `title`, recuperável numa auditoria", () => {
    expect(leituraDaPendencia("ITEM_SEM_REGRA").titulo).toMatch(/tipo: ITEM_SEM_REGRA/);
    expect(leituraDaPendencia("FATOR_R_AMBIGUO").titulo).toMatch(/tipo: FATOR_R_AMBIGUO/);
  });
});

describe("⚠ tipo não catalogado NÃO ganha explicação inventada", () => {
  it.each(["DIVERGENCIA_CADASTRO", "FATOR_R_AMBIGUO", "CADASTRO_INCOMPLETO", "COISA_NOVA"])(
    "%s é legível, mas sem frase de significado",
    (tipo) => {
      const r = leituraDaPendencia(tipo);
      expect(r.conhecida).toBe(false);
      expect(r.explicacao).toBeNull();
      expect(r.titulo).toMatch(/não catalogado/i);
    },
  );

  it("⚠ a tabela tem UMA entrada — é o número de escritores que `fila_pendencias` tem", () => {
    // O comentário do `schema.prisma` lista quatro tipos, mas só `ClassificadorService` grava, e
    // sempre `ITEM_SEM_REGRA`. Frase para os outros três seria significado inventado.
    expect(Object.keys(FRASE_PENDENCIA)).toEqual(["ITEM_SEM_REGRA"]);
  });

  it("sem tipo nenhum, o cabeçalho é genérico e não afirma nada", () => {
    expect(leituraDaPendencia(null).rotulo).toBe("Pendência");
    expect(leituraDaPendencia("").titulo).toBe("Pendência sem tipo");
  });
});

describe("humanizarTipo", () => {
  it("troca underline por espaço e capitaliza só a primeira", () => {
    expect(humanizarTipo("FATOR_R_AMBIGUO")).toBe("Fator r ambiguo");
    expect(humanizarTipo("  ")).toBe("Pendência");
  });

  it("não herda do protótipo", () => {
    expect(leituraDaPendencia("toString").conhecida).toBe(false);
    expect(leituraDaPendencia("constructor").conhecida).toBe(false);
  });
});
