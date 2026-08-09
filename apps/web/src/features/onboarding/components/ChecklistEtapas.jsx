// A CHECKLIST do escritório — uma linha por etapa, com o efeito colateral ao lado quando existe.
//
// ⚠ TODO BOTÃO DE EFEITO COLATERAL FICA DESABILITADO ENQUANTO `portalClientId` FOR NULO, com o
// motivo no `title`. SITFIS, certificado A1 e documentos exigem um `PortalClient` — são rotas
// `/firm/companies/:id/...`, e antes da conversão esse id não existe. Um botão que parece
// disponível e falha ao clicar é pior que um botão desabilitado que explica.
//
// ⚠ E TODOS RECEBEM O ID DO **PORTAL CLIENT**, nunca o da Company legada. São dois ids diferentes;
// o certificado A1 mora na legada, mas a ROTA é indexada pelo portal.

import { useState } from "react";
import { Button } from "../../../components/ui/Button";

const TEXTO_A1 =
  "sem o certificado A1 a captura de NFS-e falha em silêncio — a empresa parece sem nota";

function corDaRegua(etapa) {
  if (etapa.concluidaEm) return "var(--state-ok)";
  // ⚠ O A1 ganha destaque enquanto não concluído — e a PALAVRA faz mais que a cor aqui.
  // Não escalar para `--state-danger`: esse token é reservado a bloqueio de fechamento contábil.
  if (etapa.acao === "CERTIFICADO_A1") return "var(--state-warn)";
  return "var(--border)";
}

function rotuloDaAcao(acao) {
  switch (acao) {
    case "SITFIS": return "Consultar situação fiscal";
    case "CERTIFICADO_A1": return "Ir para o certificado A1";
    case "DOCUMENTOS": return "Ir para documentos";
    case "CONVERSAO": return "Criar a empresa";
    default: return null;
  }
}

function formatarData(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

export function CardEtapa({
  etapa,
  portalClientId,
  certificado,
  onAlternar,
  onObservacao,
  onAcao,
  ocupada,
}) {
  const [rascunhoObs, setRascunhoObs] = useState(etapa.observacao || "");
  const [editandoObs, setEditandoObs] = useState(false);

  const exigePortal = ["SITFIS", "CERTIFICADO_A1", "DOCUMENTOS"].includes(etapa.acao);
  const bloqueadaPorConversao = exigePortal && !portalClientId;
  const rotuloAcao = rotuloDaAcao(etapa.acao);
  const mostrarAcao = Boolean(rotuloAcao) && !(etapa.acao === "CONVERSAO" && portalClientId);

  return (
    <li
      style={{
        listStyle: "none",
        display: "grid",
        gap: "var(--space-2)",
        padding: "var(--space-3) var(--space-4)",
        paddingLeft: "calc(var(--space-4) - 3px)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${corDaRegua(etapa)}`,
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          id={`etapa-${etapa.id}`}
          checked={Boolean(etapa.concluidaEm)}
          disabled={ocupada}
          onChange={(e) => onAlternar(etapa, e.target.checked)}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--state-ok)" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <label
            htmlFor={`etapa-${etapa.id}`}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: etapa.concluidaEm ? "var(--text-muted)" : "var(--text)",
              cursor: "pointer",
            }}
          >
            {etapa.titulo}
            {!etapa.obrigatoria && (
              <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-faint)" }}>(opcional)</span>
            )}
          </label>

          {etapa.descricao && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {etapa.descricao}
            </p>
          )}

          {/* ⚠ A frase por extenso, não só a régua colorida: a consequência do A1 ausente é
              invisível (a empresa aparece "sem nota"), e cor nenhuma comunica isso. */}
          {etapa.acao === "CERTIFICADO_A1" && !etapa.concluidaEm && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--state-warn)", lineHeight: 1.5 }}>
              {TEXTO_A1}
            </p>
          )}

          {/* Pós-conversão o card LÊ o estado real do certificado — assim o checkbox não pode
              afirmar "feito" com a empresa sem certificado instalado. */}
          {etapa.acao === "CERTIFICADO_A1" && portalClientId && certificado && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
              {certificado.hasCertificate
                ? `Certificado instalado${certificado.expiresAt ? ` · vence em ${formatarData(certificado.expiresAt)}` : ""}.`
                : "Nenhum certificado instalado nesta empresa."}
            </p>
          )}

          {etapa.concluidaEm && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--state-ok)" }}>
              ✓ concluída em {formatarData(etapa.concluidaEm)}
              {etapa.concluidaPorNome ? ` por ${etapa.concluidaPorNome}` : ""}
            </p>
          )}

          {editandoObs ? (
            <div style={{ marginTop: "var(--space-2)", display: "grid", gap: "var(--space-2)" }}>
              <textarea
                rows={2}
                value={rascunhoObs}
                onChange={(e) => setRascunhoObs(e.target.value)}
                aria-label={`Observação de ${etapa.titulo}`}
                style={{
                  width: "100%", padding: "6px 8px", borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)", background: "var(--bg-page)",
                  color: "var(--text)", fontSize: 13, fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button
                  size="sm"
                  type="button"
                  onClick={async () => { await onObservacao(etapa, rascunhoObs); setEditandoObs(false); }}
                >
                  Salvar observação
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => { setRascunhoObs(etapa.observacao || ""); setEditandoObs(false); }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditandoObs(true)}
              style={{
                marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer",
                color: etapa.observacao ? "var(--text)" : "var(--text-faint)",
                fontSize: 12, textAlign: "left",
              }}
            >
              {etapa.observacao || "+ observação"}
            </button>
          )}
        </div>

        {mostrarAcao && (
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={bloqueadaPorConversao || ocupada}
            title={
              bloqueadaPorConversao
                ? "Disponível depois de criar a empresa: esta ação precisa de uma empresa na carteira."
                : undefined
            }
            onClick={() => onAcao?.(etapa)}
          >
            {rotuloAcao}
          </Button>
        )}
      </div>
    </li>
  );
}

export function ChecklistEtapas({
  etapas = [],
  portalClientId,
  certificado,
  onAlternar,
  onObservacao,
  onAcao,
  ocupada,
}) {
  if (!etapas.length) {
    return (
      <p style={{ color: "var(--text-faint)", fontSize: 13 }}>
        A checklist é criada quando a ficha é finalizada.
      </p>
    );
  }
  const concluidas = etapas.filter((e) => e.concluidaEm).length;

  return (
    <div>
      <p style={{ margin: "0 0 var(--space-3)", fontSize: 12, color: "var(--text-muted)" }}>
        {concluidas} de {etapas.length} concluídas
      </p>
      <ul style={{ margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
        {etapas.map((etapa) => (
          <CardEtapa
            key={etapa.id}
            etapa={etapa}
            portalClientId={portalClientId}
            certificado={certificado}
            onAlternar={onAlternar}
            onObservacao={onObservacao}
            onAcao={onAcao}
            ocupada={ocupada}
          />
        ))}
      </ul>
    </div>
  );
}

export default ChecklistEtapas;
