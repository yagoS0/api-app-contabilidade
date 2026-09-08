import { useMemo, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { calcularPreviaVencimentos } from "../lib/previaVencimentos";

const campo = { width: "100%", minHeight: 40, boxSizing: "border-box", padding: "8px 10px", background: "var(--bg-page)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.95rem", colorScheme: "dark" };
const fmt = (iso) => iso?.split("-").reverse().join("/") || "—";
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function preparar(iso, dias) { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - Number(dias || 0)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function Campo({ label, children }) { return <label style={{ display: "grid", gap: 5, fontSize: "0.875rem", color: "var(--text-muted)" }}><span>{label}</span>{children}</label>; }

/** Um cadastro para tarefas avulsas e obrigações, com vencimento fiscal independente. */
export function ModalObrigacao({ empresas, opcoes, inicial, onFechar, onSalvar, salvando, erro }) {
  const editando = Boolean(inicial?.obrigacaoId);
  const [alcance, setAlcance] = useState("ESTA");
  const unica = Boolean(inicial?.ocorrenciaId) && alcance === "ESTA";
  const [falha, setFalha] = useState(null);
  const [form, setForm] = useState(() => ({
    companyId: inicial?.companyId || empresas[0]?.companyId || "", nome: inicial?.nome || "",
    tipo: inicial?.tipo || "OBRIGACAO", periodicidade: inicial?.periodicidade || "AVULSA",
    dataInicio: inicial?.dataInicio || inicial?.inicio || hoje(), dataFim: inicial?.dataFim || inicial?.fim || inicial?.dataInicio || inicial?.inicio || hoje(),
    dataVencimento: inicial?.dataVencimento || inicial?.dataFim || inicial?.fim || hoje(),
    janelaTrabalho: inicial?.janelaTrabalho || null,
    descricao: inicial?.descricao || "", categoria: inicial?.categoria || "", diasPreparacao: inicial?.diasPreparacao ?? 0,
    diaVencimento: inicial?.diaVencimento || 20, mesReferencia: inicial?.mesReferencia || 1,
    defasagemMeses: inicial?.defasagemMeses ?? 1, antecedenciaLembreteDias: inicial?.antecedenciaLembreteDias ?? 5,
    ajusteDiaUtil: inicial?.ajusteDiaUtil || "ANTECIPAR", verificador: inicial?.verificador || "", incluirVencidoDoMes: false,
  }));
  const set = (k, v) => { setFalha(null); setForm((f) => {
    const atualizado = { ...f, [k]: v };
    if (atualizado.tipo === "TAREFA" || atualizado.periodicidade === "AVULSA") atualizado.verificador = "";
    return atualizado;
  }); };
  const avulsa = form.periodicidade === "AVULSA";
  const previa = useMemo(() => calcularPreviaVencimentos(form, new Date()), [form.periodicidade, form.mesReferencia, form.diaVencimento, form.ajusteDiaUtil]);
  const podeMarcarVencido = !editando && !avulsa && Boolean(previa.jaVencida);
  const titulo = unica ? "Editar somente esta ocorrência" : editando ? "Editar tarefa ou obrigação" : "Nova tarefa ou obrigação";
  if (alcance === "ESTA_E_PROXIMAS") {
    const janela = form.janelaTrabalho || { modo: "DIAS_DO_CICLO", diaInicio: 10, diaFim: 15, deslocamentoFim: 0 };
    return <Modal titulo="Editar esta e as próximas" aoFechar={onFechar} ocupado={salvando} tamanho="md">
      <form onSubmit={e => { e.preventDefault(); onSalvar({ ...form, alcance, janelaTrabalho: janela }); }} style={{ display: "grid", gap: 14 }}>
        <p><strong>{form.nome}</strong> · a partir da ocorrência de {fmt(form.dataInicio)}. Altera apenas a janela de trabalho; o prazo fiscal e a frequência não mudam. Concluídas e exceções individuais são preservadas.</p>
        {(erro || falha) && <p role="alert">{erro || falha}</p>}
        <Campo label="Dia de início"><input required type="number" min="1" max="31" value={janela.diaInicio} onChange={e => set("janelaTrabalho", { ...janela, diaInicio: Number(e.target.value) })} style={campo} /></Campo>
        <Campo label="Dia de fim"><input required type="number" min="1" max="31" value={janela.diaFim} onChange={e => set("janelaTrabalho", { ...janela, diaFim: Number(e.target.value) })} style={campo} /></Campo>
        <Campo label="Mês do fim"><select value={janela.deslocamentoFim} onChange={e => set("janelaTrabalho", { ...janela, deslocamentoFim: Number(e.target.value) })} style={campo}><option value={0}>Mesmo mês</option><option value={1}>Mês seguinte</option></select></Campo>
        <p>Aparece em todos os dias do período. Dias que não existem no mês usam o último dia desse mês.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Button disabled={salvando} onClick={() => setAlcance("ESTA")} type="button">Somente esta ocorrência</Button><Button disabled={salvando} type="submit">{salvando ? "Salvando…" : "Salvar esta e as próximas"}</Button></div>
      </form>
    </Modal>;
  }
  return <Modal titulo={titulo} aoFechar={onFechar} ocupado={salvando} tamanho="md">
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!form.companyId) { setFalha("Selecione uma empresa para salvar."); return; }
      if ((avulsa || unica) && (!form.dataInicio || !form.dataFim || form.dataFim < form.dataInicio)) { setFalha("O fim planejado deve ser igual ou posterior ao início do trabalho."); return; }
      onSalvar({ ...form, ...(inicial?.ocorrenciaId ? { alcance } : {}), verificador: form.tipo === "TAREFA" || avulsa ? "" : form.verificador, incluirVencidoDoMes: podeMarcarVencido && form.incluirVencidoDoMes });
    }} style={{ display: "grid", gap: 14 }}>
      {(erro || falha) && <div role="alert" style={{ color: "var(--danger)", padding: 10, border: "1px solid var(--danger)", borderRadius: 6 }}>{erro || falha}</div>}
      {inicial?.ocorrenciaId && form.periodicidade !== "AVULSA" && <Campo label="Aplicar alteração"><select value={alcance} onChange={e => setAlcance(e.target.value)} style={campo}><option value="ESTA">Somente esta ocorrência</option><option value="ESTA_E_PROXIMAS">Esta e as próximas — janela de trabalho</option></select></Campo>}
      {alcance === "ESTA_E_PROXIMAS" && <p>Concluídas e ocorrências ajustadas individualmente mantêm seu histórico. O prazo fiscal não muda.</p>}
      {unica ? <p style={{ margin: 0 }}>{form.nome} · {inicial.competenciaRef}. {form.tipo === "TAREFA" ? "O fim planejado será o novo prazo desta tarefa." : `Altera apenas a janela de trabalho; o vencimento fiscal permanece em ${fmt(form.dataVencimento)}.`}</p> : <>
        <Campo label="Nome"><input required value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Ex.: Transmitir apuração do Simples" style={campo} /></Campo>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Campo label="Tipo"><select value={form.tipo} disabled={editando} onChange={(e) => set("tipo", e.target.value)} style={campo}><option value="TAREFA">Tarefa</option><option value="OBRIGACAO">Obrigação</option></select></Campo>
          <Campo label="Empresa"><select required disabled={editando} value={form.companyId} onChange={(e) => set("companyId", e.target.value)} style={campo}><option value="">Selecione a empresa</option>{empresas.map((e) => <option key={e.companyId} value={e.companyId}>{e.razao}</option>)}</select></Campo>
          <Campo label="Repetição"><select value={form.periodicidade} disabled={editando} onChange={(e) => set("periodicidade", e.target.value)} style={campo}>{Object.entries({ AVULSA: "Uma vez (avulsa)", MENSAL: "Mensal", TRIMESTRAL: "Trimestral", ANUAL: "Anual" }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
          <Campo label="Categoria"><input value={form.categoria} onChange={(e) => set("categoria", e.target.value)} list="categorias-obrigacao" style={campo} /></Campo>
        </div>
      </>}
      {(avulsa || unica) ? <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Campo label="Início do trabalho"><input required type="date" value={form.dataInicio} onChange={(e) => set("dataInicio", e.target.value)} style={campo} /></Campo>
          <Campo label="Fim planejado"><input required type="date" value={form.dataFim} onChange={(e) => set("dataFim", e.target.value)} style={campo} /></Campo>
          {form.tipo === "OBRIGACAO" && !unica && <Campo label="Vencimento fiscal"><input required type="date" value={form.dataVencimento} onChange={(e) => set("dataVencimento", e.target.value)} style={campo} /></Campo>}
        </div>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>Aparece em todos os dias, incluindo início, fim e fins de semana. {form.tipo === "TAREFA" ? "O fim planejado é o prazo da tarefa." : "O período de trabalho não altera o vencimento fiscal."}</p>
        {form.tipo === "OBRIGACAO" && form.dataFim > form.dataVencimento && <p role="status" style={{ margin: 0, color: "var(--state-warn)" }}>O fim planejado ultrapassa o vencimento fiscal de {fmt(form.dataVencimento)}.</p>}
      </> : <>
        {editando && <p style={{ margin: 0, color: "var(--text-muted)" }}>Esta edição atualiza as ocorrências pendentes e futuras. As concluídas mantêm seu histórico. Para ajustar apenas uma janela, use “Editar ocorrência” na lista.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Campo label="Dia do vencimento"><input required type="number" min="1" max="31" value={form.diaVencimento} onChange={(e) => set("diaVencimento", e.target.value)} style={campo} /></Campo>
          {form.periodicidade !== "MENSAL" && <Campo label={form.periodicidade === "ANUAL" ? "Mês" : "Primeiro mês do ciclo"}><select value={form.mesReferencia} onChange={(e) => set("mesReferencia", e.target.value)} style={campo}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(2026, i, 1))}</option>)}</select></Campo>}
          <Campo label="Janela de trabalho"><select value={form.janelaTrabalho ? "FIXA" : "RELATIVA"} onChange={e => set("janelaTrabalho", e.target.value === "FIXA" ? { modo: "DIAS_DO_CICLO", diaInicio: 10, diaFim: 15, deslocamentoFim: 0 } : null)} style={campo}><option value="RELATIVA">Dias antes do vencimento</option><option value="FIXA">Dias fixos de cada ciclo</option></select></Campo>
          {form.janelaTrabalho && <>
            <Campo label="Dia de início"><input required type="number" min="1" max="31" value={form.janelaTrabalho.diaInicio} onChange={e => set("janelaTrabalho", { ...form.janelaTrabalho, diaInicio: Number(e.target.value) })} style={campo} /></Campo>
            <Campo label="Dia de fim"><input required type="number" min="1" max="31" value={form.janelaTrabalho.diaFim} onChange={e => set("janelaTrabalho", { ...form.janelaTrabalho, diaFim: Number(e.target.value) })} style={campo} /></Campo>
            <Campo label="Mês do fim"><select value={form.janelaTrabalho.deslocamentoFim} onChange={e => set("janelaTrabalho", { ...form.janelaTrabalho, deslocamentoFim: Number(e.target.value) })} style={campo}><option value={0}>Mesmo mês</option><option value={1}>Mês seguinte</option></select></Campo>
          </>}
          {!form.janelaTrabalho && <Campo label="Dias corridos de preparação"><input required type="number" min="0" max="365" value={form.diasPreparacao} onChange={(e) => set("diasPreparacao", e.target.value)} style={campo} /></Campo>}
          <Campo label="Refere-se à competência de"><select value={form.defasagemMeses} onChange={(e) => set("defasagemMeses", e.target.value)} style={campo}>{[0, 1, 2, 3, 5, 12].map((n) => <option key={n} value={n}>{n ? `${n} mês(es) antes` : "Mesmo mês do vencimento"}</option>)}</select></Campo>
        </div>
        <Campo label="Se o vencimento cair em fim de semana ou feriado"><select value={form.ajusteDiaUtil} onChange={(e) => set("ajusteDiaUtil", e.target.value)} style={campo}>{Object.entries({ ANTECIPAR: "Antecipa para o dia útil anterior", POSTERGAR: "Adia para o próximo dia útil", MANTER: "Mantém a data, mesmo sem ser dia útil" }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
        <div style={{ padding: 12, background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)" }}>
          Próximos vencimentos: <strong>{previa.proximas.map(fmt).join(" · ") || "—"}</strong>
          {form.janelaTrabalho && <p>Todo ciclo: dia {form.janelaTrabalho.diaInicio} até dia {form.janelaTrabalho.diaFim}{form.janelaTrabalho.deslocamentoFim ? " do mês seguinte" : " do mesmo mês"}, incluindo fins de semana. Dia inexistente usa o último dia do mês. Vencimento fiscal independente.</p>}
          {!form.janelaTrabalho && previa.proximas[0] && <p>Primeira janela de preparação: {fmt(preparar(previa.proximas[0], form.diasPreparacao))} até {fmt(previa.proximas[0])}.</p>}
          {previa.jaVencida && <div>O vencimento deste mês ({fmt(previa.jaVencida)}) já passou.{podeMarcarVencido ? <label style={{ display: "flex", gap: 8, marginTop: 8 }}><input type="checkbox" checked={form.incluirVencidoDoMes} onChange={(e) => set("incluirVencidoDoMes", e.target.checked)} /><span>Registrar {fmt(previa.jaVencida)} como pendência em atraso — marque só se esta entrega realmente não foi feita.</span></label> : " Ele não vira pendência: a obrigação começa no próximo."}</div>}
          <p style={{ marginBottom: 0 }}>Estimativa: considera só fim de semana. Os feriados cadastrados entram quando o servidor gera os vencimentos.</p>
        </div>
      </>}
      {!unica && <>
        <Campo label="Descrição"><textarea rows={3} value={form.descricao} onChange={(e) => set("descricao", e.target.value)} style={campo} /></Campo>
        <Campo label="Avisar com antecedência de (dias)"><input type="number" min="0" max="90" value={form.antecedenciaLembreteDias} onChange={(e) => set("antecedenciaLembreteDias", e.target.value)} style={campo} /></Campo>
        {form.tipo === "OBRIGACAO" && !avulsa ? <Campo label="Concluir sozinha"><select value={form.verificador} onChange={(e) => set("verificador", e.target.value)} style={campo}><option value="">Eu marco quando concluir</option>{(opcoes?.verificadores || []).map((v) => <option key={v.chave} value={v.chave}>{v.rotulo}</option>)}</select></Campo> : <p style={{ margin: 0, color: "var(--text-muted)" }}>Conclusão manual: você marca quando o trabalho estiver concluído.</p>}
      </>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}><Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button><Button type="submit" variant="primary" disabled={salvando}>{salvando ? "Salvando…" : editando ? "Salvar" : form.tipo === "TAREFA" ? "Criar tarefa" : "Criar obrigação"}</Button></div>
    </form>
  </Modal>;
}
