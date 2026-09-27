export const ATENDIMENTO_URL = "/whatsapp?app=atendimento";
// Mesmo um HTTP 409 pode representar uma mensagem aceita ou ainda em andamento.
// Esses estados sempre exigem consultar a mesma intenção antes de outro envio.
export function precisaConferirIntencao(erro) {
  if (["INCERTA", "PROCESSANDO", "ACEITA"].includes(erro?.payload?.intencao?.status)) return true;
  if (erro?.payload?.podeTentarDeNovo === true) return false;
  return !erro?.status || erro.status >= 500 || erro.payload?.podeTentarDeNovo === false;
}
export function modoAtendimento(location = window.location) {
  return location.pathname === "/whatsapp" && (new URLSearchParams(location.search).get("app") === "atendimento" || window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
}
export function destinoInternoSeguro(raw, fallback = "/companies") {
  if (!raw || typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "https://altan.invalid");
    if (url.origin !== "https://altan.invalid" || !/^\/(whatsapp(?:\/comunicados)?|companies(?:\/[^/]+(?:\/[^/]+)?)?|onboardings(?:\/[^/]+(?:\/editar)?)?|biblioteca|configuracoes(?:\/atendimento)?|rotinas|obrigacoes|guides\/[^/]+|firm-settings\/[^/]+|apuracao|planejamento|funcoes-serpro|laboratorio)\/?$/.test(url.pathname)) return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}
export function novaIntencao() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function registroAtendimento() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/atendimento-sw.js", { scope: "/", updateViaCache: "none" });
}
export async function comunicarWorker(mensagem) {
  const registro = await navigator.serviceWorker?.getRegistration("/");
  const worker = registro?.active;
  if (!worker) return;
  await new Promise((resolve, reject) => {
    const canal = new MessageChannel();
    const timer = setTimeout(() => { canal.port1.close(); reject(new Error("O aplicativo não confirmou a alteração das notificações.")); }, 4000);
    canal.port1.onmessage = e => { clearTimeout(timer); canal.port1.close(); e.data?.ok ? resolve() : reject(new Error("Não foi possível atualizar as notificações neste aparelho.")); };
    worker.postMessage(mensagem, [canal.port2]);
  });
}
export async function desligarNotificacoesLocais(api) {
  const registro = await navigator.serviceWorker?.getRegistration("/");
  if (!registro) return;
  // Primeiro invalida o vínculo local. Uma falha de rede nunca deixa avisos da conta anterior.
  const subscription = await registro.pushManager?.getSubscription();
  try { await comunicarWorker({ tipo: "LIMPAR_VINCULO" }); }
  catch (e) {
    // Falha no banco do SW: remove o receptor da instalação antes de encerrar a conta.
    const desinscrita = !subscription || await subscription.unsubscribe();
    const removido = await registro.unregister();
    if (!desinscrita && !removido) throw e;
  }
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await api?.revogarAtendimentoPush?.({ endpoint });
  }
}
