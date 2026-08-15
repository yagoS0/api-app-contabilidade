// CASOS DOURADOS — validação EXTERNA do motor.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE SEPARADO DE `motorFiscal.test.js`
// Aquele verifica CONSISTÊNCIA INTERNA: a soma da partilha fecha, a redistribuição bate com a
// efetiva, o teto trava onde deve. Tudo isso continua passando se um número da tabela tiver sido
// transcrito errado — a soma fecha igual, só que sobre a alíquota errada. Consistência interna não
// pega erro de transcrição; caso dourado pega.
//
// Cada valor esperado abaixo foi CALCULADO À MÃO contra as tabelas do documento FONTES FISCAIS, com
// a conta escrita no comentário. Se um teste daqui quebrar depois de mexer nas tabelas, a pergunta
// certa é "a tabela mudou por ato normativo?" — e não "como faço o teste passar?".
//
// ⚠ NÃO CONFRONTADO CONTRA O PGDAS-D AO VIVO. O simulador oficial (TRANSDECLARACAO11) é chamada
// PAGA e por empresa real; queimar chamadas para conferir tabela é decisão do dono, não minha. O
// caminho existe e está pronto (`PgdasSimulacaoService.simular`): quando o dono quiser, os casos de
// Simples abaixo são os que valem a pena confrontar, porque cobrem faixa, teto de ISS e Anexo IV.

import {
  aliquotaEfetiva, repartirPorTributo, custoAnualSimples, rbt12InicioAtividade,
} from "../simplesNacional";
import { custoAnualPresumido } from "../lucroPresumido";
import { ANEXOS } from "../tabelasFiscais";

/** Compara em pontos percentuais com 6 casas — erro de transcrição aparece muito antes disso. */
const efetiva = (anexo, rbt12) => Number(aliquotaEfetiva(anexo, rbt12).toFixed(8));
const reais = (v) => Number(Number(v).toFixed(2));

describe("Anexo I — Comércio, 3ª faixa", () => {
  // RBT12 500.000 → faixa 3 (9,50% / PD 13.860)
  // (500.000 × 0,095 − 13.860) / 500.000 = (47.500 − 13.860) / 500.000 = 33.640 / 500.000
  it("efetiva de 6,728%", () => {
    expect(efetiva(ANEXOS.I, 500_000)).toBeCloseTo(0.06728, 8);
  });

  it("DAS de R$ 33.640,00 sobre receita de 500 mil", () => {
    const r = custoAnualSimples({ anexoChave: "I", rbt12: 500_000, receitaAnual: 500_000, folhaAnual: 0 });
    expect(reais(r.das)).toBe(33_640);
  });

  it("repartição por tributo, valor a valor", () => {
    // Partilha da 3ª faixa: IRPJ 5,50 · CSLL 3,50 · Cofins 12,74 · PIS 2,76 · CPP 42,00 · ICMS 33,50
    const t = custoAnualSimples({ anexoChave: "I", rbt12: 500_000, receitaAnual: 500_000 }).porTributo;
    expect(reais(t.irpj)).toBe(1_850.20);   // 33.640 × 5,50%
    expect(reais(t.csll)).toBe(1_177.40);   // 33.640 × 3,50%
    expect(reais(t.cofins)).toBe(4_285.74); // 33.640 × 12,74%
    expect(reais(t.pis)).toBe(928.46);      // 33.640 × 2,76%
    expect(reais(t.cpp)).toBe(14_128.80);   // 33.640 × 42,00%
    expect(reais(t.icms)).toBe(11_269.40);  // 33.640 × 33,50%
  });
});

describe("Anexo II — Indústria, 5ª faixa", () => {
  // (2.000.000 × 0,147 − 85.500) / 2.000.000 = (294.000 − 85.500) / 2.000.000 = 208.500 / 2.000.000
  it("efetiva de 10,425%", () => {
    expect(efetiva(ANEXOS.II, 2_000_000)).toBeCloseTo(0.104250, 8);
  });

  it("o IPI aparece na repartição — é o anexo que o tem", () => {
    const t = repartirPorTributo(ANEXOS.II, 2_000_000).porTributo;
    // 10,425% × 7,50% = 0,781875% da receita
    expect(t.ipi).toBeCloseTo(0.00781875, 10);
  });
});

describe("Anexo III — 5ª faixa, LOGO ABAIXO do teto de ISS", () => {
  // (2.000.000 × 0,21 − 125.640) / 2.000.000 = 294.360 / 2.000.000 = 14,718%
  // Gatilho do teto: 14,92537%. 14,718% < gatilho → partilha normal.
  it("efetiva de 14,718%", () => {
    expect(efetiva(ANEXOS.III, 2_000_000)).toBeCloseTo(0.14718, 8);
  });

  it("⚠ o ISS fica em 4,93% da receita — abaixo dos 5%, e é POR ISSO que o teto não precisa agir", () => {
    // 14,718% × 33,50% = 4,930530%. O gatilho da tabela não é um número solto: é exatamente o
    // ponto em que 33,5% da efetiva alcança 5% da receita. Este teste amarra os dois.
    const t = repartirPorTributo(ANEXOS.III, 2_000_000);
    expect(t.tetoIssAplicado).toBe(false);
    expect(t.porTributo.iss).toBeCloseTo(0.04930530, 8);
    expect(t.porTributo.iss).toBeLessThan(0.05);
  });
});

describe("Anexo III — 5ª faixa, ACIMA do teto de ISS", () => {
  // (3.000.000 × 0,21 − 125.640) / 3.000.000 = 504.360 / 3.000.000 = 16,812%
  it("efetiva de 16,812%", () => {
    expect(efetiva(ANEXOS.III, 3_000_000)).toBeCloseTo(0.16812, 8);
  });

  it("⚠ sem o teto o ISS seria 5,632% — acima do máximo legal", () => {
    // 16,812% × 33,50% = 5,63202%. É a prova de que o teto não é enfeite: sem ele o DAS cobraria
    // mais ISS do que a lei permite ao município.
    expect(0.16812 * 0.335).toBeCloseTo(0.0563202, 7);
  });

  it("com o teto: ISS em 5% e o excedente redistribuído, valor a valor", () => {
    // Excedente = 16,812% − 5% = 11,812%
    const t = repartirPorTributo(ANEXOS.III, 3_000_000).porTributo;
    expect(t.iss).toBeCloseTo(0.05, 10);
    expect(t.irpj).toBeCloseTo(0.11812 * 0.0602, 10);   // 0,7110824%
    expect(t.csll).toBeCloseTo(0.11812 * 0.0526, 10);   // 0,6213112%
    expect(t.cofins).toBeCloseTo(0.11812 * 0.1928, 10); // 2,2773536%
    expect(t.pis).toBeCloseTo(0.11812 * 0.0418, 10);    // 0,4937416%
    expect(t.cpp).toBeCloseTo(0.11812 * 0.6526, 10);    // 7,7085112%
  });
});

describe("Anexo IV — 5ª faixa, com teto de ISS E CPP por fora", () => {
  // (3.000.000 × 0,22 − 183.780) / 3.000.000 = 476.220 / 3.000.000 = 15,874%
  it("efetiva de 15,874%", () => {
    expect(efetiva(ANEXOS.IV, 3_000_000)).toBeCloseTo(0.15874, 8);
  });

  it("teto do IV dispara em 12,5%, não em 14,92537%", () => {
    const t = repartirPorTributo(ANEXOS.IV, 3_000_000);
    expect(t.tetoIssAplicado).toBe(true);
    expect(t.porTributo.iss).toBeCloseTo(0.05, 10);
    // Excedente = 15,874% − 5% = 10,874%
    expect(t.porTributo.irpj).toBeCloseTo(0.10874 * 0.3133, 10);
    expect(t.porTributo.cpp).toBeUndefined(); // não há CPP na partilha do IV
  });

  it("⚠ o custo total soma a CPP por fora: R$ 476.220 de DAS + R$ 120.000 de INSS patronal", () => {
    // Folha de 600.000 × 20% = 120.000. Total = 596.220,00.
    const r = custoAnualSimples({ anexoChave: "IV", rbt12: 3_000_000, receitaAnual: 3_000_000, folhaAnual: 600_000 });
    expect(reais(r.das)).toBe(476_220);
    expect(reais(r.cppPorFora)).toBe(120_000);
    expect(reais(r.total)).toBe(596_220);
  });
});

describe("Anexo V — 4ª faixa", () => {
  // (1.000.000 × 0,205 − 17.100) / 1.000.000 = 187.900 / 1.000.000 = 18,79%
  it("efetiva de 18,79%", () => {
    expect(efetiva(ANEXOS.V, 1_000_000)).toBeCloseTo(0.1879, 8);
  });

  it("DAS de R$ 187.900,00 sobre receita de 1 milhão", () => {
    const r = custoAnualSimples({ anexoChave: "V", rbt12: 1_000_000, receitaAnual: 1_000_000 });
    expect(reais(r.das)).toBe(187_900);
  });
});

describe("Início de atividade — Anexo I, com a conta escrita (art. 18, § 2º)", () => {
  // A regra vem da Resolução CGSN 140/2018, art. 22, §§ 2º a 4º — conferida no texto oficial, não
  // no documento FONTES FISCAIS, que não a transcreve. Os números abaixo são calculados à mão
  // contra a tabela do Anexo I, exatamente como os demais casos dourados deste arquivo.

  it("1º mês: receita de R$ 30.000 no mês → RBT12 de R$ 360.000 e efetiva de 5,65%", () => {
    // § 2º: RBT12 = 30.000 × 12 = 360.000 → 2ª faixa do Anexo I (7,30% / PD 5.940).
    // (360.000 × 0,073 − 5.940) / 360.000 = (26.280 − 5.940) / 360.000 = 20.340 / 360.000 = 5,65%
    const r = rbt12InicioAtividade({ mesesDeAtividade: 1, receitasMensais: [30_000] });
    expect(reais(r.rbt12)).toBe(360_000);
    expect(efetiva(ANEXOS.I, r.rbt12)).toBeCloseTo(0.0565, 8);
  });

  it("⚠ 2º mês: o mês corrente fica FORA da média — 5,65%, não 7,575%", () => {
    // Série [30.000, 90.000], apurando o 2º mês.
    //   § 3º (certo)     → média dos ANTERIORES = 30.000 → RBT12 360.000 → 2ª faixa → 5,65%
    //   meses decorridos → (30.000 + 90.000)/2 = 60.000 → RBT12 720.000 → 3ª faixa (9,50%/13.860)
    //                      (720.000 × 0,095 − 13.860)/720.000 = 54.540/720.000 = 7,575%
    // Quase dois pontos percentuais de diferença — é o que está em jogo na leitura do § 3º.
    const r = rbt12InicioAtividade({ mesesDeAtividade: 2, receitasMensais: [30_000, 90_000] });
    expect(reais(r.rbt12)).toBe(360_000);
    expect(efetiva(ANEXOS.I, r.rbt12)).toBeCloseTo(0.0565, 8);
    // E a prova de que o caminho errado daria outro número:
    expect(efetiva(ANEXOS.I, 720_000)).toBeCloseTo(0.07575, 8);
  });

  it("DAS de R$ 20.340,00 no 1º mês de atividade, sobre receita anualizada de R$ 360.000", () => {
    // 360.000 × 5,65% = 20.340,00 — o próprio numerador da fórmula, como sempre que a receita
    // anual coincide com o RBT12.
    const r = custoAnualSimples({ anexoChave: "I", rbt12: null, receitaAnual: 360_000, mesesDeAtividade: 1 });
    expect(reais(r.das)).toBe(20_340);
    expect(reais(r.rbt12Utilizado)).toBe(360_000);
  });

  it("⚠ a transição para o 13º mês muda a faixa, e por isso muda a alíquota", () => {
    // Seis meses a 10.000, depois seis a 50.000 (empresa em rampa, o caso real de quem abriu agora).
    const serie = [...Array(6).fill(10_000), ...Array(6).fill(50_000)];

    // 12º mês (§ 3º): média dos onze anteriores = (6 × 10.000 + 5 × 50.000) / 11
    //               = 310.000 / 11 = 28.181,8181... → × 12 = 338.181,82 → 2ª faixa
    const m12 = rbt12InicioAtividade({ mesesDeAtividade: 12, receitasMensais: serie });
    expect(reais(m12.rbt12)).toBe(reais((310_000 / 11) * 12)); // 338.181,82

    // 13º mês (§ 1º): RBT12 real = 6 × 10.000 + 6 × 50.000 = 360.000
    const m13 = rbt12InicioAtividade({ mesesDeAtividade: 13, receitasMensais: serie });
    expect(reais(m13.rbt12)).toBe(360_000);

    // As duas caem na 2ª faixa, mas em pontos diferentes dela — e a PD fixa de 5.940 pesa mais
    // sobre o RBT12 menor, então o 12º mês sai com alíquota MENOR que o 13º.
    //   12º → 0,073 − 5.940/338.181,82 = 5,5436%
    //   13º → 0,073 − 5.940/360.000    = 5,6500%
    expect(efetiva(ANEXOS.I, m12.rbt12)).toBeCloseTo(0.073 - 5_940 / ((310_000 / 11) * 12), 8);
    expect(efetiva(ANEXOS.I, m13.rbt12)).toBeCloseTo(0.0565, 8);
    expect(aliquotaEfetiva(ANEXOS.I, m12.rbt12)).toBeLessThan(aliquotaEfetiva(ANEXOS.I, m13.rbt12));
  });
});

describe("LC 224/2025 — a virada, com os DOIS limites de 2026", () => {
  it("⚠ receita de R$ 4,5 mi: a CSLL JÁ é majorada e o IRPJ AINDA NÃO", () => {
    // Este é o caso dourado que mais importa da LC 224, porque o resultado é contraintuitivo:
    // a base da CSLL fica MAIOR que a do IRPJ, apesar de as duas presunções serem 32%.
    //   IRPJ  → 4.500.000 < 5.000.000  → sem majoração → 4.500.000 × 32% = 1.440.000
    //   CSLL  → 4.500.000 > 3.750.000  → majorada      → 3.750.000 × 32% + 750.000 × 35,2%
    //                                                  = 1.200.000 + 264.000 = 1.464.000
    const r = custoAnualPresumido({ receitaAnual: 4_500_000, atividade: "servicos", anoBase: 2026 });
    expect(reais(r.porTributo.irpj)).toBe(reais(1_440_000 * 0.15)); // 216.000,00
    expect(reais(r.porTributo.csll)).toBe(reais(1_464_000 * 0.09)); // 131.760,00
    // A prova do ponto: base de CSLL maior que a de IRPJ com a mesma presunção nominal.
    expect(r.porTributo.csll / 0.09).toBeGreaterThan(r.porTributo.irpj / 0.15);
  });

  it("receita de R$ 6 mi: os dois majorados, cada um pelo seu limite", () => {
    //   IRPJ → 5.000.000 × 32% + 1.000.000 × 35,2% = 1.600.000 + 352.000 = 1.952.000
    //   CSLL → 3.750.000 × 32% + 2.250.000 × 35,2% = 1.200.000 + 792.000 = 1.992.000
    const r = custoAnualPresumido({ receitaAnual: 6_000_000, atividade: "servicos", anoBase: 2026 });
    expect(reais(r.porTributo.irpj)).toBe(reais(1_952_000 * 0.15)); // 292.800,00
    expect(reais(r.porTributo.csll)).toBe(reais(1_992_000 * 0.09)); // 179.280,00
  });

  it("adicional de IRPJ sobre a base majorada, por trimestre", () => {
    // Base IRPJ 1.952.000 / 4 = 488.000 por trimestre; (488.000 − 60.000) × 10% × 4 = 171.200
    const r = custoAnualPresumido({ receitaAnual: 6_000_000, atividade: "servicos", anoBase: 2026 });
    expect(reais(r.porTributo.adicionalIrpj)).toBe(171_200);
  });

  it("PIS/COFINS cumulativo sobre a receita cheia, sem majoração nenhuma", () => {
    // A LC 224 mexeu na PRESUNÇÃO de IRPJ/CSLL. PIS/COFINS continuam 0,65% + 3% da receita.
    const r = custoAnualPresumido({ receitaAnual: 6_000_000, atividade: "servicos", anoBase: 2026 });
    expect(reais(r.porTributo.pis)).toBe(39_000);
    expect(reais(r.porTributo.cofins)).toBe(180_000);
  });
});

describe("⚠⚠ Presumido — TRANSPORTE DE PASSAGEIROS: IRPJ de 16%, CSLL de 12%", () => {
  // O caso dourado que este bloco existe para travar. O motor usava CSLL de 32% aqui, e a conta
  // abaixo é a prova de que 32% não sai da lei — sai de ler "transporte de passageiros" como
  // "serviço em geral".
  //
  // A LEI, conferida em 15/08/2026 no texto compilado oficial da Câmara dos Deputados
  // (https://www2.camara.leg.br/legin/fed/lei/1995/lei-9249-26-dezembro-1995-349062-normaatualizada-pl.pdf):
  //
  //   Lei 9.249/1995, art. 15, § 1º, II, "a" — 16% "para a atividade de prestação de serviços de
  //     transporte, EXCETO o de carga, para o qual se aplicará o percentual previsto no caput"
  //     (8%). Este é o percentual do IRPJ, e é o único ponto em que passageiros difere de cargas.
  //   Lei 9.249/1995, art. 15, § 1º, III — 32% para "prestação de serviços em geral",
  //     intermediação de negócios, administração/locação/cessão de bens e direitos, factoring e
  //     construção vinculada a concessão. Transporte NÃO está aqui: está no inciso II.
  //   Lei 9.249/1995, art. 20 (red. LC 167/2019) — a base da CSLL é de 32% para as receitas do
  //     "inciso III do § 1º do art. 15", 38,4% para as do inciso IV, e "III - 12% (doze por cento)
  //     para as DEMAIS receitas brutas".
  //
  // A conclusão é mecânica: transporte está no inciso II, o art. 20 só manda 32% para o inciso III,
  // logo transporte cai em "demais receitas brutas" → CSLL de 12%.
  //
  // A CONTA, À MÃO, sobre receita anual de R$ 2.000.000 (abaixo dos dois limites da LC 224/2025,
  // então sem majoração nenhuma), folha zero e ISS não informado:
  //   IRPJ      base = 2.000.000 × 16% = 320.000  →  320.000 × 15% =  48.000,00
  //   Adicional 320.000 ÷ 4 = 80.000 por trimestre; (80.000 − 60.000) × 10% × 4 =  8.000,00
  //   CSLL      base = 2.000.000 × 12% = 240.000  →  240.000 ×  9% =  21.600,00
  //   PIS       2.000.000 × 0,65% =  13.000,00
  //   COFINS    2.000.000 × 3,00% =  60.000,00
  //   TOTAL                                                         = 150.600,00
  //
  // Com a CSLL errada de 32% a base seria 640.000 e a CSLL, 57.600,00 — R$ 36.000,00 por ano a
  // mais, num único cliente, num número que sai impresso no PDF que vai ao cliente.
  const r = () => custoAnualPresumido({ receitaAnual: 2_000_000, atividade: "transportePassageiros", anoBase: 2026 });

  it("CSLL de R$ 21.600,00 — base de 12% (art. 20, III), não de 32%", () => {
    expect(reais(r().porTributo.csll)).toBe(21_600);
    // A prova de que a base é de 12%: 21.600 ÷ 9% = 240.000 = 12% de 2.000.000.
    expect(reais(r().porTributo.csll / 0.09)).toBe(240_000);
    // E o número que o defeito produzia, escrito aqui para não voltar por descuido.
    expect(reais(r().porTributo.csll)).not.toBe(57_600);
  });

  it("IRPJ de R$ 48.000,00 e adicional de R$ 8.000,00 — base de 16% (art. 15, § 1º, II, 'a')", () => {
    expect(reais(r().porTributo.irpj)).toBe(48_000);
    expect(reais(r().porTributo.adicionalIrpj)).toBe(8_000);
  });

  it("total anual de R$ 150.600,00", () => {
    expect(reais(r().porTributo.pis)).toBe(13_000);
    expect(reais(r().porTributo.cofins)).toBe(60_000);
    expect(reais(r().total)).toBe(150_600);
  });

  it("⚠ o que separa passageiros de cargas é SÓ o IRPJ — a CSLL dos dois é a mesma", () => {
    // Cargas: IRPJ de 8% (caput) → base 160.000 → 24.000, sem adicional (40.000/tri < 60.000).
    // CSLL idêntica, porque os dois estão no mesmo inciso II do § 1º do art. 15.
    const cargas = custoAnualPresumido({ receitaAnual: 2_000_000, atividade: "transporteCargas", anoBase: 2026 });
    expect(reais(cargas.porTributo.csll)).toBe(21_600);
    expect(reais(cargas.porTributo.irpj)).toBe(24_000);
    expect(reais(cargas.porTributo.adicionalIrpj)).toBe(0);
    // A diferença entre os dois transportes é exatamente o IRPJ e o seu adicional: 32.000,00.
    expect(reais(r().total - cargas.total)).toBe(32_000);
  });

  it("a premissa IMPRESSA diz 16,0% de IRPJ e 12,0% de CSLL — é o que o PDF leva ao cliente", () => {
    // O PDF circula sozinho e cita o documento do projeto. Imprimir "CSLL 32,0% (FONTES_FISCAIS
    // §2.3)" era citar um documento que diz outra coisa.
    const premissa = r().premissas.find((p) => /Presunção de IRPJ/.test(p));
    expect(premissa).toBe("Presunção de IRPJ 16,0% e de CSLL 12,0% (FONTES_FISCAIS §2.2 e §2.3)");
  });
});

describe("⚠⚠ Simples acima do sublimite — o ISS que sai do DAS volta à conta (art. 13-A)", () => {
  // A CONTA, À MÃO. Anexo III, RBT12 e receita de R$ 4.000.000 → 6ª faixa (33,00% / PD 648.000):
  //   efetiva = (4.000.000 × 0,33 − 648.000) / 4.000.000 = 672.000 / 4.000.000 = 16,80%
  //   DAS     = 16,80% × 4.000.000 = 672.000,00   ← e a 6ª faixa NÃO tem ISS na partilha
  //   ISS     = 5% × 4.000.000     = 200.000,00   ← recolhido por fora, pelo município
  //   TOTAL   = 872.000,00
  // O DAS encolhe acima do sublimite; o custo da empresa, não.
  it("efetiva de 16,80% e DAS de R$ 672.000,00", () => {
    expect(efetiva(ANEXOS.III, 4_000_000)).toBeCloseTo(0.168, 8);
    const r = custoAnualSimples({ anexoChave: "III", rbt12: 4_000_000, receitaAnual: 4_000_000 });
    expect(reais(r.das)).toBe(672_000);
  });

  it("com ISS de 5% informado, o total é R$ 872.000,00 — DAS + ISS por fora", () => {
    const r = custoAnualSimples({ anexoChave: "III", rbt12: 4_000_000, receitaAnual: 4_000_000, aliquotaIss: 0.05 });
    expect(reais(r.issPorFora)).toBe(200_000);
    expect(reais(r.porTributo.iss)).toBe(200_000);
    expect(reais(r.total)).toBe(872_000);
    // Carga efetiva de 21,80% — não os 16,80% do DAS.
    expect(r.cargaEfetiva).toBeCloseTo(0.218, 10);
  });

  it("sem a alíquota informada o total fica nos R$ 672.000 — E A FALTA VAI ESCRITA", () => {
    // Ausência não é zero. O número menor só é honesto acompanhado da ressalva.
    const r = custoAnualSimples({ anexoChave: "III", rbt12: 4_000_000, receitaAnual: 4_000_000 });
    expect(reais(r.total)).toBe(672_000);
    expect(r.naoConsiderado.some((x) => /^ISS/.test(x))).toBe(true);
  });
});

describe("Presumido — comércio, sem majoração", () => {
  it("receita de R$ 2 mi: presunções de 8% (IRPJ) e 12% (CSLL)", () => {
    //   IRPJ  → base 160.000 × 15% = 24.000; adicional: 40.000/tri < 60.000 → zero
    //   CSLL  → base 240.000 × 9%  = 21.600
    //   PIS/COFINS → 2.000.000 × 3,65% = 73.000
    const r = custoAnualPresumido({ receitaAnual: 2_000_000, atividade: "comercio", anoBase: 2026 });
    expect(reais(r.porTributo.irpj)).toBe(24_000);
    expect(reais(r.porTributo.adicionalIrpj)).toBe(0);
    expect(reais(r.porTributo.csll)).toBe(21_600);
    expect(reais(r.porTributo.pis + r.porTributo.cofins)).toBe(73_000);
    expect(reais(r.total)).toBe(118_600);
  });
});
