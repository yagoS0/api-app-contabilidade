import { useEffect, useRef } from "react";
import { Button } from "../../../components/ui/Button";
import { identidadeDaConversa, rotuloDaSituacao, estadoDaResposta } from "../lib/conversasTela";
import { companyTabPath } from "../../companies/detail/lib/rotasDaEmpresa";

export function WhatsappIcon({ nome = "chat", size = 20 }) {
  const desenhos = {
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" />,
    busca: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    seta: <path d="m14 6-6 6 6 6" />,
    enviar: <><path d="m3 3 19 9-19 9 4-9-4-9Z" /><path d="M7 12h15" /></>,
    pessoa: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    empresa: <><path d="M4 22V3h13v19M17 10h4v12M1 22h22M8 7h1m3 0h1M8 11h1m3 0h1M8 15h1m3 0h1M9 22v-4h4v4" /></>,
    documento: <><path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h6" /></>,
    relogio: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    painel: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M15 3v18" /></>,
    fechar: <path d="m6 6 12 12M6 18 18 6" />,
    atualizar: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{desenhos[nome] || desenhos.chat}</svg>;
}

export function AvatarConversa({ nome, pequeno = false }) {
  const iniciais = String(nome || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
  return <span className={`wa-avatar${pequeno ? " wa-avatar--small" : ""}`} aria-hidden="true">{iniciais}</span>;
}

export function SituacaoConversa({ conversa }) {
  const r = rotuloDaSituacao(conversa);
  return <span className="wa-status" data-tom={r.tom}><span aria-hidden="true" />{r.texto}</span>;
}

export function DetalhesConversa({ conversa, onFechar }) {
  const fecharRef = useRef(null);
  useEffect(() => {
    const origem = document.activeElement;
    fecharRef.current?.focus();
    return () => { if (origem?.isConnected) origem.focus(); };
  }, []);
  const i = identidadeDaConversa(conversa);
  const resposta = estadoDaResposta(conversa);
  return <aside className="wa-details" aria-label="Detalhes da conversa" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onFechar(); } }}>
    <div className="wa-section-heading"><h2>Detalhes do contato</h2><Button ref={fecharRef} variant="secondary" size="sm" onClick={onFechar} aria-label="Fechar detalhes"><WhatsappIcon nome="fechar" size={16} /></Button></div>
    <div className="wa-contact-profile"><AvatarConversa nome={i.pessoa} /><strong>{i.pessoa}</strong><span>{i.papel || "Contato"}</span><span>{conversa.telefoneMascarado}</span></div>
    <section className="wa-detail-section"><h3><WhatsappIcon nome="empresa" size={16} /> Empresa</h3><p>{i.linhaDaEmpresa}</p>{i.cnpj ? <small>{i.cnpj}</small> : null}{conversa.portalClientId ? <a href={companyTabPath(conversa.portalClientId, "anotacoes")}>Abrir a empresa →</a> : null}</section>
    <section className="wa-detail-section"><h3><WhatsappIcon nome="pessoa" size={16} /> Atendimento</h3><SituacaoConversa conversa={conversa} /><p>{conversa.excluidaEm || (conversa.portalClientId && (conversa.escopoVerificado === false || conversa.legadoNaoVerificado)) ? "Histórico preservado para consulta. O atendimento acontece em Conversas atuais." : conversa.atendidaPor || conversa.atendidaDesde ? "O assistente permanece em pausa durante o atendimento da equipe." : "Você pode assumir a conversa para responder pela equipe."}</p></section>
    <section className="wa-detail-section"><h3><WhatsappIcon nome="relogio" size={16} /> Respostas pelo WhatsApp</h3><p>{resposta.pode ? "Janela de resposta aberta." : resposta.motivo}</p></section>
    <section className="wa-detail-section"><h3><WhatsappIcon nome="documento" size={16} /> Arquivos recebidos</h3><p>Confira extratos e OFX em Lançamentos → A lançar. A importação é manual.</p></section>
  </aside>;
}
