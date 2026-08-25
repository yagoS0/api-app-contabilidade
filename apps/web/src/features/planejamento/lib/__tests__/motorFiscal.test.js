// O MOTOR FISCAL — os casos que o documento FONTES FISCAIS exige em §8.4.
//
// Errar aqui não produz uma tela feia: produz um número que decide o regime tributário de uma
// empresa. Cada teste abaixo existe porque a regra tem uma armadilha específica, e o comentário diz
// qual — o teste sem o porquê seria removido na primeira refatoração que "simplificasse" o motor.

import {
  aliquotaEfetiva, repartirPorTributo, fatorR, anexoPorFatorR, folhaParaFatorR,
  custoAnualSimples, podeOptarPorReceita, faixaDoRbt12,
  rbt12InicioAtividade, INICIO_ATIVIDADE, limiteProporcionalInicioAtividade,
  tributosForaDoDasNaSextaFaixa,
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
// SIMPLES — início de atividade (art. 18, § 2º / CGSN 140/2018, art. 22)
// ─────────────────────────────────────────────────────────────────────────────

describe("início de atividade — RBT12 proporcionalizado", () => {
  // Série em rampa: é o formato real de quem abriu agora, e é a única forma de distinguir
  // "média dos meses anteriores" de "média dos meses decorridos". Com receita constante as duas
  // dão o mesmo número e o teste não provaria nada.
  const rampa = [10_000, 20_000, 30_000, 40_000];

  it("1º mês: a receita do PRÓPRIO mês × 12 (§ 2º)", () => {
    // É o único mês em que o mês de apuração entra na própria conta — não há anterior.
    const r = rbt12InicioAtividade({ mesesDeAtividade: 1, receitasMensais: rampa });
    perto(r.rbt12, 120_000, 1e-9); // 10.000 × 12
    expect(r.regra).toBe("art. 22, § 2º");
    expect(r.proporcionalizado).toBe(true);
  });

  it("⚠ 2º mês: média dos meses ANTERIORES — o mês corrente NÃO entra (§ 3º)", () => {
    // A armadilha da regra. O § 3º diz "meses anteriores ao do período de apuração":
    //   certo  → 10.000 / 1 × 12 = 120.000
    //   errado → (10.000 + 20.000) / 2 × 12 = 180.000  ← "meses decorridos", como diz muito resumo
    // A diferença não é acadêmica: 180.000 é exatamente a fronteira da 1ª faixa.
    const r = rbt12InicioAtividade({ mesesDeAtividade: 2, receitasMensais: rampa });
    perto(r.rbt12, 120_000, 1e-9);
    expect(r.rbt12).not.toBeCloseTo(180_000, 6);
    expect(r.mesesNaMedia).toBe(1);
    expect(r.regra).toBe("art. 22, § 3º");
  });

  it("4º mês: média dos três anteriores × 12", () => {
    // (10.000 + 20.000 + 30.000) / 3 = 20.000 → × 12 = 240.000. O 4º mês (40.000) fica de fora.
    const r = rbt12InicioAtividade({ mesesDeAtividade: 4, receitasMensais: rampa });
    perto(r.rbt12, 240_000, 1e-9);
    expect(r.mesesNaMedia).toBe(3);
  });

  it("⚠ a transição do 12º para o 13º mês: proporcionalizado vira REAL (§ 4º, II)", () => {
    // Seis meses a 10.000 e seis a 50.000 — soma de 360.000 no ano.
    const serie = [...Array(6).fill(10_000), ...Array(6).fill(50_000)];

    // 12º mês, ainda § 3º: média dos ONZE anteriores = (60.000 + 250.000) / 11 = 28.181,81...
    const m12 = rbt12InicioAtividade({ mesesDeAtividade: 12, receitasMensais: serie });
    expect(m12.proporcionalizado).toBe(true);
    perto(m12.rbt12, (310_000 / 11) * 12, 1e-6); // 338.181,82

    // 13º mês: acabou a proporcionalização — RBT12 real dos 12 meses anteriores = 360.000.
    const m13 = rbt12InicioAtividade({ mesesDeAtividade: 13, receitasMensais: serie });
    expect(m13.proporcionalizado).toBe(false);
    expect(m13.regra).toBe("art. 22, § 1º");
    perto(m13.rbt12, 360_000, 1e-9);
    expect(m13.mesesNaMedia).toBe(12);

    // E a virada MUDA o número: se os dois coincidissem, o teste não provaria a transição.
    expect(Math.abs(m13.rbt12 - m12.rbt12)).toBeGreaterThan(20_000);
  });

  it("o 12º mês é o último proporcionalizado", () => {
    const serie = Array(20).fill(10_000);
    expect(rbt12InicioAtividade({ mesesDeAtividade: 12, receitasMensais: serie }).proporcionalizado).toBe(true);
    expect(rbt12InicioAtividade({ mesesDeAtividade: 13, receitasMensais: serie }).proporcionalizado).toBe(false);
    expect(INICIO_ATIVIDADE.ultimoMesProporcionalizado).toBe(12);
  });

  it("⚠ com receita UNIFORME, § 2º e § 3º convergem — é a premissa que a tela declara", () => {
    // A tela trabalha em ano, não em série mensal: ela assume receita mensal uniforme. Sob essa
    // premissa o mês de atividade deixa de alterar o RBT12, e é por isso que a tela pode pedir só
    // `mesesDeAtividade` sem pedir doze campos. A premissa está na tela, não escondida aqui.
    const valores = [1, 2, 5, 9, 12].map(
      (m) => rbt12InicioAtividade({ mesesDeAtividade: m, receitaMensalMedia: 30_000 }).rbt12,
    );
    for (const v of valores) perto(v, 360_000, 1e-9);
  });

  it("⚠ receita zero vale R$ 1,00 SÓ na fórmula (art. 21, par. único)", () => {
    // Sem o piso, a divisão por zero apagaria a alíquota de quem abriu e ainda não faturou. Com ele,
    // a empresa cai na 1ª faixa (PD zero) e a efetiva sai igual à nominal — e o DAS sai zero de
    // qualquer forma, porque incide sobre receita zero.
    const r = rbt12InicioAtividade({ mesesDeAtividade: 1, receitaMensalMedia: 0 });
    expect(r.rbt12).toBe(0);            // o fato: não houve receita
    expect(r.rbt12ParaAliquota).toBe(1); // a convenção de cálculo, separada do fato
    perto(aliquotaEfetiva(ANEXOS.I, r.rbt12ParaAliquota), 0.04, 1e-9);
  });

  it("sem meses de atividade válidos não há regra — devolve null, não um palpite", () => {
    expect(rbt12InicioAtividade({ mesesDeAtividade: 0, receitaMensalMedia: 10_000 })).toBeNull();
    expect(rbt12InicioAtividade({ mesesDeAtividade: null, receitaMensalMedia: 10_000 })).toBeNull();
    // Meses informados, mas nenhuma receita: não dá para proporcionalizar o que não se sabe.
    expect(rbt12InicioAtividade({ mesesDeAtividade: 3 })).toBeNull();
  });

  it("⚠⚠ a empresa nova DEIXA de cair em `indisponivel` — era o bug que a regra fecha", () => {
    // Antes: sem RBT12 histórico, `custoAnualSimples` recusava calcular e a empresa recém-aberta
    // (usuária mais provável do módulo) não conseguia comparar regime nenhum.
    const semHistorico = custoAnualSimples({ anexoChave: "I", rbt12: 0, receitaAnual: 500_000 });
    expect(semHistorico.indisponivel).toBe(true);

    const inicio = custoAnualSimples({ anexoChave: "I", rbt12: 0, receitaAnual: 500_000, mesesDeAtividade: 3 });
    expect(inicio.indisponivel).toBeUndefined();
    expect(inicio.total).toBeGreaterThan(0);
    // E o resultado DIZ que o RBT12 é premissa, não histórico.
    expect(inicio.inicioAtividade.proporcionalizado).toBe(true);
    expect(inicio.premissas.some((p) => /PROPORCIONALIZADO/.test(p))).toBe(true);
  });

  it("no 13º mês a premissa some — o RBT12 voltou a ser real", () => {
    const r = custoAnualSimples({ anexoChave: "I", rbt12: 0, receitaAnual: 500_000, mesesDeAtividade: 13 });
    expect(r.inicioAtividade.proporcionalizado).toBe(false);
    expect(r.premissas.some((p) => /PROPORCIONALIZADO/.test(p))).toBe(false);
  });

  it("⚠ o Fator R também sai do RBT12 proporcionalizado, não do vazio", () => {
    // O Fator R se calcula sobre o RBT12 (§ 5º-J). Deixá-lo com o RBT12 vazio da empresa nova daria
    // "sem fator" numa tela que acabou de conseguir calcular o anexo.
    const r = compararRegimes({
      receitaAnual: 1_000_000, folhaAnual: 300_000, sujeitoAoFatorR: true,
      atividadePresumido: "servicos", mesesDeAtividade: 2, rbt12: null,
    });
    expect(r.inicioAtividade.proporcionalizado).toBe(true);
    perto(r.inicioAtividade.rbt12, 1_000_000, 1e-6); // (1.000.000 / 12) × 12
    expect(r.fatorR).not.toBeNull();
    expect(r.anexoResolvido).toBe("III"); // 300.000 / 1.000.000 = 30% ≥ 28%
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
// SIMPLES — acima do sublimite: ICMS/ISS fora do DAS (art. 13-A, §1.1)
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠⚠ 6ª faixa: o que sai do DAS volta à conta, ou vai escrito", () => {
  it("quem sai é lido da TABELA, não de uma lista escrita à mão", () => {
    // Anexo I perde o ICMS; III, IV e V perdem o ISS; o II perde o ICMS e mantém o IPI.
    expect(tributosForaDoDasNaSextaFaixa(ANEXOS.I)).toEqual(["icms"]);
    expect(tributosForaDoDasNaSextaFaixa(ANEXOS.II)).toEqual(["icms"]);
    expect(tributosForaDoDasNaSextaFaixa(ANEXOS.III)).toEqual(["iss"]);
    expect(tributosForaDoDasNaSextaFaixa(ANEXOS.IV)).toEqual(["iss"]);
    expect(tributosForaDoDasNaSextaFaixa(ANEXOS.V)).toEqual(["iss"]);
  });

  it("⚠ ABAIXO do sublimite a alíquota de ISS é IGNORADA — o ISS já está no DAS", () => {
    // Somar de novo aqui cobraria o mesmo imposto duas vezes e faria o Simples parecer caro em
    // toda faixa onde ele é competitivo.
    const semIss = custoAnualSimples({ anexoChave: "III", rbt12: 2_000_000, receitaAnual: 2_000_000 });
    const comIss = custoAnualSimples({ anexoChave: "III", rbt12: 2_000_000, receitaAnual: 2_000_000, aliquotaIss: 0.05 });
    expect(comIss.issPorFora).toBe(0);
    perto(comIss.total, semIss.total, 1e-9);
    expect(comIss.acimaDoSublimite).toBe(false);
    // E o ISS que aparece no detalhamento é o da partilha, não o do município.
    perto(comIss.porTributo.iss, semIss.porTributo.iss, 1e-9);
  });

  it("⚠⚠ ACIMA do sublimite, sem a alíquota, o número menor vem com a RESSALVA — não em silêncio", () => {
    // Era o defeito: `custoAnualSimples` não devolvia `naoConsiderado` nenhum, então o card do
    // Simples mostrava um total reduzido sem uma linha de ressalva, ao lado de um Presumido que
    // soma o ISS e ainda imprime o próprio "Fora desta conta".
    const r = custoAnualSimples({ anexoChave: "III", rbt12: 4_000_000, receitaAnual: 4_000_000 });
    expect(r.acimaDoSublimite).toBe(true);
    expect(r.naoConsiderado.some((x) => /^ISS/.test(x))).toBe(true);
    expect(r.premissas.some((p) => /art\. 13-A/.test(p))).toBe(true);
  });

  it("no Anexo I acima do sublimite a ressalva é do ICMS, que ninguém estima aqui", () => {
    // A alíquota de ICMS varia por estado, NCM e operação: não há número a somar, só a ressalva.
    const r = custoAnualSimples({ anexoChave: "I", rbt12: 4_000_000, receitaAnual: 4_000_000, aliquotaIss: 0.05 });
    expect(r.issPorFora).toBe(0);
    expect(r.naoConsiderado.some((x) => /^ICMS/.test(x))).toBe(true);
  });

  it("informada a alíquota, o ISS entra no total, no detalhamento e na premissa", () => {
    const r = custoAnualSimples({ anexoChave: "III", rbt12: 4_000_000, receitaAnual: 4_000_000, aliquotaIss: 0.05 });
    perto(r.issPorFora, 200_000);
    perto(r.total, r.das + 200_000);
    // Deixa de ser ausência: vira valor, e a ressalva de ISS sai da lista.
    expect(r.naoConsiderado.some((x) => /^ISS/.test(x))).toBe(false);
    expect(r.premissas.some((p) => /somado POR FORA do DAS/.test(p))).toBe(true);
  });

  it("abaixo da 6ª faixa não há ressalva de sublimite — a regra é da 6ª faixa, não de todo Simples", () => {
    const r = custoAnualSimples({ anexoChave: "III", rbt12: 2_000_000, receitaAnual: 2_000_000 });
    expect(r.naoConsiderado).toEqual([]);
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

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLES — limite PROPORCIONAL no ano de início (art. 3º, §§ 2º e 10 a 13)
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠⚠ guarda: limite proporcional do ano de início de atividade", () => {
  it("o limite é R$ 400.000 por mês de atividade, não R$ 4,8 mi", () => {
    // CGSN 140/2018, art. 3º, caput. Empresa aberta em outubro → 3 meses → R$ 1,2 mi.
    const g = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 0 });
    perto(g.limite, 1_200_000);
    perto(g.sublimite, 900_000); // 3 × R$ 300.000 (art. 12, § 2º)
  });

  it("⚠ o cenário que a guarda existe para barrar: passa no teto anual e estoura o proporcional", () => {
    // R$ 1,5 mi passa folgado no teto de R$ 4,8 mi — e estoura o limite de 3 meses (R$ 1,2 mi) em
    // 25%, que é acima da tolerância. Sem esta checagem o simulador diria "opte pelo Simples".
    const semGuarda = podeOptarPorReceita(1_500_000);
    expect(semGuarda.pode).toBe(true);

    const comGuarda = podeOptarPorReceita(1_500_000, { mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_500_000 });
    expect(comGuarda.pode).toBe(false);
    expect(comGuarda.inicioAtividade.efeitoExclusao).toBe("retroativo_ao_inicio");
  });

  it("⚠ o degrau de 20% muda a CONSEQUÊNCIA, não só a mensagem (§§ 10 e 12)", () => {
    // Limite de 3 meses = R$ 1.200.000. Tolerância de 20% = R$ 240.000.
    //   R$ 1.400.000 → excesso de 200.000 (≤ 240.000) → efeitos no ano seguinte
    //   R$ 1.500.000 → excesso de 300.000 (>  240.000) → RETROAGE ao início
    const dentroDaTolerancia = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_400_000 });
    expect(dentroDaTolerancia.excedeu).toBe(true);
    expect(dentroDaTolerancia.efeitoExclusao).toBe("ano_calendario_subsequente");

    const acimaDaTolerancia = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_500_000 });
    expect(acimaDaTolerancia.efeitoExclusao).toBe("retroativo_ao_inicio");
  });

  it("exatamente 20% de excesso ainda NÃO retroage — o § 12 diz 'não superior a 20%'", () => {
    // Fronteira: R$ 1.200.000 + 20% = R$ 1.440.000. Um `>=` no lugar de `>` faria a empresa que
    // parou exatamente no degrau perder o ano inteiro.
    const g = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_440_000 });
    expect(g.efeitoExclusao).toBe("ano_calendario_subsequente");
    const acima = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_440_000.01 });
    expect(acima.efeitoExclusao).toBe("retroativo_ao_inicio");
  });

  it("⚠ fração de mês conta como mês COMPLETO (art. 3º, § 2º)", () => {
    // Quem abriu em 20 de setembro tem setembro inteiro: 4 meses até dezembro. Arredondar para
    // baixo daria R$ 1,2 mi de limite em vez de R$ 1,6 mi e acusaria estouro onde não há.
    const g = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3.3, receitaNoAnoDeInicio: 1_500_000 });
    expect(g.meses).toBe(4);
    perto(g.limite, 1_600_000);
    expect(g.excedeu).toBe(false);
  });

  it("no ano cheio (12 meses) o limite proporcional reencontra o teto do Simples", () => {
    const g = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 12, receitaNoAnoDeInicio: 0 });
    perto(g.limite, 4_800_000);
    perto(g.sublimite, 3_600_000);
  });

  it("a margem até estourar vem em REAIS — é o que dá para decidir", () => {
    const g = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_000_000 });
    perto(g.margem, 200_000);
    perto(g.consumoDoLimite, 1_000_000 / 1_200_000, 1e-9);
    expect(g.excedeu).toBe(false);
  });

  it("⚠ excesso RETROATIVO derruba o regime da comparação — não vence quem não pode optar", () => {
    // Sem isso, o card diria "MENOR CARGA" para um regime do qual a empresa será excluída com
    // efeitos retroativos ao início das atividades.
    const r = custoAnualSimples({
      anexoChave: "I", rbt12: null, receitaAnual: 6_000_000, receitasMensais: Array(3).fill(500_000),
      mesesDeAtividade: 3,
    });
    expect(r.elegivel).toBe(false);
    expect(r.motivo).toMatch(/retroage ao início das atividades/);
    expect(r.elegibilidadeInicioAtividade.efeitoExclusao).toBe("retroativo_ao_inicio");
  });

  it("excesso dentro da tolerância mantém o cálculo do ano, com o aviso na premissa", () => {
    // ⚠ A receita PRECISA estar concentrada no mês corrente, e não é detalhe do teste: o RBT12 do
    // 3º mês olha só os meses ANTERIORES (§ 3º), enquanto o limite proporcional olha o período
    // INTEIRO. Série [100k, 100k, 1,2 mi]:
    //   RBT12  = média(100k, 100k) × 12 = 1.200.000  → dentro do teto do Simples
    //   período = 100k + 100k + 1,2 mi  = 1.400.000  → estoura o limite de 1.200.000 em 200.000
    //   200.000 ≤ 20% de 1.200.000 (240.000) → fica no Simples este ano, sai no seguinte
    const r = custoAnualSimples({
      anexoChave: "I", rbt12: null, receitaAnual: 1_400_000, receitasMensais: [100_000, 100_000, 1_200_000],
      mesesDeAtividade: 3,
    });
    expect(r.elegivel).toBeUndefined();
    expect(r.elegibilidadeInicioAtividade.efeitoExclusao).toBe("ano_calendario_subsequente");
    expect(r.premissas.some((p) => /excluída a partir do ano-calendário seguinte/.test(p))).toBe(true);
  });

  it("⚠ sob receita UNIFORME a guarda não dispara sozinha — quem a faz morder é a série", () => {
    // Com receita uniforme, receita do período = (anual/12) × meses e limite = 400.000 × meses:
    // os dois crescem juntos, então o proporcional só estoura quando o anual também estouraria.
    // É por isso que o detalhamento mês a mês não é luxo — é o que dá dentes a esta checagem.
    const uniforme = custoAnualSimples({ anexoChave: "I", rbt12: null, receitaAnual: 4_000_000, mesesDeAtividade: 3 });
    expect(uniforme.elegibilidadeInicioAtividade.excedeu).toBe(false);

    // Mesma receita anual projetada, mas concentrada nos meses já decorridos: agora estoura.
    const emRampa = custoAnualSimples({
      anexoChave: "I", rbt12: null, receitaAnual: 4_000_000,
      receitasMensais: [200_000, 600_000, 1_600_000], mesesDeAtividade: 3,
    });
    expect(emRampa.elegibilidadeInicioAtividade.excedeu).toBe(true);
  });

  it("do 13º mês em diante a guarda não se aplica — a empresa saiu do ano de início", () => {
    const r = custoAnualSimples({ anexoChave: "I", rbt12: 500_000, receitaAnual: 500_000, mesesDeAtividade: 13 });
    expect(r.elegibilidadeInicioAtividade).toBeNull();
  });

  it("meses fora de 1 a 12 não produzem limite — não se inventa proporção", () => {
    expect(limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 0, receitaNoAnoDeInicio: 10 })).toBeNull();
    expect(limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 13, receitaNoAnoDeInicio: 10 })).toBeNull();
  });

  it("o sublimite de ICMS/ISS tem o MESMO degrau de 20%, com efeito próprio (art. 12, § 4º)", () => {
    // Sublimite de 3 meses = R$ 900.000; tolerância = R$ 180.000.
    const dentro = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_050_000 });
    expect(dentro.excedeuSublimite).toBe(true);
    expect(dentro.efeitoSublimite).toBe("ano_calendario_subsequente");

    const acima = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 3, receitaNoAnoDeInicio: 1_150_000 });
    expect(acima.efeitoSublimite).toBe("retroativo_ao_inicio");
  });

  it("UF com sublimite reduzido usa R$ 150.000/mês — e é PARÂMETRO, não escolha do motor", () => {
    const g = limiteProporcionalInicioAtividade({ mesesNoAnoDeInicio: 4, receitaNoAnoDeInicio: 0, sublimiteMensal: 150_000 });
    perto(g.sublimite, 600_000); // 4 × 150.000, par do sublimite de R$ 1,8 mi (art. 9º, caput)
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

  it("⚠⚠ o ISS acima do sublimite INVERTE o vencedor — é o efeito do defeito corrigido", () => {
    // Anexo III, receita e RBT12 de R$ 4 mi (6ª faixa), ISS de 5%, folha zero:
    //   Simples   DAS 672.000 + ISS por fora 200.000 = 872.000
    //   Presumido IRPJ 192.000 + adicional 104.000 + CSLL 115.920 + PIS/COFINS 146.000
    //             + ISS 200.000                                   = 757.920
    // Sem o ISS no lado do Simples, o comparador via 672.000 × 757.920 e coroava o Simples; com
    // ele, o Presumido ganha. O mesmo imposto existia nos dois lados e só aparecia em um.
    const args = {
      receitaAnual: 4_000_000, rbt12: 4_000_000, anexoSimples: "III",
      atividadePresumido: "servicos", aliquotaIss: 0.05, folhaAnual: 0,
    };
    const r = compararRegimes(args);
    const simples = r.regimes.find((x) => x.regime === "Simples Nacional");
    const presumido = r.regimes.find((x) => x.regime === "Lucro Presumido");

    perto(simples.das, 672_000);
    perto(simples.issPorFora, 200_000);
    perto(simples.total, 872_000);
    perto(presumido.total, 757_920);
    expect(r.vencedor.regime).toBe("Lucro Presumido");

    // A PROVA DE QUE A INVERSÃO É DO ISS, reconstruindo a comparação ASSIMÉTRICA de antes: o
    // Simples sem o ISS (era o que o comparador fazia — não passava a alíquota) contra o mesmo
    // Presumido, que sempre o somou. 672.000 < 757.920: o Simples "vencia" por R$ 85.920 porque
    // faltava um imposto do lado dele, e a diferença real é de R$ 114.080 para o outro lado.
    const simplesComoAntes = custoAnualSimples({
      anexoChave: "III", rbt12: 4_000_000, receitaAnual: 4_000_000, folhaAnual: 0,
    });
    expect(simplesComoAntes.total).toBeLessThan(presumido.total);
    perto(presumido.total - simplesComoAntes.total, 85_920);
    perto(simples.total - presumido.total, 114_080);

    // E onde o número menor sobrevive (alíquota não informada), a falta vai ESCRITA no card.
    expect(simplesComoAntes.naoConsiderado.some((x) => /^ISS/.test(x))).toBe(true);
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

// ⚠⚠ DUAS CAUSAS PARA "NÃO DÁ PARA CALCULAR O SIMPLES" — E ELAS SÃO OPOSTAS.
//
// Até 25/08/2026 `compararRegimes` devolvia a MESMA frase ("Sem RBT12 não há alíquota efetiva —
// informe a receita dos 12 meses anteriores") para os dois casos, porque `faixaDoRbt12` devolve
// `null` tanto para RBT12 ausente quanto para RBT12 ACIMA do teto de R$ 4,8 mi.
//
// ⚠ A empresa grande demais para o Simples recebia "informe a receita dos 12 meses anteriores" —
// mandando preencher um campo que estava preenchido. E foi por essa frase que o defeito do parser
// se disfarçou: com o RBT12 lido ×100, SETE empresas em produção viam "Sem RBT12" com o número na
// tela. Frase que esconde a causa faz o sintoma apontar para o lugar errado.
describe("⚠⚠ o Simples distingue RBT12 AUSENTE de RBT12 ACIMA DO TETO", () => {
  const base = { receitaAnual: 500_000, folhaAnual: 100_000, anexoSimples: "III", sujeitoAoFatorR: false };
  const simples = (over) => compararRegimes({ ...base, ...over }).regimes.find((r) => r.regime === "Simples Nacional");

  it("sem RBT12, a frase manda INFORMAR", () => {
    const r = simples({ rbt12: 0 });
    expect(r.indisponivel).toBe(true);
    expect(r.motivo).toMatch(/Sem RBT12/);
    expect(r.motivo).toMatch(/informe a receita/i);
  });

  it("⚠ acima do teto, a frase diz o TETO — e não manda informar nada", () => {
    const r = simples({ receitaAnual: 6_000_000, rbt12: 6_000_000 });
    expect(r.indisponivel).toBe(true);
    expect(r.motivo).toMatch(/acima do teto do Simples Nacional/i);
    expect(r.motivo).not.toMatch(/informe a receita/i);
  });

  it("no teto exato ainda calcula — o limite é inclusivo", () => {
    expect(simples({ receitaAnual: 4_800_000, rbt12: 4_800_000 }).indisponivel).toBeFalsy();
  });
});
