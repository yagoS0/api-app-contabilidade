// A RETENÇÃO FEDERAL NA DPS — as três condições, e a dispensa que não é condição.
//
// ⚠⚠ O QUE ESTE ARQUIVO TRAVA: que **nenhuma das três** possa ser esquecida. Elas têm origens
// diferentes — o REGIME vem do cadastro, o SERVIÇO vem do perfil, o TOMADOR vem da própria nota —
// e é justamente por isso que é fácil implementar uma e achar que acabou.
//
// ⚠ E trava o que NÃO é derivado: o serviço estar na lista do art. 30 é DECLARAÇÃO do contador.
// Derivar do CNAE erraria nos dois sentidos — retenção indevida, ou omissão da devida.

import { ALIQUOTAS_ART30, PISO_DISPENSA } from "../../fiscal/retencao/index.js";
import {
  SITUACAO,
  TP_RET_PIS_COFINS_CSLL_RETIDOS,
  retencaoFederalDaDps,
} from "../retencaoFederalDaDps.js";

const PERFIL = { retencaoFederalArt30: true, cstPisCofins: "01" };
const CNPJ = "39254243000191";
const CPF = "12219079724";

const chamar = (extra = {}) =>
  retencaoFederalDaDps({
    regime: "LUCRO_PRESUMIDO",
    perfil: PERFIL,
    valorServicos: 1000,
    documentoTomador: CNPJ,
    ...extra,
  });

describe("⚠⚠ TRÊS CONDIÇÕES, e só UMA é do perfil", () => {
  it("1) sem a declaração do contador, nada muda — e é o estado de todo perfil hoje", () => {
    for (const perfil of [null, {}, { retencaoFederalArt30: null }, { retencaoFederalArt30: false }]) {
      const r = chamar({ perfil });
      expect(r.situacao).toBe(SITUACAO.NAO_DECLARADA);
      expect(r.informar).toBe(false);
    }
  });

  it("⚠⚠ `null` NÃO é `false` para o consumidor — mas os dois não retêm, e a distinção fica no motivo", () => {
    // A coluna nasce NULA (a lição de `CadastroFiscal.usaFatorR`, que era `@default(false)` e não
    // distinguia "o contador disse que não" de "ninguém abriu essa tela"). Aqui a decisão é a
    // mesma nos dois — não reter —, e é isso que torna seguro exigir `true` EXPLÍCITO.
    expect(chamar({ perfil: { retencaoFederalArt30: null } }).informar).toBe(false);
    expect(chamar({ perfil: { retencaoFederalArt30: "true" } }).informar).toBe(false);
  });

  it("2) no SIMPLES é vedada por LEI — e a nota sai CERTA sem ela", () => {
    // Lei 10.833/2003, art. 32, III (e IN SRF 459/2004, art. 3º, II). ⚠ Não é recusa da emissão:
    // a nota sem retenção é a nota correta. O que seria errado é sair COM retenção.
    const r = chamar({ regime: "SIMPLES_NACIONAL" });
    expect(r.ok).toBe(true);
    expect(r.situacao).toBe(SITUACAO.VEDADA_NO_SIMPLES);
    expect(r.informar).toBe(false);
    // ⚠ O motivo NOMEIA a norma — quem lê precisa saber que é lei, não configuração nossa.
    expect(r.motivo).toMatch(/art\.?\s*32|459/i);
  });

  it("3) tomador PESSOA FÍSICA não sofre retenção — a obrigação é da fonte pagadora PJ", () => {
    const r = chamar({ documentoTomador: CPF });
    expect(r.situacao).toBe(SITUACAO.TOMADOR_PESSOA_FISICA);
    expect(r.informar).toBe(false);
  });

  it("⚠ documento ilegível também NÃO retém — falha fechada na direção certa", () => {
    // Sem PROVA de que a fonte pagadora é PJ, não se retém: reter de pessoa física é cobrar
    // tributo de quem não deve.
    for (const doc of [null, undefined, "", "123", "abc"]) {
      expect(chamar({ documentoTomador: doc }).situacao).toBe(SITUACAO.TOMADOR_PESSOA_FISICA);
    }
  });

  it("⚠⚠ REGIME INDEFINIDO NÃO RETÉM — falha FECHADA, e era falha aberta", () => {
    // `retencaoFederalPeloRegime` tem TRÊS respostas, e a terceira não é "não": é "não dá para
    // afirmar". A primeira versão desta regra tratava só `DISPENSADA` e deixava tudo o mais
    // passar — ou seja, empresa SEM regime cadastrado **retinha**, declarando ao fisco uma
    // retenção que talvez seja vedada por lei. Sem prova de que é devida, não se retém.
    for (const regime of [null, undefined, "", "MEI", "algo_que_ninguém_reconhece"]) {
      const r = chamar({ regime });
      expect({ regime: String(regime), situacao: r.situacao, informar: r.informar }).toEqual({
        regime: String(regime), situacao: SITUACAO.REGIME_INDEFINIDO, informar: false,
      });
    }
  });

  it("⚠ as três juntas: só com as três satisfeitas a retenção é devida", () => {
    expect(chamar().situacao).toBe(SITUACAO.DEVIDA);
  });
});

describe("⚠⚠ o PISO — e o limite de R$ 5.000 que NÃO existe mais", () => {
  it("valor retido ≤ R$ 10,00 dispensa (art. 31, § 3º)", () => {
    // 4,65% de 215,00 = 10,00 exatos.
    const r = chamar({ valorServicos: 215 });
    expect(r.situacao).toBe(SITUACAO.DISPENSADA_PELO_PISO);
    expect(r.motivo).toMatch(/10[.,]00/);
  });

  it("um centavo acima do piso, retém", () => {
    const r = chamar({ valorServicos: 216 });
    expect(r.situacao).toBe(SITUACAO.DEVIDA);
    expect(r.totalRetido).toBe("10.04");
  });

  it("⚠⚠ o PISO é sobre o VALOR RETIDO, não sobre o valor da nota", () => {
    // Uma nota de R$ 215 não é "pequena": o que é pequeno é a retenção dela. Comparar o piso com o
    // valor do serviço dispensaria retenção de notas de até R$ 10, ou seja, quase nunca.
    expect(PISO_DISPENSA.valor).toBe(10);
    expect(chamar({ valorServicos: 215 }).situacao).toBe(SITUACAO.DISPENSADA_PELO_PISO);
    expect(chamar({ valorServicos: 1000 }).situacao).toBe(SITUACAO.DEVIDA);
  });

  it("⚠⚠ NENHUMA soma mensal — o § 4º foi REVOGADO pela Lei 13.137/2015", () => {
    // A função não recebe histórico, e é assim que se garante que ninguém reintroduza a regra
    // antiga de somar os pagamentos do mês à mesma PJ para aferir o limite de R$ 5.000. Sistema
    // que ainda a aplique DEIXA DE RETER o que é devido.
    // ⚠⚠ A VARREDURA MIRA O MECANISMO, NÃO A PROSA — e a primeira versão errou nisso, acusando a
    // própria mensagem que EXPLICA que os R$ 5.000 foram revogados. É a segunda vez que esta
    // armadilha aparece na entrega (a primeira foi um `11` que acusava a citação legítima do
    // art. 11 da IN 459). **Teste que acusa a fonte certa é teste que alguém desliga.**
    //
    // O que se procura agora é código: literal numérico e identificadores de acumulação.
    const fonte = retencaoFederalDaDps.toString();
    expect(fonte).not.toMatch(/[^.\d]5000/);
    expect(fonte).not.toMatch(/acumulad\w*\s*[=(),.]|somaDoMes|pagamentosDoMes|historico/i);

    // ⚠ A prova ESTRUTURAL, que nenhuma varredura de texto dá: a função não recebe histórico.
    // Sem histórico não há como somar o mês, por construção.
    expect(retencaoFederalDaDps.length).toBe(1);
    expect(fonte.slice(0, fonte.indexOf(")"))).not.toMatch(/pagamentos|meses|hist/i);
    // Cada nota decide sozinha: duas de 216 retêm as duas, sem se conhecerem.
    expect(chamar({ valorServicos: 216 }).situacao).toBe(SITUACAO.DEVIDA);
  });
});

describe("⚠⚠ o grupo emitido sai da tabela VERSIONADA — nenhum percentual é literal", () => {
  it("as alíquotas são as do art. 31, lidas do módulo de retenção", () => {
    const { grupo } = chamar();
    expect(grupo.piscofins.pAliqPis).toBe(ALIQUOTAS_ART30.pisPasep.toFixed(2));
    expect(grupo.piscofins.pAliqCofins).toBe(ALIQUOTAS_ART30.cofins.toFixed(2));
    // ⚠ A soma tem de fechar com o total declarado na lei — 1 + 3 + 0,65 = 4,65.
    expect(ALIQUOTAS_ART30.csll + ALIQUOTAS_ART30.cofins + ALIQUOTAS_ART30.pisPasep)
      .toBeCloseTo(ALIQUOTAS_ART30.total, 10);
  });

  it("os valores são a base × alíquota, com duas casas", () => {
    const { grupo, totalRetido } = chamar({ valorServicos: 1000 });
    expect(grupo.piscofins.vBCPisCofins).toBe("1000.00");
    expect(grupo.piscofins.vPis).toBe("6.50");
    expect(grupo.piscofins.vCofins).toBe("30.00");
    expect(grupo.vRetCSLL).toBe("10.00");
    expect(totalRetido).toBe("46.50"); // 4,65% de 1000
  });

  it("⚠⚠ `tpRetPisCofins` é SEMPRE 3 — as combinações parciais não têm fonte aqui", () => {
    // A enumeração tem dez posições (5 = só PIS, 6 = só COFINS, 8 = só CSLL…). Os 4,65% do art. 31
    // são uma retenção ÚNICA das três contribuições, e para as parciais este projeto não tem fonte
    // nenhuma. Emitir uma delas seria inventar qual tributo foi retido.
    expect(TP_RET_PIS_COFINS_CSLL_RETIDOS).toBe("3");
    expect(chamar().grupo.piscofins.tpRetPisCofins).toBe("3");
  });

  it("⚠ o CST vem do PERFIL — não há de-para serviço → CST em fonte versionada", () => {
    expect(chamar().grupo.piscofins.CST).toBe("01");
    expect(chamar({ perfil: { ...PERFIL, cstPisCofins: "50" } }).grupo.piscofins.CST).toBe("50");
  });

  it("⚠⚠ sem CST, RECUSA nomeando — nunca um `01` fabricado", () => {
    const r = chamar({ perfil: { retencaoFederalArt30: true } });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe("NFSE_RETENCAO_FEDERAL_SEM_CST");
    expect(r.correcao).toMatch(/não é derivado|de-para/i);
  });

  it("sem base, recusa", () => {
    for (const v of [0, null, undefined, -5, "abc"]) {
      expect(chamar({ valorServicos: v }).codigo).toBe("NFSE_RETENCAO_FEDERAL_SEM_BASE");
    }
  });
});

describe("⚠⚠ o que este módulo NÃO produz, e por quê", () => {
  it("`vRetIRRF` e `vRetCP` NÃO saem do grupo", () => {
    // A alíquota do IRRF vive na legislação do IR e os 11% da Lei 8.212/1991 não foram confirmados
    // em fonte primária — nenhum dos dois está versionado aqui. Emitir percentual de memória é
    // exatamente o que a regra 1 do projeto proíbe.
    const { grupo } = chamar();
    expect(Object.keys(grupo).sort()).toEqual(["piscofins", "vRetCSLL"]);
    expect(JSON.stringify(grupo)).not.toMatch(/vRetIRRF|vRetCP/);
  });

  it("⚠ e o grupo `piscofins` tem exatamente os sete campos do XSD", () => {
    expect(Object.keys(chamar().grupo.piscofins).sort()).toEqual([
      "CST", "pAliqCofins", "pAliqPis", "tpRetPisCofins", "vBCPisCofins", "vCofins", "vPis",
    ]);
  });
});
