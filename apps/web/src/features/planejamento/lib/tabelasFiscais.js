// TABELAS FISCAIS — dados versionados por vigência.
//
// ⚠ TODO VALOR AQUI TEM FONTE. Cada bloco cita a seção do documento FONTES FISCAIS entregue pelo
// dono (verificado em 06/08/2026), que por sua vez cita a lei. Valor sem citação não entra — o que
// não está no documento é PARÂMETRO DE ENTRADA (§9) ou está fora do escopo. Inferir alíquota é
// bug, não fallback (regra 1 do projeto).
//
// ⚠ POR QUE VERSIONADO POR VIGÊNCIA, E NÃO CONSTANTE
// 2026 provou que "constante fiscal" não existe: a LC 224/2025 majorou a presunção do Presumido
// no meio do caminho, a Lei 15.270/2025 mudou dividendos e IRPF, e a CBS/IBS entrou em fase de
// teste. Uma tabela hardcoded dentro da lógica de cálculo obriga a reescrever o motor a cada ato
// normativo — e, pior, apaga o histórico: uma simulação de 2025 refeita hoje daria outro número
// sem ninguém saber por quê.

export const VIGENCIA_ATUAL = "2026";

/** Quando as fontes foram conferidas. A tela MOSTRA esta data — simulação sem data envelhece calada. */
export const FONTES_VERIFICADAS_EM = "2026-08-06";

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLES NACIONAL — LC 123/2006 (tabelas da LC 155/2016, vigentes desde 01/01/2018)
// FONTES_FISCAIS §1
// ─────────────────────────────────────────────────────────────────────────────

/** FONTES_FISCAIS §1.1 — limites de enquadramento. */
export const LIMITES_SIMPLES = Object.freeze({
  me: 360_000,               // LC 123/2006, art. 3º, I
  epp: 4_800_000,            // LC 123/2006, art. 3º, II
  sublimiteIcmsIss: 3_600_000, // LC 123/2006, art. 13-A
});

/** FONTES_FISCAIS §1.8 — Fator R. */
export const FATOR_R_LIMITE = 0.28;

/**
 * As seis faixas são as MESMAS para todos os anexos (RBT12), o que muda é alíquota e PD.
 * `ate: Infinity` na 6ª não existe: o teto do Simples é o próprio limite de EPP.
 */
const FAIXAS_RBT12 = Object.freeze([
  { faixa: 1, de: 0, ate: 180_000 },
  { faixa: 2, de: 180_000.01, ate: 360_000 },
  { faixa: 3, de: 360_000.01, ate: 720_000 },
  { faixa: 4, de: 720_000.01, ate: 1_800_000 },
  { faixa: 5, de: 1_800_000.01, ate: 3_600_000 },
  { faixa: 6, de: 3_600_000.01, ate: 4_800_000 },
]);

// `pd: 0` na 1ª faixa é o "—" da tabela oficial: não há parcela a deduzir.
const linhas = (dados) => Object.freeze(FAIXAS_RBT12.map((f, i) => Object.freeze({ ...f, ...dados[i] })));

/** FONTES_FISCAIS §1.3 — Anexo I (Comércio). */
export const ANEXO_I = Object.freeze({
  nome: "Anexo I — Comércio",
  fonte: "FONTES_FISCAIS §1.3",
  faixas: linhas([
    { aliquota: 0.0400, pd: 0, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4150, icms: 0.3400 } },
    { aliquota: 0.0730, pd: 5_940, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4150, icms: 0.3400 } },
    { aliquota: 0.0950, pd: 13_860, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4200, icms: 0.3350 } },
    { aliquota: 0.1070, pd: 22_500, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4200, icms: 0.3350 } },
    { aliquota: 0.1430, pd: 87_300, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4200, icms: 0.3350 } },
    // 6ª faixa não tem ICMS: acima do sublimite ele sai do DAS (§1.1).
    { aliquota: 0.1900, pd: 378_000, partilha: { irpj: 0.1350, csll: 0.1000, cofins: 0.2827, pis: 0.0613, cpp: 0.4210 } },
  ]),
});

/** FONTES_FISCAIS §1.4 — Anexo II (Indústria). */
export const ANEXO_II = Object.freeze({
  nome: "Anexo II — Indústria",
  fonte: "FONTES_FISCAIS §1.4",
  faixas: linhas([
    { aliquota: 0.0450, pd: 0, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, ipi: 0.0750, icms: 0.3200 } },
    { aliquota: 0.0780, pd: 5_940, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, ipi: 0.0750, icms: 0.3200 } },
    { aliquota: 0.1000, pd: 13_860, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, ipi: 0.0750, icms: 0.3200 } },
    { aliquota: 0.1120, pd: 22_500, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, ipi: 0.0750, icms: 0.3200 } },
    { aliquota: 0.1470, pd: 85_500, partilha: { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, ipi: 0.0750, icms: 0.3200 } },
    { aliquota: 0.3000, pd: 720_000, partilha: { irpj: 0.0850, csll: 0.0750, cofins: 0.2096, pis: 0.0454, cpp: 0.2350, ipi: 0.3500 } },
  ]),
});

/** FONTES_FISCAIS §1.5 — Anexo III (locação de bens móveis e serviços não listados nos §§ 5º-C e 5º-I). */
export const ANEXO_III = Object.freeze({
  nome: "Anexo III — Serviços",
  fonte: "FONTES_FISCAIS §1.5",
  // ⚠ TETO DO ISS: o percentual efetivo de ISS limita-se a 5% da receita; o excedente é
  // redistribuído aos federais. Só se aplica a partir do gatilho da 5ª faixa (§1.5).
  tetoIss: Object.freeze({
    faixa: 5,
    aliquotaEfetivaGatilho: 0.1492537,
    // Repartição do que passa de 5%: incide sobre (alíquota efetiva − 5%).
    redistribuicao: { irpj: 0.0602, csll: 0.0526, cofins: 0.1928, pis: 0.0418, cpp: 0.6526 },
  }),
  faixas: linhas([
    { aliquota: 0.0600, pd: 0, partilha: { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, cpp: 0.4340, iss: 0.3350 } },
    { aliquota: 0.1120, pd: 9_360, partilha: { irpj: 0.0400, csll: 0.0350, cofins: 0.1405, pis: 0.0305, cpp: 0.4340, iss: 0.3200 } },
    { aliquota: 0.1350, pd: 17_640, partilha: { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, cpp: 0.4340, iss: 0.3250 } },
    { aliquota: 0.1600, pd: 35_640, partilha: { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, cpp: 0.4340, iss: 0.3250 } },
    { aliquota: 0.2100, pd: 125_640, partilha: { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, cpp: 0.4340, iss: 0.3350 } },
    { aliquota: 0.3300, pd: 648_000, partilha: { irpj: 0.3500, csll: 0.1500, cofins: 0.1603, pis: 0.0347, cpp: 0.3050 } },
  ]),
});

/** FONTES_FISCAIS §1.6 — Anexo IV (construção, vigilância, limpeza, advocacia). */
export const ANEXO_IV = Object.freeze({
  nome: "Anexo IV — Serviços (§ 5º-C)",
  fonte: "FONTES_FISCAIS §1.6",
  // ⚠⚠ A CPP NÃO ESTÁ NO DAS (art. 18, § 5º-C). A empresa recolhe INSS patronal POR FORA, como
  // qualquer outra. Toda comparação com outro anexo ou regime PRECISA somar a CPP separadamente —
  // senão o Anexo IV parece artificialmente barato, que é o erro que o próprio documento alerta.
  cppForaDoDas: true,
  tetoIss: Object.freeze({
    faixa: 5,
    aliquotaEfetivaGatilho: 0.125,
    redistribuicao: { irpj: 0.3133, csll: 0.3200, cofins: 0.3013, pis: 0.0654 },
  }),
  faixas: linhas([
    { aliquota: 0.0450, pd: 0, partilha: { irpj: 0.1880, csll: 0.1520, cofins: 0.1767, pis: 0.0383, iss: 0.4450 } },
    { aliquota: 0.0900, pd: 8_100, partilha: { irpj: 0.1980, csll: 0.1520, cofins: 0.2055, pis: 0.0445, iss: 0.4000 } },
    { aliquota: 0.1020, pd: 12_420, partilha: { irpj: 0.2080, csll: 0.1520, cofins: 0.1973, pis: 0.0427, iss: 0.4000 } },
    { aliquota: 0.1400, pd: 39_780, partilha: { irpj: 0.1780, csll: 0.1920, cofins: 0.1890, pis: 0.0410, iss: 0.4000 } },
    { aliquota: 0.2200, pd: 183_780, partilha: { irpj: 0.1880, csll: 0.1920, cofins: 0.1808, pis: 0.0392, iss: 0.4000 } },
    { aliquota: 0.3300, pd: 828_000, partilha: { irpj: 0.5350, csll: 0.2150, cofins: 0.2055, pis: 0.0445 } },
  ]),
});

/** FONTES_FISCAIS §1.7 — Anexo V (tecnologia, engenharia, consultoria, auditoria). */
export const ANEXO_V = Object.freeze({
  nome: "Anexo V — Serviços (§ 5º-I)",
  fonte: "FONTES_FISCAIS §1.7",
  faixas: linhas([
    { aliquota: 0.1550, pd: 0, partilha: { irpj: 0.2500, csll: 0.1500, cofins: 0.1410, pis: 0.0305, cpp: 0.2885, iss: 0.1400 } },
    { aliquota: 0.1800, pd: 4_500, partilha: { irpj: 0.2300, csll: 0.1500, cofins: 0.1410, pis: 0.0305, cpp: 0.2785, iss: 0.1700 } },
    { aliquota: 0.1950, pd: 9_900, partilha: { irpj: 0.2400, csll: 0.1500, cofins: 0.1492, pis: 0.0323, cpp: 0.2385, iss: 0.1900 } },
    { aliquota: 0.2050, pd: 17_100, partilha: { irpj: 0.2100, csll: 0.1500, cofins: 0.1574, pis: 0.0341, cpp: 0.2385, iss: 0.2100 } },
    { aliquota: 0.2300, pd: 62_100, partilha: { irpj: 0.2300, csll: 0.1250, cofins: 0.1410, pis: 0.0305, cpp: 0.2385, iss: 0.2350 } },
    { aliquota: 0.3050, pd: 540_000, partilha: { irpj: 0.3500, csll: 0.1550, cofins: 0.1644, pis: 0.0356, cpp: 0.2950 } },
  ]),
});

export const ANEXOS = Object.freeze({ I: ANEXO_I, II: ANEXO_II, III: ANEXO_III, IV: ANEXO_IV, V: ANEXO_V });

// ─────────────────────────────────────────────────────────────────────────────
// LUCRO PRESUMIDO — FONTES_FISCAIS §2
// ─────────────────────────────────────────────────────────────────────────────

/** §2.1 — teto de receita do ano anterior (Lei 9.718/1998, art. 13). */
export const LIMITE_LUCRO_PRESUMIDO = 78_000_000;

/** §2.2 — presunção de IRPJ (Lei 9.249/1995, art. 15). */
export const PRESUNCAO_IRPJ = Object.freeze({
  comercioIndustria: 0.08,
  combustiveis: 0.016,
  transportePassageiros: 0.16,
  // ⚠ Trava: passando de R$ 120.000 no ano, vira 32% RETROATIVO com recolhimento da diferença.
  servicosAte120k: 0.16,
  servicosGeral: 0.32,
});
export const LIMITE_SERVICOS_16_PCT = 120_000;

/** §2.3 — presunção de CSLL (Lei 9.249/1995, art. 20, red. LC 167/2019). */
export const PRESUNCAO_CSLL = Object.freeze({
  comercioIndustria: 0.12,
  servicosGeral: 0.32,
  empresaSimplesCredito: 0.384,
});

/**
 * §2.4 — MAJORAÇÃO DA LC 224/2025.
 *
 * ⚠ OS LIMITES SÃO DIFERENTES PARA IRPJ E CSLL EM 2026, e essa é a armadilha desta regra:
 * o IRPJ vale desde 01/01/2026 (limite anual cheio de R$ 5 mi); a CSLL só a partir de 01/04/2026
 * pela noventena, então o limite dela em 2026 é ¾ disso — R$ 3,75 mi. Usar o mesmo número para os
 * dois majoraria a CSLL de R$ 1,25 mi de receita que a lei ainda não alcançava.
 *
 * A majoração é MULTIPLICATIVA (10% sobre o percentual), não aditiva: 32% → 35,2%, não 42%.
 */
export const MAJORACAO_LC224 = Object.freeze({
  fator: 1.10,
  limiteIrpj: 5_000_000,
  limiteCsll2026: 3_750_000,
  vigenciaIrpj: "2026-01-01",
  vigenciaCsll: "2026-04-01",
  // O documento registra judicialização em curso: o motor aplica a regra vigente e a TELA exibe a
  // nota. Nunca o contrário — deixar de aplicar por causa de liminar de terceiro seria decidir
  // ato fiscal por suposição.
  controvertida: true,
});

/** §2.5 — alíquotas sobre a base presumida. */
export const IRPJ = Object.freeze({
  aliquota: 0.15,
  adicional: 0.10,
  // O adicional incide sobre o que exceder R$ 20.000/mês. A apuração do Presumido é TRIMESTRAL,
  // então o limite prático é R$ 60.000 por trimestre.
  limiteAdicionalMensal: 20_000,
  limiteAdicionalTrimestral: 60_000,
  limiteAdicionalAnual: 240_000,
});
export const CSLL_ALIQUOTA = 0.09;

/** §2.6 — PIS/COFINS cumulativo (obrigatório no Presumido, sem créditos). */
export const PIS_COFINS_CUMULATIVO = Object.freeze({ pis: 0.0065, cofins: 0.03, total: 0.0365 });

/** §3 — PIS/COFINS não cumulativo (Lucro Real, com créditos). */
export const PIS_COFINS_NAO_CUMULATIVO = Object.freeze({ pis: 0.0165, cofins: 0.076, total: 0.0925 });

// ─────────────────────────────────────────────────────────────────────────────
// FOLHA — FONTES_FISCAIS §5
// ─────────────────────────────────────────────────────────────────────────────

export const ENCARGOS_FOLHA = Object.freeze({
  /** CPP patronal sobre folha e pró-labore — Lei 8.212/1991, art. 22, I e III. */
  cppPatronal: 0.20,
  /** INSS do contribuinte individual, retido do pró-labore, observado o teto do RGPS. */
  inssContribuinteIndividual: 0.11,
  // RAT/FAP, terceiros, tabela do IRPF e teto do RGPS são PARÂMETRO DE ENTRADA (§9) — variam por
  // CNAE, por FAP da empresa e por portaria anual. Não têm valor aqui de propósito.
});

// ─────────────────────────────────────────────────────────────────────────────
// ISS / ICMS — FONTES_FISCAIS §4 (faixa legal; o valor concreto é PARÂMETRO)
// ─────────────────────────────────────────────────────────────────────────────

export const ISS_FAIXA_LEGAL = Object.freeze({
  minimo: 0.02, // piso — EC 37/2002 / LC 157/2016
  maximo: 0.05, // teto — LC 116/2003, art. 8º
});

// ─────────────────────────────────────────────────────────────────────────────
// REFORMA DO IR — FONTES_FISCAIS §7 (impacta pró-labore × dividendos)
// ─────────────────────────────────────────────────────────────────────────────

export const REFORMA_IR_2026 = Object.freeze({
  /** §7.1 — IRRF de 10% quando a distribuição a uma mesma PF supera R$ 50 mil no MÊS. */
  dividendos: { limiteMensal: 50_000, aliquota: 0.10, incideSobreTotal: true },
  /** §7.3 — isenção efetiva do IRPF até R$ 5.000/mês. Muda o ponto ótimo do pró-labore. */
  isencaoIrpfMensal: 5_000,
  /** §7.2 — IRPF mínimo. */
  irpfMinimo: { pisoAnual: 600_000, tetoProgressivo: 1_200_000, aliquotaMaxima: 0.10 },
  /** §7.4 — JCP. */
  jcpIrrf: 0.175,
  /** §7.4 — a RFB entende que a retenção alcança sócio de optante do Simples; há decisões nos dois
   *  sentidos. O motor aplica a regra da RFB por padrão; alternativa só por configuração explícita. */
  dividendosAlcancamSimples: true,
  controversiaSimples: true,
});
