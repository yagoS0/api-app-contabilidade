// A REGRA DE TELA DO CICLO, sozinha — a lista e o detalhe leem ESTA, e é o teste dela que trava
// as quatro leituras que precisam ser diferentes.
//
// O defeito que originou o módulo: a lista dizia "substituída" em âmbar e, clicando na MESMA nota,
// o detalhe dizia "cancelada" em vermelho. A lista lia `ciclo`; o detalhe lia `statusEfetivo` —
// que nunca vale "substituida". Uma leitura só é o conserto; este arquivo é o que a mantém uma só.

import { lerCicloDaNota, temHistoria, SITUACAO_TOKEN, TEXTO_SEM_EVENTO } from "../cicloNotaTela";

const CH_VELHA = "3304".padEnd(50, "1");
const CH_NOVA = "3304".padEnd(50, "2");

describe("as quatro coisas que não são a mesma", () => {
  it("autorizada é verde e não tem história para contar", () => {
    const l = lerCicloDaNota({
      statusEfetivo: "autorizada",
      ciclo: { situacao: "autorizada", ehSubstituta: false, eventoRegistrado: false, avisos: [] },
    });
    expect(l.situacao).toBe("autorizada");
    expect(l.cor).toBe("var(--state-ok)");
    expect(l.semEvento).toBe(false);
    expect(temHistoria(l, [])).toBe(false);
  });

  it("cancelada COM evento é vermelha e não recebe o aviso de ausência", () => {
    const l = lerCicloDaNota({
      statusEfetivo: "cancelada",
      ciclo: {
        situacao: "cancelada", ehSubstituta: false, eventoRegistrado: true, avisos: [],
        evento: { tipo: "cancelamento", dataEvento: "2026-07-16T10:00:00.000Z", motivo: "erro de digitação" },
      },
    });
    expect(l.cor).toBe("var(--state-danger)");
    expect(l.semEvento).toBe(false);
    expect(l.evento.motivo).toBe("erro de digitação");
    expect(temHistoria(l, [])).toBe(true);
  });

  // ⚠ O quarto estado, e o mais fácil de perder: ausência não desenha nada sozinha.
  it('cancelada SEM evento diz "não temos o evento", que não é "não houve evento"', () => {
    const l = lerCicloDaNota({
      statusEfetivo: "cancelada",
      ciclo: { situacao: "cancelada", ehSubstituta: false, eventoRegistrado: false, avisos: [] },
    });
    expect(l.semEvento).toBe(true);
    expect(l.tituloAjuda).toBe(TEXTO_SEM_EVENTO);
    expect(l.tituloAjuda).toMatch(/não quer dizer que não houve evento/i);
  });

  it("substituída sai em ÂMBAR mesmo com statusEfetivo=cancelada, e aponta a substituta", () => {
    const l = lerCicloDaNota({
      statusEfetivo: "cancelada",
      ciclo: {
        situacao: "substituida", ehSubstituta: false, eventoRegistrado: true, avisos: [],
        substituidaPor: { notaId: "n2", numero: "13994", chaveAcesso: CH_NOVA, naBase: true },
        evento: { tipo: "canc_por_substituicao", dataEvento: "2026-07-16T10:30:00.000Z", motivo: "valor incorreto" },
      },
    });
    expect(l.situacao).toBe("substituida");
    expect(l.cor).toBe("var(--state-warn)");
    expect(l.substituidaPor).toEqual({ notaId: "n2", numero: "13994", chaveAcesso: CH_NOVA, naBase: true });
  });

  it("substituta é um PAPEL ao lado da situação — autorizada e substituta ao mesmo tempo", () => {
    const l = lerCicloDaNota({
      statusEfetivo: "autorizada", chaveSubstituida: CH_VELHA,
      motivoSubstituicao: "valor da nota esta incorreto",
      ciclo: {
        situacao: "autorizada", ehSubstituta: true, eventoRegistrado: false, avisos: [],
        substitui: { notaId: "n1", numero: "13993", chaveAcesso: CH_VELHA, naBase: true },
        motivoSubstituicao: "valor da nota esta incorreto",
      },
    });
    expect(l.situacao).toBe("autorizada");
    expect(l.ehSubstituta).toBe(true);
    expect(l.substitui.numero).toBe("13993");
    expect(l.motivoSubstituicao).toBe("valor da nota esta incorreto");
    // Autorizada, mas TEM história: ela declara quem substituiu.
    expect(temHistoria(l, [])).toBe(true);
    // ⚠ E não pode ser confundida com "sem evento": ela não foi cancelada.
    expect(l.semEvento).toBe(false);
  });
});

// ⚠ O motivo vive em lugares diferentes nos dois lados do vínculo — e é o MESMO motivo.
describe("o motivo da substituição, dos dois lados", () => {
  it("na substituída, o motivo vem do EVENTO (a coluna é da substituta)", () => {
    const l = lerCicloDaNota({
      statusEfetivo: "cancelada", motivoSubstituicao: null,
      ciclo: {
        situacao: "substituida", eventoRegistrado: true, motivoSubstituicao: null,
        evento: { tipo: "canc_por_substituicao", motivo: "valor da nota esta incorreto" },
      },
    });
    // Sem isto, a tela dizia "não temos este dado" com o motivo impresso na linha do evento logo
    // abaixo — contradizendo-se dentro do mesmo bloco.
    expect(l.motivoSubstituicao).toBe("valor da nota esta incorreto");
  });

  it("evento que NÃO é de substituição não empresta motivo à substituição", () => {
    const l = lerCicloDaNota({
      statusEfetivo: "cancelada",
      ciclo: {
        situacao: "cancelada", eventoRegistrado: true, motivoSubstituicao: null,
        evento: { tipo: "cancelamento", motivo: "erro de digitação" },
      },
    });
    expect(l.motivoSubstituicao).toBeNull();
    expect(l.evento.motivo).toBe("erro de digitação");
  });
});

describe("o vínculo que aponta para fora da base", () => {
  it("substituta ausente continua sendo VÍNCULO, com a chave e `naBase: false`", () => {
    const l = lerCicloDaNota({
      statusEfetivo: "cancelada",
      ciclo: {
        situacao: "substituida", ehSubstituta: false, eventoRegistrado: true,
        substituidaPor: { notaId: null, numero: null, chaveAcesso: CH_NOVA, naBase: false },
        avisos: [{ codigo: "substituta_ausente", texto: "O evento aponta uma nota substituta que NÃO está na nossa base." }],
      },
    });
    expect(l.substituidaPor.naBase).toBe(false);
    expect(l.substituidaPor.chaveAcesso).toBe(CH_NOVA);
    expect(l.avisos).toHaveLength(1);
  });

  it("sem `ciclo` (API antiga), a coluna `chaveSubstituida` ainda vira vínculo — fora da base", () => {
    const l = lerCicloDaNota({ statusEfetivo: "autorizada", chaveSubstituida: CH_VELHA });
    expect(l.temCicloDoServidor).toBe(false);
    expect(l.ehSubstituta).toBe(true);
    expect(l.substitui).toEqual({ notaId: null, numero: null, chaveAcesso: CH_VELHA, naBase: false });
    // ⚠ Sem `ciclo` não se INVENTA situação: quem deriva é o backend.
    expect(l.situacao).toBe("autorizada");
    expect(l.semEvento).toBe(false);
  });
});

describe("o desconhecido nunca se apresenta como autorizado", () => {
  it("valor fora do mapa cai em neutro e diz que não foi reconhecido", () => {
    const l = lerCicloDaNota({ statusEfetivo: "coisa_nova" });
    expect(l.conhecida).toBe(false);
    expect(l.cor).toBe("var(--state-neutral)");
    expect(l.tituloAjuda).toMatch(/não presuma que está autorizada/i);
  });

  it("sem situação nenhuma, nomeia a ausência em vez de inventar 'autorizada'", () => {
    const l = lerCicloDaNota({ statusEfetivo: null, status: null });
    expect(l.situacao).toBeNull();
    expect(l.rotulo).toBe("situação não registrada");
    expect(l.conhecida).toBe(false);
  });

  it("nota nula não quebra a leitura", () => {
    const l = lerCicloDaNota(null);
    expect(l.situacao).toBeNull();
    expect(l.substitui).toBeNull();
    expect(l.avisos).toEqual([]);
  });
});

// ⚠ O MAPA DE COR MORTO. No detalhe ele era alimentado por `statusEfetivo`, que só tem dois
// valores — a entrada "substituida" nunca acendeu. Agora quem o alimenta é `ciclo.situacao`.
describe("o mapa de cor é alimentado pelo CICLO, não por statusEfetivo", () => {
  it("tem entrada para substituida, e ela acende de verdade", () => {
    expect(SITUACAO_TOKEN.substituida.cor).toBe("var(--state-warn)");
    const l = lerCicloDaNota({ statusEfetivo: "cancelada", ciclo: { situacao: "substituida", eventoRegistrado: true } });
    expect(l.cor).toBe(SITUACAO_TOKEN.substituida.cor);
    expect(l.fundo).toBe(SITUACAO_TOKEN.substituida.fundo);
  });

  // ⚠ Nunca `${cor}22`: com `var(--…)` a concatenação quebra em silêncio. O par existe.
  it("todo token de cor tem par -surface, e nenhum é hex literal", () => {
    for (const [nome, t] of Object.entries(SITUACAO_TOKEN)) {
      expect(t.cor).toMatch(/^var\(--/);
      expect(t.fundo).toMatch(/^var\(--.*-surface\)$/);
      expect(nome).toBe(nome.toLowerCase());
    }
  });
});
