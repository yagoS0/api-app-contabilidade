import { createMockApi } from "../mockApi";

const api = createMockApi();
let companyId;
beforeAll(async () => { [ { companyId } ] = await api.listCompanies(); });
const ocorrencias = (calendario, id) => calendario.dias.flatMap((dia) => dia.itens.filter((it) => it.id === id).map((it) => ({ ...it, dia: dia.data })));

test("mensal fixa mantém seis dias e exclusão de ciclo sobrevive à atualização da série", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "EFD janela fixa", tipo: "OBRIGACAO", periodicidade: "MENSAL", diaVencimento: 25, ajusteDiaUtil: "MANTER", janelaTrabalho: { modo: "DIAS_DO_CICLO", diaInicio: 10, diaFim: 15, deslocamentoFim: 0 } });
  const [primeira, segunda] = criado.obrigacao.ocorrencias;
  expect(primeira.dataInicio.slice(-2)).toBe("10"); expect(primeira.dataFim.slice(-2)).toBe("15"); expect(primeira.dataVencimento.slice(-2)).toBe("25");
  expect(ocorrencias(await api.getCalendario(primeira.dataInicio.slice(0, 7), companyId), primeira.ocorrenciaId)).toHaveLength(6);
  await api.excluirOcorrencia(primeira.ocorrenciaId, { alcance: "ESTA" });
  await api.updateObrigacao(criado.obrigacao.obrigacaoId, { nome: "EFD renomeada" });
  const lista = await api.listObrigacoes({ companyId });
  const serie = lista.obrigacoes.find(o => o.obrigacaoId === criado.obrigacao.obrigacaoId);
  expect(serie.ocorrencias.some(o => o.ocorrenciaId === primeira.ocorrenciaId)).toBe(false);
  expect(serie.ocorrencias.some(o => o.ocorrenciaId === segunda.ocorrenciaId)).toBe(true);
});

test("edição e exclusão futura preservam concluída, janela anterior e prazo fiscal", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "EFD versões", tipo: "OBRIGACAO", periodicidade: "MENSAL", diaVencimento: 25, ajusteDiaUtil: "MANTER", janelaTrabalho: { modo: "DIAS_DO_CICLO", diaInicio: 10, diaFim: 15, deslocamentoFim: 0 } });
  const [primeira, segunda, terceira] = criado.obrigacao.ocorrencias;
  await api.concluirOcorrencia(terceira.ocorrenciaId);
  await api.updateOcorrencia(segunda.ocorrenciaId, { alcance: "ESTA_E_PROXIMAS", janelaTrabalho: { modo: "DIAS_DO_CICLO", diaInicio: 11, diaFim: 17, deslocamentoFim: 0 } });
  expect(primeira.dataInicio.slice(-2)).toBe("10"); expect(segunda.dataInicio.slice(-2)).toBe("11"); expect(segunda.dataVencimento.slice(-2)).toBe("25"); expect(terceira.dataInicio.slice(-2)).toBe("10");
  await api.excluirOcorrencia(segunda.ocorrenciaId, { alcance: "ESTA_E_PROXIMAS" });
  const serie = (await api.listObrigacoes({ companyId })).obrigacoes.find(o => o.obrigacaoId === criado.obrigacao.obrigacaoId);
  expect(serie.ocorrencias.map(o => o.ocorrenciaId)).toEqual([primeira.ocorrenciaId, terceira.ocorrenciaId]);
});

test("intervalo inclusivo cruza meses, mantém ID e conclui uma única ocorrência", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "Preparar folha intervalo", tipo: "TAREFA", periodicidade: "AVULSA", dataInicio: "2026-09-29", dataFim: "2026-10-03" });
  expect(criado.ocorrenciasCriadas).toBe(1);
  const id = criado.obrigacao.ocorrencias[0].ocorrenciaId;
  expect(ocorrencias(await api.getCalendario("2026-09", companyId), id).map((x) => x.dia)).toEqual(["2026-09-29", "2026-09-30"]);
  expect(ocorrencias(await api.getCalendario("2026-10", companyId), id).map((x) => x.dia)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  await api.concluirOcorrencia(id);
  expect(ocorrencias(await api.getCalendario("2026-10", companyId), id).every((x) => x.resolvido)).toBe(true);
  const listado = await api.listObrigacoes({ companyId });
  expect(listado.obrigacoes.find((x) => x.obrigacaoId === criado.obrigacao.obrigacaoId).ocorrencias).toHaveLength(1);
});

test("preparação de obrigação não modifica prazo fiscal; não aparece em outra empresa", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "Conferir obrigação", tipo: "OBRIGACAO", periodicidade: "AVULSA", dataInicio: "2026-09-10", dataFim: "2026-09-15", dataVencimento: "2026-09-20" });
  const id = criado.obrigacao.ocorrencias[0].ocorrenciaId;
  const antes = ocorrencias(await api.getCalendario("2026-09", companyId), id);
  expect(antes).toHaveLength(6);
  expect(antes.every((x) => x.data === "2026-09-20")).toBe(true);
  const editado = await api.updateOcorrencia(id, { dataInicio: "2026-09-09", dataFim: "2026-09-16" });
  expect(editado.ocorrencia.dataVencimento).toBe("2026-09-20");
  expect(ocorrencias(await api.getCalendario("2026-09", "empresa-diferente"), id)).toEqual([]);
});

test("tarefa tem prazo no fim e intervalo alterado mantém identidade", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "Tarefa", tipo: "TAREFA", periodicidade: "AVULSA", dataInicio: "2026-09-10", dataFim: "2026-09-10" });
  const id = criado.obrigacao.ocorrencias[0].ocorrenciaId;
  expect(ocorrencias(await api.getCalendario("2026-09", companyId), id)).toHaveLength(1);
  const r = await api.updateOcorrencia(id, { dataInicio: "2026-09-11", dataFim: "2026-09-13" });
  expect(r.ocorrencia.dataVencimento).toBe("2026-09-13");
  expect(r.ocorrencia.ocorrenciaId).toBe(id);
});

test("recusa intervalo invertido e data impossível", async () => {
  await expect(api.createObrigacao(companyId, { nome: "Inválida", periodicidade: "AVULSA", dataInicio: "2026-09-15", dataFim: "2026-09-10" })).rejects.toThrow(/fim/i);
  await expect(api.createObrigacao(companyId, { nome: "Inválida", periodicidade: "AVULSA", dataInicio: "2026-02-30", dataFim: "2026-03-03" })).rejects.toThrow(/data/i);
});

test("conflito com prazo de outro ciclo preserva as duas ocorrências", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "Rotina com conflito", tipo: "TAREFA", periodicidade: "MENSAL", diaVencimento: 20, ajusteDiaUtil: "MANTER" });
  const [primeira, segunda] = criado.obrigacao.ocorrencias;
  const antes = { ...primeira };
  const resultado = await api.updateOcorrencia(primeira.ocorrenciaId, { dataInicio: primeira.dataInicio, dataFim: segunda.dataVencimento });
  expect(resultado).toMatchObject({ ok: false, status: 409 });
  const salvo = (await api.listObrigacoes({ companyId })).obrigacoes.find((o) => o.obrigacaoId === criado.obrigacao.obrigacaoId);
  expect(salvo.ocorrencias.find((o) => o.ocorrenciaId === primeira.ocorrenciaId)).toMatchObject(antes);
});

test("editar cadastro avulso conserva ID e descrição; concluída não recria pendência", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "Tarefa única", descricao: "Conferir apontamentos", tipo: "TAREFA", periodicidade: "AVULSA", dataInicio: "2026-09-10", dataFim: "2026-09-12" });
  const id = criado.obrigacao.ocorrencias[0].ocorrenciaId;
  const editado = await api.updateObrigacao(criado.obrigacao.obrigacaoId, { dataFim: "2026-09-15" });
  expect(editado.obrigacao.ocorrencias[0].ocorrenciaId).toBe(id);
  expect(editado.obrigacao.descricao).toBe("Conferir apontamentos");
  await api.concluirOcorrencia(id);
  expect((await api.updateObrigacao(criado.obrigacao.obrigacaoId, { dataFim: "2026-09-20" })).ok).toBe(false);
  const salvo = (await api.listObrigacoes({ companyId })).obrigacoes.find((o) => o.obrigacaoId === criado.obrigacao.obrigacaoId);
  expect(salvo.ocorrencias).toHaveLength(1);
  expect(salvo.ocorrencias[0].status).toBe("CONCLUIDA");
});

test("alterar descrição da recorrência não apaga janela personalizada nem duplica ciclo", async () => {
  const criado = await api.createObrigacao(companyId, { nome: "Rotina personalizada", tipo: "TAREFA", periodicidade: "MENSAL", diaVencimento: 20, ajusteDiaUtil: "MANTER", diasPreparacao: 5 });
  const oc = criado.obrigacao.ocorrencias[0];
  const inicio = `${oc.dataVencimento.slice(0, 7)}-12`;
  const fim = `${oc.dataVencimento.slice(0, 7)}-22`;
  await api.updateOcorrencia(oc.ocorrenciaId, { dataInicio: inicio, dataFim: fim });
  const editado = await api.updateObrigacao(criado.obrigacao.obrigacaoId, { descricao: "Nova orientação" });
  const mesma = editado.obrigacao.ocorrencias.filter((x) => x.competenciaRef === oc.competenciaRef);
  expect(mesma).toHaveLength(1);
  expect(mesma[0]).toMatchObject({ ocorrenciaId: oc.ocorrenciaId, dataInicio: inicio, dataFim: fim, dataVencimento: fim });
});


test('frequência futura pode mudar e voltar sem perder exceções nem ressuscitar exclusão', async () => {
  const criado = await api.createObrigacao(companyId, { nome: 'EFD frequência', tipo: 'OBRIGACAO', periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER', janelaTrabalho: { modo: 'DIAS_DO_CICLO', diaInicio: 10, diaFim: 15, deslocamentoFim: 0 } });
  const rows = criado.obrigacao.ocorrencias;
  const ids = rows.map(o => o.ocorrenciaId);
  await api.concluirOcorrencia(ids[2]);
  await api.excluirOcorrencia(ids[5], { alcance: 'ESTA' });
  const regra = { periodicidade: 'TRIMESTRAL', mesReferencia: Number(rows[1].cicloChave.slice(5)), diaVencimento: 25, ajusteDiaUtil: 'MANTER', defasagemMeses: 1, diasPreparacao: 4 };
  await api.updateOcorrencia(ids[1], { alcance: 'ESTA_E_PROXIMAS', regra, janelaTrabalho: null });
  const lista = async () => (await api.listObrigacoes({ companyId })).obrigacoes.find(o => o.obrigacaoId === criado.obrigacao.obrigacaoId);
  const trimestre = await lista();
  expect(trimestre.ocorrencias.some(o => o.ocorrenciaId === ids[6])).toBe(false);
  expect(trimestre.ocorrencias.find(o => o.ocorrenciaId === ids[2]).status).toBe('CONCLUIDA');
  await api.updateOcorrencia(ids[1], { alcance: 'ESTA_E_PROXIMAS', regra: { ...regra, periodicidade: 'MENSAL' }, janelaTrabalho: null });
  const mensal = await lista();
  expect(mensal.ocorrencias.find(o => o.ocorrenciaId === ids[6]).dataInicio.slice(-2)).toBe('21');
  expect(mensal.ocorrencias.some(o => o.ocorrenciaId === ids[5])).toBe(false);
  expect(mensal.ocorrencias.find(o => o.ocorrenciaId === ids[0]).dataVencimento.slice(-2)).toBe('20');
});


test('pausar e reativar não descarta janela individual e não mostra inativa no calendário', async () => {
  const criado = await api.createObrigacao(companyId, { nome: 'Rotina pausada', tipo: 'TAREFA', periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER' });
  const oc = criado.obrigacao.ocorrencias[0];
  await api.updateOcorrencia(oc.ocorrenciaId, { dataInicio: oc.cicloChave + '-10', dataFim: oc.cicloChave + '-22' });
  const antes = { ...oc };
  await api.updateObrigacao(criado.obrigacao.obrigacaoId, { ativa: false });
  expect(ocorrencias(await api.getCalendario(oc.cicloChave, companyId), oc.ocorrenciaId)).toHaveLength(0);
  await api.updateObrigacao(criado.obrigacao.obrigacaoId, { ativa: true });
  const salvo = (await api.listObrigacoes({ companyId })).obrigacoes.find(o => o.obrigacaoId === criado.obrigacao.obrigacaoId);
  expect(salvo.ocorrencias.find(o => o.ocorrenciaId === oc.ocorrenciaId)).toMatchObject(antes);
});


test('maio personalizado sobrevive à trimestral sem maio e pausa/reativação', async () => {
  const criado = await api.createObrigacao(companyId, { nome: 'Maio excepcional', tipo: 'TAREFA', periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER' });
  const rows = criado.obrigacao.ocorrencias;
  const maio = rows.find(o => o.cicloChave.endsWith('-05'));
  await api.updateOcorrencia(maio.ocorrenciaId, { dataInicio: maio.cicloChave + '-10', dataFim: maio.cicloChave + '-22' });
  const personalizado = { ...maio };
  await api.updateOcorrencia(rows[0].ocorrenciaId, { alcance: 'ESTA_E_PROXIMAS', janelaTrabalho: null,
    regra: { periodicidade: 'TRIMESTRAL', mesReferencia: 6, diaVencimento: 25, ajusteDiaUtil: 'MANTER', defasagemMeses: 1, diasPreparacao: 0 } });
  const listar = async () => (await api.listObrigacoes({ companyId })).obrigacoes.find(o => o.obrigacaoId === criado.obrigacao.obrigacaoId);
  expect((await listar()).ocorrencias.find(o => o.ocorrenciaId === maio.ocorrenciaId)).toMatchObject(personalizado);
  await api.updateObrigacao(criado.obrigacao.obrigacaoId, { ativa: false });
  await api.updateObrigacao(criado.obrigacao.obrigacaoId, { ativa: true });
  expect((await listar()).ocorrencias.find(o => o.ocorrenciaId === maio.ocorrenciaId)).toMatchObject(personalizado);
  await api.updateObrigacao(criado.obrigacao.obrigacaoId, { descricao: 'Conferir orientação' });
  expect((await listar()).ocorrencias.find(o => o.ocorrenciaId === maio.ocorrenciaId)).toMatchObject(personalizado);
});
