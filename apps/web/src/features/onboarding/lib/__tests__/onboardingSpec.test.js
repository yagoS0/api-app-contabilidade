import {
  ONBOARDING_CAMPOS,
  ONBOARDING_ORIGENS,
  ONBOARDING_PASSOS,
  camposDaOrigem,
  camposDoPasso,
  descritorDe,
  ehObrigatorio,
  passosVisiveis,
  podarInvisiveis,
  problemasDoPasso,
  problemasDoRascunho,
  rascunhoVazio,
} from "../onboardingSpec";

const ORIGENS = ONBOARDING_ORIGENS.map((o) => o.chave);

describe("integridade da spec", () => {
  test("as três origens têm acento de CATEGORIA, nunca token de estado", () => {
    expect(ORIGENS).toEqual(["ABERTURA", "TRANSFERENCIA", "INATIVA"]);
    for (const origem of ONBOARDING_ORIGENS) {
      expect(origem.acento).toMatch(/^--accent-/);
      expect(origem.acento).not.toMatch(/state/);
    }
  });

  test("todo descritor aponta para um passo existente e tem rótulo", () => {
    const passos = new Set(ONBOARDING_PASSOS.map((p) => p.chave));
    for (const d of ONBOARDING_CAMPOS) {
      expect(passos.has(d.passo)).toBe(true);
      expect(String(d.rotulo || "").length).toBeGreaterThan(0);
      expect(typeof d.tipo).toBe("string");
    }
  });

  test("campo de `escolha` sempre traz opções — select vazio é campo intransponível", () => {
    for (const d of ONBOARDING_CAMPOS.filter((x) => x.tipo === "escolha")) {
      expect(Array.isArray(d.opcoes)).toBe(true);
      expect(d.opcoes.length).toBeGreaterThan(0);
    }
  });

  // O array é plano justamente para a pergunta existir uma vez só; quando o mesmo `campo` se
  // repete, é porque o RÓTULO muda por origem — e aí as origens têm de ser disjuntas, senão a
  // tela renderiza o mesmo campo duas vezes.
  test("campo repetido só existe com origens disjuntas", () => {
    const porCampo = new Map();
    for (const d of ONBOARDING_CAMPOS) {
      if (!porCampo.has(d.campo)) porCampo.set(d.campo, []);
      porCampo.get(d.campo).push(d);
    }
    for (const [campo, lista] of porCampo) {
      if (lista.length === 1) continue;
      for (const origem of ORIGENS) {
        const quantos = lista.filter((d) => !d.origens || d.origens.includes(origem)).length;
        expect(`${campo}/${origem}: ${quantos}`).toBe(`${campo}/${origem}: ${Math.min(quantos, 1)}`);
      }
    }
  });

  test("nenhuma origem tem passo sem campo nenhum (passo vazio é beco no wizard)", () => {
    for (const origem of ORIGENS) {
      for (const passo of passosVisiveis(origem)) {
        if (passo.chave === "origem") continue;
        expect(camposDoPasso(origem, passo.chave, rascunhoVazio(origem)).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("passosVisiveis", () => {
  test("sem origem escolhida existe UM passo: escolher a origem", () => {
    expect(passosVisiveis(null).map((p) => p.chave)).toEqual(["origem"]);
    expect(passosVisiveis("QUALQUER").map((p) => p.chave)).toEqual(["origem"]);
  });

  test("com origem, os cinco passos", () => {
    expect(passosVisiveis("TRANSFERENCIA").map((p) => p.chave)).toEqual([
      "origem", "identificacao", "responsavel", "situacao", "revisao",
    ]);
  });
});

describe("camposDoPasso — a origem manda", () => {
  test("abertura pergunta nome PRETENDIDO e não pergunta CNPJ", () => {
    const campos = camposDoPasso("ABERTURA", "identificacao", rascunhoVazio("ABERTURA"));
    const nomes = campos.map((c) => c.campo);
    expect(nomes).toContain("razaoSocial");
    expect(nomes).not.toContain("cnpj");
    expect(descritorDe("ABERTURA", "razaoSocial").rotulo).toBe("Nome pretendido");
  });

  test("transferência pergunta CNPJ e chama o campo de razão social", () => {
    const nomes = camposDoPasso("TRANSFERENCIA", "identificacao", rascunhoVazio("TRANSFERENCIA"))
      .map((c) => c.campo);
    expect(nomes).toContain("cnpj");
    expect(descritorDe("TRANSFERENCIA", "razaoSocial").rotulo).toBe("Razão social");
  });

  test("as três origens fazem as MESMAS perguntas de responsável", () => {
    const porOrigem = ORIGENS.map((o) =>
      camposDoPasso(o, "responsavel", rascunhoVazio(o)).map((c) => c.campo).join(",")
    );
    expect(new Set(porOrigem).size).toBe(1);
  });
});

describe("visivel — condição sobre o rascunho INTEIRO", () => {
  test("MEI e EI escondem o quadro societário; LTDA mostra", () => {
    const visivelPara = (tipoEmpresa) =>
      camposDoPasso("ABERTURA", "identificacao", { tipoEmpresa }).map((c) => c.campo).includes("socios");
    expect(visivelPara("MEI")).toBe(false);
    expect(visivelPara("EI")).toBe(false);
    expect(visivelPara("LTDA")).toBe(true);
    expect(visivelPara("")).toBe(true);
  });

  test("valor dos débitos só aparece depois de o cliente dizer que tem débitos", () => {
    const tem = (dados) =>
      camposDoPasso("TRANSFERENCIA", "situacao", dados).map((c) => c.campo).includes("debitosDeclarados");
    expect(tem({ temDebitos: null })).toBe(false);
    expect(tem({ temDebitos: false })).toBe(false);
    expect(tem({ temDebitos: true })).toBe(true);
  });
});

describe("rascunhoVazio", () => {
  test("cobre todos os campos da origem e SÓ eles", () => {
    for (const origem of ORIGENS) {
      const vazio = rascunhoVazio(origem);
      const esperados = new Set(camposDaOrigem(origem).map((c) => c.campo));
      expect(new Set(Object.keys(vazio))).toEqual(esperados);
    }
  });

  // ⚠ `null`, não `false`: "ninguém respondeu se há pró-labore" e "responderam que não há" são
  // coisas diferentes, e a segunda decide se o INSS entra nas obrigações da empresa.
  test("booleano nasce null, não false", () => {
    expect(rascunhoVazio("TRANSFERENCIA").temDebitos).toBeNull();
    expect(rascunhoVazio("TRANSFERENCIA").temProLabore).toBeNull();
  });

  test("lista nasce array vazio e é uma cópia por chamada", () => {
    const a = rascunhoVazio("ABERTURA");
    const b = rascunhoVazio("ABERTURA");
    expect(a.socios).toEqual([]);
    a.socios.push({ nome: "X" });
    expect(b.socios).toEqual([]);
  });
});

describe("podarInvisiveis — a regressão do MEI com quadro societário", () => {
  test("trocar LTDA→MEI remove os sócios que ficaram no rascunho", () => {
    const rascunho = {
      tipoEmpresa: "LTDA",
      razaoSocial: "EMPRESA X",
      socios: [{ nome: "Ana" }, { nome: "Bruno" }],
    };
    expect(podarInvisiveis("ABERTURA", rascunho).socios).toHaveLength(2);

    const viroumei = { ...rascunho, tipoEmpresa: "MEI" };
    const podado = podarInvisiveis("ABERTURA", viroumei);
    expect(podado.socios).toBeUndefined();
    expect(podado.razaoSocial).toBe("EMPRESA X");
  });

  test("desmarcar 'tem débitos' remove o valor declarado", () => {
    const com = { temDebitos: true, debitosDeclarados: "15000" };
    expect(podarInvisiveis("TRANSFERENCIA", com).debitosDeclarados).toBe("15000");
    const sem = { temDebitos: false, debitosDeclarados: "15000" };
    expect(podarInvisiveis("TRANSFERENCIA", sem).debitosDeclarados).toBeUndefined();
  });

  test("campo que não pertence à origem é removido (resíduo de troca de origem)", () => {
    const podado = podarInvisiveis("ABERTURA", { cnpj: "11222333000181", razaoSocial: "NOME" });
    expect(podado.cnpj).toBeUndefined();
    expect(podado.razaoSocial).toBe("NOME");
  });

  test("é idempotente e não inventa campo", () => {
    const uma = podarInvisiveis("INATIVA", { paradaDesde: "2024-03" });
    expect(podarInvisiveis("INATIVA", uma)).toEqual(uma);
    expect(Object.keys(uma)).toEqual(["paradaDesde"]);
  });
});

describe("problemasDoPasso", () => {
  test("aponta o obrigatório em branco, com o rótulo da tela", () => {
    const problemas = problemasDoPasso("TRANSFERENCIA", "responsavel", rascunhoVazio("TRANSFERENCIA"));
    expect(problemas.map((p) => p.campo).sort()).toEqual(
      ["responsavelEmail", "responsavelNome", "responsavelTelefone"].sort()
    );
    expect(problemas[0].rotulo).toBe("Nome do responsável");
  });

  test("passo preenchido não tem problema", () => {
    const dados = {
      ...rascunhoVazio("TRANSFERENCIA"),
      responsavelNome: "Maria",
      responsavelEmail: "maria@x.com",
      responsavelTelefone: "11999990000",
    };
    expect(problemasDoPasso("TRANSFERENCIA", "responsavel", dados)).toEqual([]);
  });

  // Campo escondido não pode ser exigido: seria uma pendência que a tela não mostra como resolver.
  test("obrigatório escondido não vira pendência", () => {
    const semDebitos = { ...rascunhoVazio("TRANSFERENCIA"), temDebitos: false };
    const campos = problemasDoPasso("TRANSFERENCIA", "situacao", semDebitos).map((p) => p.campo);
    expect(campos).not.toContain("debitosDeclarados");
  });

  test("booleano respondido 'não' conta como preenchido", () => {
    const dados = { ...rascunhoVazio("INATIVA"), paradaDesde: "2024-01", regimeAtual: "SIMPLES", pretendeReativar: "BAIXAR" };
    expect(problemasDoPasso("INATIVA", "situacao", dados)).toEqual([]);
  });

  test("problemasDoRascunho junta os passos e carimba de qual veio", () => {
    const todos = problemasDoRascunho("ABERTURA", rascunhoVazio("ABERTURA"));
    expect(todos.length).toBeGreaterThan(0);
    expect(todos.every((p) => p.passo && p.passo !== "origem")).toBe(true);
  });
});

describe("ehObrigatorio", () => {
  test("sem `obrigatorio` no descritor, o campo é opcional", () => {
    expect(ehObrigatorio(descritorDe("TRANSFERENCIA", "nomeFantasia"), {})).toBe(false);
  });
  test("com `obrigatorio`, decide a partir do rascunho inteiro", () => {
    expect(ehObrigatorio(descritorDe("TRANSFERENCIA", "cnpj"), {})).toBe(true);
  });
});
