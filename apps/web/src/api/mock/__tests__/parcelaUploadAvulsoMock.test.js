import { createMockApi } from "../mockApi";
import { coberturaFiscalParcelasMock, relatorioParcelasGuiasMock } from "../parcelasGuiasRelatorioMock";
import { lerEnvioDaGuia } from "../../../features/guides/lib/envioNaTela";

const api = createMockApi();
const meta = { tipo: "SIMPLES", competencia: "2026-09", vencimento: "2026-09-20", valor: 100, isParcelamento: true, parcelamentoTipo: "PARCSN" };
const arquivo = { name: "parcela.pdf" };

test("upload avulso não contabiliza nem envia, e aceita documento sem data para conferir", async () => {
  const companyId = "upload-sem-dados";
  const before = await api.listParcelamentos(companyId);
  const out = await api.uploadCompanyGuide(companyId, arquivo, { ...meta, vencimento: null, valor: null });
  expect(out.guide).toMatchObject({ parcelamentoAvulso: true, emailStatus: "PENDING", paymentStatus: "OPEN", extracted: { conferenciaDocumentoPendente: true } });
  expect(lerEnvioDaGuia(out.guide).situacao).toBe("NAO_ENVIADA");
  const resumo = contratos => contratos.map(c => ({ id: c.id, aberturaEntryId: c.aberturaEntryId, totalValue: c.totalValue, saldoPassivo: c.saldoPassivo, guias: c.guides.map(g => g.id) }));
  expect(resumo(await api.listParcelamentos(companyId))).toEqual(resumo(before));
  const fiscal = await api.getAcompanhamentoParcelamentos(companyId);
  expect(fiscal.contratos.find(c => c.id === out.guide.parcelamentoId)).toMatchObject({ aberturaEntryId: null, numParcelas: null, origem: "GUIA_AVULSA" });
  expect(fiscal.itens.find(i => i.guideId === out.guide.id)).toMatchObject({ estado: "CONFERIR_DOCUMENTO", atrasada: false });
});

test("vínculo posterior preserva guia paga, arquivo, valores e referência sem novo upload", async () => {
  const companyId = "upload-vinculo-posterior";
  const { guide } = await api.uploadCompanyGuide(companyId, arquivo, meta);
  await api.confirmGuidePayment(guide.id);
  const { contrato } = await api.criarAcompanhamentoParcelamento(companyId, { tipo: "PARCSN", numeroParcelamento: "100" });
  const out = await api.vincularGuiaParcelamento(companyId, guide.id, { parcelamentoId: contrato.id, numeroParcela: null });
  expect(out.guide).toMatchObject({ id: guide.id, fileName: "parcela.pdf", valor: 100, competencia: "2026-09", paymentStatus: "PAID", parcelamentoAvulso: false, numeroParcela: null });
  expect((await api.getCompanyGuides(companyId))).toHaveLength(1);
  const fiscal = await api.getAcompanhamentoParcelamentos(companyId);
  expect(fiscal.contratos.find(c => c.id === contrato.id).aberturaEntryId).toBeNull();
  expect((await api.vincularGuiaParcelamento(companyId, guide.id, { parcelamentoId: contrato.id, numeroParcela: null })).ok).toBe(true);
  await expect(api.vincularGuiaParcelamento("outra", guide.id, { parcelamentoId: contrato.id })).rejects.toThrow("nesta empresa");
});

test("vincula ao contrato contabilizado existente sem duplicar contrato nem prestação", async () => {
  const companyId = "upload-contrato-novo";
  const out = await api.ingestParcelamento(companyId, { header: { tipo: "PARCSN", numeroParcelamento: "456", quantidadeParcelas: 2, valorPrincipal: 200, valorParcela: 100, anoMesParcela: "202609", diaPagamento: 20 } });
  const { guide } = await api.uploadCompanyGuide(companyId, arquivo, meta);
  await api.vincularGuiaParcelamento(companyId, guide.id, { parcelamentoId: out.data.parcelamentoId, numeroParcela: 1 });
  const contratos = await api.listParcelamentos(companyId);
  expect(contratos.filter(c => c.id === out.data.parcelamentoId)).toHaveLength(1);
  const vinculado = contratos.find(c => c.id === out.data.parcelamentoId);
  expect(vinculado.guides.filter(g => g.id === guide.id)).toHaveLength(1);
  expect(vinculado.parcelasContratadas.filter(p => p.numeroParcela === 1)).toHaveLength(1);
  expect(vinculado.parcelasContratadas.find(p => p.numeroParcela === 1).guia.id).toBe(guide.id);
});

test("indícios Talbot/Klaus permanecem só anteriores depois do upload compatível do mês", async () => {
  const empresas = await api.listCompanies();
  const demos = empresas.filter(c => c.parcelamentoDemoAtrasos);
  expect(demos).toHaveLength(2);
  for (const empresa of demos) {
    const id = empresa.companyId;
    const antes = await api.getCompanyGuideDueReport(id, "2026-09");
    const falta = antes.simples[0].faltantes.find(f => f.indicacaoId);
    expect(falta).toBeTruthy();
    await api.uploadCompanyGuide(id, arquivo, { ...meta, indicacaoId: falta.indicacaoId });
    const depois = await api.getCompanyGuideDueReport(id, "2026-09");
    expect(depois.simples[0].faltantes.filter(f => f.indicacaoId)).toHaveLength(0);
    expect(depois.pendenciasAnteriores.find(p => p.indicacaoId)).toMatchObject({ somenteAnteriores: true, guiaDoMesPresente: true, parcelasEmAtraso: empresa.parcelamentoDemoAtrasos });
    expect(depois.simples[0].documentos.some(g => g.parcelamentoAvulso)).toBe(true);
  }
});

test("relatório não inventa indício, DAS normal e guia de outro mês não cobrem parcela", () => {
  const base = { companyId: "x", mesVencimento: "2026-09" };
  expect(relatorioParcelasGuiasMock(base).simples[0].faltantes).toEqual([]);
  const acompanhamento = { indicacoes: [{ id: "i", status: "PENDENTE", modalidade: "PARCSN", parcelasEmAtraso: 2 }] };
  const guias = [{ id: "das", tipo: "SIMPLES", competencia: "2026-09", status: "PROCESSED", hasPdf: true }, { id: "antiga", parcelamentoId: "p", parcelamentoTipo: "PARCSN", competencia: "2026-08", status: "PROCESSED", hasPdf: true }];
  expect(relatorioParcelasGuiasMock({ ...base, acompanhamento, guias }).simples[0].faltantes).toHaveLength(1);
});

test("a cobertura fiscal do mock conserva o mês do documento e a referência da previsão", async () => {
  const companyId = "empresa-ficticia-fiscal";
  const item = (parcelaId, referencia, guideId, extra = {}) => ({
    id: parcelaId, parcelaId, portalClientId: companyId, referencia, guideId,
    vencimento: "2026-11-30", formaPagamento: "GUIA_MENSAL", ...extra,
  });
  const itens = [item("real","2026-11","g"), item("outubro","2026-10",null),
    item("novembro","2026-11",null), item("sem-mes",null,null),
    item("outra-empresa","2026-10",null,{portalClientId:"outra"}), item("sem-guia-local","2026-10","id-desconhecido")];
  const doc = {id:"g",competencia:"2026-10",status:"PROCESSED",hasPdf:true,vencimento:"2026-11-30",valor:20};
  const projetar = mes => coberturaFiscalParcelasMock(companyId,mes,[doc],{itens});
  expect(projetar("2026-10").map(p=>p.id)).toEqual(["real","outubro"]);
  expect(projetar("2026-11").map(p=>p.id)).toEqual(["novembro"]);
  expect(projetar("2026-10")[0]).toMatchObject({referencia:"2026-11",referenciaFiscal:"2026-10",documento:"disponivel"});
  expect(await api.getExpectedGuides(companyId,"2026-10")).toMatchObject({competencia:"2026-10",compliance:{coberturaParcelamentoMes:[]}});
});
test("carteira e aba Guias projetam as mesmas parcelas para uma competência real da simulação", async () => {
  const [empresa] = await api.listCompanies();
  const id = empresa.companyId;
  const { contrato } = await api.criarAcompanhamentoParcelamento(id, {
    tipo: "PARCSN", numeroParcelamento: "COMP-IGUAL", formaPagamento: "GUIA_MENSAL",
  });
  await api.capturarContratoParcelamento(id, contrato.id);
  const itens = (await api.getAcompanhamentoParcelamentos(id)).itens;
  const item = itens.find(p => p.parcelamentoId === contrato.id && p.guideId);
  expect(item).toBeDefined();
  const periodo = item.referencia;
  const carteira = (await api.listCompanies(periodo)).find(c => c.companyId === id);
  const guias = await api.getExpectedGuides(id, periodo);
  expect(guias.compliance.coberturaParcelamentoMes).toEqual(carteira.guideCompliance.coberturaParcelamentoMes);
  expect(guias.compliance.coberturaParcelamentoMes).toEqual(expect.arrayContaining([
    expect.objectContaining({ guideId: item.guideId, referenciaFiscal: periodo, documento: "disponivel" }),
  ]));
});
