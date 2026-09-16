import { calcularOperacoes, calcularReformaOperacoes } from "../operacoesPlanejamento";
import { projetarTributos, prepararMesesTributos } from "../tributosMensais";

const entradas = { receitaAnual: 1200000, rbt12: 1200000, folhaAnual: 336000, folhaRemuneracoesAnual: 120000, encargosAdicionaisAnuais: 1200, aliquotaIss: .05, margemLucro: .1, creditosPisCofins: 0, anexoSimples: "III", atividadePresumido: "servicos" };
const mensal = { linhas: Array.from({ length: 12 }, () => ({ receita: 100000, rbt12: 1200000, fs12: 336000, folha: 28000, origem: "apurado" })) };
const op = { regime: "LUCRO_PRESUMIDO", competencia: "2026-01", tributo: "ICMS", base: 1000, aliquota: 18, conferida: true };
const estudo = (value = {}, e = entradas, operacoes = []) => projetarTributos({ value, entradas: e, mensal, operacoes });
const regime = (r, k) => r.resultados.find(x => x.regime === k);

test("ICMS com redução usa base efetiva e exige fundamento; não torna crédito excedente imposto negativo", () => {
  expect(calcularOperacoes([{ ...op, reducao: 50 }]).operacoes[0].total).toBeNull();
  const r = calcularOperacoes([{ ...op, reducao: 50, fundamento: "Ato estadual fictício", credito: 100 }]).operacoes[0];
  expect(r).toMatchObject({ baseEfetiva: 500, debito: 90, imposto: 0, creditoExcedente: 10, total: 0 });
});
test("ST deduz ICMS próprio, DIFAL usa diferença; crédito de imposto não reduz FCP", () => {
  expect(calcularOperacoes([{ ...op, tributo: "ICMS-ST", icmsProprio: 120, fcpPct: 2 }]).operacoes[0].total).toBe(80);
  expect(calcularOperacoes([{ ...op, tributo: "DIFAL", interestadualPct: 12, fcpPct: 2, credito: 100 }]).operacoes[0]).toMatchObject({ debito: 60, imposto: 0, fcp: 20, total: 20 });
});
test.each([{ base: "" }, { aliquota: 101 }, { conferida: false }, { competencia: "2027-01" }, { regime: "" }])("operação incompleta não vira zero: %j", patch => {
  expect(calcularOperacoes([{ ...op, ...patch }]).total).toBeNull();
});
test("Presumido e Real fecham ano com IRPJ/CSLL no trimestre; valores mensais não ganham limite anual", () => {
  const p = regime(estudo(), "LUCRO_PRESUMIDO"), r = regime(estudo(), "LUCRO_REAL");
  expect(p.total).toBe(235560); expect(p.meses[0].tributos.irpj).toBeUndefined();
  expect(p.meses[2].tributos).toMatchObject({ irpj: 14400, adicionalIrpj: 3600, csll: 8640, pis: 650, cofins: 3000 });
  expect(r.total).toBe(225000);
  expect(regime(estudo(), "SIMPLES_NACIONAL").total).toBe(156360);
});
test("sazonalidade concentra adicional no trimestre forte", () => {
  const meses = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, { receita: i < 3 ? 400000 : 0 }]));
  const p = regime(estudo({ meses }), "LUCRO_PRESUMIDO");
  expect(p.meses[2].tributos.adicionalIrpj).toBe(32400);
  expect(p.meses[5].tributos.adicionalIrpj).toBe(0);
});
test("preserva zero, apagamento manual e receita automática; não divide crédito agregado entre PIS e Cofins", () => {
  const e = { ...entradas, creditosPisCofins: 1000 };
  const p = prepararMesesTributos({ entradas: e, mensal, value: { meses: { 0: { receita: "", remuneracoes: "0" } } } });
  expect(p.linhas[0]).toMatchObject({ receita: null, remuneracoes: 0, creditoPis: null, creditoCofins: null });
  expect(p.linhas[1].receita).toBe(100000);
  expect(regime(estudo({}, e), "LUCRO_REAL").total).toBeNull();
});
test("edição da receita e folha altera janela somente nos meses seguintes", () => {
  const r = regime(estudo({ meses: { 0: { receita: 200000, folha: 50000 } } }), "SIMPLES_NACIONAL");
  expect(r.meses[0].memoria.rbt12).toBe(1200000);
  expect(r.meses[1].memoria.rbt12).toBe(1300000);
  expect(r.meses[1].memoria.fatorR).toBeCloseTo(358000 / 1300000);
});
test("início de atividade usa primeiro mês e depois média dos anteriores, inclusive atividade mista e IV", () => {
  const e = { ...entradas, receitasPorAtividade: [{ receita: 600000, atividade: "servicos", anexo: "III", issPct: 5 }, { receita: 600000, atividade: "servicos", anexo: "IV", issPct: 5 }] };
  const meses = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, { exclusivaIV: 1000, compartilhada: 2000, ratIV: 30 }]));
  const r = regime(estudo({ inicio: "2026-01", meses }, e), "SIMPLES_NACIONAL");
  expect(r.meses[0].memoria.rbt12).toBe(1200000);
  expect(r.meses[0].tributos.cpp).toBe(400); expect(r.total).not.toBeNull();
  expect(regime(estudo({ inicio: "2026-01" }, e), "SIMPLES_NACIONAL").total).toBeNull();
});
test("CPP exclusiva IV continua devida sem receita IV, compartilhada não gera contribuição com proporção zero", () => {
  const e = { ...entradas, receitasPorAtividade: [{ receita: 1200000, atividade: "servicos", anexo: "III", issPct: 5 }, { receita: 0, atividade: "servicos", anexo: "IV", issPct: 5 }] };
  const r = regime(estudo({ meses: { 0: { exclusivaIV: 1000, compartilhada: 5000, ratIV: 0 } } }, e), "SIMPLES_NACIONAL");
  expect(r.meses[0].tributos.cpp).toBe(200);
});
test("monofásico remove somente PIS/Cofins e ST somente ICMS; nenhuma vantagem sem conferência de operações", () => {
  const e = { ...entradas, atividadePresumido: "comercio", anexoSimples: "I" };
  const normal = regime(estudo({}, e), "SIMPLES_NACIONAL").meses[0];
  const mono = regime(estudo({ tratamentos: { 0: "mono_st" } }, e), "SIMPLES_NACIONAL").meses[0];
  const impostos = normal.memoria.atividades[0].porTributo;
  expect(mono.tributos.das).toBeCloseTo(normal.tributos.das - impostos.pis - impostos.cofins - impostos.icms, 2);
  expect(mono.total).toBeNull();
});
test("Real preserva prejuízo trimestral e compensa apenas 30% do lucro seguinte", () => {
  const meses = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, { baseRealIrpj: i < 3 ? -10000 : 10000, baseRealCsll: i < 3 ? -5000 : 10000 }]));
  const r = regime(estudo({ meses }), "LUCRO_REAL");
  expect(r.meses[2].tributos.irpj).toBe(0);
  expect(r.meses[5].memoria).toMatchObject({ baseIrpj: 21000, baseCsll: 21000, compensacaoIrpj: 9000, saldoPrejuizo: 21000, saldoBaseNegativa: 6000 });
});
test("saldos de PIS/Cofins correm separados; lacuna no crédito anterior bloqueia o saldo seguinte", () => {
  const r = regime(estudo({ meses: { 0: { creditoPis: 2000, creditoCofins: 0 }, 2: { creditoPis: "" } } }), "LUCRO_REAL");
  expect(r.meses[0].tributos).toMatchObject({ pis: 0, cofins: 7600 });
  expect(r.meses[1].tributos.pis).toBe(1300);
  expect(r.meses[3].tributos.pis).toBeNull();
});
test("operações entram somente no regime e mês correspondentes; PIS da memória não duplica o já calculado", () => {
  const r = estudo({}, entradas, [op, { ...op, tributo: "PIS", aliquota: .65 }]);
  expect(regime(r, "LUCRO_PRESUMIDO").meses[0].tributos.operacoes).toBe(180);
  expect(regime(r, "LUCRO_PRESUMIDO").meses[1].tributos.operacoes).toBe(0);
  expect(regime(r, "LUCRO_REAL").meses[0].tributos.operacoes).toBe(0);
});
test("mercadorias exigem base legal de PIS/Cofins; operações não somam regimes alternativos", () => {
  const e = { ...entradas, atividadePresumido: "comercio", anexoSimples: "I" };
  const p = regime(estudo({ operacoesConferidas: true }, e), "LUCRO_PRESUMIDO");
  expect(p.meses[0].tributos.pis).toBeNull(); expect(p.total).toBeNull();
  const conferido = regime(estudo({ operacoesConferidas: true, meses: { 0: { basePisCofins: 82000 } } }, e), "LUCRO_PRESUMIDO");
  expect(conferido.meses[0].tributos.pis).toBe(533);
  const ops = calcularOperacoes([op, { ...op, regime: "LUCRO_REAL" }]);
  expect(ops.total).toBeNull(); expect(ops.totaisPorRegime).toEqual({ LUCRO_PRESUMIDO: 180, LUCRO_REAL: 180 });
});
test("sublimite e receita anual divergente tornam projeção parcial", () => {
  const r = estudo({ meses: { 0: { receita: 4000000 } } });
  expect(regime(r, "SIMPLES_NACIONAL").total).toBeNull();
  const misto = { ...entradas, receitasPorAtividade: [{ receita: 500000, atividade: "servicos", anexo: "III", issPct: 5 }] };
  expect(regime(estudo({}, misto), "LUCRO_PRESUMIDO").total).toBeNull();
});
const reforma = { ano: 2029, creditosConferidos: true, operacoes: [{ base: 10000, cbsPct: 9, ibsPct: 2, reducao: 0, legado: 500, conferida: true }], creditos: [{ fornecedor: "Fornecedor A", documento: "123", cbs: 1000, ibs: 50, conferido: true }] };
test("reforma isola créditos e conserva ICMS/ISS pelo cronograma", () => {
  expect(calcularReformaOperacoes(reforma)).toMatchObject({ cbs: 0, ibs: 150, legado: 450, excedenteCbs: 100, excedenteIbs: 0, total: 600 });
});
test("créditos duplicados, não conferidos ou lista vazia sem confirmação impedem subtotal", () => {
  expect(calcularReformaOperacoes({ ...reforma, creditos: [...reforma.creditos, ...reforma.creditos] }).total).toBeNull();
  expect(calcularReformaOperacoes({ ...reforma, creditos: [{ ...reforma.creditos[0], conferido: false }] }).total).toBeNull();
  expect(calcularReformaOperacoes({ ...reforma, creditos: [], creditosConferidos: false }).total).toBeNull();
});
test("reforma 2027 usa IBS legal, 2033 extingue legado; taxa ausente não é inventada", () => {
  expect(calcularReformaOperacoes({ ...reforma, ano: 2027, creditos: [] }).ibs).toBe(10);
  expect(calcularReformaOperacoes({ ...reforma, ano: 2033, creditos: [] }).legado).toBe(0);
  expect(calcularReformaOperacoes({ ...reforma, operacoes: [{ ...reforma.operacoes[0], cbsPct: "" }] }).total).toBeNull();
});
