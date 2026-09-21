// A TELA MÍNIMA DE CONVERSAS DE WHATSAPP (F5, 02/09/2026) — lista à esquerda, fio à direita.
//
// O que ela faz, e só isso: mostra a fila de não vinculados em destaque (é pendência do
// escritório), o fio com QUEM escreveu cada balão (cliente · assistente · escritório · fixa), a
// pendência aberta (código e expiração), ASSUMIR/DEVOLVER (o que cala e devolve a IA), RESPONDER
// à mão (com a janela de 24h dita ANTES de digitar) e VINCULAR (o formulário de contato da F1,
// resumido: empresa + nome + opt-in + pessoa do portal).
//
// A regra mora em `../lib/conversasTela.js`. Cores por token; âmbar é pendência, nunca decoração.
//
// ⚠ O FIO saiu daqui em 06/09/2026 (`../components/FioDaConversa.jsx`): ele ganhou um segundo
// consumidor — a mesma conversa dentro da empresa, ao lado das Anotações. `LinhaConversa` e
// `FormVincular` FICARAM, e por motivo: lá dentro a empresa é a mesma em toda linha (seria ruído)
// e o vínculo não existe (`portalClientId` nunca é nulo ali).

import { useMemo, useEffect, useState, useRef, useCallback } from "react";
import { relacionamentoDaConversa, chaveDoInterlocutor, canaisDaConversa, canalInicialDaConversa } from "../lib/identidadeAtendimento";
import { AvatarConversa, WhatsappIcon, DetalhesConversa } from "../components/ConversaVisual";
import { AppShell } from "../../../components/layout/AppShell";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { Feedback } from "../../../components/ui/Feedback";
import { useConversasWhatsapp } from "../hooks/useConversasWhatsapp";
import { useResumoWhatsapp } from "../hooks/useResumoWhatsapp";
import { AtualizacaoAtendimento } from "../components/AtendimentoComercial";
import { CanalDoAtendimento } from "../components/CanalDoAtendimento";
import { FormOnboarding } from "../components/FormOnboarding";
import { FioDaConversa, campo } from "../components/FioDaConversa";
// ⚠ A MESMA fonte da URL que a navegação por clique usa — nunca uma segunda construção do caminho.
import { companyTabPath } from "../../companies/detail/lib/rotasDaEmpresa";
import { FILTROS, SITUACAO_FIO, situacaoDoFio, rotuloDaSituacao, fraseDoConsumo, ordenarConversas, identidadeDaConversa, frasePaginacao } from "../lib/conversasTela";

// A lista identifica a pessoa. Empresa, função, origem do nome e caso ficam no fio/detalhes.
function LinhaConversa({ c, ativa, onAbrir }) {
  const r = rotuloDaSituacao(c);
  const identidade = identidadeDaConversa(c);
  const relacionamento = relacionamentoDaConversa(c);
  return <button type="button" className="wa-conversation" data-testid={`conversa-${c.id}`} data-situacao={r.situacao} data-relacionamento={relacionamento.tipo} aria-current={ativa ? "true" : undefined} onClick={() => onAbrir(c.id)}>
    <AvatarConversa nome={identidade.pessoa} pequeno />
    <div className="wa-conversation-copy">
      <div className="wa-conversation-title"><strong title={identidade.pessoa}>{identidade.pessoa}</strong>{c.naoLidas > 0 ? <span className="wa-unread" aria-label={`${c.naoLidas} novas mensagens`}>{c.naoLidas}</span> : null}</div>
      <div className="wa-contact-meta"><span className="wa-relationship" data-relacionamento={relacionamento.tipo}>{relacionamento.rotulo}</span></div>
    </div>
  </button>;
}
function FormVincular({ companies, api, conversaId, onVincular, ocupado, legado = false, empresaInicial = "" }) {
  const [portalClientId, setPortalClientId] = useState(empresaInicial);
  const [nome, setNome] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [usuarios, setUsuarios] = useState([]);
  useEffect(() => {
    let vivo = true;
    setUsuarios([]); setUserId("");
    if (!portalClientId || typeof api?.getPortalAccessUsers !== "function") return undefined;
    api.getPortalAccessUsers(portalClientId).then((r) => { if (vivo) setUsuarios(Array.isArray(r?.usuarios) ? r.usuarios : []); }).catch(() => {});
    return () => { vivo = false; };
  }, [api, portalClientId]);
  const pode = Boolean(portalClientId && nome.trim()) && !ocupado;
  return (
    <div data-testid="form-vincular" style={{ padding: "10px 12px", border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)", borderRadius: "var(--radius-sm)", marginBottom: 12 }}>
      <div style={{ fontSize: "0.8rem", color: "var(--text)", marginBottom: 8 }}>
        <strong>{legado ? "Este histórico precisa de um vínculo verificado." : "Este número não está em nenhum cadastro."}</strong> Confirme a empresa e o contato. Um novo segmento será aberto com o vínculo verificado, preservando o histórico anterior.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <label style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>Empresa
          <select aria-label="Empresa do vínculo" style={{ ...campo, marginTop: 4 }} value={portalClientId} onChange={(e) => setPortalClientId(e.target.value)}>
            <option value="">— escolha —</option>
            {(companies || []).map((c) => <option key={c.companyId} value={c.companyId}>{c.razao}</option>)}
          </select>
        </label>
        <label style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>Nome do contato
          <input aria-label="Nome do contato" style={{ ...campo, marginTop: 4 }} value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>Pessoa do portal
          <select aria-label="Pessoa do portal" style={{ ...campo, marginTop: 4 }} value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!portalClientId}>
            <option value="">— nenhuma —</option>
            {usuarios.map((u) => <option key={u.userId} value={u.userId}>{u.nome || u.email}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.76rem", color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> Opt-in registrado (autorizou receber mensagens)
        </label>
        <Button variant="primary" disabled={!pode} onClick={() => onVincular(conversaId, { portalClientId, contato: { nome, optIn, optInOrigem: optIn ? "vinculo_pela_conversa" : undefined, ...(userId ? { userId } : {}) } })}>
          Vincular
        </Button>
      </div>
    </div>
  );
}

export function WhatsappPage({ api, companies = [], onBack, onComunicados, message, error, usuarioId = null, mensagemBiblioteca = null, onMensagemBibliotecaAberta }) {
  const hook = useConversasWhatsapp({ api, feedback: null });
  const resumo = useResumoWhatsapp({ api });
  const [revisaoComercial, setRevisaoComercial] = useState(0);
  const atualizacaoComercial = useMemo(() => ({ revisao: revisaoComercial, mensagemBiblioteca, onMensagemBibliotecaAberta, atualizar: () => { setRevisaoComercial(v => v + 1); return hook.atualizarConversa(hook.aberta?.conversa.id); } }), [revisaoComercial, hook.atualizarConversa, hook.aberta?.conversa.id, mensagemBiblioteca, onMensagemBibliotecaAberta]);
  const [busca, setBusca] = useState("");
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const [relacionamento, setRelacionamento] = useState("");
  const chavePreferencia = usuarioId ? `altan:comunicacao:largura:${usuarioId}` : null;
  const lerLargura = () => { try { const n = Number(chavePreferencia && localStorage.getItem(chavePreferencia)); return n >= 200 && n <= 380 ? n : 238; } catch { return 238; } };
  const [larguraLista, setLarguraLista] = useState(lerLargura);
  useEffect(() => { setLarguraLista(lerLargura()); }, [chavePreferencia]);
  const ajustarLargura = useCallback(valor => { if (!Number.isFinite(valor)) return; const n = Math.min(380, Math.max(200, Math.round(valor))); setLarguraLista(n); try { if (chavePreferencia) localStorage.setItem(chavePreferencia, String(n)); } catch { /* Preferência visual continua na sessão. */ } }, [chavePreferencia]);
  const [listaOculta, setListaOculta] = useState(false);
  const alternarListaRef = useRef(null);
  const arrastoLista = useRef(null);
  const alternarLista = useCallback(() => { setListaOculta(v => !v); setVerChat(false); alternarListaRef.current?.focus(); }, []);
  useEffect(() => {
    const atalho = e => { if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing && e.key.toLowerCase() === "b") { e.preventDefault(); alternarLista(); } };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, [alternarLista]);
  useEffect(() => {
    const mover = e => { const inicio = arrastoLista.current; if (inicio) ajustarLargura(inicio.largura + e.clientX - inicio.x); };
    const terminar = () => { arrastoLista.current = null; };
    window.addEventListener("pointermove", mover); window.addEventListener("pointerup", terminar); window.addEventListener("pointercancel", terminar);
    return () => { terminar(); window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", terminar); window.removeEventListener("pointercancel", terminar); };
  }, [ajustarLargura]);
  const [detalhes, setDetalhes] = useState(false);
  const [canalPreparado, setCanalPreparado] = useState(null);
  const [pedidoCanal, setPedidoCanal] = useState(null);
  const registrarCanal = useCallback(c => setCanalPreparado(anterior => JSON.stringify(anterior) === JSON.stringify(c) ? anterior : c), []);
  const canalComercial = canalPreparado?.interlocutorId === (hook.aberta?.conversa.interlocutorId || hook.aberta?.conversa.id) ? canalPreparado : null;
  const canalAtual = hook.aberta ? canaisDaConversa(hook.aberta.conversa).find(c => c.id === (relacionamentoDaConversa(hook.aberta.conversa).tipo === "LEAD" ? canalInicialDaConversa(hook.aberta.conversa) : canalComercial?.canalId || canalInicialDaConversa(hook.aberta.conversa))) : null;
  const conversaComercial = hook.aberta ? { ...hook.aberta.conversa, ...(canalAtual ? { id: canalAtual.conversaId, canalId: canalAtual.id, janela: canalAtual.janela, podeResponder: canalAtual.podeResponder } : {}) } : null;
  const escolherCanal = canalId => setPedidoCanal({ interlocutorId: hook.aberta.conversa.interlocutorId || hook.aberta.conversa.id, canalId });
  const canalDeEnvio = hook.aberta ? <CanalDoAtendimento conversa={hook.aberta.conversa} canalId={conversaComercial.canalId} onSelecionar={escolherCanal} disabled={hook.ocupado} /> : null;
  const [verChat, setVerChat] = useState(false);
  const listaRef = useRef(null);
  const lista = useMemo(() => hook.buscaServidor ? hook.conversas : ordenarConversas(hook.conversas), [hook.conversas, hook.buscaServidor]);
  const fila = lista.filter((c) => c.relacionamento ? relacionamentoDaConversa(c).tipo === "A_IDENTIFICAR" : situacaoDoFio(c) === SITUACAO_FIO.FILA_SEM_EMPRESA).length;
  const avisoDaLista = frasePaginacao(hook.temMais);
  // A classificação e o caso comercial chegam na própria página; nunca carregar a carteira de fichas.
  const leituraOnboarding = c => c.solicitacaoComercial?.onboardingId
    ? { situacao: "EXATO", candidatos: [{ id: c.solicitacaoComercial.onboardingId, origem: c.solicitacaoComercial.origem, status: c.solicitacaoComercial.etapa, confianca: "EXATO" }] }
    : { situacao: "SEM_ONBOARDING", candidatos: [] };
  useEffect(() => {
    if (!api?.whatsappContratoV2) return;
    const timer = setTimeout(() => hook.setConsulta({ q: busca.trim(), relacionamento, naoLidas: soNaoLidas }), 250);
    return () => clearTimeout(timer);
  }, [api, busca, relacionamento, soNaoLidas, hook.setConsulta]);
  const normalizar = valor => String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const termo = normalizar(busca).trim();
  const visiveis = hook.buscaServidor ? lista : lista.filter(c => (!soNaoLidas || c.naoLidas > 0) && (!termo || normalizar([c.contato?.nome, c.nomePerfilProvedor, c.empresa?.razao, c.empresa?.cnpj, ...(c.empresas || []).flatMap(e => [e.razao, e.cnpj, ...(e.apelidosWhatsapp || [])]), c.telefoneMascarado, c.ultimaMensagem?.corpo].filter(Boolean).join(" ")).includes(termo)));
  const grupos = ["CLIENTE", "LEAD", "A_IDENTIFICAR"].map(tipo => ({ tipo, titulo: ({ CLIENTE: "Clientes", LEAD: "Leads", A_IDENTIFICAR: "A identificar" })[tipo], itens: visiveis.filter(c => relacionamentoDaConversa(c).tipo === tipo) }));
  const abrir = id => { setVerChat(true); hook.abrir(id); };
  const voltar = () => {
    setVerChat(false); setDetalhes(false); setListaOculta(false);
    requestAnimationFrame(() => (listaRef.current?.querySelector('[aria-current="true"]') || listaRef.current?.querySelector("input"))?.focus());
  };

  const painelComercial = hook.aberta ? <><section className="wa-commercial-section"><FormOnboarding key={chaveDoInterlocutor(hook.aberta.conversa)} api={api} conversa={conversaComercial} canalDeEnvio={canalDeEnvio} slotEmpresa={!hook.aberta.conversa.portalClientId ? <details className="wa-link-company"><summary>Vincular a uma empresa existente</summary><p>Use quando este contato já representa uma empresa da carteira.</p><FormVincular companies={companies} api={api} conversaId={hook.aberta.conversa.id} legado={hook.aberta.conversa.escopoVerificado === false} empresaInicial={hook.aberta.conversa.portalClientId || ""} onVincular={hook.vincular} ocupado={hook.ocupado} /></details> : null} mensagens={hook.aberta.mensagens} leitura={leituraOnboarding(hook.aberta.conversa)} onCriado={() => hook.atualizarConversa(hook.aberta.conversa.id)} /></section></> : null;

  return <div className="wa-page">
    <PageShell title="Atendimento" subtitle={mensagemBiblioteca ? `Escolha uma conversa para usar “${mensagemBiblioteca.titulo}”.` : "Conversas pelo WhatsApp"} onBack={onBack}
      actions={<><Button ref={alternarListaRef} variant="secondary" aria-label={listaOculta ? "Mostrar contatos" : "Ocultar contatos"} aria-expanded={!listaOculta} aria-controls="wa-lista-contatos" aria-keyshortcuts="Control+B" title={`${listaOculta ? "Mostrar" : "Ocultar"} contatos (Ctrl+B)`} onClick={alternarLista}>Contatos</Button><Button variant="secondary" onClick={() => hook.carregar(hook.filtro)} disabled={hook.carregando}><span className="wa-inline"><WhatsappIcon nome="atualizar" size={16} />{hook.carregando ? "Carregando…" : "Atualizar"}</span></Button></>}>
      <AppShell className="wa-shell">
        <div style={{ "--wa-list-width": `${larguraLista}px` }} className={`wa-workspace wa-workspace-v2${verChat ? " wa-workspace--open" : ""}${listaOculta ? " wa-workspace--list-hidden" : ""}${detalhes && hook.aberta ? " wa-workspace--details" : ""}`}>
          <aside id="wa-lista-contatos" className="wa-sidebar" aria-label="Caixa de entrada" ref={listaRef} hidden={listaOculta}>
            <div className="wa-sidebar-top">
              <div className="wa-section-heading"><h2>Conversas</h2><span className="wa-count" title="Conversas carregadas neste filtro">{lista.length}</span></div>
              <label className="wa-search"><WhatsappIcon nome="busca" size={17} /><input aria-label={api?.whatsappContratoV2 ? "Buscar pessoa ou empresa" : "Buscar nas conversas carregadas"} placeholder="Buscar contato ou empresa" value={busca} onChange={e => setBusca(e.target.value)} /></label>
              <div className="wa-sidebar-filterline"><div className="wa-relationship-filters" aria-label="Relacionamento">{[["", "Todos"], ["LEAD", "Leads"], ["CLIENTE", "Clientes"]].map(([tipo, titulo]) => <button type="button" key={tipo} aria-label={titulo} title={resumo.contagensNaoLidas ? `${resumo.contagensNaoLidas[tipo || "TODOS"]} novas mensagens em todas as conversas atuais de ${titulo.toLowerCase()}` : "Contagem de novas mensagens indisponível"} aria-pressed={relacionamento === tipo} onClick={() => { setRelacionamento(tipo); if (!api?.whatsappContratoV2) hook.setConsulta({ ...hook.consulta, relacionamento: tipo }); }}>{titulo}{resumo.contagensNaoLidas && <span className="wa-filter-count" aria-label={`${resumo.contagensNaoLidas[tipo || "TODOS"]} novas mensagens`}>{resumo.contagensNaoLidas[tipo || "TODOS"]}</span>}</button>)}</div>
              <details className="wa-list-filters"><summary>Filtros{(hook.filtro !== "todas" || soNaoLidas) && <span aria-label="Há filtros ativos"> ·</span>}</summary><div className="wa-filters">
                <select aria-label="Filtro das conversas" style={campo} value={hook.filtro} disabled={hook.ocupado} onChange={e => { setVerChat(false); setDetalhes(false); hook.setFiltro(e.target.value); }}>{FILTROS.map(f => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}</select>
                <Button variant="secondary" size="sm" className="wa-filter-unread" aria-pressed={soNaoLidas} onClick={() => setSoNaoLidas(v => !v)}>Não lidas</Button>
              </div></details></div>
              {(hook.filtro !== "todas" || soNaoLidas) && <p className="wa-active-filters" role="status">{[hook.filtro !== "todas" && FILTROS.find(f => f.valor === hook.filtro)?.rotulo, soNaoLidas && "Não lidas"].filter(Boolean).join(" · ")}</p>}
              {fila > 0 ? <p data-testid="contagem-fila" className="wa-list-note" style={{ color: "var(--state-warn)", padding: "8px 0 0" }}>{fila} número{fila === 1 ? "" : "s"} aguardando atendimento</p> : null}
              {resumo.avisoHistorico ? <p role="status" className="wa-list-note">{resumo.avisoHistorico}. Consulte o filtro Histórico anterior.</p> : null}
              {hook.filtro === "historico" ? <p className="wa-list-note">Mensagens anteriores preservadas para consulta, separadas das conversas atuais.</p> : hook.filtro === "lixeira" ? <p className="wa-list-note">Conversas excluídas da lista. O histórico está preservado e pode ser restaurado.</p> : null}
            </div>
            <div className="wa-conversation-list">
              {hook.erro ? <p role="status" className="wa-list-note" style={{ color: "var(--state-warn)" }}>Não foi possível ler as conversas{hook.erro.mensagem ? `: ${hook.erro.mensagem}` : ""}. A lista pode existir e não ter sido carregada.</p> : null}
              {hook.carregando && lista.length === 0 ? <p role="status" className="wa-list-note">Carregando conversas…</p> : null}
              {!hook.carregando && !hook.erro && visiveis.length === 0 ? <div className="wa-empty"><WhatsappIcon nome="busca" size={28} /><p>{termo || soNaoLidas ? hook.buscaServidor ? "Nenhuma conversa corresponde à busca e aos filtros." : "Nenhuma conversa carregada corresponde à busca e aos filtros." : "Nenhuma conversa neste filtro."}</p></div> : null}
              {grupos.filter(g => !relacionamento || g.tipo === relacionamento).map(g => g.itens.length ? <section key={g.tipo} aria-label={g.titulo} className="wa-contact-group"><h3>{g.titulo}</h3>{g.itens.map(c => <LinhaConversa key={chaveDoInterlocutor(c)} c={c} ativa={chaveDoInterlocutor(hook.aberta?.conversa) === chaveDoInterlocutor(c)} onAbrir={abrir} />)}</section> : null)}
              {hook.cursorLista ? <Button variant="secondary" size="sm" disabled={hook.carregandoMais} onClick={hook.carregarMais}>{hook.carregandoMais ? "Carregando…" : "Carregar mais conversas"}</Button> : null}
              {lista.length > 0 && avisoDaLista ? <p data-testid="aviso-paginacao-lista" className="wa-list-note">{avisoDaLista}</p> : null}
              {(termo || soNaoLidas) && !hook.buscaServidor ? <p className="wa-list-note">Busca e filtro de não lidas aplicados às conversas carregadas.</p> : null}
            </div>
            <div className="wa-sidebar-footer"><nav className="wa-inbox-links" aria-label="Comunicação">{onComunicados && <button type="button" onClick={onComunicados}>Avisos</button>}<a href="/biblioteca" target="_blank" rel="noopener noreferrer" aria-label="Gerenciar biblioteca compartilhada (nova aba)">Biblioteca ↗</a></nav><details className="wa-inbox-options"><summary>Opções</summary><div className="wa-options-content"><label className="wa-list-preferences">Largura da lista: {larguraLista}px<input aria-label="Largura da lista" type="range" min="200" max="380" value={larguraLista} onChange={e => ajustarLargura(Number(e.target.value))} /></label><div className="wa-budget"><strong>Consumo do assistente</strong><p data-testid="consumo-ia">{fraseDoConsumo(hook.consumoIa)}</p></div></div></details></div>
            <div className="wa-list-resizer" role="separator" aria-label="Redimensionar lista de contatos" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={380} aria-valuenow={larguraLista} tabIndex={0} onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); arrastoLista.current = { x: e.clientX, largura: larguraLista }; }} onKeyDown={e => { const n = { ArrowLeft: larguraLista - 10, ArrowRight: larguraLista + 10, Home: 200, End: 380 }[e.key]; if (n !== undefined) { e.preventDefault(); ajustarLargura(n); } }} />
          </aside>
          <section className="wa-chat-column" aria-label="Conversa selecionada">
            {hook.erroFio ? <p role="alert" className="wa-notice">Não foi possível atualizar a conversa: {hook.erroFio}</p> : null}
            {hook.aberta ? <FioDaConversa key={chaveDoInterlocutor(hook.aberta.conversa)} fio={hook.aberta} hook={hook} temMais={hook.temMaisNoFio}
              hrefDaEmpresa={id => companyTabPath(id, "anotacoes")} onVoltar={voltar} onDetalhes={() => setDetalhes(v => !v)} detalhesAbertos={detalhes} onCanalSelecionado={registrarCanal} pedidoCanal={pedidoCanal} atualizacaoComercialExterna={atualizacaoComercial}
              slotVincular={painelComercial} usuarioId={usuarioId}
            /> : <div className="wa-empty"><div className="wa-empty-symbol"><WhatsappIcon size={34} /></div><h2>{hook.carregandoFio ? "Abrindo conversa…" : "Seu atendimento, em um só lugar"}</h2><p>{hook.carregandoFio ? "Carregando o histórico deste contato." : "Escolha uma conversa à esquerda. Consulte o histórico, acompanhe a entrega e responda aos seus clientes."}</p>{verChat ? <Button variant="secondary" className="wa-mobile-back" onClick={voltar}>Voltar para conversas</Button> : null}</div>}
          </section>
          {hook.aberta ? <AtualizacaoAtendimento.Provider value={atualizacaoComercial}><DetalhesConversa key={chaveDoInterlocutor(hook.aberta.conversa)} aberto={detalhes} conversa={hook.aberta.conversa} atendimento={painelComercial} api={api} onConferido={() => hook.atualizarConversa(hook.aberta.conversa.id)} onFechar={() => setDetalhes(false)} /></AtualizacaoAtendimento.Provider> : null}
        </div>
        <Feedback message={message} error={hook.erroAcao || error} />
      </AppShell>
    </PageShell>
  </div>;
}

export default WhatsappPage;
