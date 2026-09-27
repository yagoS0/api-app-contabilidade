/** @jest-environment node */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const codigo = fs.readFileSync(path.join(__dirname, "../../../../../public/atendimento-sw.js"), "utf8");
function ambiente() {
  const listeners = new Map(), dados = new Map(), mensagens = [], mostrar = jest.fn(async () => {}), navegar = jest.fn(), fechar = jest.fn();
  const cliente = { url: "https://app.test/whatsapp?app=atendimento", postMessage: m => mensagens.push(m), navigate: navegar, focus: jest.fn() };
  const indexedDB = { open: () => {
    const req = {};
    queueMicrotask(() => { req.result = {
      close() {}, createObjectStore() {}, transaction: () => {
        const tx = { objectStore: () => ({
          get: key => executar(() => dados.get(key)),
          put: (value,key) => executar(() => dados.set(key,value)),
          delete: key => executar(() => dados.delete(key)),
        }) };
        function executar(fn) { const leitura = {}; queueMicrotask(() => { leitura.result = fn(); leitura.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return leitura; }
        return tx;
      },
    }; req.onsuccess?.(); }); return req;
  } };
  const self = { addEventListener: (tipo, cb) => listeners.set(tipo, cb), location: { origin: "https://app.test" }, registration: { showNotification: mostrar, getNotifications: async () => [{ close: fechar }] }, clients: { claim: jest.fn(), matchAll: async () => [cliente], openWindow: jest.fn() }, skipWaiting: jest.fn() };
  vm.runInNewContext(codigo, { self, indexedDB, URL, Promise });
  async function disparar(tipo, payload) { let pending; listeners.get(tipo)({ ...payload, waitUntil: p => { pending = p; } }); await pending; }
  const vincular = () => disparar("message", { data: { tipo: "SALVAR_VINCULO", id: "device", vinculo: "nonce-atual" } });
  return { self, listeners, mostrar, navegar, fechar, mensagens, disparar, vincular };
}
test("worker não intercepta rede nem guarda histórico; push sem vínculo é descartado", async () => {
  const a = ambiente(); expect(a.listeners.has("fetch")).toBe(false);
  await a.disparar("push", { data: { json: () => ({ vinculo: "antigo", body: "Conteúdo privado" }) } }); expect(a.mostrar).not.toHaveBeenCalled();
});
test("push com vínculo certo mostra só texto genérico e separa conversas", async () => {
  const a = ambiente(); await a.vincular();
  await a.disparar("push", { data: { json: () => ({ vinculo: "nonce-atual", title: "Nome privado", body: "CPF secreto", url: "/whatsapp?conversa=abc" }) } });
  expect(a.mostrar).toHaveBeenCalledWith("Nova mensagem no atendimento", expect.objectContaining({ body: "Abra o Altan Atendimento para responder.", tag: "altan-atendimento-abc", data: { url: "/whatsapp?app=atendimento&conversa=abc", vinculo: "nonce-atual" } }));
  expect(JSON.stringify(a.mostrar.mock.calls)).not.toMatch(/privado|secreto/);
});
test("logout limpa nonce e avisos antes de rejeitar evento antigo", async () => {
  const a = ambiente(); await a.vincular(); await a.disparar("message", { data: { tipo: "LIMPAR_VINCULO" } });
  expect(a.fechar).toHaveBeenCalled(); await a.disparar("push", { data: { json: () => ({ vinculo: "nonce-atual" }) } }); expect(a.mostrar).not.toHaveBeenCalled();
});
test("clicar aviso preserva documento aberto e só solicita navegação interna ao aplicativo", async () => {
  const a = ambiente(); await a.vincular();
  await a.disparar("notificationclick", { notification: { close: jest.fn(), data: { vinculo: "nonce-atual", url: "https://evil.test/roubar" } } });
  expect(a.navegar).not.toHaveBeenCalled(); expect(a.mensagens).toEqual([{ tipo: "ABRIR_CONVERSA", url: "/whatsapp?app=atendimento" }]);
});
