// O REGIME E A RETENÇÃO SAEM DO DADO, NÃO DE UM LITERAL — E O QUE NÃO SE SABE RECUSA.
//
// ⚠ POR QUE ESTE TESTE EXISTE
//   • `opSimpNac="3"` estava CRAVADO em `buildDpsXml`: toda empresa era declarada Simples ME/EPP
//     no documento fiscal, inclusive as 11 do Lucro Presumido da carteira (medido em 12/08/2026).
//   • `tpRetISSQN` era o literal `1`. As três variáveis que calculavam a retenção
//     (`issRetido`, `issRetidoFlag`, `effectiveIssRetido`) eram MORTAS — nenhuma entrava no XML.
//     Nota com ISS retido saía declarada como não retida.
//
// ⚠ O QUE ESTE TESTE TAMBÉM TRAVA É A RECUSA. O XSD do leiaute **não está versionado neste
// repositório**, então nenhuma linha da tabela pode se apoiar nele. Onde não há evidência, a
// resposta é `indefinido` e a emissão para — não vira um palpite plausível (regra 1 do projeto).

import {
  resolverOpSimpNac,
  resolverTpRetIssqn,
  RESOLUCAO,
  TP_RET_ISSQN,
  OP_SIMP_NAC_POR_REGIME,
} from "../dpsCodigos.js";

describe("opSimpNac — vem do regime REAL da empresa", () => {
  it("Simples Nacional → 3, e exige regApTribSN", () => {
    // Evidência: a única emissão aceita que o projeto já produziu (homolog, status:issued) era de
    // empresa do Simples e usou 3 — `docs/nfse-preenchimento.md` §12.
    const r = resolverOpSimpNac("SIMPLES_NACIONAL");
    expect(r.resolucao).toBe(RESOLUCAO.RESOLVIDO);
    expect(r.opSimpNac).toBe("3");
    expect(r.exigeRegApTribSN).toBe(true);
  });

  it("⚠ Lucro Presumido → 1, e NÃO exige regApTribSN (era declarado como Simples)", () => {
    // Evidência: NFS-e real versionada em `docs/leiaute-nfse/nfse-nacional-substituicao.xml`, com
    // `<opSimpNac>1</opSimpNac>` + `<pTotTrib>` e SEM `<regApTribSN>`.
    const r = resolverOpSimpNac("LUCRO_PRESUMIDO");
    expect(r.resolucao).toBe(RESOLUCAO.RESOLVIDO);
    expect(r.opSimpNac).toBe("1");
    expect(r.exigeRegApTribSN).toBe(false);
  });

  it("Lucro Real → 1 (também não optante)", () => {
    expect(resolverOpSimpNac("LUCRO_REAL").opSimpNac).toBe("1");
  });

  it("aceita variação de grafia sem inventar regime", () => {
    expect(resolverOpSimpNac("simples nacional").opSimpNac).toBe("3");
    expect(resolverOpSimpNac(" Lucro-Presumido ").opSimpNac).toBe("1");
  });

  it("⚠ MEI é INDEFINIDO — o único apoio para o valor 2 é um comentário de código", () => {
    // O comentário estava no MESMO bloco que cravava opSimpNac=3 para todo mundo, ou seja, foi
    // escrito pela mesma mão que produziu o defeito. E o MEI tem recolhimento em valor fixo, o que
    // muda o resto do grupo `regTrib`. Declarar 2 por analogia seria inventar regra fiscal.
    const r = resolverOpSimpNac("MEI");
    expect(r.resolucao).toBe(RESOLUCAO.INDEFINIDO);
    expect(r.opSimpNac).toBeUndefined();
    expect(r.motivo).toMatch(/leiaute oficial/i);
    expect(OP_SIMP_NAC_POR_REGIME).not.toHaveProperty("MEI");
  });

  it("⚠ regime AUSENTE é INDEFINIDO — não afirma 'não optante' nem 'Simples'", () => {
    // Terceira resposta, na mesma forma de `obrigatoriedadeDefis`/`obrigatoriedadeEfd`: ausência
    // de dado não é uma das duas respostas. O default silencioso é o defeito de que se está saindo.
    for (const vazio of [null, undefined, "", "   "]) {
      const r = resolverOpSimpNac(vazio);
      expect(r.resolucao).toBe(RESOLUCAO.INDEFINIDO);
      expect(r.opSimpNac).toBeUndefined();
    }
  });

  it("regime desconhecido é INDEFINIDO, e a mensagem diz quais são conhecidos", () => {
    const r = resolverOpSimpNac("LUCRO_ARBITRADO");
    expect(r.resolucao).toBe(RESOLUCAO.INDEFINIDO);
    expect(r.motivo).toMatch(/SIMPLES_NACIONAL/);
  });

  it("nenhuma entrada se declara verificada contra o XSD (que não existe no repo)", () => {
    for (const entrada of Object.values(OP_SIMP_NAC_POR_REGIME)) {
      expect(entrada.verificadoNoLeiaute).toBe(false);
      expect(typeof entrada.fonte).toBe("string");
      expect(entrada.fonte.length).toBeGreaterThan(0);
    }
  });
});

describe("tpRetISSQN — a retenção chega ao XML", () => {
  it("issRetido=false → 1 (não retido) — MESMO valor que a emissão aceita usou", () => {
    // O caminho não retido não muda de comportamento: é o `1` de hoje, o da emissão homolog aceita.
    const r = resolverTpRetIssqn(false);
    expect(r.tpRetISSQN).toBe(TP_RET_ISSQN.NAO_RETIDO);
    expect(r.tpRetISSQN).toBe("1");
    expect(r.exigeAliquota).toBe(false);
  });

  it("⚠ issRetido=true → 2 (retido pelo tomador) — antes saía 1, declarando o oposto", () => {
    const r = resolverTpRetIssqn(true);
    expect(r.tpRetISSQN).toBe(TP_RET_ISSQN.RETIDO_TOMADOR);
    expect(r.tpRetISSQN).toBe("2");
  });

  it("com retenção, a alíquota passa a ser exigida (o E0625 já anotado no código)", () => {
    expect(resolverTpRetIssqn(true).exigeAliquota).toBe(true);
  });

  it("só o booleano estrito conta — 'true', 1 e {} não são retenção", () => {
    // Retenção é fato fiscal; coerção frouxa aqui inverteria a declaração de uma nota por causa de
    // um campo de formulário mal tipado.
    for (const naoBooleano of ["true", 1, {}, "sim", null, undefined]) {
      expect(resolverTpRetIssqn(naoBooleano).tpRetISSQN).toBe("1");
    }
  });
});
