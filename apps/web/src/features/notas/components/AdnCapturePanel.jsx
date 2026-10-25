// Q12.B+: captura manual de NFS-e (ADN / Emissor Nacional) — versão enxuta (só o botão de consultar).

import { mensagemCapturaAdn } from "../lib/mensagemCapturaAdn";

import { PANEL } from "./notasStyles.shared.js";
import { Button } from "../../../components/ui/Button";

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

export function AdnCapturePanel({ adnState, adnSyncing, onSync, onClearError, mostrarStatus = true, somenteStatus = false }) {
  const inBackoff = adnState?.adnBackoffUntil && new Date(adnState.adnBackoffUntil) > new Date();
  const hasError = Boolean(adnState?.adnLastError);

  // ⚠ ESTE ERRO É SEMPRE PASSADO — abrir a aba NÃO consulta o ADN (`GET /adn/state` é leitura do
  // banco). O texto vem de `PortalSyncState.adnLastError`, gravado por alguma tentativa ANTERIOR.
  //
  // Sem dizer isso, a tela mentia por omissão: um 429 de um dia aparecia idêntico a um 429
  // acontecendo agora, em toda empresa, e o contador lia "o sistema está quebrado" quando a captura
  // já havia voltado ao normal. Datar o erro é o que transforma um alarme perpétuo em informação.


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {!somenteStatus && <Button variant="secondary" onClick={() => onSync({ env: AMBIENTE })} aria-label={adnSyncing ? "Capturando NFS-e…" : "Buscar NFS-e"} aria-busy={Boolean(adnSyncing)} aria-describedby={inBackoff ? "adn-bloqueio" : undefined} disabled={adnSyncing || inBackoff}>
          {adnSyncing ? "Capturando…" : "Buscar"}
        </Button>}
        {mostrarStatus && (hasError || inBackoff) && onClearError && (
          // ⚠ O `title` diz mais que o rótulo ("e backoff"), e `title` NÃO é tooltip de verdade:
          // ele não aparece no foco de teclado nem no toque. Quem lê por leitor de tela ouvia só
          // "Limpar erro" e não sabia que o botão também destrava a próxima tentativa. O
          // `aria-label` carrega a informação inteira; o `title` fica para o mouse.
          <button onClick={onClearError} disabled={adnSyncing} title="Limpa backoff e último erro"
            aria-label="Limpar o erro e o backoff da captura do ADN"
            style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
            Limpar erro
          </button>
        )}
        {mostrarStatus && hasError && (
          <span style={{ color: "var(--danger)", fontSize: "0.78rem", maxWidth: 520 }} >
            {/* Normaliza também erros técnicos legados já persistidos no banco. */}
            {mensagemCapturaAdn(adnState.adnLastError)}
          </span>
        )}
      </div>

      {mostrarStatus && inBackoff && <span id="adn-bloqueio">Busca em espera após erro. Confira o motivo antes de limpar o bloqueio.</span>}
    </div>
  );
}
