// AS AÇÕES EM LOTE, SOBRE UMA SELEÇÃO — o que se aplica, e por que não se aplica ao resto.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// O pedido do dono foi *"selecionando as empresas e enviando todas as guias que nessas empresas
// estão contidas"*, e as regras que ele impôs são todas sobre NÃO AFIRMAR o que não se sabe:
//
//   1. ato irreversível confirma repetindo os dados;
//   2. a consulta paga não pode ser furada nem gasta por engano;
//   3. número na tela sai de dado real — na dúvida, não mostrar;
//   4. ação que não se aplica NÃO SOME: fica desabilitada COM o motivo.
//
// Testa-se a REGRA. A ligação (barra, prévia, tabela) tem teste próprio em `../../components/`.

import {
  ACOES, ORDEM_ACOES, acaoDoPlano, planoDaSelecao, guiasPendentesDeEnvio,
  resumoEnvioDoRelatorio, fraseDeConfirmacao, formatarCompetencia, HORAS_TRAVA_SITFIS,
} from "../acoesDaSelecao";

const HORA = 3600000;
const AGORA = new Date("2026-08-17T12:00:00Z").getTime();

function empresa(over = {}) {
  return {
    companyId: "c1",
    razao: "ACME LTDA",
    legacyCompany: { regimeTributario: "SIMPLES", certStorageKey: "k", certExpiresAt: "2099-01-01" },
    guideCompliance: { das: { required: true, state: "gerada", ok: true, guideId: "g1" } },
    apuracao: { apurada: false },
    fiscalCheckedAt: new Date(AGORA - 40 * HORA).toISOString(),
    ...over,
  };
}

const plano = (empresas, extra = {}) =>
  planoDaSelecao({ empresas, competencia: "2026-07", agora: AGORA, ...extra });

describe("nenhuma ação some da barra — ela fica desabilitada COM o motivo", () => {
  test("as cinco ações existem sempre, mesmo sem seleção nenhuma", () => {
    const p = plano([]);
    expect(p.acoes.map((a) => a.chave)).toEqual(ORDEM_ACOES);
    for (const a of p.acoes) {
      expect(a.disponivel).toBe(false);
      // ⚠ Desabilitado sem explicação é proibido neste projeto.
      expect(a.motivo).toEqual(expect.any(String));
      expect(a.motivo.length).toBeGreaterThan(0);
    }
  });

  test("toda ação indisponível carrega motivo — nunca `null`", () => {
    const p = plano([empresa({ legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO" } })]);
    for (const a of p.acoes.filter((x) => !x.disponivel)) {
      expect(a.motivo).toBeTruthy();
    }
  });
});

describe("apurar — o Lucro Presumido é DITO, não escondido", () => {
  test("empresa do Presumido fica de fora, e o motivo nomeia o regime", () => {
    const lp = empresa({ companyId: "lp", razao: "LP LTDA", legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO", certStorageKey: "k" } });
    const a = acaoDoPlano(plano([lp]), "apurar");
    expect(a.alvos).toHaveLength(0);
    expect(a.fora[0].motivo).toMatch(/Lucro Presumido/i);
    expect(a.disponivel).toBe(false);
    expect(a.motivo).toMatch(/nenhuma das 1 empresa selecionada se aplica/);
  });

  test("regime NÃO CADASTRADO não vira Simples por default — a regra diz que não sabe", () => {
    // Espelha `estadoApuracao`/`obrigatoriedadeDefis`: ausência de regime é o terceiro estado, não
    // um "provavelmente Simples". Apurar por suposição transmite declaração errada.
    const semRegime = empresa({ companyId: "x", legacyCompany: { certStorageKey: "k" } });
    const a = acaoDoPlano(plano([semRegime]), "apurar");
    expect(a.fora[0].motivo).toMatch(/regime não cadastrado/i);
  });

  test("empresa JÁ apurada fica de fora — reapurar em lote geraria retificadora", () => {
    const a = acaoDoPlano(plano([empresa({ apuracao: { apurada: true } })]), "apurar");
    expect(a.alvos).toHaveLength(0);
    expect(a.fora[0].motivo).toMatch(/retificadora/i);
  });

  test("Simples ainda não apurada entra, e o alvo AVISA que o servidor revalida", () => {
    const a = acaoDoPlano(plano([empresa()]), "apurar");
    expect(a.alvos).toHaveLength(1);
    // ⚠ Regra 3: a listagem NÃO sabe se a apuração está "fechada" (é o que `criarBatchJob` exige).
    // Em vez de inventar elegibilidade, o alvo declara que quem decide é o servidor.
    expect(a.alvos[0].detalhe).toMatch(/apuração fechada/i);
    expect(a.irreversivel).toBe(true);
  });
});

describe("capturar notas — sem A1 da própria empresa o ADN recusa", () => {
  test.each([
    ["sem certificado", { certStorageKey: null }, /sem certificado A1/i],
    ["certificado vencido", { certStorageKey: "k", certExpiresAt: "2020-01-01" }, /vencido/i],
  ])("%s fica de fora com o motivo", (_nome, legacy, esperado) => {
    const c = empresa({ legacyCompany: { regimeTributario: "SIMPLES", ...legacy } });
    const a = acaoDoPlano(plano([c]), "capturarNotas");
    expect(a.alvos).toHaveLength(0);
    expect(a.fora[0].motivo).toMatch(esperado);
  });

  test("com A1 válido entra", () => {
    expect(acaoDoPlano(plano([empresa()]), "capturarNotas").alvos).toHaveLength(1);
  });
});

describe("situação fiscal — o ZIP não é a consulta paga, e a janela de 4 h é DITA", () => {
  test("⚠ o download do SITFIS é declarado como NÃO PAGO — ele zipa o que já está salvo", () => {
    // A confusão custa caro: `POST /firm/sitfis-download` monta um ZIP dos PDFs armazenados e não
    // fala com o SERPRO. A consulta paga (com a trava de 4 h) é outra rota, por empresa.
    expect(ACOES.baixarSitfis.irreversivel).toBe(false);
    expect(ACOES.baixarSitfis.descricao).toMatch(/não consulta o SERPRO/i);
  });

  test("empresa NUNCA CONSULTADA fica de fora — não há relatório para zipar", () => {
    const a = acaoDoPlano(plano([empresa({ fiscalCheckedAt: null })]), "baixarSitfis");
    expect(a.alvos).toHaveLength(0);
    expect(a.fora[0].motivo).toMatch(/nunca consultada/i);
  });

  test(`consultada dentro das ${HORAS_TRAVA_SITFIS} h aparece com a janela nomeada`, () => {
    const recente = empresa({ fiscalCheckedAt: new Date(AGORA - 1 * HORA).toISOString() });
    const a = acaoDoPlano(plano([recente]), "baixarSitfis");
    expect(a.alvos[0].detalhe).toMatch(new RegExp(`menos de ${HORAS_TRAVA_SITFIS} h`));
  });
});

describe("um processo rodando não pode ser disparado duas vezes", () => {
  test("com job ativo, só as ações que criam JOB são bloqueadas — e o motivo cita o processo", () => {
    const p = plano([empresa()], { jobsAtivos: 2 });
    for (const chave of ["capturarNotas", "baixarNotas", "baixarSitfis"]) {
      const a = acaoDoPlano(p, chave);
      expect(a.disponivel).toBe(false);
      expect(a.motivo).toMatch(/2 processos em segundo plano/);
    }
    // ⚠ O envio de e-mail é chamada BLOQUEANTE e nunca aparece em `/firm/jobs/ativos` — bloqueá-lo
    // por causa de um download de notas seria travar por um sinal que não fala dele.
    expect(acaoDoPlano(p, "email").disponivel).toBe(true);
  });

  test("sem job ativo nada é bloqueado por este motivo", () => {
    const p = plano([empresa()], { jobsAtivos: 0 });
    expect(acaoDoPlano(p, "baixarNotas").disponivel).toBe(true);
  });
});

describe("guias pendentes de envio — os estados terminais não contam", () => {
  test.each([
    ["gerada", 1], ["falhou", 1], ["enviada", 0], ["vazio", 0], ["missing", 0],
  ])("estado %s conta %i", (state, esperado) => {
    const c = empresa({ guideCompliance: { das: { required: true, state, ok: true } } });
    expect(guiasPendentesDeEnvio(c)).toHaveLength(esperado);
  });

  test("empresa ZERADA não tem guia — e o motivo diz isso, não 'todas enviadas'", () => {
    const z = empresa({ empresaZerada: true });
    expect(guiasPendentesDeEnvio(z)).toHaveLength(0);
    expect(acaoDoPlano(plano([z]), "email").fora[0].motivo).toMatch(/zerada/i);
  });

  test("todas terminais → motivo diferente de 'falta apurar'", () => {
    const c = empresa({ guideCompliance: { das: { required: true, state: "enviada", ok: true } } });
    expect(acaoDoPlano(plano([c]), "email").fora[0].motivo).toMatch(/já estão enviadas/i);
  });

  test("⚠ a leitura local NÃO tranca o envio — quem decide é o relatório", () => {
    // Com `alvos` gateando o botão, um `guideCompliance` velho na tela ("todas já enviadas")
    // fechava a porta ANTES de o relatório poder ser lido, e o contador ficava sem caminho para
    // uma guia que de fato estava pendente. As outras quatro continuam gateadas: para elas a
    // listagem é a única fonte.
    const c = empresa({ guideCompliance: { das: { required: true, state: "enviada", ok: true } } });
    const p = plano([c]);
    expect(acaoDoPlano(p, "email").disponivel).toBe(true);
    expect(acaoDoPlano(p, "email").alvos).toHaveLength(0); // a leitura local segue disponível p/ motivos
    // Sem seleção nenhuma, aí sim: não há o que enviar.
    expect(acaoDoPlano(plano([]), "email").disponivel).toBe(false);
  });

  test("nenhuma guia gerada → o motivo aponta para a apuração", () => {
    const c = empresa({ guideCompliance: { das: { required: true, state: "missing", ok: false } } });
    expect(acaoDoPlano(plano([c]), "email").fora[0].motivo).toMatch(/falta apurar/i);
  });
});

describe("⚠ A PRÉVIA DO ENVIO SAI DO RELATÓRIO, e relatório ausente NÃO vira zero", () => {
  const REPORT = {
    competencia: "2026-07",
    simples: [{
      portalClientId: "c1", razao: "ACME LTDA", cnpj: "1", competencia: "2026-07",
      tiposGuias: { DAS: { guideId: "g1" }, INSS: { guideId: "g2", emailStatus: "SENT" } },
      pendingGuideIds: ["g1"],
    }],
    presumidos: [{
      portalClientId: "c2", razao: "BETA LTDA", cnpj: "2", competencia: "2026-07",
      tiposGuias: { IRPJ: { guideId: "g3" }, CSLL: { guideId: "g4" } },
      pendingGuideIds: ["g3", "g4"],
    }],
    outros: [],
  };

  test("conta as guias PENDENTES por empresa e soma o total", () => {
    const r = resumoEnvioDoRelatorio(REPORT, ["c1", "c2"], "2026-07");
    expect(r.conhecido).toBe(true);
    expect(r.totalEmpresas).toBe(2);
    expect(r.totalGuias).toBe(3);
    // Linha a linha: cada empresa diz QUAIS tributos vão. `INSS` já enviada não entra.
    expect(r.linhas.find((l) => l.companyId === "c1").tributos).toEqual(["DAS"]);
  });

  test("⚠ sem relatório, `conhecido` é FALSO — não existe '0 guias' fabricado", () => {
    const r = resumoEnvioDoRelatorio(null, ["c1"], "2026-07");
    expect(r.conhecido).toBe(false);
    expect(r.linhas).toHaveLength(0);
  });

  test("empresa ausente do relatório vira EXCLUSÃO nomeada, não uma linha com zero", () => {
    const r = resumoEnvioDoRelatorio(REPORT, ["c1", "c9"], "2026-07");
    expect(r.linhas.map((l) => l.companyId)).toEqual(["c1"]);
    expect(r.fora).toEqual([{ companyId: "c9", razao: null, motivo: expect.stringMatching(/não aparece no relatório/i) }]);
  });

  test("empresa com zero pendentes fica de fora com o motivo próprio", () => {
    const semPendente = { ...REPORT, simples: [{ ...REPORT.simples[0], pendingGuideIds: [] }] };
    const r = resumoEnvioDoRelatorio(semPendente, ["c1"], "2026-07");
    expect(r.fora[0].motivo).toMatch(/nenhuma guia pendente/i);
  });

  test("⚠ a COMPETÊNCIA da linha manda, não a que pedimos — linha de outro mês é descartada", () => {
    const outroMes = { ...REPORT, simples: [{ ...REPORT.simples[0], competencia: "2026-06" }], presumidos: [] };
    expect(resumoEnvioDoRelatorio(outroMes, ["c1"], "2026-07").linhas).toHaveLength(0);
  });
});

describe("a confirmação REPETE os dados — 'tem certeza?' não confirma nada", () => {
  test("envio: quantas guias, de quantas empresas, em qual competência", () => {
    expect(fraseDeConfirmacao("email", { empresas: 8, guias: 23, competencia: "2026-07" }))
      .toBe("Enviar 23 guias de 8 empresas, competência 07/2026?");
  });

  test("envio com número desconhecido não inventa a contagem", () => {
    expect(fraseDeConfirmacao("email", { empresas: 8, guias: null, competencia: "2026-07" }))
      .toBe("Enviar as guias de 8 empresas, competência 07/2026?");
  });

  test("apuração diz TRANSMITIR, com empresas e competência", () => {
    expect(fraseDeConfirmacao("apurar", { empresas: 1, competencia: "2026-07" }))
      .toBe("Transmitir o PGDAS-D de 1 empresa, competência 07/2026?");
  });

  test("o aviso do ato irreversível fala do efeito, não da ação", () => {
    expect(ACOES.email.aviso).toMatch(/chega ao cliente/i);
    expect(ACOES.apurar.aviso).toMatch(/Receita Federal/i);
  });

  test("competência vira 07/2026 sem passar por `Date`", () => {
    expect(formatarCompetencia("2026-07")).toBe("07/2026");
    expect(formatarCompetencia("lixo")).toBe("lixo");
  });
});
