// OS CAMPOS DE IMPOSTO DA NOTA — a regra, com os TRÊS regimes exercidos em cada caso.
//
// ⚠⚠ O defeito de produção que abriu este arquivo (20/08/2026, relatado pelo dono): a empresa do
// **Lucro Presumido** via "Alíquota efetiva do Simples (%)" no formulário de emissão. O campo era
// renderizado sem nenhuma condição de regime.
//
// ⚠ Cada caso mede os DOIS lados — quem vê e quem NÃO vê —, e o `null` do payload é medido junto:
// campo escondido que continua viajando é o defeito pior, e um teste que só olhasse a tela passaria
// com o corpo errado.

import {
  REGIME,
  lerRegime,
  camposDeImposto,
  conferirAliquotaIss,
  conferirPTotTribSN,
  aliquotaIssParaOPayload,
  pTotTribSNParaOPayload,
} from "../impostosDaNota";

const empresaCom = (regimeTributario) => ({ legacyCompany: { regimeTributario } });

describe("lerRegime — três estados, e o terceiro não é 'não'", () => {
  test.each([
    ["SIMPLES_NACIONAL", REGIME.SIMPLES],
    ["SIMPLES", REGIME.SIMPLES],
    ["simples nacional", REGIME.SIMPLES],
    ["LUCRO_PRESUMIDO", REGIME.OUTRO],
    ["LUCRO PRESUMIDO", REGIME.OUTRO],
    ["LUCRO_REAL", REGIME.OUTRO],
  ])("%s ⇒ %s", (bruto, esperado) => {
    expect(lerRegime(empresaCom(bruto))).toBe(esperado);
  });

  test("⚠ ausente, vazio ou irreconhecível é DESCONHECIDO — nunca cai no Simples por omissão", () => {
    expect(lerRegime(empresaCom(""))).toBe(REGIME.DESCONHECIDO);
    expect(lerRegime(empresaCom(null))).toBe(REGIME.DESCONHECIDO);
    expect(lerRegime({ legacyCompany: null })).toBe(REGIME.DESCONHECIDO);
    expect(lerRegime(undefined)).toBe(REGIME.DESCONHECIDO);
    expect(lerRegime(empresaCom("MEI"))).toBe(REGIME.DESCONHECIDO);
  });

  test("⚠ `optanteSimples` NÃO é lido — eleger aqui uma autoridade que o backend não tem faz as pontas discordarem", () => {
    expect(lerRegime({ legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO", optanteSimples: true } }))
      .toBe(REGIME.OUTRO);
    expect(lerRegime({ legacyCompany: { optanteSimples: true } })).toBe(REGIME.DESCONHECIDO);
  });
});

describe("⚠⚠ `pTotTribSN` — SÓ no Simples, e a guarda vale nos DOIS lados", () => {
  test("Simples DECLARA", () => {
    expect(camposDeImposto({ regime: REGIME.SIMPLES }).pTotTribSNNoFormulario).toBe(true);
  });

  test("⚠ não optante NÃO declara — é o defeito relatado em produção", () => {
    expect(camposDeImposto({ regime: REGIME.OUTRO }).pTotTribSNNoFormulario).toBe(false);
  });

  test("⚠⚠ regime INDEFINIDO também NÃO declara — 'é do Simples' é o default silencioso que este projeto proíbe", () => {
    expect(camposDeImposto({ regime: REGIME.DESCONHECIDO }).pTotTribSNNoFormulario).toBe(false);
  });

  test("⚠ o valor VIAJA no Simples", () => {
    expect(pTotTribSNParaOPayload({ regime: REGIME.SIMPLES, pTotTribSN: "6" })).toBe(6);
    expect(pTotTribSNParaOPayload({ regime: REGIME.SIMPLES, pTotTribSN: "6,00" })).toBe(null); // vírgula não é número
    expect(pTotTribSNParaOPayload({ regime: REGIME.SIMPLES, pTotTribSN: "6.24" })).toBe(6.24);
  });

  test("⚠⚠ e NÃO viaja fora dele — nem com o campo preenchido no estado do formulário", () => {
    // O caso real: o efeito da alíquota efetiva preencheu `pTotTribSN`, e só DEPOIS a empresa (ou o
    // regime) mudou. "Não aparece na tela" nunca foi garantia de "não está no corpo".
    expect(pTotTribSNParaOPayload({ regime: REGIME.OUTRO, pTotTribSN: "6" })).toBe(null);
    expect(pTotTribSNParaOPayload({ regime: REGIME.DESCONHECIDO, pTotTribSN: "6" })).toBe(null);
  });

  test("⚠ campo vazio no Simples é `null` (não mandar), nunca 0 — 0% numa nota é uma AFIRMAÇÃO", () => {
    expect(pTotTribSNParaOPayload({ regime: REGIME.SIMPLES, pTotTribSN: "" })).toBe(null);
    expect(pTotTribSNParaOPayload({ regime: REGIME.SIMPLES, pTotTribSN: "   " })).toBe(null);
    // Zero DIGITADO é outra coisa: ele viaja, porque alguém o escreveu.
    expect(pTotTribSNParaOPayload({ regime: REGIME.SIMPLES, pTotTribSN: "0" })).toBe(0);
  });
});

describe("o bloco de ISS — sai só no Simples; o indefinido MANTÉM", () => {
  test("Simples não tem bloco de ISS", () => {
    expect(camposDeImposto({ regime: REGIME.SIMPLES }).issNoFormulario).toBe(false);
  });

  test("não optante e regime indefinido têm", () => {
    expect(camposDeImposto({ regime: REGIME.OUTRO }).issNoFormulario).toBe(true);
    expect(camposDeImposto({ regime: REGIME.DESCONHECIDO }).issNoFormulario).toBe(true);
  });
});

describe("⚠⚠ a alíquota de ISS SÓ EXISTE COM RETENÇÃO", () => {
  test("caixa desmarcada ⇒ campo fora da tela", () => {
    expect(camposDeImposto({ regime: REGIME.OUTRO, issRetido: false }).aliquotaNoFormulario).toBe(false);
  });

  test("caixa marcada ⇒ campo na tela", () => {
    expect(camposDeImposto({ regime: REGIME.OUTRO, issRetido: true }).aliquotaNoFormulario).toBe(true);
    expect(camposDeImposto({ regime: REGIME.DESCONHECIDO, issRetido: true }).aliquotaNoFormulario).toBe(true);
  });

  test("⚠ no SIMPLES a caixa não existe, então a alíquota também não — nada é reintroduzido lá", () => {
    expect(camposDeImposto({ regime: REGIME.SIMPLES, issRetido: true }).aliquotaNoFormulario).toBe(false);
    expect(aliquotaIssParaOPayload({ regime: REGIME.SIMPLES, issRetido: true, aliquota: "5" })).toBe(null);
  });

  test("⚠⚠ desmarcou ⇒ o valor NÃO VIAJA, mesmo preso no estado do formulário", () => {
    expect(aliquotaIssParaOPayload({ regime: REGIME.OUTRO, issRetido: false, aliquota: "5" })).toBe(null);
  });

  test("marcada, ela viaja", () => {
    expect(aliquotaIssParaOPayload({ regime: REGIME.OUTRO, issRetido: true, aliquota: "5" })).toBe(5);
    expect(aliquotaIssParaOPayload({ regime: REGIME.OUTRO, issRetido: true, aliquota: "2.5" })).toBe(2.5);
  });
});

describe("⚠ com retenção a alíquota é OBRIGATÓRIA — e a tela diz ANTES", () => {
  test("sem retenção, nada é exigido", () => {
    expect(conferirAliquotaIss({ regime: REGIME.OUTRO, issRetido: false, aliquota: "" }).ok).toBe(true);
    expect(conferirAliquotaIss({ regime: REGIME.SIMPLES, issRetido: false, aliquota: "" }).ok).toBe(true);
  });

  test("com retenção e campo vazio, recusa com frase", () => {
    const r = conferirAliquotaIss({ regime: REGIME.OUTRO, issRetido: true, aliquota: "" });
    expect(r.ok).toBe(false);
    expect(r.falta).toMatch(/alíquota de ISS/i);
  });

  test("⚠⚠ ZERO NÃO BASTA — `buildDpsXml` exige `> 0` (NFSE_ISS_RETIDO_SEM_ALIQUOTA), e `required` do HTML deixa passar", () => {
    const r = conferirAliquotaIss({ regime: REGIME.OUTRO, issRetido: true, aliquota: "0" });
    expect(r.ok).toBe(false);
    expect(r.falta).toMatch(/maior que zero/i);
  });

  test("com retenção e alíquota positiva, passa", () => {
    expect(conferirAliquotaIss({ regime: REGIME.OUTRO, issRetido: true, aliquota: "5" })).toEqual({
      ok: true,
      falta: null,
    });
  });

  test("⚠ no Simples a conferência nunca bloqueia — o bloco inteiro saiu da tela", () => {
    expect(conferirAliquotaIss({ regime: REGIME.SIMPLES, issRetido: true, aliquota: "" }).ok).toBe(true);
  });
});

// ⚠⚠ A GUARDA QUE FALTAVA — achada em teste de usabilidade (31/08/2026).
//
// A alíquota de ISS tinha conferência local e o `pTotTribSN` não tinha: no Simples, a empresa sem
// alíquota apurada preenchia a nota inteira e só descobria a recusa ao clicar em EMITIR.
//
// ⚠⚠ O CASO QUE MAIS IMPORTA AQUI É O ZERO, e ele separa esta regra da irmã: o servidor recusa
// `pTotTribSN` ausente/NaN/`< 0` (`NfseService.js:626`) e **aceita zero**; a alíquota de ISS, essa,
// é exigida `> 0` (`:766`). Copiar o critério do ISS faria a tela recusar nota que o sistema
// nacional aceita.
describe("⚠⚠ o `pTotTribSN` tem guarda local, e o critério é o DO SERVIDOR", () => {
  it("no Simples, campo vazio NÃO emite — e a frase diz que a recusa viria de qualquer jeito", () => {
    const r = conferirPTotTribSN({ regime: REGIME.SIMPLES, pTotTribSN: "" });
    expect(r.ok).toBe(false);
    expect(r.falta).toMatch(/al[íi]quota efetiva do Simples/i);
  });

  it("⚠⚠ ZERO PASSA — é o que `NfseService.js:626` aceita (`< 0` é que recusa)", () => {
    expect(conferirPTotTribSN({ regime: REGIME.SIMPLES, pTotTribSN: "0" }).ok).toBe(true);
    expect(conferirPTotTribSN({ regime: REGIME.SIMPLES, pTotTribSN: "0.00" }).ok).toBe(true);
  });

  it("⚠ VÍRGULA é ausência aqui, e concorda com o payload — o campo é `type=number`", () => {
    // `percentual` não lê vírgula, e `pTotTribSNParaOPayload` devolveria `null` — ou seja, o corpo
    // sairia SEM o campo e o servidor recusaria. A guarda tem de recusar o mesmo, senão ela libera
    // exatamente o caso que existe para pegar. ⚠ Na tela isto não acontece: o `<input
    // type="number">` não aceita a vírgula. É o contrato da regra que está sendo travado.
    expect(conferirPTotTribSN({ regime: REGIME.SIMPLES, pTotTribSN: "6,24" }).ok).toBe(false);
    expect(pTotTribSNParaOPayload({ regime: REGIME.SIMPLES, pTotTribSN: "6,24" })).toBe(null);
  });

  it("negativo NÃO passa, com frase própria", () => {
    const r = conferirPTotTribSN({ regime: REGIME.SIMPLES, pTotTribSN: "-1" });
    expect(r.ok).toBe(false);
    expect(r.falta).toMatch(/negativa/i);
  });

  it("valor legítimo passa", () => {
    expect(conferirPTotTribSN({ regime: REGIME.SIMPLES, pTotTribSN: "6.24" }).ok).toBe(true);
  });

  it("⚠ texto ilegível é tratado como AUSENTE, nunca como zero", () => {
    // `Number("abc")` é NaN, e o servidor recusa NaN — a tela diz o mesmo, antes.
    expect(conferirPTotTribSN({ regime: REGIME.SIMPLES, pTotTribSN: "abc" }).ok).toBe(false);
  });

  it("⚠⚠ FORA DO SIMPLES não confere nada — o campo não existe e o grupo não viaja", () => {
    // Conferir o que não é enviado bloquearia a emissão do Presumido por um número que ninguém
    // declara. O regime INDEFINIDO entra junto, pelo mesmo motivo.
    for (const regime of [REGIME.OUTRO, REGIME.DESCONHECIDO, undefined]) {
      expect(conferirPTotTribSN({ regime, pTotTribSN: "" }).ok).toBe(true);
      expect(conferirPTotTribSN({ regime, pTotTribSN: "-99" }).ok).toBe(true);
    }
  });

  it("⚠ a guarda concorda com o que VAI no payload — as duas leem `camposDeImposto`", () => {
    // Se divergirem, existe caso em que a tela libera e o corpo não leva o campo (ou o inverso).
    for (const regime of [REGIME.SIMPLES, REGIME.OUTRO, REGIME.DESCONHECIDO]) {
      const confere = conferirPTotTribSN({ regime, pTotTribSN: "6.24" });
      const noPayload = pTotTribSNParaOPayload({ regime, pTotTribSN: "6.24" });
      expect(confere.ok).toBe(true);
      expect(noPayload === null).toBe(regime !== REGIME.SIMPLES);
    }
  });
});
