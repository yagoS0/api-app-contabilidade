import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { comunicarWorker, desligarNotificacoesLocais, registroAtendimento } from "../lib/atendimentoPwa";
import { haRascunhoPendente } from "../hooks/useRascunhoServidor";

function chavePush(valor) {
  const texto = atob(valor.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(valor.length / 4) * 4, "="));
  return Uint8Array.from(texto, c => c.charCodeAt(0));
}
export function AtendimentoAplicativo({ api, onSair }) {
  const [instalar, setInstalar] = useState(null), [registro, setRegistro] = useState(null), [atualizacao, setAtualizacao] = useState(null);
  const [config, setConfig] = useState(null), [inscrito, setInscrito] = useState(false), [ocupado, setOcupado] = useState(false), [aviso, setAviso] = useState("");
  const [online, setOnline] = useState(navigator.onLine !== false);
  useEffect(() => {
    let vivo = true, remover = () => {};
    const prompt = e => { e.preventDefault(); setInstalar(e); };
    const conexao = () => setOnline(navigator.onLine !== false);
    window.addEventListener("beforeinstallprompt", prompt); window.addEventListener("online", conexao); window.addEventListener("offline", conexao);
    registroAtendimento().then(async r => {
      if (!r || !vivo) return;
      setRegistro(r); setAtualizacao(r.waiting);
      setInscrito(Boolean(await r.pushManager?.getSubscription()));
      const mudou = () => { const worker = r.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller && vivo) setAtualizacao(r.waiting); }); };
      r.addEventListener("updatefound", mudou); remover = () => r.removeEventListener("updatefound", mudou);
    }).catch(() => { if (vivo) setAviso("Não foi possível preparar a instalação. Você pode continuar atendendo nesta página."); });
    api.getAtendimentoPushConfig?.().then(r => { if (vivo) setConfig(r); }).catch(() => { if (vivo) setConfig({ enabled: false }); });
    return () => { vivo = false; remover(); window.removeEventListener("beforeinstallprompt", prompt); window.removeEventListener("online", conexao); window.removeEventListener("offline", conexao); };
  }, [api]);
  async function notificacoes() {
    if (ocupado) return; setOcupado(true); setAviso("");
    try {
      if (inscrito) { await desligarNotificacoesLocais(api); setInscrito(false); setAviso("Notificações desativadas neste aparelho."); return; }
      if (!("Notification" in window) || !registro?.pushManager) throw new Error("Para receber avisos neste aparelho, instale o Altan Atendimento na tela inicial e abra pelo ícone.");
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") throw new Error("Notificações não autorizadas. Você pode alterar a permissão nas configurações do navegador.");
      await navigator.serviceWorker.ready;
      const subscription = await registro.pushManager.getSubscription() || await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chavePush(config.publicKey) });
      const r = await api.registrarAtendimentoPush({ subscription: subscription.toJSON(), deviceName: "Navegador do atendimento", preferencias: { minhas: true, fila: true } });
      if (!r?.vinculo) throw new Error("A inscrição não foi confirmada. Tente ativar novamente.");
      await comunicarWorker({ tipo: "SALVAR_VINCULO", id: r.id, vinculo: r.vinculo });
      setInscrito(true); setAviso("Avisos ativados para suas conversas e para a fila da equipe. O conteúdo fica protegido até abrir o atendimento.");
    } catch (e) { setAviso(e.message || "Não foi possível alterar as notificações."); }
    finally { setOcupado(false); }
  }
  function atualizar() {
    if (haRascunhoPendente()) { setAviso("Aguarde o rascunho ser salvo e resolva os envios sem confirmação antes de atualizar."); return; }
    const mudou = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", mudou, { once: true });
    atualizacao.postMessage({ tipo: "ATUALIZAR" });
  }
  return <div className="wa-app-tools">
    {!online && <p role="status" className="wa-notice">Sem conexão. Seus textos continuam nesta tela; aguarde a conexão para salvar ou enviar.</p>}
    <details><summary>Aplicativo e notificações</summary><div className="wa-app-options">
      {instalar ? <Button variant="secondary" onClick={async () => { await instalar.prompt(); setInstalar(null); }}>Instalar Altan Atendimento</Button> : <p>Para instalar: abra o menu do navegador e escolha “Adicionar à tela inicial”. No iPhone, use Compartilhar.</p>}
      {config?.enabled && config.publicKey ? <Button variant="secondary" disabled={ocupado || !online} onClick={notificacoes}>{inscrito ? "Desativar notificações neste aparelho" : "Ativar notificações neste aparelho"}</Button> : <p>Notificações aguardam configuração do escritório. As mensagens continuam atualizando com o atendimento aberto.</p>}
      {atualizacao && <Button variant="secondary" onClick={atualizar}>Atualizar aplicativo</Button>}
      {onSair && <Button variant="secondary" onClick={onSair}>Sair da conta</Button>}
      {aviso && <p role="status">{aviso}</p>}
    </div></details>
  </div>;
}
