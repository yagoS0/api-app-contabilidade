// Q12.B+: captura manual de NFS-e (ADN / Emissor Nacional) — versão enxuta (só o botão de consultar).

import { useState } from "react";
import { PANEL } from "./notasStyles";
import { Button } from "../../../components/ui/Button";

// "há 20 minutos" / "há 3 dias" — a idade importa mais que o timestamp exato: é ela que separa
// "acabou de acontecer" de "isto é história".
function idade(quando) {
  if (!quando) return null;
  const min = Math.floor((Date.now() - new Date(quando).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 0) return null;
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 48) return `há ${Math.floor(min / 60)}h`;
  return `há ${Math.floor(min / 1440)} dias`;
}

export function AdnCapturePanel({ adnState, adnSyncing, onSync, onClearError }) {
  const [env, setEnv] = useState("prod");
  const inBackoff = adnState?.adnBackoffUntil && new Date(adnState.adnBackoffUntil) > new Date();
  const hasError = Boolean(adnState?.adnLastError);

  // ⚠ ESTE ERRO É SEMPRE PASSADO — abrir a aba NÃO consulta o ADN (`GET /adn/state` é leitura do
  // banco). O texto vem de `PortalSyncState.adnLastError`, gravado por alguma tentativa ANTERIOR.
  //
  // Sem dizer isso, a tela mentia por omissão: um 429 de um dia aparecia idêntico a um 429
  // acontecendo agora, em toda empresa, e o contador lia "o sistema está quebrado" quando a captura
  // já havia voltado ao normal. Datar o erro é o que transforma um alarme perpétuo em informação.
  const tentativaEm = idade(adnState?.adnLastAttemptAt);
  const capturaEm = idade(adnState?.adnLastSyncAt);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Button onClick={() => onSync({ env })} disabled={adnSyncing || inBackoff}>
        {adnSyncing ? "Capturando…" : "🔄 Buscar NFS-e"}
      </Button>
      <select value={env} onChange={(e) => setEnv(e.target.value)} disabled={adnSyncing}
        style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 8px", fontSize: "0.8rem" }}>
        <option value="prod">Produção</option>
        <option value="hom">Homologação</option>
      </select>
      {(hasError || inBackoff) && onClearError && (
        <button onClick={onClearError} disabled={adnSyncing} title="Limpa backoff e último erro"
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
          Limpar erro
        </button>
      )}
      {/* Ausência nunca é resposta: sem nota na tela, o contador precisa saber se ninguém olhou,
          se olharam e não veio nada, ou se deu erro. Os três eram o mesmo vazio. */}
      {!hasError && (
        <span style={{ color: PANEL.muted, fontSize: "0.75rem" }}>
          {tentativaEm
            ? `Última busca ${tentativaEm}${capturaEm ? ` · última nota nova ${capturaEm}` : " · nenhuma nota nova até agora"}`
            : "Esta empresa ainda não foi consultada no ADN."}
        </span>
      )}

      {hasError && (
        <span style={{ color: "#FF4757", fontSize: "0.78rem", maxWidth: 520 }} title={adnState.adnLastError}>
          {/* ⚠ O texto do erro é TRUNCADO na tela e vai inteiro no `title`. Ele vem do servidor e já
              chegou a ser HTML cru do gov.br (`<html><body><h1>429 Too Many Requests…`) despejado
              aqui dentro. A origem foi corrigida no `AdnNacionalClient`, mas o erro fica GRAVADO no
              banco até a próxima captura bem-sucedida: os registros antigos ainda passam por aqui. */}
          {String(adnState.adnLastError).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)}
          {tentativaEm && (
            <span style={{ color: PANEL.muted, marginLeft: 6 }}>
              (da tentativa de {tentativaEm} — abrir a aba não consulta o ADN)
            </span>
          )}
        </span>
      )}
    </div>
  );
}
