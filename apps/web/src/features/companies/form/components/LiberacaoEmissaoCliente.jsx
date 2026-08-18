// O CONTROLE DO PORTÃO — quem do lado do CLIENTE pode emitir e cancelar NFS-e desta empresa.
//
// Decisão do dono (18/08/2026): *"o acesso a emissão deve ser liberado para o cliente pelo portal
// do contador"*. Fica dentro do bloco "Emissão de NFS-e" porque é onde o contador já vem
// configurar a nota de serviço — e porque a liberação só faz sentido depois de os campos ao lado
// estarem preenchidos.
//
// ⚠ LIGAR É ATO DE CONSEQUÊNCIA, e a confirmação REPETE o que vai acontecer. "Tem certeza?" não
// informa nada; o que informa é "os usuários CLIENT_ADMIN e OWNER desta empresa passarão a emitir
// NFS-e em produção, em nome dela".
//
// ⚠ NADA DE VERDE NO BOTÃO DE LIGAR. Verde é CONCLUÍDO no vocabulário deste app (o rodapé `D = C`,
// a guia paga, a obrigação entregue). Ação primária é o **accent**. Sem Tailwind: cores por
// `var(--…)` de `styles/tokens.css`.

import { useState } from "react";
import {
  TITULO,
  PAPEIS_QUE_PASSAM,
  PAPEIS_QUE_NAO_PASSAM,
  fraseDeConfirmacao,
  lerLiberacaoEmissao,
  linhaDeAutoria,
} from "../../../../lib/nfse/liberacaoEmissaoCliente";

const AJUDA = { fontSize: 11, color: "#8A8FA3", lineHeight: 1.5 };

const BOTAO_BASE = {
  border: "1px solid",
  borderRadius: 6,
  padding: "7px 12px",
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
};

export function LiberacaoEmissaoCliente({
  emissaoCliente,
  razaoSocial,
  onSetEmissaoCliente,
  saving = false,
}) {
  const [confirmando, setConfirmando] = useState(null); // null | true (ligar) | false (desligar)
  const leitura = lerLiberacaoEmissao(emissaoCliente);

  // ⚠ PROP AUSENTE ≠ NÃO LIBERADA. Sem o estado, a tela não afirma nada sobre a empresa — e sem o
  // handler não há o que oferecer (é o caso do cadastro de empresa NOVA: não existe empresa a
  // liberar antes de ela existir).
  if (!leitura.conhecida || typeof onSetEmissaoCliente !== "function") return null;

  const { liberada } = leitura;

  async function confirmar() {
    const alvo = confirmando;
    setConfirmando(null);
    await onSetEmissaoCliente(alvo);
  }

  return (
    <div
      className="full"
      style={{
        marginTop: 10,
        border: `1px solid ${liberada ? "var(--state-closed)" : "var(--border)"}`,
        background: liberada ? "var(--state-closed-surface)" : "var(--state-neutral-surface)",
        borderRadius: 6,
        padding: "10px 12px",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.85rem", color: "var(--text)" }}>{TITULO}</strong>
        {/* O estado em PALAVRA, não só em cor — quem não distingue as cores precisa ler o mesmo. */}
        <span
          data-testid="estado-emissao-cliente"
          style={{
            fontSize: "0.78rem",
            fontWeight: 700,
            color: liberada ? "var(--state-closed)" : "var(--state-neutral)",
          }}
        >
          {liberada ? "● Liberada" : "○ Não liberada"}
        </span>
      </div>

      <div style={{ ...AJUDA, color: "var(--text-muted)" }}>{leitura.resumo}</div>

      {liberada && (
        // ⚠ QUEM LIBEROU E QUANDO. Sem isto, "quem autorizou este cliente a emitir?" — a pergunta
        // que se faz depois de uma nota indevida — não tem resposta em lugar nenhum da tela.
        <div style={AJUDA} data-testid="autoria-emissao-cliente">
          {linhaDeAutoria(leitura)}
        </div>
      )}

      {!liberada && (
        <div style={AJUDA}>
          Enquanto ficar assim, um usuário do cliente que tentar emitir recebe uma recusa
          explicando que o escritório ainda não liberou esta empresa. A leitura das notas
          continua funcionando normalmente.
        </div>
      )}

      {confirmando === null ? (
        <div>
          <button
            type="button"
            onClick={() => setConfirmando(!liberada)}
            disabled={saving}
            style={{
              ...BOTAO_BASE,
              borderColor: liberada ? "var(--border)" : "var(--accent-purple)",
              color: liberada ? "var(--text-muted)" : "var(--accent-purple)",
              background: liberada ? "transparent" : "var(--accent-purple-surface)",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {liberada ? "Revogar a liberação" : "Liberar a emissão para o cliente"}
          </button>
        </div>
      ) : (
        <div
          role="alertdialog"
          aria-label={confirmando ? "Confirmar liberação da emissão" : "Confirmar revogação da emissão"}
          style={{
            border: "1px solid var(--state-warn)",
            background: "var(--state-warn-surface)",
            borderRadius: 6,
            padding: "9px 11px",
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--text)", lineHeight: 1.5 }}>
            {confirmando ? (
              <>
                <strong>{fraseDeConfirmacao(razaoSocial)}</strong>{" "}
                O papel {PAPEIS_QUE_NAO_PASSAM.join(", ")} continua sem emitir, mesmo com a empresa
                liberada.
              </>
            ) : (
              <>
                <strong>
                  Os usuários {PAPEIS_QUE_PASSAM.join(" e ")} desta empresa deixarão de emitir e de
                  cancelar NFS-e.
                </strong>{" "}
                O escritório continua emitindo normalmente. As notas já emitidas não são afetadas.
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={confirmar}
              disabled={saving}
              style={{
                ...BOTAO_BASE,
                // ⚠ Nem aqui o verde entra: confirmar a liberação é ação primária (accent);
                // confirmar a revogação é ação de retirada (neutra, com borda de aviso).
                borderColor: confirmando ? "var(--accent-purple)" : "var(--state-warn)",
                color: confirmando ? "var(--accent-purple)" : "var(--state-warn)",
                background: confirmando ? "var(--accent-purple-surface)" : "transparent",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Salvando…" : confirmando ? "Sim, liberar" : "Sim, revogar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(null)}
              disabled={saving}
              style={{ ...BOTAO_BASE, borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
