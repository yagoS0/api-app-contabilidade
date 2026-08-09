import { buildZodFromSpec, validarPasso } from "../onboardingZod";
import { rascunhoVazio } from "../onboardingSpec";

describe("buildZodFromSpec — derivado da spec, sem regra duplicada", () => {
  test("obrigatório em branco falha; opcional em branco passa", () => {
    const dados = { ...rascunhoVazio("TRANSFERENCIA") };
    const r = validarPasso("TRANSFERENCIA", dados, "responsavel");
    expect(r.ok).toBe(false);
    expect(r.erros.responsavelNome).toBeTruthy();
    // `responsavelCargo` é opcional e está vazio — não pode aparecer como erro
    expect(r.erros.responsavelCargo).toBeUndefined();
  });

  // ⚠ A regressão que este teste guarda: sem `.or(z.literal(""))`, um campo OPCIONAL em branco cai
  // na validação de formato (`.email()`, `.regex()`) e derruba o SCHEMA INTEIRO — inclusive os
  // campos que estavam certos.
  test("campo opcional em branco NÃO derruba o schema inteiro", () => {
    const dados = {
      ...rascunhoVazio("TRANSFERENCIA"),
      responsavelNome: "Maria",
      responsavelEmail: "maria@x.com",
      responsavelTelefone: "11999990000",
      responsavelCargo: "", // em branco, e é uma STRING
    };
    const r = validarPasso("TRANSFERENCIA", dados, "responsavel");
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual({});
  });

  test("mesAno opcional em branco passa; preenchido errado falha", () => {
    const base = { ...rascunhoVazio("TRANSFERENCIA"), regimeAtual: "SIMPLES" };
    expect(validarPasso("TRANSFERENCIA", { ...base, ultimaCompetenciaEntregue: "" }, "situacao").ok).toBe(true);
    const ruim = validarPasso("TRANSFERENCIA", { ...base, ultimaCompetenciaEntregue: "03/2026" }, "situacao");
    expect(ruim.ok).toBe(false);
    expect(ruim.erros.ultimaCompetenciaEntregue).toMatch(/AAAA-MM/);
  });

  test("CNPJ exige 14 dígitos, com ou sem máscara", () => {
    const base = { ...rascunhoVazio("TRANSFERENCIA"), razaoSocial: "X LTDA", tipoEmpresa: "LTDA" };
    expect(validarPasso("TRANSFERENCIA", { ...base, cnpj: "11.222.333/0001-81" }, "identificacao").ok).toBe(true);
    expect(validarPasso("TRANSFERENCIA", { ...base, cnpj: "11222333000181" }, "identificacao").ok).toBe(true);
    const curto = validarPasso("TRANSFERENCIA", { ...base, cnpj: "112223" }, "identificacao");
    expect(curto.ok).toBe(false);
    expect(curto.erros.cnpj).toMatch(/14/);
  });

  test("e-mail inválido é apontado no campo certo", () => {
    const dados = {
      ...rascunhoVazio("ABERTURA"),
      responsavelNome: "Ana", responsavelTelefone: "11999990000", responsavelEmail: "ana@",
    };
    const r = validarPasso("ABERTURA", dados, "responsavel");
    expect(r.ok).toBe(false);
    expect(Object.keys(r.erros)).toEqual(["responsavelEmail"]);
  });

  test("escolha só aceita valor da própria lista de opções", () => {
    const base = { ...rascunhoVazio("INATIVA"), paradaDesde: "2024-01", pretendeReativar: "REATIVAR" };
    expect(validarPasso("INATIVA", { ...base, regimeAtual: "SIMPLES" }, "situacao").ok).toBe(true);
    expect(validarPasso("INATIVA", { ...base, regimeAtual: "PRESUMIDÍSSIMO" }, "situacao").ok).toBe(false);
  });

  // O campo escondido não entra no schema do passo: exigir o que a tela não mostra deixaria o
  // wizard num beco.
  test("campo escondido fica fora do schema", () => {
    const escondido = buildZodFromSpec("TRANSFERENCIA", { temDebitos: false }, { passo: "situacao" });
    expect(Object.keys(escondido.shape)).not.toContain("debitosDeclarados");
    const visivel = buildZodFromSpec("TRANSFERENCIA", { temDebitos: true }, { passo: "situacao" });
    expect(Object.keys(visivel.shape)).toContain("debitosDeclarados");
  });

  test("sem `passo`, o schema cobre a origem inteira", () => {
    const schema = buildZodFromSpec("ABERTURA", rascunhoVazio("ABERTURA"));
    expect(Object.keys(schema.shape)).toContain("atividadePretendida");
    expect(Object.keys(schema.shape)).toContain("responsavelNome");
  });

  // A poda roda antes; enquanto isso o rascunho pode carregar resíduo. Recusar aqui transformaria
  // "campo que sobrou" em erro de formulário.
  test("chave extra no rascunho não invalida o passo", () => {
    const dados = {
      ...rascunhoVazio("ABERTURA"),
      responsavelNome: "Ana", responsavelEmail: "a@x.com", responsavelTelefone: "11999990000",
      campoQueSobrouDaOutraOrigem: "lixo",
    };
    expect(validarPasso("ABERTURA", dados, "responsavel").ok).toBe(true);
  });

  test("booleano não aceita string vazia disfarçada de resposta", () => {
    const schema = buildZodFromSpec("TRANSFERENCIA", { temDebitos: null }, { passo: "situacao" });
    expect(schema.shape.temDebitos.safeParse("").success).toBe(false);
    expect(schema.shape.temDebitos.safeParse(null).success).toBe(true);
    expect(schema.shape.temDebitos.safeParse(true).success).toBe(true);
  });
});
