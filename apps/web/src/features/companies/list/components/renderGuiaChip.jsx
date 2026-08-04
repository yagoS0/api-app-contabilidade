// O chip de guia — o ciclo de vida de uma obrigação, na listagem.
//
//                       ┌─→ ✈ gerada ─→ ✓ enviada        (terminais bons)
//   ⚠ falta gerar ──────┤
//                       └─→ ⊘ vazio                      (terminal: ausência confirmada)
//
// POR QUE ELE EXISTE
// Antes a regra era "tag vermelha some quando a guia é gerada". A ausência de tag passou a
// significar DUAS coisas — "tudo certo" e "esta empresa não tem essa obrigação" — e o contador não
// tinha como saber qual estava vendo. Tornar o ciclo explícito é o que mata a ambiguidade.
//
// TRÊS TIPOS DE AUSÊNCIA, TRÊS VISUAIS
//   não se aplica ao regime  → o chip NEM RENDERIZA
//   existe, ninguém olhou    → vermelho (trabalho pendente)
//   confirmado sem movimento → cinza (terminal, mas visível)
//
// ⚠ Cor NUNCA é o único sinal: todo estado tem ícone próprio (daltonismo, e a regra de aceite pede
// que um screenshot dessaturado continue legível).

import { useEffect, useRef, useState } from "react";

// Chave do compliance → tipo de Guide. Mesmo de-para do backend; PIS representa o grupo PIS/COFINS.
export const TRIBUTO_TIPO = {
  das: "SIMPLES", inss: "INSS", irpj: "IRPJ", csll: "CSLL", pisCofins: "PIS", iss: "ISS",
};

const ESTADO = {
  missing:  { icone: "⚠", cor: "var(--state-danger)",  fundo: "var(--state-danger-surface)",  rotulo: "falta gerar" },
  gerada:   { icone: "✈", cor: "var(--state-warn)",    fundo: "var(--state-warn-surface)",    rotulo: "gerada, falta enviar" },
  enviada:  { icone: "✓", cor: "var(--state-ok)",      fundo: "var(--state-ok-surface)",      rotulo: "enviada ao cliente" },
  vazio:    { icone: "⊘", cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)", rotulo: "sem movimento (confirmado)" },
  conflito: { icone: "⚠", cor: "var(--state-danger)",  fundo: "var(--state-danger-surface)",  rotulo: "marcada sem movimento, mas há faturamento" },
};

const fmtData = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtMoeda = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function Popover({ children, onFechar }) {
  const ref = useRef(null);
  useEffect(() => {
    function aoClicarFora(e) { if (ref.current && !ref.current.contains(e.target)) onFechar(); }
    function aoEsc(e) { if (e.key === "Escape") onFechar(); }
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoEsc);
    return () => { document.removeEventListener("mousedown", aoClicarFora); document.removeEventListener("keydown", aoEsc); };
  }, [onFechar]);
  return (
    <div
      ref={ref}
      role="dialog"
      style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300, minWidth: 250, maxWidth: 320,
        background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)", padding: 12, fontSize: "0.78rem",
        color: "var(--text)", fontWeight: 400, textAlign: "left", cursor: "default",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function BotaoAcao({ children, onClick, tom = "neutro", disabled }) {
  const cores = {
    neutro:  { cor: "var(--text)",         borda: "var(--border)" },
    perigo:  { cor: "var(--state-danger)", borda: "var(--state-danger)" },
    ok:      { cor: "var(--state-ok)",     borda: "var(--state-ok)" },
  }[tom];
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        padding: "5px 10px", borderRadius: 6, cursor: disabled ? "wait" : "pointer",
        background: "transparent", border: `1px solid ${cores.borda}`, color: cores.cor,
        font: "inherit", fontSize: "0.76rem", fontWeight: 600, opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

/**
 * @param {object} tag       nó do compliance: { key, label, state, guideId, emailSentAt, vazioEm, vazioPor, vazioMotivo, faturamento, origem }
 * @param {object} empresa   { companyId, razao, guideNotificationEmail }
 * @param {string} competencia
 * @param {object} acoes     { onEnviar, onMarcarVazio, onDesfazerVazio, onAbrirEmpresa }
 */
export function GuiaChip({ tag, empresa, competencia, acoes = {} }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [motivo, setMotivo] = useState("");

  const meta = ESTADO[tag.state] || ESTADO.missing;
  const destinatario = empresa?.guideNotificationEmail || empresa?.ownerEmail || null;

  async function executar(fn) {
    if (ocupado) return;
    setOcupado(true); setErro(null);
    try {
      const out = await fn();
      // A recusa vem do servidor com o motivo (ex.: faturamento na competência). Mostrar o número
      // é o que faz o contador entender que não é capricho da tela.
      if (out && out.ok === false) { setErro(out.message || out.error || "Não foi possível."); return; }
      setAberto(false); setMotivo("");
    } catch (e) {
      setErro(e?.message || "Não foi possível.");
    } finally { setOcupado(false); }
  }

  const tipo = TRIBUTO_TIPO[tag.key] || String(tag.key || "").toUpperCase();

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label={`${tag.label}: ${meta.rotulo}`}
        title={`${tag.label} — ${meta.rotulo}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
          background: meta.fundo, border: `1px solid ${meta.cor}`, color: meta.cor,
          cursor: "pointer", font: "inherit", lineHeight: 1.6,
        }}
      >
        <span aria-hidden="true">{meta.icone}</span>
        {tag.label}
        {tag.state === "gerada" && <span style={{ fontWeight: 500 }}>enviar</span>}
      </button>

      {aberto && (
        <Popover onFechar={() => { setAberto(false); setErro(null); }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{tag.label} · {competencia}</div>
          <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>{meta.rotulo}</div>

          {tag.state === "conflito" && (
            <div style={{ marginBottom: 8, color: "var(--state-danger)" }}>
              Marcada como sem movimento, mas a competência tem <strong>{fmtMoeda(tag.faturamento)}</strong> em
              notas emitidas. A afirmação envelheceu — confira antes de fechar o mês.
            </div>
          )}

          {(tag.state === "vazio" || tag.state === "conflito") && (
            <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
              {tag.origem === "sem_faturamento"
                ? "Vem da marcação de MÊS sem faturamento (aba Lançamentos), não desta guia."
                : <>Marcada por {tag.vazioPor || "—"}{fmtData(tag.vazioEm) ? ` em ${fmtData(tag.vazioEm)}` : ""}.</>}
              {tag.vazioMotivo && <div style={{ marginTop: 2 }}>Motivo: {tag.vazioMotivo}</div>}
            </div>
          )}

          {tag.state === "enviada" && (
            <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
              Enviada{fmtData(tag.emailSentAt) ? ` em ${fmtData(tag.emailSentAt)}` : ""}
              {destinatario ? ` para ${destinatario}` : ""}.
            </div>
          )}

          {/* A BIFURCAÇÃO, no lugar onde ela aparece: gerar a guia OU afirmar que não houve
              movimento. Marcar vazio é declaração fiscal — pede confirmação e grava quem/quando. */}
          {tag.state === "missing" && (
            <>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo (opcional)"
                style={{
                  width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "5px 8px",
                  background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 6,
                  color: "var(--text)", font: "inherit", fontSize: "0.76rem",
                }}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <BotaoAcao onClick={() => acoes.onAbrirEmpresa?.(empresa.companyId)}>Abrir apuração</BotaoAcao>
                <BotaoAcao
                  disabled={ocupado}
                  onClick={() => executar(() => acoes.onMarcarVazio?.(empresa.companyId, tipo, competencia, motivo))}
                >
                  {ocupado ? "…" : "Marcar sem movimento"}
                </BotaoAcao>
              </div>
            </>
          )}

          {/* Envio é ação EXTERNA e irreversível: nunca dispara no clique do chip, sempre depois
              de confirmar com destinatário à vista. */}
          {tag.state === "gerada" && (
            <>
              <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
                Enviar ao cliente {destinatario ? <strong>{destinatario}</strong> : "(sem e-mail cadastrado)"}.
              </div>
              <BotaoAcao
                tom="ok" disabled={ocupado || !tag.guideId}
                onClick={() => executar(() => acoes.onEnviar?.(tag.guideId, empresa))}
              >
                {ocupado ? "Enviando…" : "✈ Enviar e-mail"}
              </BotaoAcao>
            </>
          )}

          {(tag.state === "vazio" || tag.state === "conflito") && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <BotaoAcao
                tom="perigo" disabled={ocupado || tag.origem === "sem_faturamento"}
                onClick={() => executar(() => acoes.onDesfazerVazio?.(empresa.companyId, tipo, competencia))}
              >
                {ocupado ? "…" : "Desfazer marcação"}
              </BotaoAcao>
              <BotaoAcao onClick={() => acoes.onAbrirEmpresa?.(empresa.companyId)}>Abrir empresa</BotaoAcao>
            </div>
          )}

          {erro && (
            <div style={{ marginTop: 8, color: "var(--state-danger)", fontSize: "0.74rem" }}>{erro}</div>
          )}
        </Popover>
      )}
    </span>
  );
}

/** Todas as guias em estado TERMINAL (enviada ou vazio)? É o que autoriza condensar. */
export function todasConcluidas(tags) {
  const exigidas = (tags || []).filter((t) => t.state !== "na");
  return exigidas.length > 0 && exigidas.every((t) => t.state === "enviada" || t.state === "vazio");
}
