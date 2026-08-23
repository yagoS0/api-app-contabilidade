import { Button } from "../../../components/ui/Button";
import { PANEL, fmtDate } from "./notasStyles";
import { FRASE_MOTIVO_PENDENCIA } from "../lib/auditoriaTela";

// A LISTA DE PENDÊNCIAS PÓS-FECHAMENTO — "entrou nota depois que eu fechei o mês?"
//
// ⚠ ELA FICOU SEM NENHUM CONSUMIDOR desde que foi escrita, e isso é o defeito que o corte de
// 21/08/2026 consertou: o model (`PendenciaPosFechamento`), a rota
// (`GET /firm/companies/:id/pendencias-pos-fechamento`) e o método de API
// (`listPendenciasPosFechamento`) existiam e funcionavam, e nenhuma tela os chamava. Quem cria a
// pendência são os dois caminhos de captura (`ingestaoNfse.js` e `DfeSyncService.js`), quando a
// nota chega para uma competência JÁ FECHADA — ou seja, é exatamente a pergunta que faltava na
// auditoria pré-apuração. Hoje a aba Auditoria a renderiza.
//
// ── ⚠ ÂMBAR, NÃO VERMELHO ───────────────────────────────────────────────────────────────────────
//
// Este componente pintava a caixa de **vermelho** (`#FF4757`), enquanto o comentário dentro dele já
// dizia "o âmbar da caixa fica". Vermelho, no vocabulário deste projeto (`apps/web/CLAUDE.md`), é o
// que **bloqueia o fechamento**; pendência é o que **pede ação**, e isso é âmbar. Além disso a
// mesma tela que a hospeda tem a regra explícita de nunca usar `--state-danger`.
//
// ── ⚠ AS AÇÕES SÃO OPCIONAIS, E POR ISSO A AUDITORIA PODE MOSTRÁ-LA ─────────────────────────────
//
// "Reabrir competência" e "Ignorar" ESCREVEM. A aba Auditoria não escreve nada — é a promessa dela,
// e há teste varrendo os rótulos dos botões atrás de `ignorar`. Sem `onReabrir`/`onResolver` a
// coluna de ações não é renderizada e o componente vira leitura pura; com eles, o comportamento é o
// de sempre, para a tela que tiver a ação.

export function PendenciasList({ pendencias, saving, onReabrir, onResolver, titulo, rodape }) {
  const open = (pendencias || []).filter((p) => !p.resolvida);
  if (open.length === 0) return null;

  const comAcoes = Boolean(onReabrir || onResolver);

  return (
    <section style={{
      background: "var(--state-warn-surface)",
      border: "1px solid var(--state-warn)",
      borderRadius: 8, padding: 16, marginBottom: 16,
    }}>
      <h3 style={{ margin: 0, marginBottom: 4, fontSize: "0.95rem", color: "var(--state-warn)" }}>
        ⚠ {titulo || "Pendências pós-fechamento"} ({open.length})
      </h3>
      {/* ⚠ A frase diz o que ACONTECEU, não que alguém errou: a nota chegar depois do fechamento é
          fato do sistema nacional, não descuido do contador. */}
      <div style={{ color: PANEL.muted, fontSize: "0.8rem", marginBottom: 12 }}>
        {rodape || "Nota que chegou depois de a competência ter sido fechada."}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
            <th style={{ padding: 6 }}>Competência</th>
            <th style={{ padding: 6 }}>Motivo</th>
            <th style={{ padding: 6 }}>Detectada em</th>
            {comAcoes ? <th style={{ padding: 6 }}></th> : null}
          </tr>
        </thead>
        <tbody>
          {open.map((p) => (
            <tr key={p.id} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
              <td style={{ padding: 6, fontFamily: "monospace" }}>{p.competencia}</td>
              <td style={{ padding: 6 }}>
                {/* ⚠ `motivo` é CÓDIGO no banco (`nota_retroativa`). Sem tradução a tela mostrava o
                    identificador cru ao contador; e o código desconhecido continua aparecendo cru,
                    que é feio e honesto — a mesma disciplina de `FRASE_NAO_CONFERIVEL`. */}
                {FRASE_MOTIVO_PENDENCIA[p.motivo] || p.motivo}
                {p.observacoes && <span style={{ color: PANEL.muted, display: "block", fontSize: "0.75rem" }}>{p.observacoes}</span>}
              </td>
              <td style={{ padding: 6, color: PANEL.muted }}>{fmtDate(p.createdAt)}</td>
              {comAcoes ? (
                /* O âmbar da caixa (a pendência CONSTATADA) fica — ali a cor é informação. O botão
                   não: "Reabrir competência" é ação, e ação primária é o accent. */
                <td style={{ padding: 6, textAlign: "right" }}>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    {onReabrir ? (
                      <Button size="sm" onClick={() => onReabrir(p.competencia)} disabled={saving}>
                        Reabrir competência
                      </Button>
                    ) : null}
                    {onResolver ? (
                      <Button size="sm" variant="secondary" onClick={() => onResolver(p.id)} disabled={saving}>
                        Ignorar
                      </Button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
