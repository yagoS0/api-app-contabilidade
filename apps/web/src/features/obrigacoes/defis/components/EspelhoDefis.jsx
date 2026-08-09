// ESPELHO DA DEFIS — a tela de transcrição.
//
// ⚠ ELA NÃO TRANSMITE NADA. A DEFIS é transmitida NO PORTAL do Simples Nacional. Isto aqui existe
// para o contador transcrever de cima para baixo sem procurar campo — e é por isso que rótulo,
// ordem e numeração vêm de `defisSpec.js`, que cita o manual oficial. Nenhum campo é reordenado
// "para ficar melhor": a ordem É o produto.
//
// ⚠ O AVISO DE CONFERÊNCIA FICA NO TOPO, não em nota de rodapé (`verificadoNoPortal: false`).
// O manual usado é de jun/2025 e o portal ganha campos em ano de reforma. Antes do primeiro uso
// real o contador confere lado a lado; divergência ajusta O ESPELHO, nunca o preenchimento.

import { useMemo, useState } from "react";
import {
  DEFIS_FONTE, DEFIS_BLOCOS, CAMPOS_ME_EPP, CAMPOS_ESTABELECIMENTO,
  PERGUNTAS_MUNICIPIO, espelhoVazio, estabelecimentoVazio,
} from "../lib/defisSpec";
import { conferirEspelho } from "../lib/defisValidacoes";
import { Tabs } from "../../../../components/ui/Tabs";

const C = {
  fundo: "#21222C", surface: "#24253A", borda: "#44475A", texto: "#F8F8F2",
  muted: "#A7B0C0", accent: "#BD93F9", erro: "#FF5555", alerta: "#FFB347", ok: "#50FA7B",
};

const campoStyle = {
  background: "#1A1B26", border: `1px solid ${C.borda}`, borderRadius: 6,
  color: C.texto, padding: "6px 9px", fontSize: "0.86rem", width: "100%", boxSizing: "border-box",
};

/**
 * Um campo do espelho.
 *
 * A NUMERAÇÃO fica visível e em mono: é por ela que se acha o campo no portal. Sem ela, o contador
 * teria de casar por texto, e vários rótulos começam igual ("Total de...").
 */
function Campo({ spec, valor, onChange, origem }) {
  return (
    <label style={{ display: "grid", gap: 3, padding: "6px 0", borderBottom: `1px solid ${C.borda}` }}>
      <span style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.8rem" }}>
        <strong style={{ fontFamily: "monospace", color: C.accent, flex: "0 0 auto" }}>{spec.n}</strong>
        <span style={{ color: C.texto }}>{spec.rotulo}</span>
      </span>
      {spec.ajuda && <span style={{ fontSize: "0.72rem", color: C.muted, paddingLeft: 26 }}>{spec.ajuda}</span>}
      <div style={{ paddingLeft: 26, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={valor ?? ""}
          onChange={(e) => onChange(e.target.value)}
          inputMode={spec.tipo === "inteiro" ? "numeric" : "decimal"}
          placeholder={spec.tipo === "moeda" ? "0,00" : spec.tipo === "percentual" ? "0,00" : ""}
          style={{ ...campoStyle, maxWidth: 220 }}
        />
        {/* ⚠ ORIGEM VISÍVEL. Campo pré-preenchido sem dizer de onde veio é número que o contador
            assina sem saber de quem é — e a DEFIS é declaração dele. */}
        {origem && <span style={{ fontSize: "0.7rem", color: C.ok }}>← {origem}</span>}
        {spec.aceitaNegativo && <span style={{ fontSize: "0.7rem", color: C.muted }}>aceita negativo</span>}
      </div>
    </label>
  );
}

/** Lista repetível (exportadoras, UFs, municípios, doações). */
function ListaCampo({ spec, linhas, onChange }) {
  const cols = spec.colunas || [];
  function set(i, campo, v) {
    onChange(linhas.map((l, idx) => (idx === i ? { ...l, [campo]: v } : l)));
  }
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.borda}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.8rem" }}>
        <strong style={{ fontFamily: "monospace", color: C.accent }}>{spec.n}</strong>
        <span>{spec.rotulo}</span>
      </div>
      {spec.ajuda && <div style={{ fontSize: "0.72rem", color: C.muted, paddingLeft: 26, marginTop: 2 }}>{spec.ajuda}</div>}
      <div style={{ paddingLeft: 26, marginTop: 6, display: "grid", gap: 4 }}>
        {linhas.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {cols.map((c) => (
              <input
                key={c.campo}
                value={l[c.campo] ?? ""}
                onChange={(e) => set(i, c.campo, e.target.value)}
                placeholder={c.rotulo}
                style={{ ...campoStyle, maxWidth: c.tipo === "moeda" ? 130 : 170 }}
              />
            ))}
            <button
              type="button"
              onClick={() => onChange(linhas.filter((_, idx) => idx !== i))}
              title="Remover linha"
              style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.muted, borderRadius: 6, width: 26, height: 26, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...linhas, Object.fromEntries(cols.map((c) => [c.campo, ""]))])}
          style={{ justifySelf: "start", background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "3px 10px", font: "inherit", fontSize: "0.76rem", cursor: "pointer" }}
        >
          + Adicionar linha
        </button>
      </div>
    </div>
  );
}

export function EspelhoDefis({
  anoCalendario, valorInicial, socios = [], estabelecimentosDaEmpresa = [],
  temFolha = true, exportacaoDoPgdas = null,
  onSalvar, onMarcarTransmitida, onClose,
}) {
  const [bloco, setBloco] = useState(0);
  const [espelho, setEspelho] = useState(() => {
    const base = valorInicial || espelhoVazio(anoCalendario);
    // ── PRÉ-PREENCHIMENTO, com a origem registrada para a tela poder mostrá-la ──
    // ⚠ Só o que o sistema SABE. Nada de estimar despesa ou saldo: campo sem fonte fica em branco
    // com destaque, que é o que o manual pede.
    if (!base.meEpp.socios.length && socios.length) {
      base.meEpp.socios = socios.map((s) => ({
        cpf: s.cpf || "", nome: s.nome || "",
        rendIsentos: "", rendTributaveis: "", percentual: s.percentual ?? "", irrf: "",
      }));
    }
    // Sem folha: 2 e 3 nascem 0, EDITÁVEIS. É dado do cadastro, não chute.
    if (!temFolha) {
      if (base.meEpp.empregadosInicio === "") base.meEpp.empregadosInicio = "0";
      if (base.meEpp.empregadosFim === "") base.meEpp.empregadosFim = "0";
    }
    if (!base.estabelecimentos.length) {
      base.estabelecimentos = (estabelecimentosDaEmpresa.length
        ? estabelecimentosDaEmpresa
        : [{ cnpj: "", nome: "Matriz" }]
      ).map((e) => estabelecimentoVazio(e.cnpj, e.nome));
    }
    return base;
  });
  const [estIndex, setEstIndex] = useState(0);
  const [salvando, setSalvando] = useState(false);

  const conferencia = useMemo(
    () => conferirEspelho(espelho, { exportacaoDoPgdas }),
    [espelho, exportacaoDoPgdas],
  );

  function setMeEpp(campo, v) { setEspelho((e) => ({ ...e, meEpp: { ...e.meEpp, [campo]: v } })); }
  function setEst(campo, v) {
    setEspelho((e) => ({
      ...e,
      estabelecimentos: e.estabelecimentos.map((x, i) => (i === estIndex ? { ...x, [campo]: v } : x)),
    }));
  }

  async function salvar() {
    setSalvando(true);
    try { await onSalvar?.(espelho); } finally { setSalvando(false); }
  }

  const est = espelho.estabelecimentos[estIndex];
  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const caixa = { background: C.surface, border: `1px solid ${C.borda}`, borderRadius: 12, padding: 18, width: 780, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", color: C.texto, boxSizing: "border-box" };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div style={caixa}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Espelho da DEFIS · {espelho.anoCalendario}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* ⚠ OS DOIS AVISOS QUE NÃO PODEM VIRAR RODAPÉ. */}
        <div style={{ padding: 10, borderRadius: 8, border: `1px solid ${C.alerta}`, background: "rgba(255,179,71,0.10)", fontSize: "0.78rem", marginBottom: 12, display: "grid", gap: 6 }}>
          <span>
            <strong>Este espelho não transmite.</strong> A DEFIS é transmitida no portal do Simples
            Nacional. Aqui você transcreve — os campos estão na ordem e com a numeração de lá.
          </span>
          {!DEFIS_FONTE.verificadoNoPortal && (
            <span style={{ color: C.alerta }}>
              ⚠ Campos montados a partir do {DEFIS_FONTE.documento} ({DEFIS_FONTE.versao}), seções {DEFIS_FONTE.secoes}
              — <strong>ainda não conferidos contra o portal ao vivo</strong>. Antes do primeiro uso real,
              abra a DEFIS de uma empresa e confira rótulo por rótulo. Divergência ajusta o espelho, não o preenchimento.
            </span>
          )}
          <span style={{ color: C.muted }}>Prazo de referência: {DEFIS_FONTE.prazo}.</span>
        </div>

        {/* Trilha dos blocos, na ordem das telas do portal. `size="sm"` porque são onze rótulos
            longos dentro de um modal — no tamanho padrão a barra ocupa três linhas. */}
        <Tabs
          size="sm"
          ariaLabel="Blocos da DEFIS"
          style={{ marginBottom: 12 }}
          items={DEFIS_BLOCOS.map((b, i) => ({ key: b.chave, label: `${i + 1}. ${b.titulo}` }))}
          active={DEFIS_BLOCOS[bloco]?.chave}
          onChange={(chave) => setBloco(DEFIS_BLOCOS.findIndex((b) => b.chave === chave))}
        />

        {bloco === 0 && (
          <label style={{ display: "grid", gap: 4, fontSize: "0.82rem" }}>
            Ano-calendário
            <input
              value={espelho.anoCalendario}
              onChange={(e) => setEspelho({ ...espelho, anoCalendario: Number(e.target.value) || espelho.anoCalendario })}
              inputMode="numeric"
              style={{ ...campoStyle, maxWidth: 140 }}
            />
            <span style={{ color: C.muted, fontSize: "0.74rem" }}>
              A DEFIS de {espelho.anoCalendario} é entregue em {espelho.anoCalendario + 1}.
            </span>
          </label>
        )}

        {bloco === 1 && (
          <div style={{ display: "grid", gap: 10, fontSize: "0.84rem" }}>
            <label style={{ display: "grid", gap: 4 }}>
              Tipo de declaração
              <select value={espelho.tipoDeclaracao} onChange={(e) => setEspelho({ ...espelho, tipoDeclaracao: e.target.value })} style={{ ...campoStyle, maxWidth: 240 }}>
                <option value="ORIGINAL">Original</option>
                <option value="RETIFICADORA">Retificadora</option>
              </select>
            </label>
            {/* Situação especial tem PRAZO PRÓPRIO (Res. CGSN 140/2018, art. 72, §2º) — por isso a
                data do evento é campo, não detalhe. */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={Boolean(espelho.situacaoEspecial)}
                onChange={(e) => setEspelho({ ...espelho, situacaoEspecial: e.target.checked ? { tipo: "", dataEvento: "" } : null })}
              />
              Situação especial (cisão, fusão, incorporação, extinção)
            </label>
            {espelho.situacaoEspecial && (
              <div style={{ display: "flex", gap: 8, paddingLeft: 24 }}>
                <input
                  value={espelho.situacaoEspecial.tipo}
                  onChange={(e) => setEspelho({ ...espelho, situacaoEspecial: { ...espelho.situacaoEspecial, tipo: e.target.value } })}
                  placeholder="Tipo do evento" style={{ ...campoStyle, maxWidth: 240 }}
                />
                <input
                  type="date"
                  value={espelho.situacaoEspecial.dataEvento}
                  onChange={(e) => setEspelho({ ...espelho, situacaoEspecial: { ...espelho.situacaoEspecial, dataEvento: e.target.value } })}
                  style={{ ...campoStyle, maxWidth: 180, colorScheme: "dark" }}
                />
              </div>
            )}
          </div>
        )}

        {bloco === 2 && (
          <div style={{ fontSize: "0.84rem", display: "grid", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={espelho.inativa} onChange={(e) => setEspelho({ ...espelho, inativa: e.target.checked })} />
              Declarar inatividade no ano-calendário
            </label>
            {/* Seção 0, passo 3 do manual: inativa pula direto para a transmissão. Dizer isso evita
                o contador preencher 40 campos que não serão usados. */}
            {espelho.inativa && (
              <span style={{ color: C.alerta, fontSize: "0.78rem" }}>
                Declarada a inatividade, o portal pula as informações econômicas e vai direto para a
                transmissão — os blocos 4 e 5 não precisam ser preenchidos.
              </span>
            )}
          </div>
        )}

        {bloco === 3 && !espelho.inativa && (
          <div>
            {CAMPOS_ME_EPP.map((spec) => {
              if (spec.tipo === "lista") {
                return <ListaCampo key={spec.n} spec={spec} linhas={espelho.meEpp[spec.campo] || []} onChange={(v) => setMeEpp(spec.campo, v)} />;
              }
              if (spec.tipo === "socios") {
                return (
                  <div key={spec.n} style={{ padding: "8px 0", borderBottom: `1px solid ${C.borda}` }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.8rem" }}>
                      <strong style={{ fontFamily: "monospace", color: C.accent }}>{spec.n}</strong>
                      <span>{spec.rotulo}</span>
                    </div>
                    {espelho.meEpp.socios.map((s, i) => (
                      <div key={i} style={{ margin: "8px 0 0 26px", padding: 10, border: `1px solid ${C.borda}`, borderRadius: 8, display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input value={s.cpf} onChange={(e) => setMeEpp("socios", espelho.meEpp.socios.map((x, k) => (k === i ? { ...x, cpf: e.target.value } : x)))} placeholder="CPF" style={{ ...campoStyle, maxWidth: 150 }} />
                          <input value={s.nome} onChange={(e) => setMeEpp("socios", espelho.meEpp.socios.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} placeholder="Nome" style={campoStyle} />
                        </div>
                        {spec.subcampos.map((sub) => (
                          <Campo
                            key={sub.n} spec={sub} valor={s[sub.campo]}
                            onChange={(v) => setMeEpp("socios", espelho.meEpp.socios.map((x, k) => (k === i ? { ...x, [sub.campo]: v } : x)))}
                            origem={sub.campo === "percentual" && s.percentual !== "" ? "quadro societário" : null}
                          />
                        ))}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setMeEpp("socios", [...espelho.meEpp.socios, { cpf: "", nome: "", rendIsentos: "", rendTributaveis: "", percentual: "", irrf: "" }])}
                      style={{ marginLeft: 26, marginTop: 8, background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "3px 10px", font: "inherit", fontSize: "0.76rem", cursor: "pointer" }}
                    >
                      + Adicionar sócio
                    </button>
                  </div>
                );
              }
              return (
                <Campo
                  key={spec.n} spec={spec} valor={espelho.meEpp[spec.campo]}
                  onChange={(v) => setMeEpp(spec.campo, v)}
                  origem={!temFolha && (spec.campo === "empregadosInicio" || spec.campo === "empregadosFim") ? "empresa sem folha" : null}
                />
              );
            })}
          </div>
        )}

        {bloco === 4 && !espelho.inativa && est && (
          <div>
            {/* Uma aba por CNPJ — matriz e filiais, como o portal. */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {espelho.estabelecimentos.map((e, i) => (
                <button
                  key={i} type="button" onClick={() => setEstIndex(i)}
                  style={{
                    fontSize: "0.72rem", padding: "3px 9px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${i === estIndex ? C.accent : C.borda}`,
                    background: "transparent", color: i === estIndex ? C.texto : C.muted,
                  }}
                >
                  {e.nome || e.cnpj || `Estabelecimento ${i + 1}`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEspelho({ ...espelho, estabelecimentos: [...espelho.estabelecimentos, estabelecimentoVazio("", `Filial ${espelho.estabelecimentos.length}`)] })}
                style={{ fontSize: "0.72rem", padding: "3px 9px", borderRadius: 6, border: `1px dashed ${C.borda}`, background: "transparent", color: C.muted, cursor: "pointer" }}
              >
                + Filial
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input value={est.cnpj} onChange={(e) => setEst("cnpj", e.target.value)} placeholder="CNPJ do estabelecimento" style={{ ...campoStyle, maxWidth: 200 }} />
              <input value={est.nome} onChange={(e) => setEst("nome", e.target.value)} placeholder="Identificação" style={{ ...campoStyle, maxWidth: 200 }} />
            </div>

            {CAMPOS_ESTABELECIMENTO.map((spec) => {
              if (spec.tipo === "lista") {
                return <ListaCampo key={spec.n} spec={spec} linhas={est[spec.campo] || []} onChange={(v) => setEst(spec.campo, v)} />;
              }
              return (
                <div key={spec.n}>
                  <Campo spec={spec} valor={est[spec.campo]} onChange={(v) => setEst(spec.campo, v)} />
                  {(spec.subcampos || []).map((sub) => (
                    <div key={sub.n} style={{ paddingLeft: 26 }}>
                      <Campo spec={sub} valor={est[sub.campo]} onChange={(v) => setEst(sub.campo, v)} />
                    </div>
                  ))}
                </div>
              );
            })}

            {/* ⚠ As perguntas "Dados referentes ao Município" NÃO estão no manual como lista fechada.
                Inventá-las seria pior que não tê-las: o contador leria aqui uma pergunta que o
                portal não faz. O lugar fica reservado, na posição certa, e manda ler no portal. */}
            <div style={{ marginTop: 12, padding: 10, border: `1px dashed ${C.borda}`, borderRadius: 8, fontSize: "0.78rem", color: C.muted }}>
              <strong style={{ color: C.texto }}>Dados referentes ao Município</strong> — perguntas Sim/Não
              ao final da ficha.
              {PERGUNTAS_MUNICIPIO.length === 0 && (
                <div style={{ marginTop: 4 }}>
                  O manual descreve estas perguntas como hipóteses definidas pelo sistema e não traz a
                  lista fechada, então o espelho não as reproduz — responda direto no portal. Assim que
                  a lista real for confirmada, ela entra aqui nesta posição.
                </div>
              )}
            </div>
          </div>
        )}

        {bloco === 5 && (
          <div style={{ display: "grid", gap: 10 }}>
            <strong style={{ fontSize: "0.9rem" }}>Conferência</strong>
            {conferencia.erros.length === 0 && conferencia.alertas.length === 0 && (
              <span style={{ color: C.ok, fontSize: "0.82rem" }}>✓ Nenhuma pendência encontrada no espelho.</span>
            )}
            {conferencia.erros.map((e, i) => (
              <div key={`e${i}`} style={{ fontSize: "0.8rem", color: C.erro, padding: "5px 8px", border: `1px solid ${C.erro}55`, borderRadius: 6 }}>
                <strong style={{ fontFamily: "monospace" }}>{e.campo}</strong> · {e.mensagem}
              </div>
            ))}
            {conferencia.alertas.map((a, i) => (
              <div key={`a${i}`} style={{ fontSize: "0.8rem", color: C.alerta, padding: "5px 8px", border: `1px solid ${C.alerta}55`, borderRadius: 6 }}>
                <strong style={{ fontFamily: "monospace" }}>{a.campo}</strong> · {a.mensagem}
              </div>
            ))}

            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {/* Imprimir usa a MESMA regra compartilhada (`body.imprimindo` + `data-print-area`). */}
              <button type="button" onClick={() => window.print()} style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "6px 12px", font: "inherit", fontSize: "0.8rem", cursor: "pointer" }}>
                🖨 Imprimir o espelho
              </button>
              {/* ⚠ MARCA MANUAL, e o texto diz isso: quem transmite é o portal. Erro bloqueia —
                  marcar como transmitida uma declaração que o portal recusaria seria gravar uma
                  informação falsa no nosso lado. */}
              <button
                type="button"
                disabled={conferencia.erros.length > 0 || Boolean(espelho.transmitida)}
                title={conferencia.erros.length > 0 ? "Corrija os erros acima — o portal recusaria." : undefined}
                onClick={async () => {
                  if (!window.confirm(`Confirmar que a DEFIS ${espelho.anoCalendario} foi transmitida no portal?\n\nIsto registra a entrega do nosso lado; não transmite nada.`)) return;
                  await onMarcarTransmitida?.(espelho);
                }}
                style={{
                  background: "transparent", borderRadius: 6, padding: "6px 12px", font: "inherit", fontSize: "0.8rem",
                  border: `1px solid ${conferencia.erros.length ? C.borda : C.accent}`,
                  color: conferencia.erros.length ? C.muted : C.accent,
                  cursor: conferencia.erros.length ? "not-allowed" : "pointer",
                }}
              >
                ✓ Marcar como transmitida
              </button>
            </div>
          </div>
        )}

        {espelho.inativa && (bloco === 3 || bloco === 4) && (
          <div style={{ fontSize: "0.82rem", color: C.muted, padding: 12 }}>
            Empresa declarada inativa — o portal não pede estas informações. Vá direto para a conferência.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => setBloco(Math.max(0, bloco - 1))} disabled={bloco === 0} style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "7px 13px", font: "inherit", cursor: bloco === 0 ? "not-allowed" : "pointer", opacity: bloco === 0 ? 0.5 : 1 }}>
            ← Anterior
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={salvar} disabled={salvando} style={{ background: "transparent", border: `1px solid ${C.accent}`, color: C.accent, borderRadius: 6, padding: "7px 13px", font: "inherit", cursor: "pointer" }}>
              {salvando ? "Salvando…" : "Salvar rascunho"}
            </button>
            <button type="button" onClick={() => setBloco(Math.min(DEFIS_BLOCOS.length - 1, bloco + 1))} disabled={bloco === DEFIS_BLOCOS.length - 1} style={{ background: bloco === DEFIS_BLOCOS.length - 1 ? "#44475A" : C.accent, border: "none", color: bloco === DEFIS_BLOCOS.length - 1 ? "#888" : "#1A1B26", borderRadius: 6, padding: "7px 15px", font: "inherit", fontWeight: 700, cursor: bloco === DEFIS_BLOCOS.length - 1 ? "not-allowed" : "pointer" }}>
              Próximo →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
