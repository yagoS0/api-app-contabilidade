// AS TABELAS DE RETENÇÃO NA FONTE — o que a norma diz, e o que ela NÃO diz.
//
// ⚠⚠ O VALOR DESTE ARQUIVO ESTÁ TANTO NO QUE ELE AFIRMA QUANTO NO QUE ELE PROÍBE. As alíquotas são
// poucas e fáceis de conferir; o que custa caro é alguém "completar" a tabela com o 1,5% do IRRF ou
// os 11% do INSS de memória — os dois estão nomeados em `NAO_VERSIONADO` porque a norma que os
// institui NÃO está versionada aqui. Há casos abaixo travando essa ausência.

import fs from "node:fs";
import path from "node:path";
import {
  ALIQUOTAS_ART30,
  PISO_DISPENSA,
  DISPENSA_SIMPLES_NACIONAL,
  SERVICOS_ART30,
  NAO_VERSIONADO,
  RESPOSTA,
  retencaoFederalPeloRegime,
  dispensadaPeloPiso,
} from "../index.js";

describe("⚠ as alíquotas do art. 30/31 — e a soma que elas têm de fechar", () => {
  it("1% CSLL + 3% COFINS + 0,65% PIS = 4,65%", () => {
    expect(ALIQUOTAS_ART30.csll).toBe(1);
    expect(ALIQUOTAS_ART30.cofins).toBe(3);
    expect(ALIQUOTAS_ART30.pisPasep).toBe(0.65);
    expect(ALIQUOTAS_ART30.total).toBe(4.65);
  });

  it("⚠ a soma das três É o total — não são dois números independentes", () => {
    // Se alguém corrigir uma parcela e esquecer o total, a nota sai com retenção errada e a soma
    // não denuncia. Aqui ela denuncia.
    const soma = ALIQUOTAS_ART30.csll + ALIQUOTAS_ART30.cofins + ALIQUOTAS_ART30.pisPasep;
    expect(Number(soma.toFixed(2))).toBe(ALIQUOTAS_ART30.total);
  });

  it("cada valor cita o dispositivo que o institui", () => {
    expect(ALIQUOTAS_ART30.fonte).toMatch(/Lei 10\.833\/2003, art\. 31/);
    expect(ALIQUOTAS_ART30.verificadoNaFonte).toBe(true);
  });

  it("os serviços do caput são transcrição, não paráfrase", () => {
    expect(SERVICOS_ART30).toContain("transporte de valores");
    expect(SERVICOS_ART30).toContain("remuneração de serviços profissionais");
    expect(SERVICOS_ART30.length).toBeGreaterThanOrEqual(13);
  });
});

describe("⚠⚠ o piso é R$ 10,00 — e o limite de R$ 5.000 NÃO existe mais", () => {
  it("R$ 10,00 exatos são DISPENSADOS — a norma diz 'igual ou inferior'", () => {
    expect(dispensadaPeloPiso(10).dispensada).toBe(true);
    expect(dispensadaPeloPiso(9.99).dispensada).toBe(true);
    expect(dispensadaPeloPiso(10.01).dispensada).toBe(false);
  });

  it("⚠⚠ a soma mensal do § 4º está marcada como REVOGADA", () => {
    // O item mais fácil de reintroduzir por memória: muita literatura de 2010 ainda ensina o
    // limite de R$ 5.000 acumulado no mês. A Lei 13.137/2015 revogou o parágrafo inteiro.
    expect(PISO_DISPENSA.somaMensalRevogada.revogada).toBe(true);
    expect(PISO_DISPENSA.somaMensalRevogada.fonte).toMatch(/Revogado/);
    // E o valor antigo não pode ter sobrado em lugar nenhum da tabela.
    expect(JSON.stringify(PISO_DISPENSA)).not.toMatch(/5\.?000/);
  });

  it("a exceção do DARF eletrônico via Siafi está no contrato", () => {
    expect(dispensadaPeloPiso(5, { darfEletronicoSiafi: true }).dispensada).toBe(false);
  });

  it("⚠⚠ AUSÊNCIA NÃO É ZERO — e zero seria dispensa, que é o desfecho caro", () => {
    // `Number(null)`, `Number("")` e `Number([])` são todos **0**, e `0 <= 10` responderia
    // DISPENSADA para uma nota cujo valor ninguém informou — deixando de reter tributo devido.
    // A primeira versão desta função caiu exatamente aqui. Mesma família de `folhaAusenteNaoEZero`.
    for (const v of [undefined, null, "", "   ", [], "abc", NaN, {}]) {
      expect({ v: JSON.stringify(v) ?? "undefined", d: dispensadaPeloPiso(v).dispensada })
        .toEqual({ v: JSON.stringify(v) ?? "undefined", d: false });
    }
  });

  it("⚠ mas ZERO INFORMADO dispensa — a distinção é `null` × `0`", () => {
    // Retenção calculada em zero é uma afirmação ("conferi, dá zero"), e zero é `<= 10`.
    expect(dispensadaPeloPiso(0).dispensada).toBe(true);
    expect(dispensadaPeloPiso("0").dispensada).toBe(true);
  });
});

describe("⚠⚠ optante do Simples Nacional não sofre retenção federal", () => {
  it("as duas grafias do regime respondem DISPENSADA", () => {
    // `CadastroFiscal.regime` grava `SIMPLES_NACIONAL`; `Company.regimeTributario` grava `SIMPLES`.
    // Ignorar isso recusaria 29 das 33 empresas — o mesmo motivo do `ALIAS_REGIME` de `dpsCodigos`.
    for (const r of ["SIMPLES", "SIMPLES_NACIONAL", "simples nacional"]) {
      expect(retencaoFederalPeloRegime(r).resposta).toBe(RESPOSTA.DISPENSADA);
    }
  });

  it("a dispensa está na LEI, não só na Instrução Normativa", () => {
    // Uma primeira pesquisa deste projeto atribuiu a regra só à IN 459. É o art. 32, III da própria
    // Lei 10.833 que dispensa; a IN regulamenta e atualiza o nome do regime.
    expect(DISPENSA_SIMPLES_NACIONAL.pisCofinsCsll.fonte).toMatch(/Lei 10\.833\/2003, art\. 32, III/);
    expect(DISPENSA_SIMPLES_NACIONAL.pisCofinsCsll.fonte).toMatch(/IN SRF 459\/2004, art\. 3º, II/);
  });

  it("o IRRF também é dispensado — e a exceção das aplicações vai junto", () => {
    expect(DISPENSA_SIMPLES_NACIONAL.irrf.dispensada).toBe(true);
    expect(DISPENSA_SIMPLES_NACIONAL.irrf.fonte).toMatch(/IN RFB 765\/2007/);
    expect(DISPENSA_SIMPLES_NACIONAL.irrf.excecao).toMatch(/aplicações/);
  });

  it("⚠ a dispensa tem obrigação acessória: a declaração ao tomador", () => {
    // Sem ela a tomadora não tem como provar por que não reteve. É parte da regra, não detalhe.
    expect(DISPENSA_SIMPLES_NACIONAL.declaracaoAoTomador.exigida).toBe(true);
    expect(DISPENSA_SIMPLES_NACIONAL.declaracaoAoTomador.fonte).toMatch(/art\. 11/);
  });

  it("Presumido e Real respondem DEVIDA", () => {
    for (const r of ["LUCRO_PRESUMIDO", "LUCRO_REAL"]) {
      expect(retencaoFederalPeloRegime(r).resposta).toBe(RESPOSTA.DEVIDA);
    }
  });

  it("⚠⚠ regime ausente ou desconhecido é INDEFINIDA — nunca DEVIDA", () => {
    // Responder DEVIDA por omissão faria o sistema reter de optante do Simples, que é exatamente o
    // que o art. 32, III proíbe. Terceira resposta obrigatória, como em `obrigatoriedadeEfd`.
    for (const r of ["", null, undefined, "LUCRO ARBITRADO", "  "]) {
      const v = retencaoFederalPeloRegime(r);
      expect(v.resposta).toBe(RESPOSTA.INDEFINIDA);
      expect(v.motivo).toBeTruthy();
    }
  });

  it("⚠ o MEI fica INDEFINIDO de propósito — nada foi conferido para ele", () => {
    // `dpsCodigos.MEI_NAO_MAPEADO` já recusa a emissão de MEI por falta de evidência. Responder
    // DISPENSADA aqui por analogia seria a mesma inferência que aquele bloco recusa.
    expect(retencaoFederalPeloRegime("MEI").resposta).toBe(RESPOSTA.INDEFINIDA);
  });

  it("⚠ `DEVIDA` responde só pela metade do REGIME — o nome e a doc dizem isso", () => {
    // A resposta não é ordem de reter: faltam o serviço estar na lista do art. 30 e o tomador ser
    // PJ. O teste prende a documentação porque é ela que impede a leitura errada.
    const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf-8");
    expect(fonte).toMatch(/serviço estar na lista do art\. 30/);
    expect(fonte).toMatch(/tomador ser PESSOA JUR/);
  });
});

describe("⚠⚠ o que NÃO está provado continua NÃO preenchido", () => {
  it("as cinco lacunas estão nomeadas, cada uma com o motivo", () => {
    for (const k of [
      "irrfAliquotaServicos",
      "retencaoPrevidenciaria",
      "listaServicosProfissionais",
      "orgaosPublicosFederais",
      "issRetidoNoSimples",
    ]) {
      expect(NAO_VERSIONADO[k]?.porque).toBeTruthy();
    }
  });

  it("⚠⚠ NENHUMA alíquota de IRRF ou de INSS entrou na tabela", () => {
    // O "1,5%" e o "11%" são os dois números que qualquer um completaria de memória — e nenhuma das
    // duas normas está versionada aqui. Se alguém os acrescentar sem versionar a fonte, isto cai.
    //
    // ⚠ A varredura é por número em FORMA DE ALÍQUOTA, não por dígito solto: a primeira versão
    // deste caso usava `/\b11\b/` e acusava a citação legítima do **art. 11** da IN 459 (a
    // declaração ao tomador). Teste que acusa a fonte certa é teste que alguém desliga.
    const tabela = JSON.stringify({ ALIQUOTAS_ART30, PISO_DISPENSA, DISPENSA_SIMPLES_NACIONAL });
    expect(tabela).not.toMatch(/["\s:](1[.,]5|11)\s*[,}]/); // valor numérico solto
    expect(tabela).not.toMatch(/1[.,]5\s*%|11\s*%/); // ou escrito como percentual

    // E o que decide de verdade: as chaves não existem.
    for (const k of ["irrf", "inss", "vRetCP", "vRetIRRF", "previdenciaria"]) {
      expect({ chave: k, valor: ALIQUOTAS_ART30[k] }).toEqual({ chave: k, valor: undefined });
    }
  });
});

describe("⚠⚠ ELA É INERTE HOJE, E ISSO ESTÁ TRAVADO", () => {
  // Mesmo desenho de `fiscal/nbs/__tests__/nbs.test.js`. A tabela existir NÃO é autorização para
  // ligá-la: montar `tribFed` MUDA o XML de nota fiscal em produção, e hoje a emissão RECUSA
  // retenção declarada (`NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA`). Quem ligar isto faz este teste
  // cair — e aí a decisão fica à vista, em vez de acontecer por acidente.
  it("nenhum arquivo do caminho de emissão de NFS-e importa a tabela de retenção", () => {
    const dir = path.resolve(__dirname, "../../../nfse");
    const arquivos = [];
    const varrer = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") varrer(p); }
        else if (e.name.endsWith(".js")) arquivos.push(p);
      }
    };
    varrer(dir);
    expect(arquivos.length).toBeGreaterThan(5);
    const importam = arquivos.filter((f) => /fiscal\/retencao|retencao\.data/.test(fs.readFileSync(f, "utf-8")));
    expect(importam.map((f) => path.basename(f))).toEqual([]);
  });
});

describe("⚠ o artefato oficial continua na árvore, com o hash que o gerador confere", () => {
  it("os três documentos estão em `docs/retencao-fonte/`", () => {
    // Sem eles o gerador não roda, e a tabela vira número sem procedência. É a mesma disciplina do
    // `listaIbgeChegaNaImagem.test.js`: o artefato é parte da entrega, não anexo.
    const docs = path.resolve(__dirname, "../../../../../../../docs/retencao-fonte");
    for (const f of [
      "l10833compilado.htm",
      "in-srf-459-2004-vigente.json",
      "in-rfb-765-2007-vigente.json",
      "README.md",
    ]) {
      expect({ f, existe: fs.existsSync(path.join(docs, f)) }).toEqual({ f, existe: true });
    }
  });
});
