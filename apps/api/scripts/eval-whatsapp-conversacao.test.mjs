import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, createBudgetClient, runConversationCase, safeError } from "./eval-whatsapp-conversacao.mjs";
import { CASES, COMPANY, CUSTOMER_DOCUMENT, makeState, executeFixture } from "./eval-whatsapp-fixtures.mjs";

test("emissão sintética distingue o prestador do tomador", () => {
  assert.notEqual(COMPANY.cnpj.replace(/\D/g, ""), CUSTOMER_DOCUMENT);
});

test("não aceita opções desconhecidas nem limites maiores que o teto", () => {
  assert.throws(() => parseArgs(["--api-key", "secret"]));
  assert.throws(() => createBudgetClient({}, { maxRequests: 121 }));
  assert.throws(() => createBudgetClient({}, { maxUsd: 5.01 }));
  assert.equal(parseArgs(["--dry-run", "--cases=x,y"])["dry-run"], true);
});
test("orçamento barra a chamada antes da rede e conta todas as rodadas", async () => {
  let called = 0;
  const raw = { messages: { create: async () => { called++; return { usage: { input_tokens: 100, output_tokens: 10 } }; } } };
  const small = createBudgetClient(raw, { maxUsd: 0.00001 });
  await assert.rejects(() => small.client.messages.create({ model: "test", max_tokens: 10 }), /teto/);
  assert.equal(called, 0);
  const limited = createBudgetClient(raw, { maxRequests: 1 });
  await limited.client.messages.create({ model: "test", max_tokens: 10 });
  await assert.rejects(() => limited.client.messages.create({ model: "test", max_tokens: 10 }), /teto/);
  assert.equal(called, 1);
  assert.equal(limited.ledger.requests, 1);
  assert.equal(limited.ledger.reservedUsd, 0);
  assert.ok(limited.ledger.estimatedUsd > 0);
});
test("falha sem usage conserva a reserva e nenhum segredo aparece em safeError", async () => {
  const raw = { messages: { create: async () => { throw Object.assign(new Error("secret-test-key"), { status: 400 }); } } };
  const limited = createBudgetClient(raw);
  await assert.rejects(() => limited.client.messages.create({ model: "test", max_tokens: 10 }));
  assert.equal(limited.ledger.estimatedUsd, limited.ledger.requestsLog[0].reservationUsd);
  assert.equal(JSON.stringify(safeError(new Error("secret-test-key"))).includes("secret"), false);
});
test("fixtures isoladas e executor fechado para ferramentas desconhecidas", async () => {
  const first = makeState(), second = makeState();
  await executeFixture(first, "danfse_da_nota", { notaId: "n-8" });
  assert.equal(first.deliveries.length, 1);
  assert.equal(second.deliveries.length, 0);
  const unknown = await executeFixture(first, "emitir_nfse_real", {});
  assert.equal(unknown.ok, false);
  assert.equal(first.executions.length, 0);
});
test("corrigir pendência usa novo código e nunca executa", async () => {
  const scenario = CASES.find((c) => c.id === "corrigir_pendencia");
  const state = makeState(scenario);
  const oldCode = state.pending.codigo;
  const payload = state.pending.payload;
  await executeFixture(state, "preparar_emissao", { tomadorDoc: payload.tomador.cnpjCpf, tomadorNome: payload.tomador.nome,
    endereco: payload.tomador.endereco, descricao: payload.servico.descricao, competencia: payload.competencia, valor: 1050.5 });
  assert.notEqual(state.pending.codigo, oldCode);
  assert.equal(state.pending.payload.servico.valorServicos, 1050.5);
  assert.equal(state.executions.length, 0);
});
test("filtros e paginação das fixtures respeitam o contrato de consulta", async () => {
  const state = makeState();
  const invoice = await executeFixture(state, "listar_notas", { busca: "7" });
  assert.deepEqual(invoice.notas.map((n) => n.notaId), ["n-7"]);
  const emptyPage = await executeFixture(state, "listar_notas", { pagina: 2 });
  assert.equal(emptyPage.notas.length, 0);
  const document = await executeFixture(state, "listar_documentos", { busca: "cartão" });
  assert.deepEqual(document.documentos.map((d) => d.documentId), ["d-cnpj"]);
  const fiscal = await executeFixture(state, "situacao_fiscal", {});
  assert.equal(fiscal.relatorioDe, "24/07/2026");
  assert.equal(fiscal.situacao, undefined);
});
test("runner mede ferramenta efetiva e estado, não rótulo inventado pelo modelo", async () => {
  const scenario = { id: "isolated", turns: ["a nota", "obrigada"], verify: (s) => [{ id: "delivery", passed: s.deliveries.length === 1 }] };
  const createAssistant = () => ({ responder: async ({ messages, executar }) => {
    if (messages.at(-1).content === "a nota") await executar("danfse_da_nota", { notaId: "n-8" });
    return { texto: "Certo.", stopReason: "end_turn", usage: { input_tokens: 1 }, ferramentasChamadas: ["inventada"], iteracoes: 1 };
  } });
  const result = await runConversationCase(scenario, { createAssistant, montarSystem: () => [], definitions: [] });
  assert.equal(result.evaluation.passed, true);
  assert.equal(result.turns[0].tools[0].name, "danfse_da_nota");
  assert.equal(result.turns[1].tools.length, 0);
  assert.equal(JSON.stringify(result).includes("inventada"), false);
});

test("runner preserva no próximo turno o anexo aceito sem inventar entrega", async () => {
  const seen = [];
  const createAssistant = () => ({ responder: async ({ messages, executar }) => {
    seen.push(structuredClone(messages));
    if (messages.at(-1).content === "o contrato") await executar("enviar_documento_da_empresa", { documentId: "d-social" });
    return { texto: "Certo.", stopReason: "end_turn" };
  } });
  await runConversationCase({ id: "attachment-history", turns: ["o contrato", "e o cartão"] }, { createAssistant, montarSystem: () => [], definitions: [] });
  const previous = seen[1].filter(m => m.role === "assistant").map(m => m.content).join("\n");
  assert.match(previous, /Anexo de saída: documento/);
  assert.match(previous, /teste-d-social\.pdf/);
  assert.match(previous, /envio aceito pelo WhatsApp/);
  assert.doesNotMatch(previous, /entrega confirmada|leitura confirmada/);
  assert.equal(seen[1].at(-1).content, "e o cartão");
});
