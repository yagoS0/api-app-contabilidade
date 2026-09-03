// A TELA MÍNIMA DE CONVERSAS DE WHATSAPP (F5, 02/09/2026) — lista à esquerda, fio à direita.
//
// O que ela faz, e só isso: mostra a fila de não vinculados em destaque (é pendência do
// escritório), o fio com QUEM escreveu cada balão (cliente · assistente · escritório · fixa), a
// pendência aberta (código e expiração), ASSUMIR/DEVOLVER (o que cala e devolve a IA), RESPONDER
// à mão (com a janela de 24h dita ANTES de digitar) e VINCULAR (o formulário de contato da F1,
// resumido: empresa + nome + opt-in + pessoa do portal).
//
// A regra mora em `../lib/conversasTela.js`. Cores por token; âmbar é pendência, nunca decoração.

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../components/layout/AppShell";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { Feedback } from "../../../components/ui/Feedback";
import { useConversasWhatsapp } from "../hooks/useConversasWhatsapp";
import { FILTROS, SITUACAO_FIO, situacaoDoFio, rotuloDaSituacao, rotuloDoAutor, estadoDaResposta, fmtDataHora, fraseDoConsumo, ordenarConversas } from "../lib/conversasTela";

const campo = {
  background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)",
  padding: "8px 10px", fontSize: "0.86rem", fontFamily: "inherit", boxSizing: "border-box", width: "100%",
};
const COR_TOM = { aviso: "var(--state-warn)", neutro: "var(--text-muted)" };

function LinhaConversa({ c, ativa, onAbrir }) {
  const r = rotuloDaSituacao(c);
  return (
    <button
      type="button"
      data-testid={`conversa-${c.id}`}
      data-situacao={r.situacao}
      onClick={() => onAbrir(c.id)}
      style={{
        display: "block", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit",
        padding: "10px 12px", borderRadius: "var(--radius-sm)", marginBottom: 6,
        border: `1px solid ${ativa ? "var(--accent-purple)" : (r.tom === "aviso" ? "var(--state-warn)" : "var(--border)")}`,
        background: r.tom === "aviso" ? "var(--state-warn-surface)" : "var(--bg-subtle)", color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <strong style={{ fontSize: "0.88rem" }}>{c.empresa?.razao || c.nomePerfilProvedor || c.telefoneMascarado}</strong>
        {c.naoLidas > 0 ? <span style={{ fontSize: "0.7rem", color: "var(--accent-purple)", fontWeight: 700 }}>{c.naoLidas} nova{c.naoLidas === 1 ? "" : "s"}</span> : null}
        <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-faint)" }}>{fmtDataHora(c.ultimaMensagem?.registradaEm || c.updatedAt)}</span>
      </div>
      <div style={{ fontSize: "0.74rem", color: COR_TOM[r.tom] }}>{c.telefoneMascarado} · {r.texto}{c.pendencia ? ` · pedido ${c.pendencia.codigo} aguardando confirmação` : ""}</div>
      {c.ultimaMensagem?.corpo ? <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.ultimaMensagem.corpo}</div> : null}
    </button>
  );
}

function FormVincular({ companies, api, conversaId, onVincular, ocupado }) {
  const [portalClientId, setPortalClientId] = useState("");
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
        <strong>Este número não está em nenhum cadastro.</strong> Vincule-o a uma empresa: o contato é criado com este telefone (dígito a dígito) e o fio passa para a empresa.
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

function Fio({ fio, api, companies, hook }) {
  const { conversa, mensagens } = fio;
  const [texto, setTexto] = useState("");
  const [recusa, setRecusa] = useState(null);
  const situacao = situacaoDoFio(conversa);
  const resposta = estadoDaResposta(conversa);
  const nomeDoCliente = conversa?.nomePerfilProvedor || null;

  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    setRecusa(null);
    const r = await hook.responder(conversa.id, t);
    if (r?.ok === false) setRecusa(r.erro?.payload?.message || r.erro?.message || "Não foi possível responder.");
    else setTexto("");
  }

  return (
    <div data-testid="fio" style={{ display: "flex", flexDirection: "column", minHeight: 400 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <strong style={{ fontSize: "0.95rem" }}>{conversa.empresa?.razao || nomeDoCliente || conversa.telefoneMascarado}</strong>
        <span style={{ fontSize: "0.76rem", color: COR_TOM[rotuloDaSituacao(conversa).tom] }}>{conversa.telefoneMascarado} · {rotuloDaSituacao(conversa).texto}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {situacao === SITUACAO_FIO.ASSUMIDA ? (
            <Button variant="secondary" disabled={hook.ocupado} onClick={() => hook.devolver(conversa.id)} title="O assistente volta a responder neste fio">Devolver à IA</Button>
          ) : situacao !== SITUACAO_FIO.FILA_SEM_EMPRESA ? (
            <Button variant="secondary" disabled={hook.ocupado} onClick={() => hook.assumir(conversa.id)} title="Você responde; o assistente fica em silêncio">Assumir</Button>
          ) : null}
        </div>
      </div>

      {conversa.pendencia ? (
        <div data-testid="pendencia-aberta" style={{ fontSize: "0.78rem", padding: "6px 10px", border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)", borderRadius: "var(--radius-sm)", marginBottom: 8 }}>
          Pedido aguardando confirmação do cliente: <strong>{conversa.pendencia.tipo}</strong> · código <strong>{conversa.pendencia.codigo}</strong> · expira {fmtDataHora(conversa.pendencia.expiraEm)}.
        </div>
      ) : null}

      {situacao === SITUACAO_FIO.FILA_SEM_EMPRESA ? <FormVincular companies={companies} api={api} conversaId={conversa.id} onVincular={hook.vincular} ocupado={hook.ocupado} /> : null}

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 4px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-page)", marginBottom: 8 }}>
        {mensagens.length === 0 ? <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", margin: 8 }}>Nenhuma mensagem neste fio.</p> : null}
        {mensagens.map((m) => {
          const entrada = m.direcao === "in";
          return (
            <div key={m.id} data-testid={`balao-${m.id}`} data-autor={m.autor || (entrada ? "cliente" : "sem-autor")} style={{ display: "flex", justifyContent: entrada ? "flex-start" : "flex-end", marginBottom: 6 }}>
              <div style={{ maxWidth: "78%", padding: "6px 10px", borderRadius: 10, fontSize: "0.82rem", background: entrada ? "var(--bg-subtle)" : "var(--accent-purple-surface)", border: `1px solid ${entrada ? "var(--border)" : "var(--accent-purple-border)"}`, color: "var(--text)" }}>
                <div style={{ fontSize: "0.68rem", color: "var(--text-faint)", marginBottom: 2 }}>{rotuloDoAutor(m, { nomeDoCliente })} · {fmtDataHora(m.ocorridaEmProvedor || m.registradaEm)}{m.tipo && m.tipo !== "text" ? ` · ${m.tipo}` : ""}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.corpo || `[${m.tipo || "mensagem"}]`}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ⚠ A JANELA É DITA ANTES DE DIGITAR: campo desabilitado com o motivo, nunca campo que recusa depois. */}
      <div>
        {!resposta.pode ? <p data-testid="resposta-bloqueada" style={{ fontSize: "0.76rem", color: "var(--state-warn)", margin: "0 0 6px" }}>{resposta.motivo}</p> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            aria-label="Responder ao cliente"
            style={{ ...campo, minHeight: 56, resize: "vertical" }}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={!resposta.pode || hook.ocupado}
            placeholder={resposta.pode ? "Escreva a resposta — sai como mensagem do escritório" : "Fora da janela de 24h"}
          />
          <Button variant="primary" disabled={!resposta.pode || !texto.trim() || hook.ocupado} onClick={enviar}>Responder</Button>
        </div>
        {recusa ? <p role="alert" style={{ fontSize: "0.76rem", color: "var(--state-danger)", margin: "6px 0 0" }}>{recusa}</p> : null}
      </div>
    </div>
  );
}

export function WhatsappPage({ api, companies = [], onBack, message, error }) {
  const hook = useConversasWhatsapp({ api, feedback: null });
  const lista = useMemo(() => ordenarConversas(hook.conversas), [hook.conversas]);
  const fila = lista.filter((c) => situacaoDoFio(c) === SITUACAO_FIO.FILA_SEM_EMPRESA).length;

  return (
    <PageShell
      title="WhatsApp"
      subtitle="As conversas do escritório: a fila de números sem cadastro, os fios com o assistente e os que você assumiu."
      onBack={onBack}
      actions={<Button variant="secondary" onClick={() => hook.carregar(hook.filtro)} disabled={hook.carregando}>{hook.carregando ? "Carregando…" : "Atualizar"}</Button>}
    >
      <AppShell>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12, fontSize: "0.8rem", color: "var(--text-muted)" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Mostrar
            <select aria-label="Filtro das conversas" style={{ ...campo, width: "auto" }} value={hook.filtro} onChange={(e) => hook.setFiltro(e.target.value)}>
              {FILTROS.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
            </select>
          </label>
          {fila > 0 ? <span data-testid="contagem-fila" style={{ color: "var(--state-warn)", fontWeight: 600 }}>{fila} número{fila === 1 ? "" : "s"} sem cadastro aguardando vínculo</span> : null}
          <span data-testid="consumo-ia" style={{ marginLeft: "auto" }}>{fraseDoConsumo(hook.consumoIa)}</span>
        </div>

        {hook.erro && !hook.conversas.length ? (
          <p role="status" style={{ color: "var(--state-warn)", fontSize: "0.82rem" }}>Não foi possível ler as conversas{hook.erro.mensagem ? `: ${hook.erro.mensagem}` : ""}. A lista pode existir e não ter sido carregada.</p>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(0, 2fr)", gap: 16 }}>
          <div>
            {!hook.carregando && !hook.erro && lista.length === 0 ? <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Nenhuma conversa neste filtro.</p> : null}
            {lista.map((c) => <LinhaConversa key={c.id} c={c} ativa={hook.aberta?.conversa?.id === c.id} onAbrir={hook.abrir} />)}
          </div>
          <div>
            {hook.carregandoFio ? <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Abrindo o fio…</p> : null}
            {hook.aberta ? <Fio fio={hook.aberta} api={api} companies={companies} hook={hook} /> : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Escolha uma conversa à esquerda.</p>
            )}
          </div>
        </div>

        <Feedback message={message} error={error} />
      </AppShell>
    </PageShell>
  );
}

export default WhatsappPage;
