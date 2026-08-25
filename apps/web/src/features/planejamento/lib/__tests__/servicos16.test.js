// ⚠⚠ A REGRA DOS R$ 120.000 — IRPJ de 16%, CSLL de 32%. Lei 9.249/1995, art. 15, § 4º.
//
// Trazida pelo dono em 25/08/2026: "o presumido é generalizado, como por exemplo, receita de
// prestação de serviços até 120 mil, IRPJ de 16% e CSLL 32, é baseado nisso que veremos qual
// atividade se encaixa, dividindo as atividades pelas categorias."
//
// ⚠ `PRESUNCAO_IRPJ.servicosAte120k = 0.16` existia como CONSTANTE e nunca entrava em conta
// nenhuma. Medido em produção: 10 das 18 empresas com dado apurado têm receita abaixo de R$ 120
// mil — o simulador presumia o DOBRO do IRPJ na maioria da carteira.

import { custoAnualPresumido, ofertaServicos16 } from "../lucroPresumido";
import { compararRegimes } from "../comparador";
import { PRESUNCAO_IRPJ, PRESUNCAO_CSLL, IRPJ, CSLL_ALIQUOTA } from "../tabelasFiscais";

const base = { receitaAnual: 100_000, atividade: "servicos", folhaAnual: 0, aliquotaIss: null };

describe("⚠⚠ A REDUÇÃO É SÓ DO IRPJ — a CSLL continua em 32%", () => {
  it("confirmado, o IRPJ usa 16% e a CSLL segue em 32%", () => {
    const r = custoAnualPresumido({ ...base, servicosAte120kConfirmado: true });
    // ⚠ A conta é conferida contra a LEI, não contra o próprio motor.
    expect(r.porTributo.irpj).toBeCloseTo(100_000 * PRESUNCAO_IRPJ.servicosAte120k * IRPJ.aliquota, 6);
    expect(r.porTributo.csll).toBeCloseTo(100_000 * PRESUNCAO_CSLL.servicosGeral * CSLL_ALIQUOTA, 6);
  });

  it("⚠ o art. 20 não é alcançado pelo § 4º: a CSLL é IDÊNTICA com e sem a confirmação", () => {
    // Copiar a redução para a CSLL é o erro simétrico ao do transporte de passageiros, que este
    // projeto já cometeu e corrigiu em 15/08/2026.
    const com = custoAnualPresumido({ ...base, servicosAte120kConfirmado: true });
    const sem = custoAnualPresumido({ ...base, servicosAte120kConfirmado: false });
    expect(com.porTributo.csll).toBe(sem.porTributo.csll);
    expect(com.porTributo.irpj).toBeLessThan(sem.porTributo.irpj);
  });

  it("o IRPJ cai pela METADE — 32% para 16%", () => {
    const com = custoAnualPresumido({ ...base, servicosAte120kConfirmado: true });
    const sem = custoAnualPresumido({ ...base, servicosAte120kConfirmado: false });
    expect(com.porTributo.irpj).toBeCloseTo(sem.porTributo.irpj / 2, 6);
  });
});

describe("⚠⚠ NÃO SE LIGA SOZINHA — três estados, e o `null` preserva o de hoje", () => {
  it("NÃO PERGUNTADO (`null`) usa 32%, exatamente como antes desta entrega", () => {
    const semParam = custoAnualPresumido({ ...base });
    const nulo = custoAnualPresumido({ ...base, servicosAte120kConfirmado: null });
    expect(nulo.total).toBe(semParam.total);
    expect(nulo.porTributo.irpj).toBeCloseTo(100_000 * PRESUNCAO_IRPJ.servicosGeral * IRPJ.aliquota, 6);
  });

  it("⚠⚠ e a oferta NÃO RESPONDIDA aparece em `naoConsiderado` — o total pode estar SUPERESTIMADO", () => {
    // Ausência de resposta não é resposta. Sem esta linha o contador vê um total maior do que
    // precisa e não tem como saber por quê.
    const r = custoAnualPresumido({ ...base });
    expect(r.naoConsiderado.join(" ")).toMatch(/SUPERESTIMADO/);
    expect(r.naoConsiderado.join(" ")).toMatch(/art\. 15, § 4º/);
  });

  it("respondido NÃO não deixa aviso de oferta pendente", () => {
    const r = custoAnualPresumido({ ...base, servicosAte120kConfirmado: false });
    expect(r.naoConsiderado.join(" ")).not.toMatch(/SUPERESTIMADO/);
  });
});

describe("⚠⚠ ACIMA DO LIMITE A CONFIRMAÇÃO NÃO COLA (§ 5º)", () => {
  it("receita de R$ 120.000,01 com confirmação ⇒ 32%", () => {
    // O § 5º manda o contrário: estourando no ano, vira 32% RETROATIVO com recolhimento da
    // diferença. Uma confirmação antiga não pode valer sobre uma receita que cresceu.
    const r = custoAnualPresumido({ ...base, receitaAnual: 120_000.01, servicosAte120kConfirmado: true });
    expect(r.servicosAte120k.aplicado).toBe(false);
    expect(r.porTributo.irpj).toBeCloseTo(120_000.01 * PRESUNCAO_IRPJ.servicosGeral * IRPJ.aliquota, 4);
  });

  it("no limite EXATO ainda vale — R$ 120.000,00", () => {
    expect(custoAnualPresumido({ ...base, receitaAnual: 120_000, servicosAte120kConfirmado: true }).servicosAte120k.aplicado).toBe(true);
  });
});

describe("⚠⚠ A OFERTA NOMEIA AS EXCEÇÕES — senão o contador confirma sem saber o quê", () => {
  it("as três exclusões do § 4º e a exigência de exclusividade viajam", () => {
    // Caso concreto na carteira: uma empresa de terapia ocupacional (profissão regulamentada) NÃO
    // teria direito — e o CNAE dela não diz isso.
    const o = ofertaServicos16({ receitaAnual: 100_000 });
    const texto = o.excecoes.join(" | ");
    expect(texto).toMatch(/hospitalares/i);
    expect(texto).toMatch(/transporte/i);
    expect(texto).toMatch(/profissão legalmente regulamentada/i);
    expect(texto).toMatch(/EXCLUSIVAMENTE/i);
  });

  it("a pergunta diz que a CSLL continua em 32% e que o portal não aplica sozinho", () => {
    const o = ofertaServicos16({ receitaAnual: 100_000 });
    expect(o.pergunta).toMatch(/CSLL continua em 32%/);
    expect(o.pergunta).toMatch(/não aplica isto sozinho/i);
  });

  it("⚠ fora da categoria SERVIÇOS a pergunta nem existe", () => {
    for (const a of ["comercio", "transporteCargas", "transportePassageiros", "combustiveis"]) {
      expect(ofertaServicos16({ receitaAnual: 100_000, atividade: a })).toBeNull();
    }
  });

  it("acima do limite a oferta existe mas NÃO cabe, e não há pergunta", () => {
    const o = ofertaServicos16({ receitaAnual: 200_000 });
    expect(o.cabe).toBe(false);
    expect(o.pergunta).toBeNull();
  });

  it("⚠ receita ZERO não cabe — não há o que enquadrar", () => {
    expect(ofertaServicos16({ receitaAnual: 0 }).cabe).toBe(false);
  });
});

describe("⚠ o que foi confirmado SAI IMPRESSO nas premissas", () => {
  it("o PDF diz que o 16% veio de confirmação do contador, com a lei e o risco do § 5º", () => {
    // O PDF circula sozinho; dois PDFs da mesma empresa com IRPJ diferente precisam se distinguir
    // no papel, senão a diferença parece erro de cálculo.
    const p = custoAnualPresumido({ ...base, servicosAte120kConfirmado: true }).premissas.join(" | ");
    expect(p).toMatch(/POR CONFIRMAÇÃO DO CONTADOR/);
    expect(p).toMatch(/art\. 15, § 4º/);
    expect(p).toMatch(/RETROATIVA/);
    expect(p).toMatch(/Presunção de IRPJ 16,0%/);
  });
});

describe("⚠ o comparador repassa a confirmação", () => {
  it("com ela, o Lucro Presumido fica mais barato — e o vencedor pode mudar", () => {
    const args = { receitaAnual: 100_000, rbt12: 100_000, folhaAnual: 30_000, anexoSimples: "III", atividadePresumido: "servicos" };
    const sem = compararRegimes(args).regimes.find((r) => r.regime === "Lucro Presumido");
    const com = compararRegimes({ ...args, servicosAte120kConfirmado: true }).regimes.find((r) => r.regime === "Lucro Presumido");
    expect(com.total).toBeLessThan(sem.total);
  });
});
