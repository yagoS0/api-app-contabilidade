// QUAL ALÍQUOTA O PAINEL MOSTRA — e desde 30/08/2026 não há escolha nenhuma: é o LANÇADO.
//
// ⚠⚠ **ISTO REVISA A DECISÃO DE 24/08/2026**, que estes mesmos testes prendiam ("o Simples continua
// saindo dos PAGAMENTOS"). Dono, 30/08/2026: *"use sempre o que foi lançada, ou seja, veio do
// extrato do simples nacional, ou veio do presumido, para cálculo a alíquota."*
//
// ⚠⚠ **O QUE DERRUBOU A REGRA ANTIGA FOI MEDIÇÃO, e ela está no cabeçalho do módulo:** na
// ERISANGELA (Simples), `efetiva` deu **0,77%** em 07/2026 — porque a única guia marcada como paga
// naquele mês era o INSS de R$ 178,31 — contra **6,24%** pelo lançado, que é o número do extrato do
// PGDAS-D. Trocar de volta não quebra a tela: só devolve, em silêncio, um percentual de carga
// tributária refém de qual guia alguém marcou como paga.

import { FONTE, MOTIVO, aliquotaDoPainel } from "../aliquotaDoPainel";

const empresaCom = (regimeTributario) => ({ legacyCompany: { regimeTributario } });
const SIMPLES = empresaCom("SIMPLES_NACIONAL");
const PRESUMIDO = empresaCom("LUCRO_PRESUMIDO");
const SEM_REGIME = { legacyCompany: {} };

const linha = (extra = {}) => ({
  competencia: "2026-07",
  faturamento: 100000,
  impostosPagos: 6000,
  dasExtrato: 6000,
  efetiva: 6,
  deReceita: 6,
  deLancamentos: null,
  ...extra,
});

const blocoCalculado = (extra = {}) => ({
  situacao: "CALCULADA",
  aliquota: 7.49,
  base: 100000,
  receitaBruta: 100000,
  devolucoesEDescontos: 0,
  impostos: 7490,
  impostoSobreReceita: 3650,
  impostoSobreResultado: 3840,
  impostosPorConta: [{ codigo: "420", nome: "(-) COFINS", total: 3000 }],
  naoClassificadas: 0,
  ...extra,
});

describe("⚠⚠ o SIMPLES passou a sair dos LANÇAMENTOS — a reversão de 30/08/2026", () => {
  it("usa `deLancamentos.aliquota` e IGNORA a `efetiva`", () => {
    // ⚠ A linha traz `efetiva: 6` e o bloco traz 7,49. Se algum dia o 6 voltar a aparecer aqui, é
    // porque alguém reintroduziu a conta pelos pagamentos.
    const r = aliquotaDoPainel({ empresa: SIMPLES, linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.LANCAMENTOS);
    expect(r.valor).toBe(7.49);
  });

  it("⚠⚠ com guia paga ABSURDA o número NÃO se move — o caso real da ERISANGELA", () => {
    // 07/2026: única guia paga = INSS 178,31 sobre receita de 23.040,26 ⇒ `efetiva` 0,77%.
    // O lançado diz 6,24%, que é o DAS do extrato. É este caso que o dono chamou de impossível.
    const r = aliquotaDoPainel({
      empresa: SIMPLES,
      linha: linha({
        faturamento: 23040.26, impostosPagos: 178.31, efetiva: 0.77,
        deLancamentos: blocoCalculado({ aliquota: 6.24, base: 23040.26, receitaBruta: 23040.26, impostos: 1437.15, impostoSobreReceita: 1437.15, impostoSobreResultado: 0 }),
      }),
    });
    expect(r.valor).toBe(6.24);
  });

  it("⚠ sem receita LANÇADA não vira 0% — e o motivo fala de contabilidade, não de guia", () => {
    const r = aliquotaDoPainel({
      empresa: SIMPLES,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SEM_RECEITA_LANCADA", aliquota: null }) }),
    });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_RECEITA_LANCADA);
  });

  it("⚠⚠ sem o BLOCO, o Simples NÃO cai de volta na `efetiva`", () => {
    // Falha fechado: backend antigo (ou cálculo que falhou) não dá número nenhum. Cair na conta
    // velha aqui seria a reversão acontecendo sozinha, sem ninguém decidir.
    const r = aliquotaDoPainel({ empresa: SIMPLES, linha: linha({ deLancamentos: null }) });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.BLOCO_AUSENTE);
  });
});

describe("o LUCRO PRESUMIDO passa a sair dos lançamentos", () => {
  it("usa `deLancamentos.aliquota`, NÃO a `efetiva`", () => {
    const r = aliquotaDoPainel({ empresa: PRESUMIDO, linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.LANCAMENTOS);
    expect(r.valor).toBe(7.49);
    expect(r.impostos).toBe(7490);
    expect(r.base).toBe(100000);
  });

  it("o LUCRO REAL vai pelo mesmo caminho", () => {
    const r = aliquotaDoPainel({ empresa: empresaCom("LUCRO_REAL"), linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.LANCAMENTOS);
    expect(r.valor).toBe(7.49);
  });

  it("⚠⚠ o caso REAL: provisão existe e a receita não foi lançada ⇒ NULL, não 0", () => {
    // Medido em produção: KODA BEAR 2026-07, provisão R$ 1.593,00 e nenhuma receita lançada.
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SEM_RECEITA_LANCADA", aliquota: null, base: 0, receitaBruta: 0, impostos: 1593 }) }),
    });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_RECEITA_LANCADA);
    expect(r.impostos).toBe(1593);
  });

  it("⚠ imposto não provisionado é motivo DIFERENTE de receita não lançada", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SEM_IMPOSTO_LANCADO", aliquota: null, impostos: 0 }) }),
    });
    expect(r.motivo).toBe(MOTIVO.SEM_IMPOSTO_LANCADO);
  });

  it("sem lançamento nenhum tem o seu próprio motivo", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SEM_LANCAMENTO", aliquota: null, base: 0, impostos: 0 }) }),
    });
    expect(r.motivo).toBe(MOTIVO.SEM_LANCAMENTO);
  });

  it("⚠ 'o servidor não mandou o bloco' NÃO é 'não há lançamento'", () => {
    const r = aliquotaDoPainel({ empresa: PRESUMIDO, linha: linha({ deLancamentos: null }) });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.BLOCO_AUSENTE);
  });

  it("⚠⚠ situação DESCONHECIDA não vira número — falha fechado", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SITUACAO_QUE_NAO_EXISTE_AINDA" }) }),
    });
    expect(r.valor).toBeNull();
  });

  it("⚠ CALCULADA com alíquota ilegível também não vira número", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ aliquota: null }) }),
    });
    expect(r.valor).toBeNull();
  });

  it("⚠ as linhas SEM conta contábil chegam contadas, mesmo com o número calculado", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ naoClassificadas: 11 }) }),
    });
    expect(r.valor).toBe(7.49);
    expect(r.naoClassificadas).toBe(11);
  });
});

describe("⚠⚠ o REGIME não decide mais nada", () => {
  it("regime desconhecido lê o mesmo bloco que o Simples e o Presumido", () => {
    // ⚠ Antes ele caía nos pagamentos, para não afirmar nada sobre empresa sem regime. Hoje a conta
    // não pergunta o regime: ela lê o razão da empresa, que existe independentemente dele.
    const r = aliquotaDoPainel({ empresa: SEM_REGIME, linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.LANCAMENTOS);
    expect(r.valor).toBe(7.49);
    // ⚠ O regime CONTINUA VIAJANDO na leitura — ele só não escolhe mais a fonte.
    expect(r.regime).toBe("desconhecido");
  });

  it("empresa ausente também", () => {
    const r = aliquotaDoPainel({ empresa: null, linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.LANCAMENTOS);
    expect(r.valor).toBe(7.49);
  });

  it("⚠ `FONTE.PAGAMENTOS` não existe mais — o vocabulário fechou", () => {
    // Uma constante fantasma faria `r.fonte === FONTE.PAGAMENTOS` comparar contra `undefined` e
    // dar `false` para sempre, sem erro nenhum.
    expect(FONTE.PAGAMENTOS).toBeUndefined();
    expect(Object.values(FONTE)).toEqual(["lancamentos"]);
  });
});

describe("sem linha nenhuma", () => {
  it("responde SEM_DADOS, e não uma das ausências de insumo", () => {
    const r = aliquotaDoPainel({ empresa: PRESUMIDO, linha: null });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_DADOS);
  });
});

// ⚠⚠ O INSS DENTRO DO CARD (30/08/2026) — dono: *"não calcula o INSS junto"*.
describe("⚠⚠ o card lê a alíquota COM o INSS patronal", () => {
  const comFolha = (extra = {}) => blocoCalculado({
    aliquota: 6.24,
    aliquotaComFolha: 7.01,
    base: 23040.26,
    receitaBruta: 23040.26,
    impostos: 1437.15,
    impostosComFolha: 1615.46,
    impostoSobreReceita: 1437.15,
    impostoSobreResultado: 0,
    impostoSobreFolha: 178.31,
    ...extra,
  });

  it("usa `aliquotaComFolha`, não `aliquota`", () => {
    const r = aliquotaDoPainel({ empresa: SIMPLES, linha: linha({ deLancamentos: comFolha() }) });
    expect(r.valor).toBe(7.01);
    expect(r.comFolha).toBe(true);
    // ⚠ E o total exibido na frase acompanha o número — 1.615,46, nunca 1.437,15.
    expect(r.impostos).toBe(1615.46);
    expect(r.impostoSobreFolha).toBe(178.31);
  });

  it("⚠⚠ backend SEM o campo cai no número antigo — mas DIZ que caiu", () => {
    // Cair calado faria a tela afirmar que o INSS está dentro quando ele não está. Campo escondido
    // que continua viajando é o defeito pior, e é a frase que este app já tem escrita.
    const bloco = comFolha();
    delete bloco.aliquotaComFolha;
    const r = aliquotaDoPainel({ empresa: SIMPLES, linha: linha({ deLancamentos: bloco }) });
    expect(r.valor).toBe(6.24);
    expect(r.comFolha).toBe(false);
    expect(r.impostos).toBe(1437.15);
  });

  it("⚠⚠ `aliquotaComFolha: null` NÃO vira 0% — `Number(null)` é 0 e é finito", () => {
    const r = aliquotaDoPainel({
      empresa: SIMPLES,
      linha: linha({ deLancamentos: comFolha({ aliquotaComFolha: null }) }),
    });
    // ⚠ Sem o campo legível, vale o irmão — e a frase deixa de dizer que o INSS está dentro.
    expect(r.valor).toBe(6.24);
    expect(r.comFolha).toBe(false);
  });

  it("⚠ sem INSS lançado o card não mente: `comFolha` fica true e o valor do INSS é zero", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: comFolha({ aliquotaComFolha: 6.24, impostosComFolha: 1437.15, impostoSobreFolha: 0 }) }),
    });
    expect(r.valor).toBe(6.24);
    expect(r.impostoSobreFolha).toBe(0);
  });
});
