// A MÁQUINA DE ESTADOS DO DECLARADO.
//
// ⚠⚠ O bloco que mais importa é "A INVARIANTE DO CAIXA". Ele não protege um detalhe de fluxo:
// protege o lançamento de despesa desta casa de AFIRMAR uma saída de dinheiro que ninguém provou.
// Medido em produção: 155 de 155 lançamentos `tipo: "DESPESA"` creditam CAIXA.

import {
  ESTADO,
  ESTADOS_SEM_LANCAMENTO,
  ESTADOS_VIVOS,
  FRASE_DA_RECUSA,
  ORIGEM,
  ORIGEM_PAGAMENTO,
  RECUSA,
  TRANSICAO,
  podeTransitar,
  podeVirarLancamento,
} from "../estadosDeclarado";

const DIA = new Date("2026-07-15T00:00:00.000Z");

/** Uma nota recém-varrida: sabe a despesa, não sabe quando o dinheiro saiu. */
const aguardando = (extra = {}) => ({
  estado: ESTADO.AGUARDANDO_PAGAMENTO,
  origem: ORIGEM.NOTA_RECEBIDA,
  dataPagamento: null,
  origemPagamento: null,
  contaSugerida: "464",
  ...extra,
});

/** O mesmo depois de o pagamento aparecer. */
const aConferir = (extra = {}) => ({
  estado: ESTADO.A_CONFERIR,
  origem: ORIGEM.NOTA_RECEBIDA,
  dataPagamento: DIA,
  origemPagamento: ORIGEM_PAGAMENTO.OFX,
  contaSugerida: "464",
  ...extra,
});

describe("⚠⚠ A INVARIANTE DO CAIXA — sem data de pagamento não se lança", () => {
  it("nota aguardando pagamento NÃO pode ser confirmada", () => {
    const r = podeTransitar(aguardando(), TRANSICAO.CONFIRMAR);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(RECUSA.SEM_DATA_DE_PAGAMENTO);
    expect(r.estado).toBeNull();
  });

  it("⚠ a frase EXPLICA o porquê contábil — recusa muda não ensina nada", () => {
    const r = podeTransitar(aguardando(), TRANSICAO.CONFIRMAR);
    expect(r.frase).toMatch(/caixa/i);
    expect(r.frase).toMatch(/saída/i);
  });

  it("⚠ `podeVirarLancamento` responde a MESMA coisa — é a varredura, não uma segunda regra", () => {
    expect(podeVirarLancamento(aguardando())).toBe(false);
    expect(podeVirarLancamento(aConferir())).toBe(true);
  });

  it("⚠⚠ mandar a data EXPLICITAMENTE NULA também recusa — apagar não é preencher", () => {
    const r = podeTransitar(aConferir(), TRANSICAO.CONFIRMAR, { dataPagamento: null });
    expect(r.motivo).toBe(RECUSA.SEM_DATA_DE_PAGAMENTO);
  });

  it("⚠ data que não é Date, ou Date inválida, recusa com motivo PRÓPRIO", () => {
    expect(podeTransitar(aguardando(), TRANSICAO.CONFIRMAR, {
      dataPagamento: "2026-07-15", origemPagamento: ORIGEM_PAGAMENTO.OFX,
    }).motivo).toBe(RECUSA.DATA_DE_PAGAMENTO_INVALIDA);
    expect(podeTransitar(aguardando(), TRANSICAO.CONFIRMAR, {
      dataPagamento: new Date("banana"), origemPagamento: ORIGEM_PAGAMENTO.OFX,
    }).motivo).toBe(RECUSA.DATA_DE_PAGAMENTO_INVALIDA);
  });

  it("⚠⚠ data sem dizer se é PROVA ou DECLARAÇÃO recusa", () => {
    // Não é burocracia: quando o débito do extrato chegar sobre uma despesa já lançada, o contador
    // precisa saber qual das duas ele está olhando.
    const r = podeTransitar(aguardando(), TRANSICAO.CONFIRMAR, { dataPagamento: DIA });
    expect(r.motivo).toBe(RECUSA.ORIGEM_DE_PAGAMENTO_INVALIDA);
    const inventada = podeTransitar(aguardando(), TRANSICAO.CONFIRMAR, {
      dataPagamento: DIA, origemPagamento: "SEI_LA",
    });
    expect(inventada.motivo).toBe(RECUSA.ORIGEM_DE_PAGAMENTO_INVALIDA);
  });
});

describe("⚠⚠ AGUARDANDO_PAGAMENTO NÃO É PRISÃO (dono, 24/08/2026)", () => {
  it('o contador lança "naquele momento, mesmo sem comprovante" — informando a data', () => {
    const r = podeTransitar(aguardando(), TRANSICAO.CONFIRMAR, {
      dataPagamento: DIA,
      origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    });
    expect(r.ok).toBe(true);
    expect(r.estado).toBe(ESTADO.CONTABILIZADO);
  });

  it("⚠ e fica GRAVADO que foi declaração, não prova", () => {
    const r = podeTransitar(aguardando(), TRANSICAO.CONFIRMAR, {
      dataPagamento: DIA,
      origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    });
    expect(r.campos.origemPagamento).toBe(ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR);
    expect(r.campos.dataPagamento).toBe(DIA);
  });

  it("⚠ o atalho NÃO afrouxa a invariante — sem a data, a mesma recusa", () => {
    expect(podeTransitar(aguardando(), TRANSICAO.CONFIRMAR, {
      origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    }).motivo).toBe(RECUSA.SEM_DATA_DE_PAGAMENTO);
  });
});

describe("INFORMAR_PAGAMENTO", () => {
  it("leva de AGUARDANDO_PAGAMENTO para A_CONFERIR, sem contabilizar nada", () => {
    const r = podeTransitar(aguardando(), TRANSICAO.INFORMAR_PAGAMENTO, {
      dataPagamento: DIA, origemPagamento: ORIGEM_PAGAMENTO.OFX,
    });
    expect(r.ok).toBe(true);
    expect(r.estado).toBe(ESTADO.A_CONFERIR);
    expect(r.campos).toEqual({ dataPagamento: DIA, origemPagamento: ORIGEM_PAGAMENTO.OFX });
  });

  it("⚠ não vale sobre quem já está a conferir — a data já existe lá", () => {
    expect(podeTransitar(aConferir(), TRANSICAO.INFORMAR_PAGAMENTO, {
      dataPagamento: DIA, origemPagamento: ORIGEM_PAGAMENTO.OFX,
    }).motivo).toBe(RECUSA.TRANSICAO_INVALIDA_NESTE_ESTADO);
  });
});

describe("CONFIRMAR e a conta", () => {
  it("confirmar sem dizer conta usa a SUGERIDA — confirmar é dizer que a sugestão está certa", () => {
    const r = podeTransitar(aConferir(), TRANSICAO.CONFIRMAR);
    expect(r.ok).toBe(true);
    expect(r.campos.contaAplicada).toBe("464");
  });

  it("a conta do ATO vence a sugerida", () => {
    const r = podeTransitar(aConferir(), TRANSICAO.CONFIRMAR, { contaAplicada: "566" });
    expect(r.campos.contaAplicada).toBe("566");
  });

  it("⚠⚠ sem conta dos DOIS lados, RECUSA — conta vazia jamais vira lançamento", () => {
    const r = podeTransitar(aConferir({ contaSugerida: null }), TRANSICAO.CONFIRMAR);
    expect(r.motivo).toBe(RECUSA.SEM_CONTA);
  });

  it("⚠ conta só com espaços é conta vazia", () => {
    expect(podeTransitar(aConferir({ contaSugerida: "   " }), TRANSICAO.CONFIRMAR).motivo)
      .toBe(RECUSA.SEM_CONTA);
  });
});

describe("AJUSTAR", () => {
  it("contabiliza com o valor ajustado", () => {
    const r = podeTransitar(aConferir(), TRANSICAO.AJUSTAR, { valorAjustado: 120.5 });
    expect(r.ok).toBe(true);
    expect(r.estado).toBe(ESTADO.CONTABILIZADO);
    expect(r.campos.valorAjustado).toBe(120.5);
  });

  it("⚠⚠ zero, negativo, ausente e nulo são todos recusados", () => {
    // ⚠ `Number(null)` é 0 e `Number.isFinite(0)` é TRUE — a guarda tem de ser `> 0`, não
    // `Number.isFinite` sozinha. Este projeto já foi mordido por exatamente isso.
    for (const v of [0, -1, undefined, null, "", "abc", NaN]) {
      expect(podeTransitar(aConferir(), TRANSICAO.AJUSTAR, { valorAjustado: v }).motivo)
        .toBe(RECUSA.VALOR_AJUSTADO_INVALIDO);
    }
  });

  it("⚠ a invariante do caixa vale igual no ajuste", () => {
    expect(podeTransitar(aguardando(), TRANSICAO.AJUSTAR, { valorAjustado: 10 }).motivo)
      .toBe(RECUSA.SEM_DATA_DE_PAGAMENTO);
  });
});

describe("RECUSAR e REABRIR", () => {
  it("recusar exige motivo — ausência nunca é resposta", () => {
    expect(podeTransitar(aConferir(), TRANSICAO.RECUSAR).motivo).toBe(RECUSA.SEM_MOTIVO);
    expect(podeTransitar(aConferir(), TRANSICAO.RECUSAR, { motivoRecusa: "  " }).motivo)
      .toBe(RECUSA.SEM_MOTIVO);
  });

  it("com motivo, recusa e guarda o texto", () => {
    const r = podeTransitar(aConferir(), TRANSICAO.RECUSAR, { motivoRecusa: "despesa do sócio" });
    expect(r.estado).toBe(ESTADO.RECUSADO);
    expect(r.campos.motivoRecusa).toBe("despesa do sócio");
  });

  it("⚠⚠ RECUSADO NÃO é beco sem saída — reabrir existe", () => {
    // Recusar por engano deixaria a despesa daquela nota inalcançável para sempre, em silêncio.
    const r = podeTransitar({ estado: ESTADO.RECUSADO, dataPagamento: DIA }, TRANSICAO.REABRIR);
    expect(r.ok).toBe(true);
    expect(r.campos.motivoRecusa).toBeNull();
  });

  it("⚠ reabrir volta para onde a EVIDÊNCIA manda, não para um estado fixo", () => {
    expect(podeTransitar({ estado: ESTADO.RECUSADO, dataPagamento: DIA }, TRANSICAO.REABRIR).estado)
      .toBe(ESTADO.A_CONFERIR);
    expect(podeTransitar({ estado: ESTADO.RECUSADO, dataPagamento: null }, TRANSICAO.REABRIR).estado)
      .toBe(ESTADO.AGUARDANDO_PAGAMENTO);
  });
});

describe("DESFAZER", () => {
  const contabilizado = {
    estado: ESTADO.CONTABILIZADO,
    dataPagamento: DIA,
    origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    contaAplicada: "464",
    accountingEntryId: "ae-1",
  };

  it("volta a A_CONFERIR e SOLTA o lançamento", () => {
    const r = podeTransitar(contabilizado, TRANSICAO.DESFAZER);
    expect(r.estado).toBe(ESTADO.A_CONFERIR);
    expect(r.campos.accountingEntryId).toBeNull();
    expect(r.campos.regraId).toBeNull();
  });

  it("⚠ desfazer o LANÇAMENTO não apaga a DECLARAÇÃO DA DATA", () => {
    // Quem declarou a data continua tendo declarado; ela fica à vista e editável.
    const r = podeTransitar(contabilizado, TRANSICAO.DESFAZER);
    expect(r.campos).not.toHaveProperty("dataPagamento");
    expect(r.campos).not.toHaveProperty("origemPagamento");
  });

  it("só se aplica a CONTABILIZADO", () => {
    for (const e of [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR, ESTADO.RECUSADO, ESTADO.FUNDIDO]) {
      expect(podeTransitar({ estado: e }, TRANSICAO.DESFAZER).motivo)
        .toBe(RECUSA.TRANSICAO_INVALIDA_NESTE_ESTADO);
    }
  });
});

describe("FUNDIR", () => {
  it("exige apontar o par", () => {
    expect(podeTransitar(aConferir(), TRANSICAO.FUNDIR).motivo).toBe(RECUSA.SEM_PAR);
  });

  it("com o par, funde", () => {
    const r = podeTransitar(aConferir(), TRANSICAO.FUNDIR, { parDeclaradoId: "d-9" });
    expect(r.estado).toBe(ESTADO.FUNDIDO);
    expect(r.campos.parDeclaradoId).toBe("d-9");
  });
});

describe("⚠⚠ A MATRIZ INTEIRA — toda transição inválida é recusada", () => {
  // ⚠ Este bloco é o que impede um estado novo de nascer PERMITIDO: o mapa é de inclusão, e aqui
  // se prova que tudo que não está nele recusa.
  const VALIDAS = new Set([
    `${ESTADO.AGUARDANDO_PAGAMENTO}|${TRANSICAO.INFORMAR_PAGAMENTO}`,
    `${ESTADO.AGUARDANDO_PAGAMENTO}|${TRANSICAO.CONFIRMAR}`,
    `${ESTADO.AGUARDANDO_PAGAMENTO}|${TRANSICAO.AJUSTAR}`,
    `${ESTADO.AGUARDANDO_PAGAMENTO}|${TRANSICAO.RECUSAR}`,
    `${ESTADO.AGUARDANDO_PAGAMENTO}|${TRANSICAO.FUNDIR}`,
    `${ESTADO.A_CONFERIR}|${TRANSICAO.CONFIRMAR}`,
    `${ESTADO.A_CONFERIR}|${TRANSICAO.AJUSTAR}`,
    `${ESTADO.A_CONFERIR}|${TRANSICAO.RECUSAR}`,
    `${ESTADO.A_CONFERIR}|${TRANSICAO.FUNDIR}`,
    `${ESTADO.CONTABILIZADO}|${TRANSICAO.DESFAZER}`,
    `${ESTADO.RECUSADO}|${TRANSICAO.REABRIR}`,
  ]);

  for (const estado of Object.values(ESTADO)) {
    for (const transicao of Object.values(TRANSICAO)) {
      const chave = `${estado}|${transicao}`;
      const deveriaPassar = VALIDAS.has(chave);
      it(`${estado} + ${transicao} => ${deveriaPassar ? "permitida" : "RECUSADA"}`, () => {
        const r = podeTransitar({ estado, dataPagamento: null }, transicao);
        if (deveriaPassar) {
          // ⚠ Pode recusar por FALTA DE DADO (data, conta, motivo, par) — o que não pode é recusar
          // por ESTADO, que é o que este bloco mede.
          expect(r.motivo).not.toBe(RECUSA.TRANSICAO_INVALIDA_NESTE_ESTADO);
        } else {
          expect(r.ok).toBe(false);
          expect(r.motivo).toBe(RECUSA.TRANSICAO_INVALIDA_NESTE_ESTADO);
        }
      });
    }
  }

  it("⚠ FUNDIDO é terminal — nenhuma transição sai dele", () => {
    for (const t of Object.values(TRANSICAO)) {
      expect(podeTransitar({ estado: ESTADO.FUNDIDO }, t).ok).toBe(false);
    }
  });
});

describe("entrada torta", () => {
  it("estado que o sistema não conhece recusa NOMEANDO isso", () => {
    for (const e of [null, undefined, "", "PENDENTE", 7]) {
      expect(podeTransitar({ estado: e }, TRANSICAO.CONFIRMAR).motivo).toBe(RECUSA.ESTADO_DESCONHECIDO);
    }
    expect(podeTransitar(null, TRANSICAO.CONFIRMAR).motivo).toBe(RECUSA.ESTADO_DESCONHECIDO);
  });

  it("⚠ o estado é conferido ANTES da transição — senão a mensagem culparia a ação errada", () => {
    expect(podeTransitar({ estado: "INVENTADO" }, "VOAR").motivo).toBe(RECUSA.ESTADO_DESCONHECIDO);
  });

  it("transição que não existe recusa NOMEANDO isso", () => {
    for (const t of [null, undefined, "", "APAGAR"]) {
      expect(podeTransitar(aConferir(), t).motivo).toBe(RECUSA.TRANSICAO_DESCONHECIDA);
    }
  });
});

describe("os vocabulários", () => {
  it("são listas FECHADAS e congeladas", () => {
    for (const o of [ESTADO, ORIGEM, ORIGEM_PAGAMENTO, TRANSICAO, RECUSA, FRASE_DA_RECUSA]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
  });

  it("⚠ TODA recusa tem frase — código sem texto vira 'erro' na tela", () => {
    for (const motivo of Object.values(RECUSA)) {
      expect(typeof FRASE_DA_RECUSA[motivo]).toBe("string");
      expect(FRASE_DA_RECUSA[motivo].length).toBeGreaterThan(10);
    }
  });

  it("os conjuntos de varredura batem com os estados", () => {
    expect([...ESTADOS_VIVOS].sort()).toEqual([ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR].sort());
    // ⚠ Todo estado que NÃO é CONTABILIZADO tem de estar aqui: é a varredura que prova a
    // invariante 7 (nenhum AccountingEntry vinculado fora de CONTABILIZADO).
    expect([...ESTADOS_SEM_LANCAMENTO].sort())
      .toEqual(Object.values(ESTADO).filter((e) => e !== ESTADO.CONTABILIZADO).sort());
  });
});

describe("⚠ o módulo é PURO", () => {
  it("não importa prisma nem lê o relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "estadosDeclarado.js"), "utf8")
      .replace(/\/\/.*$/gm, "")        // ⚠ sem os comentários: eles CITAM `Date.now()` ao explicar
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/from\s+["'].*prisma/i);
    expect(fonte).not.toMatch(/Date\.now\(/);
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });
});
