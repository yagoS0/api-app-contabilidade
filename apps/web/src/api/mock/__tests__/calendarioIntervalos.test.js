import { createMockApi } from "../mockApi";

const api = createMockApi();
let companyId;
beforeAll(async () => { [ { companyId } ] = await api.listCompanies(); });
const ocorrencias = (calendario, id) => calendario.dias.flatMap((dia) => dia.itens.filter((it) => it.id === id).map((it) => ({ ...it, dia: dia.data })));

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
