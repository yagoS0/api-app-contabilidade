// LISTA / QUADRO do funil.
//
// ⚠ LARGURA: `--content-wide` — é tela de DADOS (quatro colunas de cartões), não de leitura.
// Rascunhos aparecem na seção Em preenchimento, inclusive enquanto o cliente responde ao link.

import { useMemo, useState } from "react";
import { NovoAtendimentoModal } from "../components/NovoAtendimentoModal";
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { useOnboardings } from "../hooks/useOnboardings";
import { colunasDoQuadro, estiloDoStatus, statusDoOnboarding } from "../lib/onboardingStatus";
import { ONBOARDING_ORIGENS } from "../lib/onboardingSpec";
import { formatarCnpj } from "../lib/brasilApi";

function acentoDaOrigem(origem) {
  return ONBOARDING_ORIGENS.find((o) => o.chave === origem)?.acento || "--text-faint";
}
function tituloDaOrigem(origem) {
  return ONBOARDING_ORIGENS.find((o) => o.chave === origem)?.titulo || origem || "—";
}

function Crachá({ origem }) {
  const acento = `var(${acentoDaOrigem(origem)})`;
  return (
    <span
      style={{
        display: "inline-block", padding: "1px 8px", borderRadius: 999,
        border: `1px solid ${acento}`, color: acento, background: "transparent",
        fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      }}
    >
      {tituloDaOrigem(origem)}
    </span>
  );
}

function CartaoOnboarding({ item, onAbrir, onDescartar }) {
  const status = statusDoOnboarding(item.status);
  const progresso = item.progresso || { total: 0, concluidas: 0 };

  return (
    <article
      style={{
        display: "grid", gap: "var(--space-2)",
        padding: "var(--space-3)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid var(${acentoDaOrigem(item.origem)})`,
        background: "var(--bg-surface)",
      }}
    >
      <button
        type="button"
        onClick={() => onAbrir(item)}
        style={{
          background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer",
          color: "var(--text)", fontSize: 14, fontWeight: 700,
        }}
      >
        {item.razaoSocial || item.responsavelNome || `Atendimento ${String(item.id).slice(-6)}`}
      </button>

      {item.cnpj && (
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatarCnpj(item.cnpj)}</span>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <Crachá origem={item.origem} />
        <span style={{ ...estiloDoStatus(item.status), padding: "1px 8px", borderRadius: 999, border: "1px solid", fontSize: 11, fontWeight: 600 }}>
          <span aria-hidden="true">{status.icone}</span> {status.rotulo}
        </span>
      </div>

      {item.responsavelNome && (
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.responsavelNome}</span>
      )}

      {progresso.total > 0 && (
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
          {progresso.concluidas} de {progresso.total} etapas
        </span>
      )}

      {onDescartar && (
        <button
          type="button"
          onClick={() => onDescartar(item)}
          style={{
            justifySelf: "start", background: "none", border: "none", padding: 0,
            color: "var(--text-faint)", fontSize: 12, cursor: "pointer", textDecoration: "underline",
          }}
        >
          descartar rascunho
        </button>
      )}
    </article>
  );
}

export function OnboardingsPage({ api, onVoltar, onAbrir, onNovo }) {
  const { itens, carregando, erro, filtros, alterarFiltro, descartar, recarregar } = useOnboardings({ api });
  const [mostrarRascunhos, setMostrarRascunhos] = useState(true);
  const [novoAberto, setNovoAberto] = useState(false);

  const colunas = useMemo(() => colunasDoQuadro(), []);
  const porStatus = useMemo(() => {
    const mapa = new Map(colunas.map((c) => [c.chave, []]));
    for (const item of itens) {
      if (item.status === "RASCUNHO") continue;
      if (mapa.has(item.status)) mapa.get(item.status).push(item);
    }
    return mapa;
  }, [itens, colunas]);

  const rascunhos = useMemo(() => itens.filter((i) => i.status === "RASCUNHO"), [itens]);

  function alternarBandeja() {
    const proximo = !mostrarRascunhos;
    setMostrarRascunhos(proximo);
    alterarFiltro("incluirRascunhos", proximo);
  }

  async function confirmarDescarte(item) {
    if (!window.confirm("Descartar este rascunho? Ele não vira histórico — some de vez.")) return;
    await descartar(item.id);
  }

  return (
    <PageShell
      title="Entrada de clientes"
      subtitle="Formulários, conferência de dados e acompanhamento da entrada na carteira"
      onBack={onVoltar}
      actions={<Button type="button" onClick={() => setNovoAberto(true)}>Novo atendimento</Button>}
      contentClassName="onboarding-workspace"
      contentStyle={{ maxWidth: "var(--content-wide)", margin: "0 auto", width: "100%" }}
    >
      <div className="onboarding-intro"><h2>Abertura de empresa começa com o cliente</h2><p>Crie uma ficha, gere o link pessoal e compartilhe o formulário. As respostas chegam para conferência antes da contratação e do cadastro da empresa.</p></div>
      {novoAberto && <NovoAtendimentoModal onCriar={onNovo} onFechar={() => { setNovoAberto(false); recarregar(); }} />}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <input
          aria-label="Buscar atendimento"
          placeholder="Buscar por nome, CNPJ ou responsável"
          value={filtros.q}
          onChange={(e) => alterarFiltro("q", e.target.value)}
          style={{
            flex: "1 1 260px", padding: "8px 10px", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)", background: "var(--bg-page)", color: "var(--text)", fontSize: 14,
          }}
        />
        <select
          aria-label="Filtrar por serviço"
          value={filtros.origem}
          onChange={(e) => alterarFiltro("origem", e.target.value)}
          style={{
            padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
            background: "var(--bg-page)", color: "var(--text)", fontSize: 14,
          }}
        >
          <option value="">todas as origens</option>
          {ONBOARDING_ORIGENS.map((o) => (
            <option key={o.chave} value={o.chave}>{o.titulo}</option>
          ))}
        </select>
        <Button type="button" variant="secondary" onClick={alternarBandeja}>
          {mostrarRascunhos ? "Ocultar fichas em preenchimento" : "Mostrar fichas em preenchimento"}
        </Button>
      </div>

      {erro && <p style={{ color: "var(--state-warn)" }}>{erro.message}</p>}
      {carregando && <p style={{ color: "var(--text-muted)" }}>Carregando…</p>}

      {!carregando && !erro && <>
      {mostrarRascunhos && (
        <section style={{ marginBottom: "var(--space-5)" }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-faint)" }}>
            Em preenchimento ({rascunhos.length})
          </h2>
          {rascunhos.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)" }}>Nenhuma ficha em preenchimento.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--space-2)" }}>
              {rascunhos.map((item) => (
                <CartaoOnboarding key={item.id} item={item} onAbrir={onAbrir} onDescartar={confirmarDescarte} />
              ))}
            </div>
          )}
        </section>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "var(--space-3)",
          alignItems: "start",
        }}
      >
        {colunas.map((coluna) => {
          const lista = porStatus.get(coluna.chave) || [];
          return (
            <section key={coluna.chave}>
              <h2
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  margin: "0 0 var(--space-2)", fontSize: 13, fontWeight: 700,
                  color: `var(${coluna.token})`,
                }}
              >
                <span aria-hidden="true">{coluna.icone}</span>
                {coluna.rotulo}
                <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({lista.length})</span>
              </h2>
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                {lista.length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Nenhum atendimento nesta etapa.</span>
                )}
                {lista.map((item) => (
                  <CartaoOnboarding key={item.id} item={item} onAbrir={onAbrir} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      </>}
    </PageShell>
  );
}

export default OnboardingsPage;
