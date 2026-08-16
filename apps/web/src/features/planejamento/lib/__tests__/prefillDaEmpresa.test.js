// A LIGAÇÃO ENTRE A EMPRESA E A TELA — e as duas coisas que ela não pode perder no caminho:
// a AUSÊNCIA (que não pode virar zero) e a ORIGEM (que tem de sobreviver até o PDF).

import { prefillDaEmpresa, procedenciaDosCampos, CAMPOS_PREENCHIDOS } from "../prefillDaEmpresa";

const ok = (valor, origem) => ({ valor, apurado: true, origem, motivoAusencia: null });
const nao = (motivo) => ({ valor: null, apurado: false, origem: null, motivoAusencia: motivo });

const PAYLOAD = {
  ok: true,
  empresa: { id: "emp-1", razao: "LENTE LTDA", cnpj: "11.111.111/0001-91" },
  referencia: { competencia: "2026-07", janelaRotulo: "07/2025 a 06/2026" },
  campos: {
    receitaAnual: ok(1_200_000, "notas fiscais emitidas e autorizadas de 07/2025 a 06/2026 (140 notas)"),
    rbt12: ok(1_150_000, "apuração de 06/2026 (fechada)"),
    folhaAnual: nao("Não foi possível apurar a folha dos 12 meses."),
    regimeAtual: ok("SIMPLES_NACIONAL", "cadastro fiscal da empresa"),
    anexo: nao("Atividade sujeita ao Fator R: o anexo sai da folha."),
    sujeitoFatorR: ok(true, "cadastro fiscal da empresa"),
    aliquotaIss: ok(0.05, "perfil de atividades — CNAE 6202300 (5%)"),
    atividadePresumido: nao("O projeto não tem de-para CNAE→presunção."),
  },
};

describe("prefillDaEmpresa", () => {
  test("sem empresa é SIMULAÇÃO LIVRE — e isso não é erro", () => {
    const p = prefillDaEmpresa(null);
    expect(p.temEmpresa).toBe(false);
    expect(p.valores).toEqual({});
  });

  test("campo NÃO apurado chega como null — nunca 0, nunca string vazia", () => {
    const p = prefillDaEmpresa(PAYLOAD);
    expect(p.valores.folhaAnual).toBeNull();
    expect(p.valores.folhaAnual).not.toBe(0);
    expect(p.campos.folhaAnual.apurado).toBe(false);
    expect(p.campos.folhaAnual.motivoAusencia).toBeTruthy();
  });

  test("campo apurado carrega a origem — sem origem não há campo apurado", () => {
    const p = prefillDaEmpresa(PAYLOAD);
    expect(p.valores.rbt12).toBe(1_150_000);
    expect(p.campos.rbt12.origem).toMatch(/apuração de 06\/2026/);
  });

  test("um `apurado: true` com valor nulo (payload torto) é tratado como AUSENTE", () => {
    // Preferir a ausência ao valor: o inverso publicaria `null` como se fosse dado da empresa.
    const p = prefillDaEmpresa({ campos: { rbt12: { valor: null, apurado: true, origem: "x" } } });
    expect(p.campos.rbt12.apurado).toBe(false);
    expect(p.campos.rbt12.motivoAusencia).toBeTruthy();
  });

  test("a forma antiga (campos soltos) continua sendo lida, mas SEM inventar origem", () => {
    const p = prefillDaEmpresa({ razao: "ANTIGA LTDA", receitaAnual: 500_000, folhaAnual: null });
    expect(p.temEmpresa).toBe(true);
    expect(p.valores.receitaAnual).toBe(500_000);
    expect(p.valores.folhaAnual).toBeNull();
    expect(p.campos.receitaAnual.origem).toMatch(/origem não informada/);
  });

  test("todo campo declarado tem entrada no prefill — a tabela do PDF não pode ter buraco", () => {
    const p = prefillDaEmpresa(PAYLOAD);
    for (const { chave } of CAMPOS_PREENCHIDOS) {
      expect(p.campos[chave]).toBeDefined();
    }
  });
});

describe("procedenciaDosCampos — o que vai IMPRESSO no PDF", () => {
  const p = prefillDaEmpresa(PAYLOAD);
  const linha = (linhas, chave) => linhas.find((l) => l.chave === chave);

  test("valor intocado sai como \"da empresa\", com a origem", () => {
    const linhas = procedenciaDosCampos(p, { rbt12: 1_150_000 });
    expect(linha(linhas, "rbt12").estado).toBe("da_empresa");
    expect(linha(linhas, "rbt12").texto).toMatch(/apuração de 06\/2026/);
  });

  test("⚠ DIGITADO POR CIMA é distinguível — é o que faz dois PDFs da mesma empresa se explicarem", () => {
    const linhas = procedenciaDosCampos(p, { rbt12: 2_000_000 });
    const l = linha(linhas, "rbt12");
    expect(l.estado).toBe("digitado");
    expect(l.valor).toBe(2_000_000);
    expect(l.valorDaEmpresa).toBe(1_150_000);
    expect(l.texto).toMatch(/digitado por cima/);
    expect(l.texto).toMatch(/apuração de 06\/2026/);
  });

  test("campo da empresa APAGADO à mão não vira \"ausência de dado\"", () => {
    const linhas = procedenciaDosCampos(p, { rbt12: null });
    expect(linha(linhas, "rbt12").estado).toBe("digitado");
    expect(linha(linhas, "rbt12").texto).toMatch(/apagado à mão/);
  });

  test("a folha ausente e NÃO digitada sai como AUSENTE, com o motivo — não como zero", () => {
    const linhas = procedenciaDosCampos(p, { folhaAnual: null });
    const l = linha(linhas, "folhaAnual");
    expect(l.estado).toBe("ausente");
    expect(l.valor).toBeNull();
    expect(l.texto).toMatch(/Não foi possível apurar a folha/);
  });

  test("a folha ausente que o contador DIGITOU sai como \"informado nesta simulação\"", () => {
    const linhas = procedenciaDosCampos(p, { folhaAnual: 350_000 });
    const l = linha(linhas, "folhaAnual");
    expect(l.estado).toBe("informado");
    expect(l.valor).toBe(350_000);
    expect(l.texto).toMatch(/não veio da empresa/);
  });

  test("o centavo de diferença não conta como edição", () => {
    const linhas = procedenciaDosCampos(p, { rbt12: 1_150_000.002 });
    expect(linha(linhas, "rbt12").estado).toBe("da_empresa");
  });

  test("na SIMULAÇÃO LIVRE tudo o que foi digitado sai marcado como digitado nela", () => {
    const livre = prefillDaEmpresa(null);
    const linhas = procedenciaDosCampos(livre, { receitaAnual: 900_000, folhaAnual: null });
    expect(linha(linhas, "receitaAnual").estado).toBe("informado");
    expect(linha(linhas, "folhaAnual").estado).toBe("ausente");
  });

  test("uma linha por campo, na ordem declarada", () => {
    const linhas = procedenciaDosCampos(p, {});
    expect(linhas.map((l) => l.chave)).toEqual(CAMPOS_PREENCHIDOS.map((c) => c.chave));
  });
});
