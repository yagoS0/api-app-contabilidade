import assert from "node:assert/strict";
import test from "node:test";
import { argumentos, importarArquivo } from "./import-commercial-resources.mjs";

test("CLI exige arquivo e ator; gravação é explícita", () => {
  assert.deepEqual(argumentos(["--file", "local.json", "--actor-id", "gestor"]), { arquivo: "local.json", atorId: "gestor", aplicar: false });
  assert.equal(argumentos(["--file", "local.json", "--actor-id", "gestor", "--apply"]).aplicar, true);
  for (const args of [[], ["--file"], ["--actor-id", "gestor"], ["--file", "a", "--file", "b", "--actor-id", "gestor"], ["--file", "a", "--actor-id", "gestor", "--approve"]]) assert.throws(() => argumentos(args));
});
test("arquivo válido é encaminhado ao importador com gravação desabilitada por padrão", async () => {
  const payload = { formatVersion: 1, resources: [{ tipo: "CONTRATO", texto: "Texto fictício" }] };
  let observado;
  await importarArquivo(["--file", "local.json", "--actor-id", "gestor"], { info: async () => ({ isFile: () => true, size: 80 }), ler: async () => JSON.stringify(payload), executar: async (...args) => { observado = args; return {}; } });
  assert.deepEqual(observado, [payload, "gestor", { aplicar: false }]);
});
test("JSON inválido não expõe seu conteúdo e não chama importador", async () => {
  let chamadas = 0;
  await assert.rejects(importarArquivo(["--file", "local.json", "--actor-id", "gestor"], { info: async () => ({ isFile: () => true, size: 80 }), ler: async () => '{"texto confidencial":', executar: async () => { chamadas += 1; } }), err => err.code === "json_invalido" && !err.message.includes("confidencial"));
  assert.equal(chamadas, 0);
});
test("arquivo excessivo é recusado antes de ler seu conteúdo", async () => {
  let leituras = 0;
  await assert.rejects(importarArquivo(["--file", "local.json", "--actor-id", "gestor"], { info: async () => ({ isFile: () => true, size: 9 * 1024 * 1024 }), ler: async () => { leituras += 1; return "{}"; }, executar: async () => {} }), { code: "arquivo_invalido" });
  assert.equal(leituras, 0);
});
