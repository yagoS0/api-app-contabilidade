import { createBackgroundTaskClient } from "../backgroundTasks";
import { importarNotasEmLotes } from "../importarNotasEmLotes";

test("inicia uma vez e consulta apenas progresso até concluir", async () => {
  const request = jest.fn().mockResolvedValueOnce({ taskId: "a" }).mockResolvedValueOnce({ task: { status: "running" } }).mockResolvedValueOnce({ task: { status: "done", result: { sent: true } } });
  const client = createBackgroundTaskClient(request, { wait: async () => {} });
  expect(await client.request("/send", { method: "POST" })).toEqual({ sent: true });
  expect(request.mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(1);
  expect(request.mock.calls[0][1].headers).toMatchObject({ Prefer: "respond-async", "Idempotency-Key": expect.any(String) });
});

test("timeout na leitura não refaz o envio e mantém o código do resultado final", async () => {
  const request = jest.fn().mockResolvedValueOnce({ taskId: "a" }).mockRejectedValueOnce(new Error("offline"));
  const client = createBackgroundTaskClient(request);
  await expect(client.request("/send", { method: "POST" })).rejects.toThrow("Confira a tarefa");
  expect(request).toHaveBeenCalledTimes(2);
  request.mockResolvedValueOnce({ task: { status: "error", responseStatus: 409, result: { error: "CONFERENCIA_DIVERGENTE", message: "Confira novamente" } } });
  await expect(client.result({ taskId: "a" })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE", status: 409 });
});

test("envia todos os lotes antes de aguardar processamento e conserva resultados parciais", async () => {
  const calls = [];
  const background = { start: jest.fn(async () => { calls.push("upload"); return { taskId: String(calls.length) }; }),
    result: jest.fn(async () => { calls.push("result"); return { importadas: 20, errors: [] }; }) };
  const out = await importarNotasEmLotes(null, "a", Array.from({ length: 40 }, (_, i) => new File(["xml"], `${i}.xml`)), "NFE", jest.fn(), () => true, background);
  expect(calls).toEqual(["upload", "upload", "result", "result"]); expect(out.importadas).toBe(40);
});

test("resultado vazio de importação nunca é exibido como sucesso e não repete upload", async () => {
  const background = { start: jest.fn(async () => ({ taskId: "a" })), result: jest.fn(async () => null) };
  const out = await importarNotasEmLotes(null, "a", [new File(["xml"], "a.xml")], "NFE", null, () => true, background);
  expect(out.ok).toBe(false); expect(out.mensagem).toContain("confirmar o resultado"); expect(background.start).toHaveBeenCalledTimes(1);
});
