// A TRADUÇÃO É METADE DA F3 — e é isto que estes testes travam.
//
// Três coisas, nesta ordem de importância:
//   1. código desconhecido passa CRU E NOMEADO (nunca "erro desconhecido" mudo, nunca adivinhado);
//   2. retentável × definitivo só é afirmado quando a FONTE afirma — o resto fica na terceira lista;
//   3. o que o contador lê diz o que aconteceu E o que fazer.
//
// Módulo puro: sem prisma, sem config, sem rede.

import {
  BASE_DA_RETENTATIVA,
  CODIGOS_DEFINITIVOS,
  CODIGOS_LOCAIS,
  CODIGOS_RETENTAVEIS,
  CODIGOS_SEM_CLASSIFICACAO,
  ERROS_META,
  PROCEDENCIA,
  RETENTATIVA,
  TRADUCAO_DO_ESQUELETO_DO_DONO,
  codigoNomeado,
  podeTentarDeNovo,
  traduzirErroMeta,
  traduzirFalhaDeTransporte,
} from "../errosMeta.js";

/** O envelope como a Meta documenta: `{ error: { message, type, code, error_data, fbtrace_id } }`. */
function respostaDaMeta(code, extras = {}) {
  return {
    error: {
      message: extras.message ?? `(#${code}) Erro`,
      type: "OAuthException",
      code,
      error_data: { messaging_product: "whatsapp", details: extras.details ?? "" },
      fbtrace_id: extras.fbtrace_id ?? "Az1bC2dE3",
      ...(extras.error_subcode !== undefined ? { error_subcode: extras.error_subcode } : {}),
    },
  };
}

describe("o erro chega em linguagem do contador", () => {
  it("131047 não chega como '(#131047) Re-engagement message' — diz a janela E o que fazer", () => {
    const t = traduzirErroMeta(respostaDaMeta(131047), { httpStatus: 429 });
    expect(t.traduzido).toBe(true);
    expect(t.codigo).toBe("META_131047");
    expect(t.mensagemUsuario).toMatch(/24 horas/i);
    expect(t.mensagemUsuario).toMatch(/template/i);
    // "o que fazer" não é opcional: sem isso a tradução só troca um jargão por outro.
    expect(t.mensagemUsuario).toMatch(/responder|reabre/i);
  });

  it("⚠ 131047 vem com HTTP 429 como os limites de vazão — e mesmo assim NÃO é retentável", () => {
    // É o caso que prova por que a retentativa não pôde ser derivada do status HTTP: esperar não
    // reabre a janela. Derivando do 429, o lote ficaria reenviando texto livre para sempre.
    expect(ERROS_META[131047].httpStatus).toBe(429);
    expect(ERROS_META[131047].retentativa).toBe(RETENTATIVA.NAO);
    expect(ERROS_META[131047].baseDaRetentativa).toBe(BASE_DA_RETENTATIVA.DOCUMENTADA);
    expect(CODIGOS_RETENTAVEIS).not.toContain(131047);
  });

  it("nenhuma tradução é muda: toda entrada da tabela tem mensagem, título e procedência", () => {
    for (const [codigo, linha] of Object.entries(ERROS_META)) {
      expect(String(linha.mensagemUsuario || "").length).toBeGreaterThan(20);
      expect(linha.titulo).toBeTruthy();
      expect(Object.values(PROCEDENCIA)).toContain(linha.procedencia);
      expect(Object.values(RETENTATIVA)).toContain(linha.retentativa);
      expect(Object.values(BASE_DA_RETENTATIVA)).toContain(linha.baseDaRetentativa);
      expect(codigoNomeado(codigo)).toBe(`META_${codigo}`);
    }
  });
});

describe("⚠ código desconhecido passa CRU E NOMEADO", () => {
  it("não vira 'erro desconhecido': o número e o texto da Meta viajam inteiros", () => {
    const t = traduzirErroMeta(
      respostaDaMeta(999999, { message: "(#999999) Something new", details: "detalhe novo da Meta" }),
      { httpStatus: 400 },
    );
    expect(t.traduzido).toBe(false);
    expect(t.codigo).toBe("META_999999");
    expect(t.codigoMeta).toBe(999999);
    expect(t.mensagemUsuario).toContain("999999");
    expect(t.mensagemUsuario).toContain("detalhe novo da Meta");
    expect(t.detalheDaMeta).toContain("detalhe novo da Meta");
  });

  it("não é adivinhado por semelhança de faixa — 131099 não vira 'algo de janela'", () => {
    const t = traduzirErroMeta(respostaDaMeta(131099), { httpStatus: 400 });
    expect(t.traduzido).toBe(false);
    expect(t.onde).toBeNull();
    expect(t.mensagemUsuario).not.toMatch(/janela/i);
  });

  it("desconhecido NÃO é classificado como retentável nem como definitivo", () => {
    const t = traduzirErroMeta(respostaDaMeta(999999), { httpStatus: 400 });
    expect(t.retentativa).toBe(RETENTATIVA.NAO_DOCUMENTADA);
    expect(podeTentarDeNovo(t)).toBeNull();
  });

  it("o fbtrace_id sobe junto — é com ele que se abre chamado na Meta", () => {
    const t = traduzirErroMeta(respostaDaMeta(999999, { fbtrace_id: "TRACE-XYZ" }), { httpStatus: 400 });
    expect(t.fbtraceId).toBe("TRACE-XYZ");
    expect(t.mensagemUsuario).toContain("TRACE-XYZ");
  });

  it("resposta SEM código não é confundida com erro desconhecido — tem nome próprio", () => {
    const t = traduzirErroMeta({ algo: "que não é o formato documentado" }, { httpStatus: 502 });
    expect(t.codigo).toBe(CODIGOS_LOCAIS.RESPOSTA_NAO_RECONHECIDA);
    expect(t.codigoMeta).toBeNull();
    expect(t.mensagemUsuario).toMatch(/não veio no formato/i);
  });

  it("corpo nulo (resposta vazia) também responde, e não estoura", () => {
    const t = traduzirErroMeta(null, { httpStatus: 500 });
    expect(t.codigo).toBe(CODIGOS_LOCAIS.RESPOSTA_NAO_RECONHECIDA);
    expect(t.mensagemUsuario).toContain("500");
  });
});

describe("retentável × definitivo — e a terceira lista, que é o ponto", () => {
  it("limite de vazão passa sozinho: 4, 80007, 130429 e 131056 são retentáveis", () => {
    for (const c of [4, 80007, 130429, 131056]) {
      expect(CODIGOS_RETENTAVEIS).toContain(c);
      expect(podeTentarDeNovo(traduzirErroMeta(respostaDaMeta(c)))).toBe(true);
    }
  });

  it("número sem WhatsApp NÃO melhora com retentativa: 131026 é definitivo", () => {
    expect(CODIGOS_DEFINITIVOS).toContain(131026);
    expect(podeTentarDeNovo(traduzirErroMeta(respostaDaMeta(131026)))).toBe(false);
  });

  it("131050 é o único em que a fonte PROÍBE reenviar, e a mensagem diz isso", () => {
    const t = traduzirErroMeta(respostaDaMeta(131050));
    expect(t.retentativa).toBe(RETENTATIVA.NAO);
    expect(t.mensagemUsuario).toMatch(/NÃO reenviar/);
    expect(t.solucaoDocumentada).toMatch(/Do not retry/i);
  });

  it("⚠ 131048 fica FORA das duas listas: a fonte manda conferir qualidade, não reenviar", () => {
    // É um 429, e mesmo assim não vira retentável — a solução documentada é "Check your quality
    // status in the WhatsApp Manager". Arbitrar aqui seria insistir num número já penalizado.
    expect(CODIGOS_RETENTAVEIS).not.toContain(131048);
    expect(CODIGOS_DEFINITIVOS).not.toContain(131048);
    expect(CODIGOS_SEM_CLASSIFICACAO).toContain(131048);
    expect(podeTentarDeNovo(traduzirErroMeta(respostaDaMeta(131048)))).toBeNull();
  });

  it("as três listas são disjuntas e cobrem a tabela inteira", () => {
    const todos = Object.keys(ERROS_META).map(Number).sort((a, b) => a - b);
    const uniao = [...CODIGOS_RETENTAVEIS, ...CODIGOS_DEFINITIVOS, ...CODIGOS_SEM_CLASSIFICACAO]
      .sort((a, b) => a - b);
    expect(uniao).toEqual(todos);
    expect(new Set(uniao).size).toBe(uniao.length);
  });

  it("quem afirma retentativa sem frase documentada carrega a marca de derivada do status", () => {
    for (const [, linha] of Object.entries(ERROS_META)) {
      if (linha.baseDaRetentativa === BASE_DA_RETENTATIVA.DOCUMENTADA) {
        // Só se pode dizer "documentada" quando existe a frase citada da Meta.
        expect(linha.solucaoDocumentada).toBeTruthy();
      }
    }
  });

  it("podeTentarDeNovo tem TRÊS respostas — null não é false disfarçado", () => {
    expect(podeTentarDeNovo({ retentativa: RETENTATIVA.SIM })).toBe(true);
    expect(podeTentarDeNovo({ retentativa: RETENTATIVA.NAO })).toBe(false);
    expect(podeTentarDeNovo({ retentativa: RETENTATIVA.NAO_DOCUMENTADA })).toBeNull();
    expect(podeTentarDeNovo(null)).toBeNull();
  });
});

describe("⚠ a divergência entre o esqueleto do dono e a documentação da Meta", () => {
  it("os 13 códigos do esqueleto existem todos na tabela, e vêm marcados", () => {
    for (const codigo of Object.keys(TRADUCAO_DO_ESQUELETO_DO_DONO)) {
      expect(ERROS_META[codigo]).toBeDefined();
      expect(ERROS_META[codigo].noEsqueletoDoDono).toBe(true);
    }
  });

  it("130472 NÃO é 'o contato optou por sair' — isso é o 131050", () => {
    // O esqueleto traduz 130472 com o texto documentado do 131050. A fonte oficial diz de 130472:
    // "Message was not sent as part of an experiment". Seguir o esqueleto faria o contador pedir
    // novo opt-in a quem nunca pediu para sair — e deixaria o 131050 de verdade sem tratamento.
    expect(TRADUCAO_DO_ESQUELETO_DO_DONO[130472]).toMatch(/optou por não receber/i);

    const t = traduzirErroMeta(respostaDaMeta(130472));
    expect(t.mensagemUsuario).toMatch(/experimento/i);
    expect(t.mensagemUsuario).not.toMatch(/optou/i);
    expect(t.divergeDoEsqueleto).toBeTruthy();

    // E o significado que o esqueleto deu ao 130472 continua existindo — no código certo.
    expect(traduzirErroMeta(respostaDaMeta(131050)).mensagemUsuario).toMatch(/parar de receber/i);
  });

  it("toda linha da tabela declara de onde veio", () => {
    for (const [, linha] of Object.entries(ERROS_META)) {
      expect(linha.procedencia).toBe(PROCEDENCIA.META);
    }
  });
});

describe("formato do erro da Meta", () => {
  it("aceita o envelope { error: {...} } e o objeto error direto", () => {
    const envelope = traduzirErroMeta(respostaDaMeta(131026));
    const direto = traduzirErroMeta(respostaDaMeta(131026).error);
    expect(direto.codigo).toBe(envelope.codigo);
    expect(direto.traduzido).toBe(true);
  });

  it("error_data.details é mais específico que message — os dois viajam, sem repetir", () => {
    const comAmbos = traduzirErroMeta(
      respostaDaMeta(100, { message: "Invalid parameter", details: "Param to is invalid" }),
    );
    expect(comAmbos.detalheDaMeta).toBe("Invalid parameter — Param to is invalid");

    const iguais = traduzirErroMeta(respostaDaMeta(100, { message: "x", details: "x" }));
    expect(iguais.detalheDaMeta).toBe("x");
  });

  it("error_subcode é lido quando vem, e nada depende dele (depreciado na v16.0+)", () => {
    expect(traduzirErroMeta(respostaDaMeta(130429, { error_subcode: 2494055 })).subcodigoMeta)
      .toBe(2494055);
    expect(traduzirErroMeta(respostaDaMeta(130429)).subcodigoMeta).toBeNull();
  });

  it("guarda o status recebido E o documentado — divergir entre eles é sinal, e some se guardar um só", () => {
    const t = traduzirErroMeta(respostaDaMeta(131026), { httpStatus: 500 });
    expect(t.httpStatus).toBe(500);
    expect(t.httpStatusDocumentado).toBe(400);
  });

  it("toda tradução carrega a fonte com URL e data", () => {
    expect(traduzirErroMeta(respostaDaMeta(131047)).fonte).toMatch(/error-codes/);
    expect(traduzirErroMeta(respostaDaMeta(131047)).fonte).toMatch(/2026-08-14/);
  });
});

describe("⚠ falha de transporte não é 'não enviado' — é 'não se sabe'", () => {
  it("diz que a mensagem pode ter chegado, e avisa do risco de duplicar", () => {
    const t = traduzirFalhaDeTransporte(new Error("ECONNRESET"));
    expect(t.codigo).toBe(CODIGOS_LOCAIS.FALHA_DE_TRANSPORTE);
    expect(t.mensagemUsuario).toMatch(/não dá para afirmar se a mensagem chegou/i);
    expect(t.mensagemUsuario).toMatch(/duas vezes/i);
  });

  it("não é classificada como retentável: reenviar às cegas manda a guia duas vezes", () => {
    expect(podeTentarDeNovo(traduzirFalhaDeTransporte(new Error("timeout")))).toBeNull();
  });

  it("reconhece o timeout (AbortError) e diz isso ao contador", () => {
    const causa = new Error("The operation was aborted");
    causa.name = "AbortError";
    expect(traduzirFalhaDeTransporte(causa, { timeout: true }).mensagemUsuario)
      .toMatch(/tempo de resposta/i);
  });
});
