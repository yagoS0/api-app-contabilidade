// Regras do escritório: cadastrar uma obrigação UMA vez e aplicá-la a várias empresas.
//
// É isto que substitui o catálogo pré-carregado. A dor que o catálogo resolveria — não redigitar a
// mesma obrigação 38 vezes — some aqui, com o contador dizendo o prazo em vez de herdar um prazo
// nosso que pode estar desatualizado.
//
// O passo "Para quem" mostra o alcance ANTES de salvar. Descobrir que a regra pegou 38 empresas
// depois de gravar seria descobrir tarde: são 38 calendários alterados.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { BackButton } from "../../../components/ui/BackButton";

const COR = {
  fundo: "#21222C", borda: "#44475A", texto: "#F8F8F2", suave: "#A7B0C0",
  destaque: "#BD93F9", alerta: "#FFB347", perigo: "#FF5757", ok: "#50FA7B",
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ROTULO_PERIODICIDADE = { MENSAL: "Mensal", TRIMESTRAL: "Trimestral", ANUAL: "Anual" };
const ROTULO_REGIME = { SIMPLES: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real" };
const ROTULO_AJUSTE = {
  ANTECIPAR: "Antecipa para o dia útil anterior",
  POSTERGAR: "Adia para o próximo dia útil",
  MANTER: "Mantém a data, mesmo sem ser dia útil",
};
const ROTULO_ESCOPO = { TODAS: "Todas as empresas", POR_FILTRO: "Por filtro", SELECAO_MANUAL: "Seleção manual" };

const campo = {
  background: "#1F2029", border: `1px solid ${COR.borda}`, borderRadius: 6,
  color: COR.texto, padding: "7px 10px", fontSize: "0.85rem", width: "100%", boxSizing: "border-box",
  colorScheme: "dark",
};
const rotuloTexto = { display: "block", fontSize: "0.75rem", color: COR.suave, marginBottom: 3 };

function Campo({ label, children, largura }) {
  return (
    <label style={largura ? { gridColumn: largura } : undefined}>
      <span style={rotuloTexto}>{label}</span>
      {children}
    </label>
  );
}

function Selo({ cor, children, title }) {
  return (
    <span title={title} style={{ fontSize: "0.7rem", fontWeight: 700, padding: "1px 8px", borderRadius: 999, border: `1px solid ${cor}`, color: cor, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const PASSOS = ["O quê", "Quando", "Para quem"];

function Wizard({ api, opcoes, inicial, onFechar, onSalvo }) {
  const editando = Boolean(inicial?.regraId);
  const [passo, setPasso] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [verLista, setVerLista] = useState(false);

  const [form, setForm] = useState(() => ({
    nome: inicial?.nome || "",
    categoria: inicial?.categoria || "",
    periodicidade: inicial?.periodicidade || "MENSAL",
    diaVencimento: inicial?.diaVencimento || 15,
    mesReferencia: inicial?.mesReferencia || 1,
    defasagemMeses: inicial?.defasagemMeses ?? 1,
    antecedenciaLembreteDias: inicial?.antecedenciaLembreteDias ?? 5,
    ajusteDiaUtil: inicial?.ajusteDiaUtil || "ANTECIPAR",
    verificador: inicial?.verificador || "",
    escopo: inicial?.escopo || "POR_FILTRO",
    regimes: inicial?.filtros?.regimes || [],
    temFolha: inicial?.filtros?.temFolha === true,
    empresasIds: inicial?.filtros?.empresasIds || [],
    aplicarANovas: inicial?.aplicarANovas ?? true,
  }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const filtros = useMemo(() => {
    if (form.escopo === "POR_FILTRO") return { regimes: form.regimes, temFolha: form.temFolha ? true : null };
    if (form.escopo === "SELECAO_MANUAL") return { empresasIds: form.empresasIds };
    return null;
  }, [form.escopo, form.regimes, form.temFolha, form.empresasIds]);

  // Contador ao vivo: a cada mexida no filtro, quantas empresas entram.
  useEffect(() => {
    if (passo !== 2 || !api) return undefined;
    let cancelado = false;
    setCarregandoPrevia(true);
    api.previewEscopoRegra({ escopo: form.escopo, filtros })
      .then((out) => { if (!cancelado) setPrevia(out?.ok === false ? null : out); })
      .catch(() => { if (!cancelado) setPrevia(null); })
      .finally(() => { if (!cancelado) setCarregandoPrevia(false); });
    return () => { cancelado = true; };
  }, [api, passo, form.escopo, filtros]);

  const previaDatas = useMemo(() => {
    const hoje = new Date();
    const dias = [];
    for (let i = 0; i < 12 && dias.length < 3; i += 1) {
      const bruto = hoje.getUTCMonth() + i;
      const ano = hoje.getUTCFullYear() + Math.floor(bruto / 12);
      const mes = (bruto % 12) + 1;
      if (form.periodicidade === "ANUAL" && mes !== Number(form.mesReferencia)) continue;
      if (form.periodicidade === "TRIMESTRAL" && (((mes - Number(form.mesReferencia)) % 3) + 3) % 3 !== 0) continue;
      const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
      const d = new Date(Date.UTC(ano, mes - 1, Math.min(Number(form.diaVencimento) || 1, ultimo)));
      if (form.ajusteDiaUtil !== "MANTER") {
        const passoDia = form.ajusteDiaUtil === "ANTECIPAR" ? -1 : 1;
        while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + passoDia);
      }
      dias.push(d.toISOString().slice(0, 10).split("-").reverse().join("/"));
    }
    return dias;
  }, [form.periodicidade, form.mesReferencia, form.diaVencimento, form.ajusteDiaUtil]);

  const podeAvancar = passo === 0 ? Boolean(form.nome.trim()) : true;

  // "Por filtro" sem nenhum critério vale para todas — e o backend recusa justamente por isso
  // (o escopo certo aí é "Todas"). Sem este aviso a prévia mostraria 6 empresas e o salvar
  // falharia depois, que é descobrir a regra na hora errada.
  const filtroVazio = form.escopo === "POR_FILTRO" && !form.regimes.length && !form.temFolha;
  const selecaoVazia = form.escopo === "SELECAO_MANUAL" && !form.empresasIds.length;
  const impedimento = filtroVazio
    ? 'Escolha um regime ou marque "somente com folha" — sem critério, o escopo certo é "Todas as empresas".'
    : selecaoVazia
      ? "Selecione pelo menos uma empresa."
      : null;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        nome: form.nome,
        categoria: form.categoria || null,
        periodicidade: form.periodicidade,
        diaVencimento: Number(form.diaVencimento),
        mesReferencia: form.periodicidade === "MENSAL" ? null : Number(form.mesReferencia),
        defasagemMeses: Number(form.defasagemMeses),
        antecedenciaLembreteDias: Number(form.antecedenciaLembreteDias),
        ajusteDiaUtil: form.ajusteDiaUtil,
        verificador: form.verificador || null,
        escopo: form.escopo,
        filtros,
        aplicarANovas: Boolean(form.aplicarANovas),
      };
      const out = editando
        ? await api.updateRegraObrigacao(inicial.regraId, corpo)
        : await api.createRegraObrigacao(corpo);
      if (out?.ok === false) { setErro(out.message || "Não foi possível salvar a regra."); return; }
      onSalvo(out);
    } catch (err) {
      setErro(err?.message || "Não foi possível salvar a regra.");
    } finally { setSalvando(false); }
  }

  const totalPrevia = previa?.total ?? 0;
  const ocorrenciasEstimadas =
    totalPrevia * (form.periodicidade === "MENSAL" ? 12 : form.periodicidade === "TRIMESTRAL" ? 4 : 1);

  return (
    <div
      role="dialog" aria-modal="true" aria-label={editando ? "Editar regra" : "Nova regra do escritório"}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16, overflowY: "auto" }}
    >
      <div style={{ width: "100%", maxWidth: 620, background: "#282A36", border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, color: COR.texto }}>
        <h3 style={{ margin: "0 0 10px", fontSize: "1.05rem" }}>
          {editando ? "Editar regra" : "Nova regra do escritório"}
        </h3>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {PASSOS.map((p, i) => (
            <div
              key={p}
              style={{
                flex: 1, textAlign: "center", padding: "4px 6px", borderRadius: 6, fontSize: "0.75rem",
                border: `1px solid ${i === passo ? COR.destaque : COR.borda}`,
                background: i === passo ? "rgba(189,147,249,0.16)" : "transparent",
                color: i === passo ? COR.texto : COR.suave,
              }}
            >
              {i + 1}. {p}
            </div>
          ))}
        </div>

        {erro && (
          <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: `1px solid ${COR.perigo}`, color: COR.perigo, marginBottom: 12, fontSize: "0.8rem" }}>
            {erro}
          </div>
        )}

        {passo === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Campo label="Nome da obrigação" largura="1 / -1">
              <input
                autoFocus value={form.nome} onChange={(e) => set("nome", e.target.value)}
                placeholder="Ex.: EFD-Contribuições" style={campo}
              />
            </Campo>
            <Campo label="Categoria">
              <input value={form.categoria} onChange={(e) => set("categoria", e.target.value)} placeholder="fiscal, trabalhista…" style={campo} />
            </Campo>
            <Campo label="Concluir sozinha">
              <select value={form.verificador} onChange={(e) => set("verificador", e.target.value)} style={campo}>
                <option value="">Eu marco quando concluir</option>
                {(opcoes?.verificadores || []).map((v) => <option key={v.chave} value={v.chave}>{v.rotulo}</option>)}
              </select>
            </Campo>
          </div>
        )}

        {passo === 1 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Campo label="Periodicidade">
                <select value={form.periodicidade} onChange={(e) => set("periodicidade", e.target.value)} style={campo}>
                  {(opcoes?.periodicidades || []).map((p) => <option key={p} value={p}>{ROTULO_PERIODICIDADE[p] || p}</option>)}
                </select>
              </Campo>
              <Campo label="Dia do vencimento">
                <input type="number" min="1" max="31" value={form.diaVencimento} onChange={(e) => set("diaVencimento", e.target.value)} style={campo} />
              </Campo>
              {form.periodicidade !== "MENSAL" && (
                <Campo label={form.periodicidade === "ANUAL" ? "Mês" : "Primeiro mês do ciclo"}>
                  <select value={form.mesReferencia} onChange={(e) => set("mesReferencia", e.target.value)} style={campo}>
                    {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </Campo>
              )}
              <Campo label="Se cair em fim de semana ou feriado" largura="1 / -1">
                <select value={form.ajusteDiaUtil} onChange={(e) => set("ajusteDiaUtil", e.target.value)} style={campo}>
                  {(opcoes?.ajustesDiaUtil || []).map((a) => <option key={a} value={a}>{ROTULO_AJUSTE[a] || a}</option>)}
                </select>
              </Campo>
              <Campo label="Refere-se à competência de">
                <select value={form.defasagemMeses} onChange={(e) => set("defasagemMeses", e.target.value)} style={campo}>
                  <option value={0}>Mesmo mês do vencimento</option>
                  <option value={1}>1 mês antes</option>
                  <option value={2}>2 meses antes</option>
                  <option value={3}>3 meses antes</option>
                  <option value={5}>5 meses antes</option>
                  <option value={12}>12 meses antes</option>
                </select>
              </Campo>
              <Campo label="Avisar com antecedência de">
                <input type="number" min="0" max="90" value={form.antecedenciaLembreteDias} onChange={(e) => set("antecedenciaLembreteDias", e.target.value)} style={campo} />
              </Campo>
            </div>
            <div style={{ marginTop: 12, padding: "8px 10px", background: COR.fundo, borderRadius: 6, border: `1px solid ${COR.borda}`, fontSize: "0.78rem", color: COR.suave }}>
              Próximos vencimentos: <strong style={{ color: COR.texto }}>{previaDatas.join(" · ") || "—"}</strong>
            </div>
          </>
        )}

        {passo === 2 && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(opcoes?.escopos || []).map((e) => (
                <button
                  key={e} type="button" onClick={() => set("escopo", e)}
                  style={{
                    flex: 1, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                    border: `1px solid ${form.escopo === e ? COR.destaque : COR.borda}`,
                    background: form.escopo === e ? "rgba(189,147,249,0.16)" : "transparent",
                    color: form.escopo === e ? COR.texto : COR.suave,
                  }}
                >
                  {ROTULO_ESCOPO[e] || e}
                </button>
              ))}
            </div>

            {form.escopo === "POR_FILTRO" && (
              <div style={{ marginBottom: 12 }}>
                <div style={rotuloTexto}>Regime tributário</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {(opcoes?.regimes || []).map((r) => {
                    const ativo = form.regimes.includes(r);
                    return (
                      <button
                        key={r} type="button"
                        onClick={() => set("regimes", ativo ? form.regimes.filter((x) => x !== r) : [...form.regimes, r])}
                        style={{
                          padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontSize: "0.76rem", fontWeight: 600,
                          border: `1px solid ${ativo ? COR.destaque : COR.borda}`,
                          background: ativo ? "rgba(189,147,249,0.16)" : "transparent",
                          color: ativo ? COR.texto : COR.suave,
                        }}
                      >
                        {ROTULO_REGIME[r] || r}
                      </button>
                    );
                  })}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: COR.texto }}>
                  <input type="checkbox" checked={form.temFolha} onChange={(e) => set("temFolha", e.target.checked)} />
                  Somente empresas com folha de pagamento
                </label>
              </div>
            )}

            {form.escopo === "SELECAO_MANUAL" && (
              <div style={{ marginBottom: 12, maxHeight: 200, overflowY: "auto", border: `1px solid ${COR.borda}`, borderRadius: 6, padding: 8 }}>
                {(previa?.empresas || []).length === 0 && (
                  <div style={{ color: COR.suave, fontSize: "0.78rem" }}>Carregando empresas…</div>
                )}
                {(opcoes?.todasEmpresas || []).map((e) => (
                  <label key={e.companyId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: COR.texto, padding: "2px 0" }}>
                    <input
                      type="checkbox"
                      checked={form.empresasIds.includes(e.companyId)}
                      onChange={(ev) => set("empresasIds", ev.target.checked
                        ? [...form.empresasIds, e.companyId]
                        : form.empresasIds.filter((x) => x !== e.companyId))}
                    />
                    {e.razao}
                  </label>
                ))}
              </div>
            )}

            {impedimento && (
              <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(255,179,71,0.10)", border: `1px solid ${COR.alerta}`, color: COR.alerta, marginBottom: 10, fontSize: "0.78rem" }}>
                {impedimento}
              </div>
            )}

            <div style={{ padding: "10px 12px", background: COR.fundo, borderRadius: 6, border: `1px solid ${totalPrevia && !impedimento ? COR.destaque : COR.alerta}` }}>
              <div style={{ fontSize: "0.9rem", color: COR.texto, fontWeight: 600 }}>
                {carregandoPrevia ? "calculando…" : `${totalPrevia} empresa${totalPrevia === 1 ? "" : "s"} ${totalPrevia === 1 ? "será incluída" : "serão incluídas"}`}
              </div>
              <div style={{ fontSize: "0.75rem", color: COR.suave }}>
                {/* O número de ocorrências é o que o contador vai ver multiplicado no calendário —
                    é ele que revela o tamanho real da ação, não a contagem de empresas. */}
                ~{ocorrenciasEstimadas} vencimento(s) no calendário
                {totalPrevia > 0 && (
                  <>
                    {" · "}
                    <button
                      type="button" onClick={() => setVerLista((v) => !v)}
                      style={{ background: "none", border: "none", color: COR.destaque, cursor: "pointer", padding: 0, fontSize: "0.75rem", textDecoration: "underline" }}
                    >
                      {verLista ? "esconder lista" : "ver lista"}
                    </button>
                  </>
                )}
              </div>
              {verLista && (
                <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto", fontSize: "0.78rem", color: COR.suave }}>
                  {(previa?.empresas || []).map((e) => <div key={e.companyId}>· {e.razao}</div>)}
                </div>
              )}
            </div>

            {form.escopo !== "SELECAO_MANUAL" && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: COR.texto, marginTop: 10 }}>
                <input type="checkbox" checked={form.aplicarANovas} onChange={(e) => set("aplicarANovas", e.target.checked)} />
                Aplicar automaticamente a novas empresas que se encaixem
              </label>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 18 }}>
          <Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <div style={{ display: "flex", gap: 8 }}>
            {passo > 0 && <Button type="button" variant="secondary" onClick={() => setPasso(passo - 1)} disabled={salvando}>Voltar</Button>}
            {passo < 2 ? (
              <Button type="button" variant="primary" onClick={() => setPasso(passo + 1)} disabled={!podeAvancar}>Avançar</Button>
            ) : (
              <Button type="button" variant="primary" onClick={salvar} disabled={salvando || !totalPrevia || Boolean(impedimento)}>
                {salvando ? "Aplicando…" : editando ? "Salvar regra" : "Criar regra"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RegrasObrigacao({ api, empresas = [], onVoltar }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [wizard, setWizard] = useState(null);
  const [aberta, setAberta] = useState(null); // regraId com o detalhe aberto

  const carregar = useCallback(async () => {
    if (!api) return;
    setCarregando(true);
    setErro(null);
    try {
      const out = await api.listRegrasObrigacao();
      if (out?.ok === false) { setErro(out.message || "Não foi possível carregar."); setDados(null); }
      else setDados(out);
    } catch (err) {
      setErro(err?.message || "Não foi possível carregar as regras.");
    } finally { setCarregando(false); }
  }, [api]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  const opcoes = useMemo(
    () => ({ ...(dados?.opcoes || {}), todasEmpresas: empresas }),
    [dados, empresas],
  );

  async function excluir(regra) {
    // Dois efeitos opostos, então a pergunta é explícita — nada de default silencioso.
    const desvincular = window.confirm(
      `Excluir a regra "${regra.nome}".\n\n` +
      `OK = manter as ${regra.totalEmpresas} obrigações nas empresas, agora avulsas.\n` +
      `Cancelar = escolher remover tudo.`,
    );
    let modo = "desvincular";
    if (!desvincular) {
      const remover = window.confirm(
        `Remover TAMBÉM as ${regra.totalEmpresas} obrigações das empresas?\n\n` +
        `Isso apaga os vencimentos já concluídos junto. Não dá para desfazer.`,
      );
      if (!remover) return;
      modo = "remover";
    }
    try {
      const out = await api.deleteRegraObrigacao(regra.regraId, modo);
      if (out?.ok === false) { setErro(out.message || "Não foi possível excluir."); return; }
      setAviso(modo === "remover"
        ? `Regra e ${out.removidas} obrigação(ões) removidas.`
        : `Regra removida; ${out.desvinculadas} obrigação(ões) continuam nas empresas.`);
      await carregar();
    } catch (err) { setErro(err?.message || "Não foi possível excluir."); }
  }

  async function alternarExcecao(regra, companyId, virarExcecao) {
    try {
      const out = virarExcecao
        ? await api.addExcecaoRegra(regra.regraId, companyId, null)
        : await api.removeExcecaoRegra(regra.regraId, companyId);
      if (out?.ok === false) { setErro(out.message || "Não foi possível alterar."); return; }
      await carregar();
    } catch (err) { setErro(err?.message || "Não foi possível alterar."); }
  }

  const regras = dados?.regras || [];

  return (
    <section aria-label="Regras do escritório">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <BackButton onClick={onVoltar} label="Obrigações" />
        <h2 style={{ margin: 0, color: COR.texto, fontSize: "1.1rem" }}>Regras do escritório</h2>
        <span style={{ color: COR.suave, fontSize: "0.78rem" }}>uma obrigação, várias empresas</span>
        {carregando && <span style={{ color: COR.suave, fontSize: "0.75rem" }}>carregando…</span>}
        <div style={{ marginLeft: "auto" }}>
          <Button variant="primary" onClick={() => setWizard({ inicial: null })}>+ Nova regra</Button>
        </div>
      </div>

      {erro && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: `1px solid ${COR.perigo}`, color: COR.perigo, marginBottom: 12, fontSize: "0.82rem" }}>
          {erro}
        </div>
      )}
      {aviso && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(80,250,123,0.10)", border: `1px solid ${COR.ok}`, color: COR.ok, marginBottom: 12, fontSize: "0.82rem" }}>
          {aviso}
        </div>
      )}

      {!carregando && !regras.length && (
        <div style={{ padding: "28px 16px", textAlign: "center", background: COR.fundo, border: `1px dashed ${COR.borda}`, borderRadius: 8 }}>
          <div style={{ color: COR.texto, fontWeight: 600, marginBottom: 4 }}>Nenhuma regra criada.</div>
          <div style={{ color: COR.suave, fontSize: "0.8rem" }}>
            Crie uma regra para aplicar a mesma obrigação a várias empresas de uma vez.
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {regras.map((r) => {
          const expandida = aberta === r.regraId;
          return (
            <article key={r.regraId} style={{ background: COR.fundo, border: `1px solid ${COR.borda}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: r.cor || COR.destaque, flex: "0 0 auto" }} />
                <strong style={{ color: COR.texto, fontSize: "0.92rem" }}>{r.nome}</strong>
                <Selo cor={COR.suave}>{ROTULO_PERIODICIDADE[r.periodicidade] || r.periodicidade}</Selo>
                {r.categoria && <Selo cor={COR.suave}>{r.categoria}</Selo>}
                {r.totalExcecoes > 0 && (
                  <Selo cor={COR.alerta} title="Empresas tiradas da regra à mão">
                    {r.totalExcecoes} exceção{r.totalExcecoes === 1 ? "" : "ões"}
                  </Selo>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <Button variant="secondary" onClick={() => setAberta(expandida ? null : r.regraId)}>
                    {expandida ? "Fechar" : "Empresas"}
                  </Button>
                  <Button variant="secondary" onClick={() => setWizard({ inicial: r })}>Editar</Button>
                  <Button variant="secondary" onClick={() => excluir(r)}>Excluir</Button>
                </div>
              </div>

              <div style={{ marginTop: 4, fontSize: "0.78rem", color: COR.suave }}>
                {r.resumoEscopo} · dia {r.diaVencimento}
                {r.aplicarANovas && " · aplica a novas empresas"}
              </div>

              {/* Banner de sobrescrita: sem ele o contador editaria a regra achando que pega todo
                  mundo, e essas empresas ficariam para trás em silêncio. */}
              {r.totalSobrescritas > 0 && (
                <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "rgba(255,179,71,0.10)", border: `1px solid ${COR.alerta}`, color: COR.alerta, fontSize: "0.78rem" }}>
                  {r.totalSobrescritas} empresa{r.totalSobrescritas === 1 ? " tem" : "s têm"} configuração local
                  diferente desta regra — editar aqui não muda {r.totalSobrescritas === 1 ? "ela" : "elas"}.
                </div>
              )}

              {expandida && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${COR.borda}`, paddingTop: 8 }}>
                  {!r.empresas.length && (
                    <div style={{ color: COR.suave, fontSize: "0.8rem" }}>Nenhuma empresa no escopo.</div>
                  )}
                  {r.empresas.map((e) => (
                    <div key={e.companyId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: "0.8rem" }}>
                      <span style={{ color: COR.texto }}>{e.razao}</span>
                      {e.sobrescritaLocal
                        ? <Selo cor={COR.alerta} title="Editada dentro da empresa; a regra não sobrescreve">sobrescrita</Selo>
                        : <Selo cor={COR.ok}>aplicada</Selo>}
                      <button
                        type="button"
                        onClick={() => alternarExcecao(r, e.companyId, true)}
                        style={{ marginLeft: "auto", background: "none", border: "none", color: COR.suave, cursor: "pointer", fontSize: "0.76rem", textDecoration: "underline" }}
                      >
                        tirar da regra
                      </button>
                    </div>
                  ))}
                  {r.excecoes?.map((e) => {
                    const nome = empresas.find((x) => x.companyId === e.companyId)?.razao || e.companyId;
                    return (
                      <div key={e.companyId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: "0.8rem" }}>
                        <span style={{ color: COR.suave, textDecoration: "line-through" }}>{nome}</span>
                        <Selo cor={COR.alerta}>exceção</Selo>
                        <button
                          type="button"
                          onClick={() => alternarExcecao(r, e.companyId, false)}
                          style={{ marginLeft: "auto", background: "none", border: "none", color: COR.destaque, cursor: "pointer", fontSize: "0.76rem", textDecoration: "underline" }}
                        >
                          devolver à regra
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {wizard && (
        <Wizard
          api={api}
          opcoes={opcoes}
          inicial={wizard.inicial}
          onFechar={() => setWizard(null)}
          onSalvo={async (out) => {
            setWizard(null);
            setAviso(
              `Regra aplicada a ${out.empresasNoEscopo} empresa(s)` +
              (out.criadas ? ` · ${out.criadas} nova(s)` : "") +
              (out.atualizadas ? ` · ${out.atualizadas} atualizada(s)` : "") +
              (out.puladas ? ` · ${out.puladas} pulada(s) por edição local` : "") +
              (out.removidas ? ` · ${out.removidas} removida(s)` : ""),
            );
            await carregar();
          }}
        />
      )}
    </section>
  );
}
