/* Atendimento: nenhum fetch handler/cache de rede. Login, histórico, tokens e anexos
   sempre vêm do servidor. O banco guarda apenas o vínculo opaco desta instalação. */
const DB = "altan-atendimento-notificacoes";
function vinculo(operacao, valor) {
  return new Promise((resolve, reject) => {
    const abrir = indexedDB.open(DB, 1);
    abrir.onupgradeneeded = () => abrir.result.createObjectStore("instalacao");
    abrir.onerror = () => reject(abrir.error);
    abrir.onsuccess = () => {
      const db = abrir.result, tx = db.transaction("instalacao", operacao === "ler" ? "readonly" : "readwrite"), store = tx.objectStore("instalacao");
      const req = operacao === "ler" ? store.get("vinculo") : operacao === "limpar" ? store.delete("vinculo") : store.put(valor, "vinculo");
      let resultado; req.onsuccess = () => { resultado = req.result; };
      tx.oncomplete = () => { db.close(); resolve(resultado); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  const tipo = event.data?.tipo;
  if (tipo === "ATUALIZAR") { self.skipWaiting(); return; }
  if (!["LIMPAR_VINCULO", "SALVAR_VINCULO"].includes(tipo)) return;
  event.waitUntil((async () => {
    try {
      if (tipo === "SALVAR_VINCULO" && typeof event.data.vinculo === "string" && event.data.vinculo.length <= 256) await vinculo("salvar", { id: String(event.data.id || ""), vinculo: event.data.vinculo });
      else { await vinculo("limpar"); (await self.registration.getNotifications()).forEach(n => n.close()); }
      event.ports?.[0]?.postMessage({ ok: true });
    } catch { event.ports?.[0]?.postMessage({ ok: false }); }
  })());
});
function destinoSeguro(raw) {
  try {
    const url = new URL(raw || "/whatsapp?app=atendimento", self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== "/whatsapp") return "/whatsapp?app=atendimento";
    const id = url.searchParams.get("conversa");
    return `/whatsapp?app=atendimento${id && /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? `&conversa=${encodeURIComponent(id)}` : ""}`;
  } catch { return "/whatsapp?app=atendimento"; }
}
self.addEventListener("push", event => event.waitUntil((async () => {
  let payload; try { payload = event.data?.json(); } catch { return; }
  const atual = await vinculo("ler");
  if (!atual?.vinculo || atual.vinculo !== payload?.vinculo) return;
  await self.registration.showNotification("Nova mensagem no atendimento", {
    body: "Abra o Altan Atendimento para responder.", icon: "/icon-192.png", badge: "/icon-192.png",
    tag: `altan-atendimento-${new URL(destinoSeguro(payload.url), self.location.origin).searchParams.get("conversa") || "fila"}`, data: { url: destinoSeguro(payload.url), vinculo: atual.vinculo },
  });
})()));
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const atual = await vinculo("ler");
    if (!atual?.vinculo || atual.vinculo !== event.notification.data?.vinculo) return;
    const url = destinoSeguro(event.notification.data.url);
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const janela = janelas.find(c => new URL(c.url).origin === self.location.origin && new URL(c.url).pathname === "/whatsapp");
    if (janela) { janela.postMessage({ tipo: "ABRIR_CONVERSA", url }); await janela.focus(); } else await self.clients.openWindow(url);
  })());
});
