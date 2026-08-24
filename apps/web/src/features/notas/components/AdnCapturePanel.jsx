// Q12.B+: captura manual de NFS-e (ADN / Emissor Nacional) — versão enxuta (só o botão de consultar).

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

// ⚠⚠ O SELETOR "Produção / Homologação" SAIU DA TELA (dono, 23/08/2026: *"tire também essa escolha
// em produção e homologação da tela"*), e a captura é SEMPRE em PRODUÇÃO.
//
// ⚠ O `env` NÃO sumiu do contrato — ele continua viajando no `onSync({ env })`, cravado. Tirar o
// parâmetro junto obrigaria a mexer no backend por causa de uma mudança de LAYOUT, e é o tipo de
// arrasto que transforma "esconder um select" em incidente de integração.
//
// ⚠ E o que se perdeu é real, então fica escrito: não há mais como disparar uma captura em
// HOMOLOGAÇÃO pela interface. Isso é coerente com a tela — ela é a rotina diária de um contador
// sobre dados de produção, e nota de homologação entrando aqui contamina a base que a apuração lê.
// Se um dia for preciso, o lugar é a engrenagem de configuração, não a barra de ações.
const AMBIENTE = "prod";

export function AdnCapturePanel({ adnState, adnSyncing, onSync, onClearError }) {
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => onSync({ env: AMBIENTE })} disabled={adnSyncing || inBackoff}>
          {adnSyncing ? "Capturando…" : "🔄 Buscar NFS-e"}
        </Button>
        {(hasError || inBackoff) && onClearError && (
          <button onClick={onClearError} disabled={adnSyncing} title="Limpa backoff e último erro"
            style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
            Limpar erro
          </button>
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

      {/* ⚠ O AVISO DA ÚLTIMA BUSCA DESCEU PARA CÁ, mais apagado — dono, 23/08/2026: *"esse aviso da
          última vez buscada, coloque ele em lugar mais discreto"*. Ele estava no meio da barra de
          ações, competindo com os botões.

          ⚠⚠ MAS ELE NÃO VIROU `title`, E ISSO É DELIBERADO. `title` não aparece no teclado nem no
          toque — o próprio `CLAUDE.md` do outro portal já registra esse limite. E esta frase carrega
          informação que a ausência de notas não carrega: *"sem nota na tela, o contador precisa
          saber se ninguém olhou, se olharam e não veio nada, ou se deu erro — os três eram o mesmo
          vazio"*. Discreto é ficar mais quieto, não sumir.

          ⚠ `--text-faint` e não `PANEL.muted`: é o token que este app mede em 5,79:1 sobre o fundo,
          ou seja, apagado E ainda legível. O `#6b7280` que pareceria "mais discreto" está proibido
          por escrito aqui (3,10:1). */}
      {!hasError && (
        <span style={{ color: "var(--text-faint)", fontSize: "0.72rem" }}>
          {tentativaEm
            ? `Última busca ${tentativaEm}${capturaEm ? ` · última nota nova ${capturaEm}` : " · nenhuma nota nova até agora"}`
            : "Esta empresa ainda não foi consultada no ADN."}
        </span>
      )}
    </div>
  );
}
