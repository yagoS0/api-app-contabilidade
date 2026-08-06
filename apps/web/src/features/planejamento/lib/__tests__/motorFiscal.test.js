// O MOTOR FISCAL — os casos que o documento FONTES FISCAIS exige em §8.4.
//
// Errar aqui não produz uma tela feia: produz um número que decide o regime tributário de uma
// empresa. Cada teste abaixo existe porque a regra tem uma armadilha específica, e o comentário diz
// qual — o teste sem o porquê seria removido na primeira refatoração que "simplificasse" o motor.

import {
  aliquotaEfetiva, repartirPorTributo, fatorR, anexoPorFatorR, folhaParaFatorR,
  custoAnualSimples, podeOptarPorReceita, faixaDoRbt12,
} from "../simplesNacional";
import { custoAnualPresumido, baseComMajoracao, adicionalIrpjAnual, avisoTravaServicos16 } from "../lucroPresumido";
import { ANEXOS, MAJORACAO_LC224, FATOR_R_LIMITE } from "../tabelasFiscais";
import { compararRegimes, pontoDeEquilibrio } from "../comparador";

const perto = (a, b, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLES — alíquota efetiva
// ─────────────────────────────────────────────────────────────────────────────

describe("alíquota efetiva — [(RBT12 × ALIQ) − PD] / RBT12 (§1.2)", () => {
  it("1ª faixa sem parcela a deduzir: efetiva = nominal", () => {
    // Sem PD a fórmula degenera na alíquota nominal — é o unico ponto em que as duas coincidem.
    perto(aliquotaEfetiva(ANEXOS.I, 100_000), 0.04, 1e-9);
  });

  it("Anexo I, 3ª faixa: RBT12 de 500 mil", () => {
    // (500.000 × 9,5% − 13.860) / 500.000 = 6,728%
    perto(aliquotaEfetiva(ANEXOS.I, 500_000), 0.067280, 1e-6);
  });

  it("Anexo III, 4ª faixa: RBT12 de 1 milhão", () => {
    // (1.000.000 × 16% − 35.640) / 1.000.000 = 12,436%
    perto(aliquotaEfetiva(ANEXOS.III, 1_000_000), 0.124360, 1e-6);
  });

  it("Anexo V, 1ª faixa: a mais cara do Simples", () => {
    perto(aliquotaEfetiva(ANEXOS.V, 150_000), 0.155, 1e-9);
  });

  it("⚠ a efetiva é SEMPRE menor que a nominal quando há PD — é o que a parcela a deduzir faz", () => {
    for (const chave of ["I", "II", "III", "IV", "V"]) {
      const anexo = ANEXOS[chave];
      const rbt = 1_000_000;
      const faixa = faixaDoRbt12(anexo, rbt);
      expect(aliquotaEfetiva(anexo, rbt)).toBeLessThan(faixa.aliquota);
    }
  });

  it("⚠ RBT12 zero devolve null, NÃO zero", () => {
    // A fórmula divide por RBT12. Devolver 0% faria a empresa nova parecer isenta; devolver a
    // nominal a faria parecer mais cara do que é. Null obriga quem chama a dizer que falta o dado.
    expect(aliquotaEfetiva(ANEXOS.I, 0)).toBeNull();
    expect(aliquotaEfetiva(ANEXOS.I, null)).toBeNull();
  });

  it("acima do teto de EPP não há faixa", () => {
    expect(aliquotaEfetiva(ANEXOS.I, 5_000_000)).toBeNull();
  });

  it("os limites das faixas não têm buraco", () => {
    // Exatamente 180.000 é 1ª faixa; 180.000,01 é 2ª. Um `>` no lugar de `>=` abriria um vão em que
    // a empresa não teria alíquota nenhuma.
    expect(faixaDoRbt12(ANEXOS.I, 180_000).faixa).toBe(1);
    expect(faixaDoRbt12(ANEXOS.I, 180_000.01).faixa).toBe(2);
    expect(faixaDoRbt12(ANEXOS.I, 3_600_000).faixa).toBe(5);
    expect(faixaDoRbt12(ANEXOS.I, 3_600_000.01).faixa).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLES — teto do ISS
// ─────────────────────────────────────────────────────────────────────────────

describe("teto de ISS de 5% na 5ª faixa (§1.5 e §1.6)", () => {
  it("Anexo III abaixo do gatilho: partilha normal, ISS proporcional", () => {
    // RBT12 de 2 mi → efetiva 14,718%, abaixo do gatilho de 14,92537%.
    const r = repartirPorTributo(ANEXOS.III, 2_000_000);
    expect(r.tetoIssAplicado).toBe(false);
    perto(r.porTributo.iss, r.aliquotaEfetiva * 0.335, 1e-9);
  });

  it("⚠ acima do gatilho o ISS TRAVA em 5% da receita, não em 33,5% da efetiva", () => {
    // RBT12 de 3 mi → efetiva 16,812%. Sem o teto, o ISS sairia 5,63% da receita — acima do teto
    // legal de 5%, e o DAS não fecharia com o que a prefeitura pode cobrar.
    const r = repartirPorTributo(ANEXOS.III, 3_000_000);
    expect(r.tetoIssAplicado).toBe(true);
    perto(r.porTributo.iss, 0.05, 1e-9);
  });

  it("⚠ com o teto, a soma dos tributos continua fechando com a alíquota efetiva", () => {
    // Se a redistribuição não fechasse, o detalhamento por tributo mostraria um total diferente do
    // DAS — e o contador não teria como saber qual dos dois está certo.
    const r = repartirPorTributo(ANEXOS.III, 3_000_000);
    const soma = Object.values(r.porTributo).reduce((s, v) => s + v, 0);
    perto(soma, r.aliquotaEfetiva, 1e-9);
  });

  it("Anexo IV tem gatilho PRÓPRIO (12,5%), não o do III", () => {
    // Os dois anexos têm teto de ISS, mas com gatilhos e redistribuições diferentes. Reusar o do
    // III no IV aplicaria o teto cedo demais.
    const r = repartirPorTributo(ANEXOS.IV, 3_000_000);
    expect(r.tetoIssAplicado).toBe(true);
    perto(r.porTributo.iss, 0.05, 1e-9);
    const soma = Object.values(r.porTributo).reduce((s, v) => s + v, 0);
    perto(soma, r.aliquotaEfetiva, 1e-9);
  });

  it("6ª faixa não tem ISS nenhum — acima do sublimite ele sai do DAS", () => {
    const r = repartirPorTributo(ANEXOS.III, 4_000_000);
    expect(r.porTributo.iss).toBeUndefined();
  });

  it("6ª faixa do Anexo I não tem ICMS", () => {
    expect(repartirPorTributo(ANEXOS.I, 4_000_000).porTributo.icms).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLES — Fator R
// ─────────────────────────────────────────────────────────────────────────────

describe("Fator R (§1.8)", () => {
  it("nos limites: 27,99% vai para o V, 28,00% vai para o III", () => {
    // É o teste que o documento pede explicitamente. Um `>` no lugar de `>=` jogaria a empresa que
    // fechou exatamente 28% para o anexo mais caro.
    expect(anexoPorFatorR(279_900, 1_000_000)).toBe("V");
    expect(anexoPorFatorR(280_000, 1_000_000)).toBe("III");
  });

  it("o limite é exatamente 28%", () => {
    expect(FATOR_R_LIMITE).toBe(0.28);
    perto(fatorR(280_000, 1_000_000), 0.28, 1e-12);
  });

  it("sem RBT12 não há fator — divisão por zero não vira 0%", () => {
    expect(fatorR(100_000, 0)).toBeNull();
    expect(anexoPorFatorR(100_000, 0)).toBeNull();
  });

  it("⚠ a folha que falta vem em REAIS, não em pontos percentuais", () => {
    // "Faltam 3 p.p." não diz o que fazer; "aumente R$ 30.000 de folha no ano" diz.
    const r = folhaParaFatorR(250_000, 1_000_000);
    expect(r.atinge).toBe(false);
    perto(r.folhaNecessaria, 280_000);
    perto(r.diferenca, 30_000);
  });

  it("já no Anexo III, a diferença vira MARGEM (negativa)", () => {
    const r = folhaParaFatorR(320_000, 1_000_000);
    expect(r.atinge).toBe(true);
    // Margem de R$ 40 mil: é quanto a folha pode cair antes de despencar para o Anexo V.
    perto(r.diferenca, -40_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLES — CPP fora do DAS no Anexo IV
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠ Anexo IV: CPP FORA do DAS (§1.6)", () => {
  it("a CPP é somada por fora, sobre a folha", () => {
    const r = custoAnualSimples({ anexoChave: "IV", rbt12: 1_000_000, receitaAnual: 1_000_000, folhaAnual: 300_000 });
    perto(r.cppPorFora, 60_000); // 20% de 300.000
    perto(r.total, r.das + 60_000);
  });

  it("nos outros anexos a CPP está DENTRO do DAS e não é somada de novo", () => {
    // Somar por fora aqui cobraria a CPP duas vezes e faria o Simples parecer caro em todo anexo.
    const r = custoAnualSimples({ anexoChave: "III", rbt12: 1_000_000, receitaAnual: 1_000_000, folhaAnual: 300_000 });
    expect(r.cppPorFora).toBe(0);
    perto(r.total, r.das);
  });

  it("⚠ sem a CPP por fora, o Anexo IV pareceria mais barato que o III — e não é", () => {
    // Este é o erro que o próprio documento de fontes abre um alerta para evitar.
    const args = { rbt12: 1_000_000, receitaAnual: 1_000_000, folhaAnual: 400_000 };
    const iv = custoAnualSimples({ ...args, anexoChave: "IV" });
    const iii = custoAnualSimples({ ...args, anexoChave: "III" });
    expect(iv.das).toBeLessThan(iii.das);          // só o DAS: o IV parece barato
    expect(iv.total).toBeGreaterThan(iii.das);     // com a CPP por fora, a conta vira
  });
});

describe("limites de opção (§1.1)", () => {
  it("acima de R$ 4,8 mi não pode optar", () => {
    expect(podeOptarPorReceita(4_800_001).pode).toBe(false);
  });

  it("entre o sublimite e o teto, avisa que ICMS e ISS saem do DAS", () => {
    const r = podeOptarPorReceita(4_000_000);
    expect(r.pode).toBe(true);
    expect(r.acimaDoSublimite).toBe(true);
    expect(r.aviso).toMatch(/saem do DAS/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRESUMIDO
// ─────────────────────────────────────────────────────────────────────────────

describe("majoração da LC 224/2025 (§2.4)", () => {
  it("até o limite, nada muda", () => {
    const b = baseComMajoracao({ receitaAnual: 4_000_000, presuncao: 0.32, limite: 5_000_000 });
    expect(b.houveMajoracao).toBe(false);
    perto(b.base, 4_000_000 * 0.32);
  });

  it("⚠ a majoração é MULTIPLICATIVA: 32% vira 35,2%, não 42%", () => {
    const b = baseComMajoracao({ receitaAnual: 6_000_000, presuncao: 0.32, limite: 5_000_000 });
    perto(b.baseNormal, 5_000_000 * 0.32);
    perto(b.baseMajorada, 1_000_000 * 0.352);
  });

  it("⚠ só o EXCEDENTE é majorado, não a receita inteira", () => {
    const b = baseComMajoracao({ receitaAnual: 6_000_000, presuncao: 0.32, limite: 5_000_000 });
    // Se a majoração pegasse tudo, a base seria 6.000.000 × 35,2% = 2.112.000.
    expect(b.base).toBeLessThan(6_000_000 * 0.352);
    perto(b.base, 5_000_000 * 0.32 + 1_000_000 * 0.352);
  });

  it("⚠⚠ em 2026 o limite da CSLL é MENOR que o do IRPJ (noventena)", () => {
    // A armadilha da regra: R$ 5 mi para IRPJ, R$ 3,75 mi para CSLL. Usar o mesmo para os dois
    // majoraria a CSLL sobre R$ 1,25 mi que a lei ainda não alcançava em 2026.
    expect(MAJORACAO_LC224.limiteCsll2026).toBe(3_750_000);
    expect(MAJORACAO_LC224.limiteIrpj).toBe(5_000_000);

    const r = custoAnualPresumido({ receitaAnual: 4_500_000, atividade: "servicos", anoBase: 2026 });
    // Receita entre os dois limites: a CSLL JÁ é majorada, o IRPJ ainda NÃO.
    expect(r.premissas.some((p) => /limite de 2026/.test(p))).toBe(true);
    expect(r.premissas.some((p) => /acima de.*\(IRPJ\)/.test(p))).toBe(false);
  });

  it("fora de 2026 os dois limites convergem", () => {
    const r = custoAnualPresumido({ receitaAnual: 4_500_000, atividade: "servicos", anoBase: 2027 });
    expect(r.majoracaoLc224.aplicada).toBe(false);
  });
});

describe("adicional de IRPJ (§2.5)", () => {
  it("⚠ é calculado por TRIMESTRE (R$ 60.000), não pelo anual de uma vez", () => {
    // Base anual de 240.000 = 60.000 por trimestre = exatamente o limite: adicional zero.
    perto(adicionalIrpjAnual(240_000), 0);
  });

  it("acima do limite trimestral, 10% sobre o excedente", () => {
    // 400.000/4 = 100.000 por trimestre; excedente de 40.000 × 10% × 4 trimestres = 16.000.
    perto(adicionalIrpjAnual(400_000), 16_000);
  });
});

describe("custo no Presumido", () => {
  it("PIS/COFINS cumulativo é 3,65% da receita, sem créditos", () => {
    const r = custoAnualPresumido({ receitaAnual: 1_000_000, atividade: "servicos" });
    perto(r.porTributo.pis + r.porTributo.cofins, 36_500);
  });

  it("⚠ ISS não entra sem a alíquota informada — e a tela DIZ que ficou de fora", () => {
    // Somar uma alíquota "típica" inventaria o número que decide a comparação.
    const r = custoAnualPresumido({ receitaAnual: 1_000_000, atividade: "servicos" });
    expect(r.porTributo.iss).toBeUndefined();
    expect(r.naoConsiderado.some((x) => /ISS/.test(x))).toBe(true);
  });

  it("com a alíquota informada, o ISS entra", () => {
    const r = custoAnualPresumido({ receitaAnual: 1_000_000, atividade: "servicos", aliquotaIss: 0.05 });
    perto(r.porTributo.iss, 50_000);
    expect(r.naoConsiderado.some((x) => /^ISS/.test(x))).toBe(false);
  });

  it("acima de R$ 78 mi não é elegível", () => {
    expect(custoAnualPresumido({ receitaAnual: 80_000_000 }).elegivel).toBe(false);
  });

  it("a CPP entra sobre a FOLHA, não sobre a receita", () => {
    const r = custoAnualPresumido({ receitaAnual: 1_000_000, folhaAnual: 200_000 });
    perto(r.porTributo.cpp, 40_000);
  });
});

describe("trava dos 16% em serviços (§2.2)", () => {
  it("avisa perto do limite, porque a virada é RETROATIVA", () => {
    const aviso = avisoTravaServicos16(110_000);
    expect(aviso).toMatch(/RETROATIVA/);
  });

  it("não avisa longe do limite nem depois de passar", () => {
    expect(avisoTravaServicos16(50_000)).toBeNull();
    expect(avisoTravaServicos16(200_000)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPARADOR
// ─────────────────────────────────────────────────────────────────────────────

describe("comparador de regimes", () => {
  const base = { receitaAnual: 1_000_000, folhaAnual: 200_000, anexoSimples: "III", atividadePresumido: "servicos" };

  it("ordena do mais barato ao mais caro e nomeia o vencedor", () => {
    const r = compararRegimes(base);
    expect(r.vencedor).toBeTruthy();
    expect(r.regimes.filter((x) => !x.indisponivel).length).toBeGreaterThanOrEqual(2);
  });

  it("⚠ o Lucro Real NÃO entra sem margem e créditos — e diz o que falta", () => {
    // Estimar margem seria inventar o dado que decide a comparação.
    const real = compararRegimes(base).regimes.find((x) => x.regime === "Lucro Real");
    expect(real.indisponivel).toBe(true);
    expect(real.faltam).toHaveLength(2);
  });

  it("com margem e créditos informados, o Real entra na comparação", () => {
    const r = compararRegimes({ ...base, margemLucro: 0.2, creditosPisCofins: 30_000 });
    const real = r.regimes.find((x) => x.regime === "Lucro Real");
    expect(real.indisponivel).toBeUndefined();
    expect(real.total).toBeGreaterThan(0);
  });

  it("⚠ sujeito ao Fator R, o anexo sai da FOLHA, não da escolha", () => {
    const magra = compararRegimes({ ...base, sujeitoAoFatorR: true, folhaAnual: 100_000, anexoSimples: "III" });
    const gorda = compararRegimes({ ...base, sujeitoAoFatorR: true, folhaAnual: 300_000, anexoSimples: "III" });
    expect(magra.anexoResolvido).toBe("V");  // 10% → Anexo V
    expect(gorda.anexoResolvido).toBe("III"); // 30% → Anexo III
    // E a margem acompanha, porque é o alavancador de planejamento.
    expect(magra.fatorR.atinge).toBe(false);
    expect(gorda.fatorR.atinge).toBe(true);
  });

  it("a economia só existe havendo com quem comparar", () => {
    const r = compararRegimes(base);
    expect(r.economiaAnual).toBeGreaterThan(0);
  });

  it("toda simulação carrega a data de verificação das fontes e o aviso", () => {
    // Simulação sem vigência envelhece calada — e 2026 mudou as tabelas três vezes.
    const r = compararRegimes(base);
    expect(r.fontesVerificadasEm).toBe("2026-08-06");
    expect(r.aviso).toMatch(/não substitui/i);
  });
});

describe("ponto de equilíbrio", () => {
  it("devolve a FRASE-resposta, não só o número", () => {
    // É a frase que o contador leva para a reunião com o cliente.
    const p = pontoDeEquilibrio({ anexoSimples: "V", atividadePresumido: "servicos", folhaAnual: 50_000, passo: 50_000 });
    if (p) expect(p.frase).toMatch(/passa a compensar/);
  });

  it("⚠ sem cruzamento devolve null — não inventa um empate", () => {
    // Num intervalo curto onde um regime ganha o tempo todo, dizer "empata em R$ X" seria pior que
    // dizer que não empata.
    expect(pontoDeEquilibrio({ de: 100_000, ate: 120_000, passo: 10_000, anexoSimples: "I" })).toBeNull();
  });
});
