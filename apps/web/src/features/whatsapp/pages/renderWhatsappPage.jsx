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

import { useMemo, useEffect, useState } from "react";
import { AppShell } from "../../../components/layout/AppShell";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { Feedback } from "../../../components/ui/Feedback";
import { useConversasWhatsapp } from "../hooks/useConversasWhatsapp";
import { FioDaConversa, LinhaDaEmpresa, NomeDaPessoa, campo } from "../components/FioDaConversa";
import { FILTROS, SITUACAO_FIO, situacaoDoFio, rotuloDaSituacao, fmtDataHora, fraseDoConsumo, ordenarConversas, identidadeDaConversa, frasePaginacao } from "../lib/conversasTela";

const COR_TOM = { aviso: "var(--state-warn)", neutro: "var(--text-muted)" };

// ⚠⚠ QUEM está falando E de QUAL empresa — as duas, nunca uma OU outra.
//
// Esta linha fazia `c.empresa?.razao || c.nomePerfilProvedor || c.telefoneMascarado`: um `||`
// escolhendo entre coisas que não se substituem. Numa conversa de cliente aparecia a EMPRESA e o
// contador nunca sabia QUEM estava falando; numa da fila aparecia a pessoa e não havia empresa.
// Hoje são duas linhas: a pessoa em cima (com a origem do nome dita), a empresa embaixo.
function LinhaConversa({ c, ativa, onAbrir }) {
  const r = rotuloDaSituacao(c);
  const identidade = identidadeDaConversa(c);
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
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <NomeDaPessoa identidade={identidade} />
        {c.naoLidas > 0 ? <span style={{ fontSize: "0.7rem", color: "var(--accent-purple)", fontWeight: 700 }}>{c.naoLidas} nova{c.naoLidas === 1 ? "" : "s"}</span> : null}
        <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-faint)" }}>{fmtDataHora(c.ultimaMensagem?.registradaEm || c.updatedAt)}</span>
      </div>
      <div><LinhaDaEmpresa identidade={identidade} /></div>
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

export function WhatsappPage({ api, companies = [], onBack, message, error }) {
  const hook = useConversasWhatsapp({ api, feedback: null });
  const lista = useMemo(() => ordenarConversas(hook.conversas), [hook.conversas]);
  const fila = lista.filter((c) => situacaoDoFio(c) === SITUACAO_FIO.FILA_SEM_EMPRESA).length;
  const avisoDaLista = frasePaginacao(hook.temMais);

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
            {/* ⚠ A lista também pode estar cortada, e o corte é DITO — não se conclui do silêncio. */}
            {lista.length > 0 && avisoDaLista ? (
              <p data-testid="aviso-paginacao-lista" style={{ fontSize: "0.72rem", color: "var(--text-faint)", margin: "8px 2px 0" }}>{avisoDaLista}</p>
            ) : null}
          </div>
          <div>
            {hook.carregandoFio ? <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Abrindo o fio…</p> : null}
            {hook.aberta ? (
              <FioDaConversa
                fio={hook.aberta}
                hook={hook}
                temMais={hook.temMaisNoFio}
                slotVincular={<FormVincular companies={companies} api={api} conversaId={hook.aberta.conversa?.id} onVincular={hook.vincular} ocupado={hook.ocupado} />}
              />
            ) : (
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
