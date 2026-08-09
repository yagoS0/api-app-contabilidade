import {
  ONBOARDING_STATUS,
  colunasDoQuadro,
  estiloDoStatus,
  statusDoOnboarding,
} from "../onboardingStatus";

describe("statusDoOnboarding", () => {
  test("resolve os cinco status, ignorando caixa e espaços", () => {
    expect(statusDoOnboarding("recebido").chave).toBe("RECEBIDO");
    expect(statusDoOnboarding(" EM_TRILHA ").chave).toBe("EM_TRILHA");
    expect(statusDoOnboarding("CONVERTIDO").chave).toBe("CONVERTIDO");
    expect(statusDoOnboarding("DESISTIU").chave).toBe("DESISTIU");
    expect(statusDoOnboarding("RASCUNHO").chave).toBe("RASCUNHO");
  });

  // ⚠ Status novo do backend não pode se esconder dentro de uma coluna legítima.
  test("status desconhecido vira estado próprio, não cai em EM_TRILHA", () => {
    expect(statusDoOnboarding("QUALQUER_COISA").chave).toBe("DESCONHECIDO");
    expect(statusDoOnboarding(null).chave).toBe("DESCONHECIDO");
    expect(statusDoOnboarding(undefined).chave).toBe("DESCONHECIDO");
  });
});

describe("a regra de ouro dos tokens", () => {
  test("todo status tem ÍCONE além da cor", () => {
    for (const s of Object.values(ONBOARDING_STATUS)) {
      expect(String(s.icone || "").length).toBeGreaterThan(0);
    }
  });

  test("nenhum status usa --state-danger: nada aqui bloqueia fechamento contábil", () => {
    for (const s of Object.values(ONBOARDING_STATUS)) {
      expect(s.token).not.toBe("--state-danger");
      expect(s.surface).not.toBe("--state-danger-surface");
    }
  });

  test("RECEBIDO é o único que grita — é a coluna do 'alguém precisa pegar'", () => {
    expect(ONBOARDING_STATUS.RECEBIDO.token).toBe("--state-warn");
    // o estado normal e majoritário é neutro; colorir o normal faz o RECEBIDO parar de se destacar
    expect(ONBOARDING_STATUS.EM_TRILHA.token).toBe("--state-neutral");
  });

  test("DESISTIU é 'fora do fluxo', igual a mês fechado — não é erro", () => {
    expect(ONBOARDING_STATUS.DESISTIU.token).toBe("--state-closed");
  });

  test("CONVERTIDO é o verde de concluído", () => {
    expect(ONBOARDING_STATUS.CONVERTIDO.token).toBe("--state-ok");
  });
});

describe("colunasDoQuadro", () => {
  test("rascunho fica FORA do quadro (é bandeja, não coluna)", () => {
    expect(colunasDoQuadro().map((c) => c.chave)).toEqual([
      "RECEBIDO", "EM_TRILHA", "CONVERTIDO", "DESISTIU",
    ]);
  });
});

describe("estiloDoStatus", () => {
  test("só devolve `var(--token)` — nunca hex concatenado", () => {
    for (const chave of Object.keys(ONBOARDING_STATUS)) {
      const estilo = estiloDoStatus(chave);
      expect(estilo.color).toMatch(/^var\(--[a-z-]+\)$/);
      expect(estilo.borderColor).toMatch(/^var\(--[a-z-]+\)$/);
      // ⚠ `${cor}22` produz cor inválida que o browser descarta em silêncio.
      expect(estilo.background).not.toMatch(/#/);
      expect(estilo.background === "transparent" || /^var\(--[a-z-]+\)$/.test(estilo.background)).toBe(true);
    }
  });

  test("rascunho não ganha surface — não deve ter peso de cartão de trabalho", () => {
    expect(estiloDoStatus("RASCUNHO").background).toBe("transparent");
  });
});
