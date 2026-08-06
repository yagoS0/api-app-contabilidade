// RELATÓRIOS — sub-aba de Contabilidade.
//
// ⚠ O QUE ESTA TELA NÃO OFERECE, E POR QUE ISSO É DECISÃO E NÃO FALTA
// Balanço e balancete NÃO aparecem, nem como opção desabilitada. Eles exigem saldo por conta com
// classificação patrimonial e ajustes de encerramento, e o que existe hoje são lançamentos por
// competência. Entregar "balancete" a partir disso seria um demonstrativo com nome de peça
// contábil — e alguém o mandaria para o cliente. Opção desabilitada ensinaria que o produto é
// capenga; opção ausente, com o motivo dito UMA vez no rodapé, é escopo declarado.
//
// ⚠ O INTERVALO É PRÓPRIO — a única exceção à competência global da empresa. Relatório de um mês
// só não é relatório: a pergunta aqui é a evolução.

import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "../../../api/client";
import {
  intervalosDisponiveis, periodoAnterior, variacao, somaPorTipo, somaTotal,
} from "../lib/periodoRelatorio";

const relatoriosApi = createApiClient();

const C = { surface: "#24253A", borda: "#44475A", texto: "#F8F8F2", muted: "#A7B0C0", accent: "#BD93F9", ok: "#50FA7B", baixa: "#FF5555" };
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) => `${(Number(v) * 100).toFixed(1).replace(".", ",")}%`;

// Os tipos que o relatório mostra em destaque. `PROVISAO` são os impostos — o contador chama assim.
const DESTAQUES = [
  { tipo: "RECEITA", rotulo: "Receitas", cor: "#50FA7B" },
  { tipo: "DESPESA", rotulo: "Despesas", cor: "#FF5555" },
  { tipo: "PROVISAO", rotulo: "Impostos", cor: "#FFB347" },
  { tipo: "FOLHA", rotulo: "Folha", cor: "#BD93F9" },
];

export function RelatoriosTab({ companyId, competenciaReferencia, razaoSocial }) {
  const [intervalo, setIntervalo] = useState("doze");
  const [dados, setDados] = useState(null);
  const [anterior, setAnterior] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [imprimindo, setImprimindo] = useState(false);

  const opcoes = useMemo(() => intervalosDisponiveis(competenciaReferencia), [competenciaReferencia]);
  const escolhido = opcoes.find((o) => o.chave === intervalo) || opcoes[0];

  useEffect(() => {
    if (!companyId || !escolhido) return undefined;
    let vivo = true;
    setCarregando(true); setErro("");
    const ant = periodoAnterior(escolhido.de, escolhido.ate);
    Promise.all([
      relatoriosApi.getRelatorioResumo(companyId, escolhido.de, escolhido.ate),
      // O período anterior é buscado JUNTO: sem ele a tela mostraria o total e depois o
      // comparativo apareceria pulando, o que faz duvidar do primeiro número.
      ant ? relatoriosApi.getRelatorioResumo(companyId, ant.de, ant.ate) : Promise.resolve(null),
    ])
      .then(([atual, previo]) => {
        if (!vivo) return;
        setDados(atual?.linhas || []);
        setAnterior(previo?.linhas || null);
      })
      .catch((e) => { if (vivo) setErro(e?.message || "Não foi possível montar o relatório."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [companyId, escolhido?.de, escolhido?.ate]);

  useEffect(() => {
    if (!imprimindo) return undefined;
    document.body.classList.add("imprimindo");
    const limpar = () => setImprimindo(false);
    window.addEventListener("afterprint", limpar);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", limpar);
      document.body.classList.remove("imprimindo");
    };
  }, [imprimindo]);

  const maiorTotal = useMemo(
    () => Math.max(1, ...(dados || []).map((l) => l.total || 0)),
    [dados],
  );

  return (
    <div style={{ width: "var(--content-wide)", margin: "0 auto", padding: "16px 0", color: C.texto, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} data-print-hide>
        <strong style={{ fontSize: "0.9rem" }}>Relatórios</strong>
        {opcoes.map((o) => (
          <button
            key={o.chave}
            type="button"
            onClick={() => setIntervalo(o.chave)}
            style={{
              fontSize: "0.76rem", padding: "4px 11px", borderRadius: 999, cursor: "pointer", font: "inherit",
              border: `1px solid ${o.chave === intervalo ? C.accent : C.borda}`,
              background: o.chave === intervalo ? "rgba(189,147,249,0.16)" : "transparent",
              color: o.chave === intervalo ? C.texto : C.muted,
            }}
          >
            {o.rotulo}
          </button>
        ))}
        <span style={{ fontSize: "0.75rem", color: C.muted }}>
          {escolhido ? `${escolhido.de} a ${escolhido.ate}` : ""}
        </span>
      </div>

      {erro && <div style={{ padding: 10, borderRadius: 8, border: "1px solid #FF5555", color: "#FF5555", fontSize: "0.82rem" }}>{erro}</div>}
      {carregando && <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: "0.84rem" }}>Montando o relatório…</div>}

      {!carregando && dados && (
        <div data-print-area style={{ display: "grid", gap: 14 }}>
          {/* O papel circula sozinho: empresa, período e data têm de sair impressos. */}
          <div data-print-only style={{ display: "none" }}>
            <h2 style={{ margin: "0 0 2px" }}>Demonstrativo de movimento — {escolhido.rotulo}</h2>
            <p style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>
              {razaoSocial || ""} · período {escolhido.de} a {escolhido.ate} · emitido em {new Date().toLocaleDateString("pt-BR")}
            </p>
          </div>

          {/* ── OS TOTAIS, COM A COMPARAÇÃO ─────────────────────────────── */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {DESTAQUES.map((d) => {
              const atual = somaPorTipo(dados, d.tipo);
              const previo = anterior ? somaPorTipo(anterior, d.tipo) : null;
              const v = previo == null ? null : variacao(atual, previo);
              return (
                <div key={d.tipo} style={{ flex: "1 1 180px", minWidth: 160, padding: 12, borderRadius: 10, border: `1px solid ${C.borda}`, background: C.surface }}>
                  <div style={{ fontSize: "0.74rem", color: C.muted }}>{d.rotulo}</div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, color: d.cor, marginTop: 2 }}>{brl(atual)}</div>
                  {v && (
                    <div style={{ fontSize: "0.74rem", marginTop: 4, color: C.muted }}>
                      {/* ⚠ Base zero não vira percentual: vira a frase que `variacao` devolve. */}
                      {v.percentual == null ? (
                        <span>{v.leitura}</span>
                      ) : (
                        <span style={{ color: v.absoluta >= 0 ? C.ok : C.baixa }}>
                          {v.absoluta >= 0 ? "▲" : "▼"} {pct(Math.abs(v.percentual))} ({brl(Math.abs(v.absoluta))})
                          <span style={{ color: C.muted }}> vs. período anterior</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── EVOLUÇÃO ────────────────────────────────────────────────── */}
          <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${C.borda}`, background: C.surface }}>
            <div style={{ fontSize: "0.78rem", color: C.muted, marginBottom: 8 }}>Evolução mensal</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
              {dados.map((l) => (
                <div key={l.competencia} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0 }}>
                  <div
                    title={`${l.competencia}: ${l.semLancamento ? "sem lançamento" : brl(l.total)}`}
                    style={{
                      width: "100%",
                      height: `${Math.max(2, (l.total / maiorTotal) * 96)}px`,
                      // ⚠ Mês SEM lançamento é visualmente diferente de mês com movimento baixo:
                      // os dois dariam uma barra rente ao chão, e são coisas opostas.
                      background: l.semLancamento ? "transparent" : C.accent,
                      border: l.semLancamento ? `1px dashed ${C.borda}` : "none",
                      borderRadius: "3px 3px 0 0",
                    }}
                  />
                  <span style={{ fontSize: "0.6rem", color: C.muted, whiteSpace: "nowrap" }}>{l.competencia.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── A TABELA ────────────────────────────────────────────────── */}
          <div data-print-tabela style={{ border: `1px solid ${C.borda}`, borderRadius: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ background: "#282A36" }}>
                  <th style={{ padding: "8px 10px", textAlign: "left" }}>Competência</th>
                  {DESTAQUES.map((d) => <th key={d.tipo} style={{ padding: "8px 10px", textAlign: "right" }}>{d.rotulo}</th>)}
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {dados.map((l) => (
                  <tr key={l.competencia} style={{ borderTop: `1px solid ${C.borda}`, opacity: l.semLancamento ? 0.55 : 1 }}>
                    <td style={{ padding: "6px 10px" }}>{l.competencia}</td>
                    {DESTAQUES.map((d) => (
                      <td key={d.tipo} style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {l.porTipo?.[d.tipo] ? brl(l.porTipo[d.tipo]) : "—"}
                      </td>
                    ))}
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {/* Princípio 7: ausência nunca é resposta — o mês vazio DIZ que está vazio. */}
                      {l.semLancamento ? <span style={{ color: C.muted, fontWeight: 400 }}>sem lançamento</span> : brl(l.total)}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${C.borda}`, background: "#1f2030" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 800 }}>Total do período</td>
                  {DESTAQUES.map((d) => (
                    <td key={d.tipo} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      {brl(somaPorTipo(dados, d.tipo))}
                    </td>
                  ))}
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{brl(somaTotal(dados))}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ⚠ O ESCOPO DITO UMA VEZ, no lugar de opções desabilitadas — e no papel também, porque
              o PDF chega ao cliente sem esta tela por perto. */}
          <div style={{ fontSize: "0.75rem", color: C.muted, lineHeight: 1.5 }}>
            Demonstrativo do que foi <strong>lançado</strong> por competência. Não é balanço nem
            balancete: essas peças exigem saldo por conta com classificação patrimonial e ajustes de
            encerramento, que este módulo ainda não apura.
          </div>

          <div data-print-hide>
            <button
              type="button"
              onClick={() => setImprimindo(true)}
              style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "6px 12px", font: "inherit", fontSize: "0.8rem", cursor: "pointer" }}
            >
              🖨 Imprimir / salvar em PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
