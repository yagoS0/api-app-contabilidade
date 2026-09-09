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

import { useMemo, useEffect, useState, useRef } from "react";
import { AvatarConversa, SituacaoConversa, WhatsappIcon, DetalhesConversa } from "../components/ConversaVisual";
import { AppShell } from "../../../components/layout/AppShell";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { Feedback } from "../../../components/ui/Feedback";
import { useConversasWhatsapp } from "../hooks/useConversasWhatsapp";
import { useResumoWhatsapp } from "../hooks/useResumoWhatsapp";
import { FormOnboarding } from "../components/FormOnboarding";
import { onboardingDaConversa, fraseDoOnboarding } from "../lib/onboardingDaConversa";
import { FioDaConversa, LinhaDaEmpresa, NomeDaPessoa, campo } from "../components/FioDaConversa";
// ⚠ A MESMA fonte da URL que a navegação por clique usa — nunca uma segunda construção do caminho.
import { companyTabPath } from "../../companies/detail/lib/rotasDaEmpresa";
import { FILTROS, SITUACAO_FIO, situacaoDoFio, rotuloDaSituacao, fmtDataHora, fraseDoConsumo, ordenarConversas, identidadeDaConversa, frasePaginacao } from "../lib/conversasTela";

// ⚠⚠ QUEM está falando E de QUAL empresa — as duas, nunca uma OU outra.
//
// Esta linha fazia `c.empresa?.razao || c.nomePerfilProvedor || c.telefoneMascarado`: um `||`
// escolhendo entre coisas que não se substituem. Numa conversa de cliente aparecia a EMPRESA e o
// contador nunca sabia QUEM estava falando; numa da fila aparecia a pessoa e não havia empresa.
// Hoje são duas linhas: a pessoa em cima (com a origem do nome dita), a empresa embaixo.
function LinhaConversa({ c, ativa, onAbrir, onboarding }) {
  const r = rotuloDaSituacao(c);
  const identidade = identidadeDaConversa(c);
  return <button type="button" className="wa-conversation" data-testid={`conversa-${c.id}`} data-situacao={r.situacao} aria-current={ativa ? "true" : undefined} onClick={() => onAbrir(c.id)}>
    <AvatarConversa nome={identidade.pessoa} pequeno />
    <div className="wa-conversation-copy">
      <div className="wa-conversation-title"><NomeDaPessoa identidade={identidade} /><time>{fmtDataHora(c.ultimaMensagem?.registradaEm || c.updatedAt)}</time></div>
      <div className="wa-conversation-company"><LinhaDaEmpresa identidade={identidade} /></div>
      <SituacaoConversa conversa={c} />
      {fraseDoOnboarding(onboarding) ? <div data-testid="onboarding-da-conversa" style={{ fontSize: ".72rem", color: "var(--state-warn)" }}>{fraseDoOnboarding(onboarding)}</div> : null}
      {c.pendencia ? <div style={{ fontSize: ".7rem", color: "var(--state-warn)" }}>Pedido {c.pendencia.codigo} aguardando confirmação</div> : null}
      <div className="wa-conversation-preview"><span>{c.ultimaMensagem?.corpo || c.telefoneMascarado || "Abrir conversa"}</span>{c.naoLidas > 0 ? <span className="wa-unread" aria-label={`${c.naoLidas} novas mensagens`}>{c.naoLidas}</span> : null}</div>
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

export function WhatsappPage({ api, companies = [], onBack, message, error }) {
  const hook = useConversasWhatsapp({ api, feedback: null });
  const resumo = useResumoWhatsapp({ api });
  const [busca, setBusca] = useState("");
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const [verChat, setVerChat] = useState(false);
  const listaRef = useRef(null);
  const lista = useMemo(() => ordenarConversas(hook.conversas), [hook.conversas]);
  const fila = lista.filter((c) => situacaoDoFio(c) === SITUACAO_FIO.FILA_SEM_EMPRESA).length;
  const avisoDaLista = frasePaginacao(hook.temMais);
  const [onboardings, setOnboardings] = useState(null);
  const [carregandoOnboarding, setCarregandoOnboarding] = useState(true);
  const [revisaoOnboarding, setRevisaoOnboarding] = useState(0);
  useEffect(() => {
    let vivo = true;
    if (!hook.conversas.some((c) => !c.portalClientId) || typeof api?.listarOnboardings !== "function") return undefined;
    setCarregandoOnboarding(true);
    api.listarOnboardings({ incluirRascunhos: true }).then((r) => {
      if (vivo) setOnboardings(Array.isArray(r?.itens) ? r.itens : null);
    }).catch(() => { if (vivo) setOnboardings(null); })
      .finally(() => { if (vivo) setCarregandoOnboarding(false); });
    return () => { vivo = false; };
  }, [api, hook.conversas, revisaoOnboarding]);
  const leituraOnboarding = c => !c.portalClientId && carregandoOnboarding && onboardings === null
    ? { situacao: "CARREGANDO", candidatos: [] } : onboardingDaConversa(c, onboardings);
  const normalizar = valor => String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const termo = normalizar(busca).trim();
  const visiveis = lista.filter(c => (!soNaoLidas || c.naoLidas > 0) && (!termo || normalizar([c.contato?.nome, c.nomePerfilProvedor, c.empresa?.razao, c.empresa?.cnpj, c.telefoneMascarado, c.ultimaMensagem?.corpo].filter(Boolean).join(" ")).includes(termo)));
  const abrir = id => { setVerChat(true); hook.abrir(id); };
  const voltar = () => {
    setVerChat(false); setDetalhes(false);
    requestAnimationFrame(() => (listaRef.current?.querySelector('[aria-current="true"]') || listaRef.current?.querySelector("input"))?.focus());
  };

  return <div className="wa-page">
    <PageShell title="WhatsApp" subtitle="Central de atendimento · Altan Contabilidade" onBack={onBack}
      actions={<Button variant="secondary" onClick={() => hook.carregar(hook.filtro)} disabled={hook.carregando}><span className="wa-inline"><WhatsappIcon nome="atualizar" size={16} />{hook.carregando ? "Carregando…" : "Atualizar"}</span></Button>}>
      <AppShell className="wa-shell">
        <div className={`wa-workspace${verChat ? " wa-workspace--open" : ""}${detalhes && hook.aberta ? " wa-workspace--details" : ""}`}>
          <aside className="wa-sidebar" aria-label="Caixa de entrada" ref={listaRef}>
            <div className="wa-sidebar-top">
              <div className="wa-section-heading"><h2>Caixa de entrada</h2><span className="wa-count" title="Conversas carregadas neste filtro">{lista.length}</span></div>
              <label className="wa-search"><WhatsappIcon nome="busca" size={17} /><input aria-label="Buscar nas conversas carregadas" placeholder="Buscar contato ou empresa" value={busca} onChange={e => setBusca(e.target.value)} /></label>
              <div className="wa-filters">
                <select aria-label="Filtro das conversas" style={{ ...campo, fontSize: ".75rem" }} value={hook.filtro} disabled={hook.ocupado} onChange={e => { setVerChat(false); setDetalhes(false); hook.setFiltro(e.target.value); }}>{FILTROS.map(f => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}</select>
                <Button variant="secondary" size="sm" className="wa-filter-unread" aria-pressed={soNaoLidas} onClick={() => setSoNaoLidas(v => !v)}>Não lidas</Button>
              </div>
              {fila > 0 ? <p data-testid="contagem-fila" className="wa-list-note" style={{ color: "var(--state-warn)", padding: "8px 0 0" }}>{fila} número{fila === 1 ? "" : "s"} sem cadastro aguardando vínculo</p> : null}
              {resumo.avisoHistorico ? <p role="status" className="wa-list-note">{resumo.avisoHistorico}. Consulte o filtro Histórico anterior.</p> : null}
              {hook.filtro === "historico" ? <p className="wa-list-note">Mensagens anteriores preservadas para consulta, separadas das conversas atuais.</p> : hook.filtro === "lixeira" ? <p className="wa-list-note">Conversas excluídas da lista. O histórico está preservado e pode ser restaurado.</p> : null}
            </div>
            <div className="wa-conversation-list">
              {hook.erro ? <p role="status" className="wa-list-note" style={{ color: "var(--state-warn)" }}>Não foi possível ler as conversas{hook.erro.mensagem ? `: ${hook.erro.mensagem}` : ""}. A lista pode existir e não ter sido carregada.</p> : null}
              {hook.carregando && lista.length === 0 ? <p role="status" className="wa-list-note">Carregando conversas…</p> : null}
              {!hook.carregando && !hook.erro && visiveis.length === 0 ? <div className="wa-empty"><WhatsappIcon nome="busca" size={28} /><p>{termo || soNaoLidas ? "Nenhuma conversa carregada corresponde à busca e aos filtros." : "Nenhuma conversa neste filtro."}</p></div> : null}
              {visiveis.map(c => <LinhaConversa key={c.id} c={c} ativa={hook.aberta?.conversa?.id === c.id} onAbrir={abrir} onboarding={leituraOnboarding(c)} />)}
              {hook.cursorLista ? <Button variant="secondary" size="sm" disabled={hook.carregandoMais} onClick={hook.carregarMais}>{hook.carregandoMais ? "Carregando…" : "Carregar mais conversas"}</Button> : null}
              {lista.length > 0 && avisoDaLista ? <p data-testid="aviso-paginacao-lista" className="wa-list-note">{avisoDaLista}</p> : null}
              {termo || soNaoLidas ? <p className="wa-list-note">Busca e filtro de não lidas aplicados às conversas carregadas.</p> : null}
            </div>
            <details className="wa-budget"><summary>Consumo do assistente</summary><p data-testid="consumo-ia">{fraseDoConsumo(hook.consumoIa)}</p></details>
          </aside>
          <section className="wa-chat-column" aria-label="Conversa selecionada">
            {hook.erroFio ? <p role="alert" className="wa-notice">Não foi possível atualizar a conversa: {hook.erroFio}</p> : null}
            {hook.aberta ? <FioDaConversa key={hook.aberta.conversa.id} fio={hook.aberta} hook={hook} temMais={hook.temMaisNoFio}
              hrefDaEmpresa={id => companyTabPath(id, "anotacoes")} onVoltar={voltar} onDetalhes={() => setDetalhes(v => !v)} detalhesAbertos={detalhes}
              slotVincular={<><section className="wa-commercial-section"><FormOnboarding key={hook.aberta.conversa.id} api={api} conversa={hook.aberta.conversa} mensagens={hook.aberta.mensagens} leitura={leituraOnboarding(hook.aberta.conversa)} onCriado={() => setRevisaoOnboarding(v => v + 1)} /></section><details className="wa-link-company"><summary>Vincular a uma empresa existente</summary><p>Use quando este contato já representa uma empresa da carteira.</p><FormVincular companies={companies} api={api} conversaId={hook.aberta.conversa.id} legado={hook.aberta.conversa.escopoVerificado === false} empresaInicial={hook.aberta.conversa.portalClientId || ""} onVincular={hook.vincular} ocupado={hook.ocupado} /></details></>}
            /> : <div className="wa-empty"><div className="wa-empty-symbol"><WhatsappIcon size={34} /></div><h2>{hook.carregandoFio ? "Abrindo conversa…" : "Seu atendimento, em um só lugar"}</h2><p>{hook.carregandoFio ? "Carregando o histórico deste contato." : "Escolha uma conversa à esquerda. Consulte o histórico, acompanhe a entrega e responda aos seus clientes."}</p>{verChat ? <Button variant="secondary" className="wa-mobile-back" onClick={voltar}>Voltar para conversas</Button> : null}</div>}
          </section>
          {detalhes && hook.aberta ? <DetalhesConversa conversa={hook.aberta.conversa} onFechar={() => setDetalhes(false)} /> : null}
        </div>
        <Feedback message={message} error={hook.erroAcao || error} />
      </AppShell>
    </PageShell>
  </div>;
}

export default WhatsappPage;
