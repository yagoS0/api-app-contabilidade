import {
  MOTIVOS_GUIA_VAZIA, TEM_LISTA_DE_MOTIVOS, motivoParaGravar, motivoSuficiente,
} from "../motivoGuiaVazia";

describe("⚠⚠ A LISTA FECHADA — a trava MUDOU DE LADO em 27/08/2026", () => {
  // Este bloco exigia `MOTIVOS_GUIA_VAZIA` VAZIA, e existia para ninguém inventar rótulo fiscal por
  // conta própria. As quatro opções foram propostas no plano de 27/08/2026 e aprovadas com ele, e
  // então a trava passou a prender o CONTEÚDO — como o `colunasNuncaSomem` do SIEFPAR, que foi
  // invertido e não apagado quando a decisão do dono chegou.
  it("são exatamente estas quatro chaves, nesta ordem", () => {
    expect(MOTIVOS_GUIA_VAZIA.map((m) => m.chave)).toEqual([
      "TRIMESTRAL_FORA_DO_MES",
      "QUOTA_JA_PAGA",
      "SEM_BASE_NO_MES",
      "TRIBUTO_NAO_DEVIDO",
    ]);
    expect(TEM_LISTA_DE_MOTIVOS).toBe(true);
  });

  it("⚠⚠ e as duas primeiras NÃO se colapsam — são fatos diferentes", () => {
    // "Não há apuração neste mês" (o tributo é trimestral) e "já foi recolhido noutro mês" (o
    // trimestre pode ser pago em até três quotas) descrevem situações distintas, e a diferença é
    // exatamente o que uma fiscalização vai querer ver.
    const [primeiro, segundo] = MOTIVOS_GUIA_VAZIA;
    expect(primeiro.rotulo).toMatch(/mês sem apuração/i);
    expect(segundo.rotulo).toMatch(/já recolhida em outro mês/i);
    expect(primeiro.rotulo).not.toBe(segundo.rotulo);
  });

  it("todo rótulo é legível e nenhum é vazio", () => {
    for (const m of MOTIVOS_GUIA_VAZIA) {
      expect(String(m.rotulo).length).toBeGreaterThan(10);
      expect(m.chave).toMatch(/^[A-Z_]+$/);
    }
  });

  it("⚠ o caminho de TEXTO LIVRE continua funcionando — a lista não é exaustiva", () => {
    // Fechar a lista de vez obrigaria o contador a escolher o rótulo menos errado para um caso que
    // ela não prevê, que é como classificação errada entra sem ninguém decidir isso.
    expect(motivoSuficiente({ texto: "IRPJ é trimestral; não há DARF neste mês" })).toBe(true);
    expect(motivoParaGravar({ chave: "OUTRO", texto: "caso fora da lista" })).toBe("caso fora da lista");
  });

  it("⚠ e escolher da lista grava a CHAVE junto do rótulo", () => {
    // Gravar só o rótulo faria renomear uma opção reescrever o passado.
    expect(motivoParaGravar({ chave: "TRIMESTRAL_FORA_DO_MES" }))
      .toBe("[TRIMESTRAL_FORA_DO_MES] Tributo trimestral — mês sem apuração");
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
