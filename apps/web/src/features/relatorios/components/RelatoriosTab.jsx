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
import { Tabs } from "../../../components/ui/Tabs";
import { lerFalhaDeCarga } from "../../../lib/falhaDeCarga";
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
  const [falha, setFalha] = useState(null);
  const [imprimindo, setImprimindo] = useState(false);

  const opcoes = useMemo(() => intervalosDisponiveis(competenciaReferencia), [competenciaReferencia]);
  const escolhido = opcoes.find((o) => o.chave === intervalo) || opcoes[0];
  // ⚠ O PERÍODO DA COMPARAÇÃO, LIDO UMA VEZ — a mesma leitura que alimenta a busca lá embaixo e o
  // rótulo que a nomeia na tela. Recalculá-lo no render seria a segunda definição do "anterior", e
  // a primeira divergência apareceria como uma variação comparada a um intervalo que ninguém
  // buscou. A regra (mesmo tamanho, imediatamente antes) vive em `lib/periodoRelatorio.js`.
  const comparado = useMemo(
    () => (escolhido ? periodoAnterior(escolhido.de, escolhido.ate) : null),
    [escolhido?.de, escolhido?.ate],
  );

  useEffect(() => {
    if (!companyId || !escolhido) return undefined;
    let vivo = true;
    setCarregando(true); setFalha(null);
    // ⚠ O DADO ANTIGO SAI ANTES DA NOVA RESPOSTA CHEGAR. Enquanto ele sobrevivia à troca de
    // período, uma falha na recarga deixava a tabela e os totais do período ANTERIOR na tela sob o
    // rótulo do período NOVO — com o botão Imprimir ativo em cima. O PDF que sai daí declara um
    // período e traz o movimento de outro, e ele circula sem esta tela por perto.
    setDados(null); setAnterior(null);
    Promise.all([
      relatoriosApi.getRelatorioResumo(companyId, escolhido.de, escolhido.ate),
      // O período anterior é buscado JUNTO: sem ele a tela mostraria o total e depois o
      // comparativo apareceria pulando, o que faz duvidar do primeiro número.
      comparado ? relatoriosApi.getRelatorioResumo(companyId, comparado.de, comparado.ate) : Promise.resolve(null),
    ])
      .then(([atual, previo]) => {
        if (!vivo) return;
        // ⚠ Resposta sem `linhas` NÃO é relatório vazio — é resposta que não entendemos. Tratada
        // como sucesso, ela viraria uma tabela de zeros com o total do período carimbado embaixo.
        if (!Array.isArray(atual?.linhas)) {
          setFalha(lerFalhaDeCarga(atual?.message ? atual : "O servidor respondeu sem as linhas do período.", { assunto: "o relatório" }));
          return;
        }
        setDados(atual.linhas);
        setAnterior(Array.isArray(previo?.linhas) ? previo.linhas : null);
      })
      .catch((e) => {
        if (!vivo) return;
        // Nada de dado por perto: `setDados(null)` já correu acima, então a tela não tem o que
        // desenhar sob o rótulo novo — nem tabela, nem totais, nem botão de imprimir.
        setFalha(lerFalhaDeCarga(e, { assunto: "o relatório" }));
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [companyId, escolhido?.de, escolhido?.ate, comparado]);

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
        {/* Recorte de período — `mode="view"`: escolhe UM e troca o que a tela mostra, que é o
            comportamento de aba. Não navega, então é `aria-pressed`. */}
        <Tabs
          mode="view"
          size="sm"
          ariaLabel="Período do relatório"
          items={opcoes.map((o) => ({ key: o.chave, label: o.rotulo }))}
          active={intervalo}
          onChange={setIntervalo}
        />
        <span style={{ fontSize: "0.75rem", color: C.muted }}>
          {escolhido ? `${escolhido.de} a ${escolhido.ate}` : ""}
        </span>
      </div>

      {/* ⚠ A RECUSA TEM O PESO DO RELATÓRIO (mesma ideia do `CardRegime`): ela ocupa o lugar da
          tabela, não uma tarja fina acima dela. Aqui não há número em cinza para o olho pescar —
          há a frase, e ela é a resposta. */}
      {falha && !carregando && (
        <div
          role="alert"
          style={{
            padding: 16, borderRadius: 10, background: C.surface,
            border: `2px solid ${falha.semAcesso ? C.muted : C.baixa}`,
          }}
        >
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: falha.semAcesso ? C.texto : C.baixa }}>
            {falha.titulo}
          </div>
          <div style={{ fontSize: "0.84rem", color: C.texto, marginTop: 6 }}>{falha.motivo}</div>
          <div style={{ fontSize: "0.78rem", color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
            Nada do período {escolhido ? `${escolhido.de} a ${escolhido.ate}` : "escolhido"} está sendo
            exibido — nem tabela, nem totais, nem impressão. O que estava na tela era de outro
            período e saiu junto.
          </div>
        </div>
      )}
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

          {/* ⚠ O PERÍODO DA COMPARAÇÃO É NOMEADO — na tela E no papel (por isso ele mora DENTRO da
              área impressa, e não junto do seletor, que é `data-print-hide`). "▲ 12,4% vs. período
              anterior" não diz contra o quê; no PDF, que circula sozinho, o leitor vê uma variação
              percentual sem ter como descobrir a base. O intervalo é o MESMO que foi buscado, e
              o "mesmo tamanho" é dito porque é ele que torna a comparação honesta — um trimestre
              comparado com "o mês passado" produziria um número que não significa nada. */}
          {anterior && comparado && (
            <div style={{ fontSize: "0.75rem", color: C.muted }}>
              Comparação com o período anterior, de mesmo tamanho:{" "}
              <strong style={{ color: C.texto }}>{comparado.de} a {comparado.ate}</strong>.
            </div>
          )}

          {/* ── EVOLUÇÃO ────────────────────────────────────────────────── */}
          <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${C.borda}`, background: C.surface }}>
            <div style={{ fontSize: "0.78rem", color: C.muted, marginBottom: 8 }}>Evolução mensal</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
              {dados.map((l) => (
                <div key={l.competencia} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0 }}>
                  <div
                    title={`${l.competencia}: ${l.semLancamento ? "sem lançamento" : brl(l.total)}`}
                    // ⚠ ESTA MARCA É O QUE FAZ A BARRA EXISTIR NO PAPEL. A regra de impressão
                    // (compartilhada, `@media print` no `App.css`) zera o fundo de todo descendente
                    // da área impressa — e a barra com movimento é SÓ fundo. Sem o `data-print-barra`
                    // o gráfico saía impresso como uma caixa vazia em que os únicos traços eram os
                    // meses SEM lançamento, que têm tracejado. Ver o bloco `[data-print-barra]` lá.
                    data-print-barra={l.semLancamento ? "vazio" : "movimento"}
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
