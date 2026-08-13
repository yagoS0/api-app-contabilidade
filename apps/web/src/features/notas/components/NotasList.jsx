// Q12.C.1: tabela de notas da janela ativa (NF-e OU NFS-e) — enxuta, sem resumo/stats.

import { useState } from "react";
import { PANEL, fmtMoney, fmtDate } from "./notasStyles";
import { Button } from "../../../components/ui/Button";
import { lerCicloDaNota } from "../lib/cicloNotaTela";

const PAPEL_BADGE = {
  EMIT: { bg: "rgba(105,255,71,0.15)", color: "#69FF47", label: "Emitida" },
  DEST: { bg: "rgba(139,233,253,0.15)", color: "#8BE9FD", label: "Recebida" },
};

// ⚠ O FALLBACK NÃO PODE SER VERDE, E ISSO JÁ ERA UMA BOMBA ARMADA.
//
// A regra antiga era `cancelada ? vermelho : rejeitada ? âmbar : VERDE` — ou seja, **qualquer
// valor desconhecido virava "autorizada"**, inclusive `null`. Enquanto só existiam dois valores no
// banco isso passou despercebido; no instante em que um terceiro aparecesse (`substituida`), a
// nota apareceria em VERDE, contaria no resumo, ofereceria o botão "Cancelar" — e continuaria
// FORA do faturamento, que exige `=== "autorizada"`. Duas telas discordando em silêncio sobre a
// mesma nota, que é o defeito que este projeto mais persegue.
//
// ⚠ A REGRA SAIU DAQUI: mora em `features/notas/lib/cicloNotaTela.js`, com teste próprio. Ela
// estava embutida neste componente e o `NotaDetailModal` não a lia — a lista dizia "substituída"
// em âmbar e o detalhe da MESMA nota dizia "cancelada" em vermelho. Este componente cobre agora
// só a LIGAÇÃO (cor, itálico, o "· sem evento"), não a regra de novo.
function StatusBadge({ nota }) {
  const c = lerCicloDaNota(nota);

  return (
    <span
      style={{ color: c.cor, fontSize: "0.7rem", fontWeight: 600, fontStyle: c.conhecida ? "normal" : "italic" }}
      title={c.tituloAjuda}
    >
      {c.rotulo}
      {/* ⚠ "Não temos o evento" ≠ "não houve evento". Uma nota cancelada sem o evento gravado
          (556 na base) não pode se apresentar com a mesma confiança de uma cujo cancelamento
          nós registramos. */}
      {c.semEvento && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · sem evento</span>}
    </span>
  );
}

// ⚠ QUANTAS NOTAS EXISTEM vs QUANTAS ESTÃO NA TELA — a tabela pagina, e o rodapé tem de dizer isso.
//
// O rodapé mostrava `notas.length`, ou seja, o tamanho da PÁGINA: com o limite em 100, um mês de
// 2.717 notas exibia 100 e escrevia "100 nota(s)". Não havia como distinguir isso de um mês que
// realmente teve 100 notas — truncar em silêncio se parece com "é só isso que existe".
// Medido na base de produção em 10/08/2026: 8 células empresa×competência acima de 100 notas, e as
// MESMAS 8 acima de 500 (o teto duro da rota) — a maior com 2.717.
// O `total` do servidor sempre existiu na resposta e não era usado por ninguém.
function Paginacao({ total, offset, limit, carregados, loading, onOffset }) {
  const temTudo = total != null && carregados >= total && offset === 0;
  const inicio = total === 0 ? 0 : offset + 1;
  const fim = offset + carregados;
  const podeVoltar = offset > 0;
  const podeAvancar = total != null && fim < total;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${PANEL.border}`,
    }}>
      <span style={{ fontSize: "0.78rem", color: PANEL.muted }}>
        {temTudo ? (
          <>Mostrando <strong style={{ color: PANEL.text }}>{total}</strong> nota(s) — todas as da competência.</>
        ) : (
          <>
            Mostrando <strong style={{ color: PANEL.text }}>{inicio}–{fim}</strong> de{" "}
            <strong style={{ color: PANEL.text }}>{total ?? "?"}</strong> nota(s).{" "}
            {podeAvancar && (
              <span style={{ color: "var(--state-warn)" }}>
                Há mais notas nesta competência do que cabem nesta página.
              </span>
            )}
          </>
        )}
      </span>
      {(podeVoltar || podeAvancar) && (
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* ⚠ Botão desabilitado NOMEIA o motivo — não fica mudo. */}
          <Button
            variant="secondary" size="sm"
            disabled={!podeVoltar || loading}
            title={podeVoltar ? "Página anterior" : "Você já está na primeira página"}
            onClick={() => onOffset(Math.max(offset - limit, 0))}
          >
            ‹ Anterior
          </Button>
          <Button
            variant="secondary" size="sm"
            disabled={!podeAvancar || loading}
            title={podeAvancar ? "Próxima página" : "Não há mais notas depois desta página"}
            onClick={() => onOffset(offset + limit)}
          >
            Próxima ›
          </Button>
        </span>
      )}
    </div>
  );
}

function FilterBar({ filters, onChange, onApply, loading, total }) {
  // `local` é o RASCUNHO dos campos que só valem depois de "Filtrar" (hoje, a busca textual).
  // ⚠ Ele é uma cópia feita no MOUNT e nunca ressincroniza. Isso é de propósito para o rascunho —
  // digitar não pode ser desfeito por um render —, mas é veneno para campo que muda de FORA: a
  // competência agora vem do header, e `local` guardava a de quando a aba montou. Duas
  // consequências, as duas silenciosas: o rótulo mostrava o mês velho, e clicar em "Filtrar"
  // reenviava esse mês velho, desfazendo a escolha feita no topo da página.
  //
  // Por isso a competência é lida SEMPRE de `filters` (a fonte de verdade) e injetada no apply.
  const [local, setLocal] = useState(filters);
  function patch(k, v) { setLocal((p) => ({ ...p, [k]: v, offset: 0 })); }
  function apply() {
    const efetivo = { ...local, competencia: filters.competencia };
    onChange(efetivo);
    onApply(efetivo);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
      {/* ⚠ Sem `input type="month"`: a competência é da EMPRESA e vem do seletor do header.
          Aqui ela ainda por cima ficava atrás de um botão "Filtrar" — o campo mostrava um mês e a
          tabela mostrava outro até alguém clicar, então os dois controles chegavam a discordar
          dentro da MESMA tela. O valor continua à vista, como rótulo, porque filtro ativo sem
          rastro visível é o "filtro fantasma" que a listagem já teve de resolver. */}
      <span style={{ fontSize: "0.8rem", color: PANEL.muted, whiteSpace: "nowrap" }}>
        Competência: <strong style={{ color: PANEL.text }}>{filters.competencia || "todas"}</strong>
      </span>
      <input type="text" value={local.search || ""} onChange={(e) => patch("search", e.target.value)}
        placeholder="Buscar (CNPJ, nome, número, chave)" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
      <Button size="sm" onClick={apply} disabled={loading}>
        {loading ? "..." : "Filtrar"}
      </Button>
      {/* ⚠ Este número é o TOTAL do servidor (quantas casam com o filtro), não o tamanho da página.
          Eram a mesma coisa quando a lista não paginava; deixaram de ser quando passou a paginar,
          e é justamente a diferença que estava escondida. O detalhamento fica no rodapé. */}
      <span style={{ marginLeft: "auto", color: PANEL.muted, fontSize: "0.8rem" }}>
        {total ?? "?"} nota(s) no filtro
      </span>
    </div>
  );
}
const inputStyle = {
  background: PANEL.field, border: `1px solid ${PANEL.border}`,
  borderRadius: 6, color: PANEL.text, padding: "8px 10px", fontSize: "0.85rem",
};

export function NotasList({ notas, total, filters, onFiltersChange, onApply, loading, onMarcarStatus, onAbrirNota }) {
  const limit = Number(filters?.limit) || 100;
  const offset = Number(filters?.offset) || 0;

  // Trocar de página é trocar o `offset` do filtro — o hook recarrega sozinho.
  function irPara(novoOffset) {
    const f = { ...filters, offset: novoOffset };
    onFiltersChange(f);
    onApply(f);
  }

  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <FilterBar filters={filters} onChange={onFiltersChange} onApply={onApply} loading={loading} total={total ?? notas.length} />

      {notas.length === 0 && !loading && (
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted, fontSize: "0.85rem" }}>
          Nenhuma nota encontrada.
        </div>
      )}

      {notas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                <th style={th}>Data</th>
                <th style={th}>Papel</th>
                <th style={th}>Nº/Série</th>
                <th style={th}>Emitente</th>
                <th style={th}>Tomador</th>
                <th style={{ ...th, textAlign: "right" }}>Valor</th>
                <th style={th}>Status</th>
                <th style={th}>Chave</th>
                {onMarcarStatus && <th style={th}></th>}
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => {
                const pap = PAPEL_BADGE[n.papel] || { bg: "transparent", color: PANEL.muted, label: "—" };
                return (
                  /* A LINHA INTEIRA ABRE A NOTA — no mouse e no teclado. É o "clicar na nota e ver
                     todas as informações": a lista fica enxuta e a profundidade vem daqui.
                     `tabIndex`/`onKeyDown` seguem o padrão de `tr[data-linha-empresa]` da tabela de
                     empresas (o anel de foco de `tokens.css` já alcança este seletor). */
                  <tr
                    key={n.id}
                    data-linha-nota={n.id}
                    tabIndex={onAbrirNota ? 0 : undefined}
                    role={onAbrirNota ? "button" : undefined}
                    aria-label={onAbrirNota ? `Ver a nota ${n.numero || n.id} por inteiro` : undefined}
                    title={onAbrirNota ? "Clique para ver a nota por inteiro" : undefined}
                    onClick={onAbrirNota ? () => onAbrirNota(n.id) : undefined}
                    onKeyDown={onAbrirNota ? (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrirNota(n.id); }
                    } : undefined}
                    onMouseEnter={(e) => { if (onAbrirNota) e.currentTarget.style.background = "var(--bg-page)"; }}
                    onMouseLeave={(e) => { if (onAbrirNota) e.currentTarget.style.background = "transparent"; }}
                    style={{
                      borderTop: `1px solid ${PANEL.border}`, color: PANEL.text,
                      cursor: onAbrirNota ? "pointer" : "default", outlineOffset: -2,
                    }}
                  >
                    <td style={td}>{fmtDate(n.issueDate)}</td>
                    <td style={td}>
                      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: "0.7rem", fontWeight: 600,
                                     background: pap.bg, color: pap.color, border: `1px solid ${pap.color}` }}>
                        {pap.label}
                      </span>
                    </td>
                    <td style={td}>{n.numero || "—"}{n.serie ? `/${n.serie}` : ""}</td>
                    <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={n.emitenteNome}>
                      {n.emitenteNome || "—"}
                      <div style={{ fontSize: "0.7rem", color: PANEL.muted, fontFamily: "monospace" }}>
                        {n.emitenteDoc || ""}
                      </div>
                    </td>
                    <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={n.tomadorNome}>
                      {n.tomadorNome || "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(n.total)}</td>
                    <td style={td}><StatusBadge nota={n} /></td>
                    <td style={{ ...td, fontSize: "0.7rem", fontFamily: "monospace", color: PANEL.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                        title={n.chaveAcesso}>
                      {n.chaveAcesso ? `…${n.chaveAcesso.slice(-12)}` : "—"}
                    </td>
                    {onMarcarStatus && (
                      /* ⚠ A célula de ação PARA o clique antes de ele subir para a linha: senão
                         cancelar uma nota abriria o detalhe por cima do confirm. */
                      <td style={td} onClick={(e) => e.stopPropagation()}>
                        {String(n.statusEfetivo || "").toLowerCase() === "cancelada" ? (
                          <button onClick={() => onMarcarStatus(n.id, "autorizada")} title="Reativar (volta a contar no faturamento)"
                            style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: "var(--state-ok)", borderRadius: 6, padding: "3px 8px", fontSize: "0.7rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                            Reativar
                          </button>
                        ) : (
                          <button onClick={() => { if (window.confirm("Marcar esta nota como CANCELADA? Ela sai do faturamento/apuração.")) onMarcarStatus(n.id, "cancelada"); }} title="Marcar como cancelada (sai do faturamento/apuração)"
                            style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: "#FF4757", borderRadius: 6, padding: "3px 8px", fontSize: "0.7rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                            Cancelar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Fica fora do `notas.length > 0` de propósito: numa página vazia depois de avançar demais,
          o contador e o botão "‹ Anterior" são a única saída — sem eles a tela seria só
          "Nenhuma nota encontrada", que é a mensagem errada. */}
      {(notas.length > 0 || (filters?.offset || 0) > 0) && (
        <Paginacao
          total={total}
          offset={offset}
          limit={limit}
          carregados={notas.length}
          loading={loading}
          onOffset={irPara}
        />
      )}
    </section>
  );
}
const th = { padding: 6 };
const td = { padding: 6 };
