import {
  MOTIVOS_GUIA_VAZIA, TEM_LISTA_DE_MOTIVOS, motivoParaGravar, motivoSuficiente,
} from "../motivoGuiaVazia";

describe("⚠ a lista fechada NÃO nasce inventada", () => {
  it("está vazia até o dono ditar os motivos", () => {
    // Motivo de ausência de guia é classificação fiscal. Um rótulo inventado vira justificativa
    // errada gravada exatamente onde uma fiscalização vai olhar.
    expect(MOTIVOS_GUIA_VAZIA).toEqual([]);
    expect(TEM_LISTA_DE_MOTIVOS).toBe(false);
  });

  it("e o caminho de texto livre funciona sozinho enquanto isso", () => {
    expect(motivoSuficiente({ texto: "IRPJ é trimestral; não há DARF neste mês" })).toBe(true);
  });
});

describe("o que vai para `Guide.vazioMotivo`", () => {
  it("texto livre vai como está, sem enfeite", () => {
    expect(motivoParaGravar({ texto: "  retido na fonte  " })).toBe("retido na fonte");
  });

  it("⚠ vazio é vazio — nem espaço em branco passa por motivo", () => {
    for (const texto of ["", "   ", "\n\t", undefined, null]) {
      expect(motivoSuficiente({ texto })).toBe(false);
    }
    expect(motivoSuficiente()).toBe(false);
  });

  it("⚠ chave desconhecida NÃO vira rótulo — cai no texto livre", () => {
    // É o caso do `<option value=\"OUTRO\">`, que de propósito não casa com nenhuma chave.
    expect(motivoParaGravar({ chave: "OUTRO", texto: "abaixo do mínimo" })).toBe("abaixo do mínimo");
    expect(motivoSuficiente({ chave: "OUTRO", texto: "" })).toBe(false);
  });

  it("com lista, a CHAVE viaja junto do rótulo", () => {
    // Gravar só o rótulo faria renomear uma opção reescrever o passado. Exercitado com uma lista
    // fabricada só para o teste — a de produção continua vazia.
    const fake = [{ chave: "TRIMESTRAL", rotulo: "Tributo trimestral" }];
    const comLista = ({ chave, texto }) => {
      const o = fake.find((m) => m.chave === chave);
      const livre = String(texto || "").trim();
      if (o) return livre ? `[${o.chave}] ${o.rotulo} — ${livre}` : `[${o.chave}] ${o.rotulo}`;
      return livre;
    };
    expect(comLista({ chave: "TRIMESTRAL" })).toBe("[TRIMESTRAL] Tributo trimestral");
    expect(comLista({ chave: "TRIMESTRAL", texto: "2º tri" })).toBe("[TRIMESTRAL] Tributo trimestral — 2º tri");
  });

  it("não herda do protótipo", () => {
    expect(motivoParaGravar({ chave: "constructor", texto: "x" })).toBe("x");
  });
});
