// A REGRA DA JANELA — pura, sem prisma e sem rede.
//
// O que se trava aqui é o que custa caro na prática: a base ser a ÚLTIMA mensagem RECEBIDA (não a
// nossa resposta), o desempate para a data mais antiga quando os dois instantes discordam, e a
// diferença entre "nunca abriu" e "expirou".

import {
  avaliarJanela24h,
  instanteQueAbreAJanela,
  JANELA_MS,
  SITUACOES_JANELA,
  PERMISSOES,
  FONTES_DO_INSTANTE,
  AVISOS,
  MOTIVOS_INSTANTE_INVALIDO,
} from "../janela24h.js";

const AGORA = new Date("2026-08-14T12:00:00.000Z");
const horasAtras = (h) => new Date(AGORA.getTime() - h * 60 * 60 * 1000);

describe("as 24 horas", () => {
  it("são 24 horas em milissegundos, e não uma constante paralela", () => {
    expect(JANELA_MS).toBe(86400000);
  });

  it("dentro das 24h: ABERTA e texto livre", () => {
    const r = avaliarJanela24h({ ocorridaEmProvedor: horasAtras(2), registradaEm: horasAtras(2) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.ABERTA);
    expect(r.permite).toBe(PERMISSOES.TEXTO_LIVRE);
    expect(r.restanteMs).toBe(22 * 60 * 60 * 1000);
    expect(r.expiraEm.toISOString()).toBe(new Date(horasAtras(2).getTime() + JANELA_MS).toISOString());
  });

  it("passadas 24h: EXPIRADA e só template", () => {
    const r = avaliarJanela24h({ ocorridaEmProvedor: horasAtras(25), registradaEm: horasAtras(25) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.EXPIRADA);
    expect(r.permite).toBe(PERMISSOES.SOMENTE_TEMPLATE);
    expect(r.restanteMs).toBeLessThan(0);
  });

  it("⚠ EXATAMENTE nas 24h a janela está FECHADA — o desempate vai para o lado seguro", () => {
    // Aberta demais, a Meta recusa e o cliente não recebe NADA. Fechada demais, manda-se template.
    const r = avaliarJanela24h({ ocorridaEmProvedor: horasAtras(24), registradaEm: horasAtras(24) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.EXPIRADA);
    expect(r.restanteMs).toBe(0);
  });
});

describe("⚠ NUNCA_ABERTA não é EXPIRADA", () => {
  it("cliente que nunca escreveu: NUNCA_ABERTA, e a permissão é a mesma", () => {
    const r = avaliarJanela24h(null, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.NUNCA_ABERTA);
    expect(r.permite).toBe(PERMISSOES.SOMENTE_TEMPLATE);
    expect(r.instante).toBeNull();
    expect(r.expiraEm).toBeNull();
  });

  it("a distinção existe porque a frase da tela é outra — as duas situações têm nome próprio", () => {
    const nunca = avaliarJanela24h(null, AGORA).situacao;
    const expirada = avaliarJanela24h({ registradaEm: horasAtras(30) }, AGORA).situacao;
    expect(nunca).not.toBe(expirada);
  });

  it("objeto sem nenhum instante equivale a não haver mensagem recebida", () => {
    const r = avaliarJanela24h({ ocorridaEmProvedor: null, registradaEm: null }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.NUNCA_ABERTA);
  });
});

describe("⚠ QUAL DOS DOIS INSTANTES ABRE A JANELA", () => {
  it("com os dois presentes, vence o MAIS ANTIGO — a nossa janela fecha antes da da Meta, nunca depois", () => {
    const prov = horasAtras(23.5); // a Meta recebeu primeiro
    const nosso = horasAtras(23); // gravamos meia hora depois
    const r = avaliarJanela24h({ ocorridaEmProvedor: prov, registradaEm: nosso }, AGORA);
    expect(r.instante.toISOString()).toBe(prov.toISOString());
    expect(r.fonte).toBe(FONTES_DO_INSTANTE.PROVEDOR);
  });

  it("⚠ a regra é 'mais antigo', não 'o do provedor quando existe': provedor adiantado perde, com aviso", () => {
    const prov = horasAtras(1);
    const nosso = horasAtras(3);
    const r = avaliarJanela24h({ ocorridaEmProvedor: prov, registradaEm: nosso }, AGORA);
    expect(r.instante.toISOString()).toBe(nosso.toISOString());
    expect(r.fonte).toBe(FONTES_DO_INSTANTE.NOSSO_REGISTRO);
    expect(r.avisos).toContain(AVISOS.PROVEDOR_ADIANTADO);
  });

  it("sem instante do provedor, o nosso registro serve — e isso é DITO, não presumido", () => {
    const r = avaliarJanela24h({ registradaEm: horasAtras(2) }, AGORA);
    expect(r.fonte).toBe(FONTES_DO_INSTANTE.NOSSO_REGISTRO);
    expect(r.avisos).toContain(AVISOS.SEM_INSTANTE_DO_PROVEDOR);
  });

  it("a escolha do instante é uma função própria, exercível sozinha", () => {
    const { instante, fonte } = instanteQueAbreAJanela({
      ocorridaEmProvedor: "2026-08-14T10:00:00.000Z",
      registradaEm: "2026-08-14T10:00:05.000Z",
    });
    expect(instante.toISOString()).toBe("2026-08-14T10:00:00.000Z");
    expect(fonte).toBe(FONTES_DO_INSTANTE.PROVEDOR);
  });
});

describe("⚠ RECUSA COM MOTIVO — nada é calculado em cima de lixo", () => {
  it("número cru é RECUSADO: segundos e milissegundos são indistinguíveis aqui", () => {
    // 1749416383 lido como ms cai em 1970 e a tela mostraria 'expirada' com toda a naturalidade.
    const r = avaliarJanela24h({ ocorridaEmProvedor: 1749416383, registradaEm: horasAtras(1) }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.INSTANTE_INVALIDO);
    expect(r.motivoInvalido).toBe(MOTIVOS_INSTANTE_INVALIDO.NUMERO_CRU);
    expect(r.permite).toBe(PERMISSOES.SOMENTE_TEMPLATE);
  });

  it("texto que não é data é RECUSADO, e não vira 'nunca aberta'", () => {
    const r = avaliarJanela24h({ registradaEm: "ontem à tarde" }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.INSTANTE_INVALIDO);
    expect(r.motivoInvalido).toBe(MOTIVOS_INSTANTE_INVALIDO.NAO_E_DATA);
  });

  it("Date inválida é RECUSADA", () => {
    const r = avaliarJanela24h({ registradaEm: new Date("nada") }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.INSTANTE_INVALIDO);
  });
});

describe("⚠ O AVISO DAS CHAMADAS — a janela derivada é um PISO", () => {
  it("EXPIRADA carrega o aviso: chamada de voz do cliente também reabriria a janela na Meta", () => {
    const r = avaliarJanela24h({ registradaEm: horasAtras(30) }, AGORA);
    expect(r.avisos).toContain(AVISOS.CHAMADAS_NAO_REGISTRADAS);
  });

  it("NUNCA_ABERTA carrega o mesmo aviso", () => {
    expect(avaliarJanela24h(null, AGORA).avisos).toContain(AVISOS.CHAMADAS_NAO_REGISTRADAS);
  });

  it("ABERTA NÃO carrega — é exatamente onde ele não pode estar errado", () => {
    const r = avaliarJanela24h({ registradaEm: horasAtras(1) }, AGORA);
    expect(r.avisos).not.toContain(AVISOS.CHAMADAS_NAO_REGISTRADAS);
  });
});

describe("relógios em desacordo", () => {
  it("instante no futuro mantém a janela ABERTA, mas o desencontro sobe nomeado", () => {
    const futuro = new Date(AGORA.getTime() + 60 * 1000);
    const r = avaliarJanela24h({ ocorridaEmProvedor: futuro, registradaEm: futuro }, AGORA);
    expect(r.situacao).toBe(SITUACOES_JANELA.ABERTA);
    expect(r.avisos).toContain(AVISOS.INSTANTE_NO_FUTURO);
  });

  it("o `agora` é injetável — o teste não depende do relógio da máquina", () => {
    const fato = { registradaEm: new Date("2026-01-01T00:00:00.000Z") };
    expect(avaliarJanela24h(fato, new Date("2026-01-01T23:59:59.000Z")).situacao).toBe(SITUACOES_JANELA.ABERTA);
    expect(avaliarJanela24h(fato, new Date("2026-01-02T00:00:01.000Z")).situacao).toBe(SITUACOES_JANELA.EXPIRADA);
  });
});

describe("⚠ a janela responde SÓ pela janela", () => {
  it("não devolve nada sobre opt-in, papel ou aprovação de template", () => {
    const r = avaliarJanela24h({ registradaEm: horasAtras(1) }, AGORA);
    expect(Object.keys(r).sort()).toEqual(
      ["avisos", "expiraEm", "fonte", "instante", "motivoInvalido", "permite", "restanteMs", "situacao"].sort(),
    );
  });
});
