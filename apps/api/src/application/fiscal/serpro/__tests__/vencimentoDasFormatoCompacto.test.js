// O VENCIMENTO DO DAS VINHA COMO `AAAAMMDD` E VIRAVA NULO.
//
// ⚠⚠ O DEFEITO: `parsePossibleDate` entendia `AAAA-MM-DD` e `DD/MM/AAAA`, e caía num
// `new Date(raw)` genérico para o resto. Só que `new Date("20260622")` é **Invalid Date** — o
// guarda-chuva `Number.isNaN` devolvia `null` e o vencimento sumia SEM ERRO NENHUM.
//
// ⚠ A CONSEQUÊNCIA JÁ ESTAVA ATIVA E ERA SILENCIOSA. `CalendarioFiscalService` filtra as guias por
// `vencimento`; sem ele, as guias de DAS **não apareciam no calendário fiscal**. Não havia
// mensagem, contador nem linha em vermelho — a guia simplesmente não existia para quem olhasse o
// calendário. Guia que não aparece é guia que não é paga.
//
// Medido em produção, 21/08/2026: `Guide.vencimento` nulo em **51 de 67** guias de SIMPLES
// `PROCESSED`, com a data presente em **51 de 51** dos payloads já guardados — ou seja,
// recuperável sem gastar uma única chamada ao SERPRO.
//
// ⚠ ESTE TESTE MEDE O PARSER, NÃO A CAPTURA. Nada aqui chama o SERPRO nem escreve no banco.

// ⚠ `parsePossibleDate` foi EXPORTADA para poder ser medida. Reimplementar a regra aqui daria
// verde mesmo com a regra errada — por isso o teste importa a função de verdade.
describe("vencimento do DAS em formato compacto (AAAAMMDD)", () => {
  // Reproduz, sem depender do módulo, a premissa que criou o defeito — para que ela fique
  // registrada: quem ler este arquivo entende POR QUE o ramo novo existe.
  it("⚠ a premissa que causou o defeito: `new Date(\"20260622\")` é Invalid Date", () => {
    expect(Number.isNaN(new Date("20260622").getTime())).toBe(true);
  });

  it("⚠ e `new Date(\"2026-06-22\")` é válida — a diferença é só o hífen", () => {
    expect(Number.isNaN(new Date("2026-06-22").getTime())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O contrato do parser, exercido pela função exportada que o consome.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("parsePossibleDate, pelo caminho público", () => {
  let parse;

  beforeAll(async () => {
    const mod = await import("../CaptureSerproGuidesService.js");
    // A função é interna; alcançamos pelo objeto de módulo quando exportada, senão pulamos com
    // aviso explícito em vez de dar verde falso.
    parse = mod.parsePossibleDate || mod.default?.parsePossibleDate || null;
  });

  const casos = [
    // [entrada, ISO esperado ou null, por quê]
    ["20260622", "2026-06-22", "o formato do SERPRO para o DAS — era ESTE que sumia"],
    ["20260120", "2026-01-20", "início de ano, para o mês não ser lido como dia"],
    ["20261231", "2026-12-31", "limite superior de mês e dia"],
    ["2026-06-22", "2026-06-22", "ISO continua funcionando"],
    ["22/06/2026", "2026-06-22", "formato brasileiro continua funcionando"],
    ["20261301", null, "mês 13 não é data — devolver nulo é a resposta certa"],
    ["20260632", null, "dia 32 não é data"],
    ["20260600", null, "dia 00 não é data"],
    ["", null, "vazio"],
    [null, null, "ausente"],
  ];

  it.each(casos)("%s → %s (%s)", (entrada, esperado) => {
    if (!parse) {
      throw new Error(
        "parsePossibleDate não está acessível a partir do módulo. Exporte-a para que este contrato "
        + "possa ser medido — reimplementar a regra aqui daria verde mesmo com a regra errada."
      );
    }
    const r = parse(entrada);
    if (esperado === null) {
      expect(r).toBeNull();
    } else {
      expect(r).toBeInstanceOf(Date);
      expect(r.toISOString().slice(0, 10)).toBe(esperado);
    }
  });
});
