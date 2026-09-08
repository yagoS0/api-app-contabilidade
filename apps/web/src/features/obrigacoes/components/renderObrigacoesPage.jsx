// Controle de Obrigações — o que o ESCRITÓRIO precisa entregar, em toda a carteira.
//
// Duas coisas que a tela precisa deixar óbvias sem legenda:
//
//  1. Obrigação NÃO é guia. Guia é o que o cliente paga; obrigação é o serviço que o contador faz.
//     Por isso esta tela não fala em valor, em pagamento nem em empresa devedora — fala em prazo.
//  2. Obrigação que se conclui SOZINHA não mostra botão de concluir. Mostrar um botão que o
//     backend recusa seria pior que não mostrar nada; no lugar dele vai a frase do que o sistema
//     observa. É a mesma ideia do calendário: agenda alimentada à mão envelhece.
//
// Visão do escritório por padrão, com filtro de empresa opcional — a pergunta é "o que eu preciso
// entregar", não "o que falta nesta empresa".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../components/layout/AppShell";
import { Button } from "../../../components/ui/Button";
import { BackButton } from "../../../components/ui/BackButton";
import { lerFalhaDeCarga, SEM_RESPOSTA } from "../../../lib/falhaDeCarga";
import { ModalObrigacao } from "./ModalObrigacao";
import { RegrasObrigacao } from "./renderRegrasObrigacao";

const COR = {
  fundo: "var(--bg-surface)", borda: "var(--border)", texto: "var(--text)", suave: "var(--text-muted)",
  pendente: "#8BE9FD", vencida: "#FF5757", concluida: "#50FA7B", alerta: "#FFB347",
  automatica: "#BD93F9",
};

const ROTULO_PERIODICIDADE = { AVULSA: "Uma vez", MENSAL: "Mensal", TRIMESTRAL: "Trimestral", ANUAL: "Anual" };

const fmtData = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
const ocorrenciasDoFiltro = (o, inicio, fim, situacao) => (o.ocorrencias || []).filter((oc) =>
  (!fim || (oc.dataInicio || oc.dataVencimento) <= fim)
  && (!inicio || (oc.dataFim || oc.dataVencimento) >= inicio)
  && (!situacao || oc.situacao === situacao));

function Selo({ cor, children, title }) {
  return (
    <span
      title={title}
      style={{
        fontSize: "0.7rem", fontWeight: 700, padding: "1px 8px", borderRadius: 999,
        border: `1px solid ${cor}`, color: cor, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * ⚠ O CARTÃO SABE DIZER QUE NÃO SABE.
 *
 * Ele mostrava `resumo.pendentes` de um objeto que nascia `{0, 0, 0}` quando a carga falhava: a
 * tela afirmava "0 pendentes · 0 vencendo · 0 vencidas" em corpo de 1.5rem sobre um servidor que
 * não respondeu. O contador lê os três números, conclui que está tudo em dia e fecha a página.
 *
 * Com `indisponivel`, o "—" ocupa exatamente o mesmo espaço do número (mesmo tamanho, mesma
 * altura de cartão — a recusa não pode encolher, senão o olho pula para os cartões que "têm"
 * número) e a legenda vermelha diz que houve falha de carga.
 */
function CartaoResumo({ rotulo, valor, cor, indisponivel, legenda, motivo }) {
  return (
    <div
      title={indisponivel ? motivo : undefined}
      style={{ flex: "1 1 140px", minWidth: 140, background: COR.fundo, border: `1px solid ${indisponivel ? COR.borda : cor}`, borderRadius: 8, padding: "10px 12px" }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: indisponivel ? COR.suave : cor, lineHeight: 1.1 }}>
        {indisponivel ? SEM_RESPOSTA : valor}
      </div>
      <div style={{ fontSize: "0.875rem", color: COR.suave }}>{rotulo}</div>
      {indisponivel && legenda && (
        // Vermelho só quando é FALHA — "carregando" não é bloqueio, e gastar a cor nele a esvazia.
        <div style={{ fontSize: "0.72rem", color: legenda.falhou ? COR.vencida : COR.suave, marginTop: 2 }}>
          {legenda.texto}
        </div>
      )}
    </div>
  );
}

const campo = {
  background: "var(--bg-page)", border: `1px solid ${COR.borda}`, borderRadius: 6,
  color: COR.texto, padding: "9px 10px", minHeight: 40, fontSize: "0.95rem", width: "100%", boxSizing: "border-box",
  colorScheme: "dark",
};
const rotuloTexto = { display: "block", fontSize: "0.875rem", color: COR.suave, marginBottom: 3 };

/**
 * Campo com o input DENTRO do label. Antes o label era irmão do input, e aí clicar no rótulo não
 * focava o campo nem associava os dois para leitor de tela. O resto do formulário do projeto
 * (renderCompanyForm) já envolve — isto só acompanha.
 */
function Campo({ label, children, largura }) {
  return (
    <label style={largura ? { gridColumn: largura } : undefined}>
      <span style={rotuloTexto}>{label}</span>
      {children}
    </label>
  );
}

export function ObrigacoesPage({ api, empresas = [], onBack, onBackLabel = "Voltar ao calendário", initialCompanyId = "", initialCreate = null, initialPeriod = null, initialOccurrenceId = null, onCreated, onViewDate }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);       // falha de AÇÃO (concluir, excluir)
  const [falha, setFalha] = useState(null);     // falha de CARGA — some com a lista, não com a ação
  const [aviso, setAviso] = useState(null);
  const [companyId, setCompanyId] = useState(initialCompanyId || initialCreate?.companyId || "");
  const [busca, setBusca] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("");
  const [modal, setModal] = useState(() => initialCreate ? { inicial: initialCreate } : null); // { inicial }
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState(null);
  const [verRegras, setVerRegras] = useState(false);
  const [salvoEm, setSalvoEm] = useState(null);
  const [periodoInicio, setPeriodoInicio] = useState(initialPeriod?.dataInicio || "");
  const [periodoFim, setPeriodoFim] = useState(initialPeriod?.dataFim || "");
  const [expandidas, setExpandidas] = useState({});
  const ocorrenciaAberta = useRef(null);
  const cargaId = useRef(0);

  const carregar = useCallback(async () => {
    if (!api) return;
    const id = ++cargaId.current;
    setCarregando(true);
    setDados(null);
    setErro(null);
    setFalha(null);
    try {
      const out = await api.listObrigacoes({ companyId: companyId || undefined });
      if (id !== cargaId.current) return;
      if (out?.ok === false) {
        setFalha(lerFalhaDeCarga(out, { assunto: "as obrigações" }));
        setDados(null);
      } else setDados(out);
    } catch (err) {
      if (id !== cargaId.current) return;
      setFalha(lerFalhaDeCarga(err, { assunto: "as obrigações" }));
      setDados(null);
    } finally { if (id === cargaId.current) setCarregando(false); }
  }, [api, companyId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!initialOccurrenceId || ocorrenciaAberta.current === initialOccurrenceId || !dados) return;
    const item = dados.obrigacoes?.find((o) => o.ocorrencias?.some((oc) => oc.ocorrenciaId === initialOccurrenceId));
    if (!item) return;
    ocorrenciaAberta.current = initialOccurrenceId;
    const oc = item.ocorrencias.find((entry) => entry.ocorrenciaId === initialOccurrenceId);
    if (oc.situacao === "CONCLUIDA") { setBusca(item.nome); return; }
    setModal({ inicial: item.periodicidade === "AVULSA" ? { ...item, dataInicio: oc.dataInicio, dataFim: oc.dataFim, dataVencimento: oc.dataVencimento } : { ...item, ...oc } });
  }, [dados, initialOccurrenceId]);

  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const obrigacoes = useMemo(() => {
    const lista = dados?.obrigacoes || [];
    const termo = busca.trim().toLowerCase();
    return lista.filter((o) => {
      if (termo && !`${o.nome} ${o.categoria || ""} ${o.empresa || ""}`.toLowerCase().includes(termo)) return false;
      if ((periodoInicio || periodoFim || filtroSituacao) && !ocorrenciasDoFiltro(o, periodoInicio, periodoFim, filtroSituacao).length) return false;
      return true;
    });
  }, [dados, busca, filtroSituacao, periodoInicio, periodoFim]);

  const categorias = useMemo(
    () => [...new Set((dados?.obrigacoes || []).map((o) => o.categoria).filter(Boolean))],
    [dados],
  );

  async function salvar(form) {
    setSalvando(true);
    setErroModal(null);
    try {
      const corpo = {
        nome: form.nome,
        tipo: form.tipo, descricao: form.descricao || null, diasPreparacao: Number(form.diasPreparacao),
        ...(form.periodicidade === "AVULSA" ? { dataInicio: form.dataInicio, dataFim: form.dataFim, dataVencimento: form.tipo === "TAREFA" ? form.dataFim : form.dataVencimento } : {}),
        categoria: form.categoria || null,
        periodicidade: form.periodicidade,
        diaVencimento: Number(form.diaVencimento),
        mesReferencia: form.periodicidade === "MENSAL" ? null : Number(form.mesReferencia),
        defasagemMeses: Number(form.defasagemMeses),
        antecedenciaLembreteDias: Number(form.antecedenciaLembreteDias),
        ajusteDiaUtil: form.ajusteDiaUtil,
        verificador: form.verificador || null,
      };
      const out = modal?.inicial?.ocorrenciaId
        ? await api.updateOcorrencia(modal.inicial.ocorrenciaId, { dataInicio: form.dataInicio, dataFim: form.dataFim })
        : modal?.inicial?.obrigacaoId
        ? await api.updateObrigacao(modal.inicial.obrigacaoId, corpo)
        // ⚠ Só no CADASTRO. `incluirVencidoDoMes` é a declaração de que o vencimento já passado
        // desta empresa é atraso de verdade; editar depois não pode fabricar pendência retroativa.
        : await api.createObrigacao(form.companyId, { ...corpo, incluirVencidoDoMes: form.incluirVencidoDoMes === true });
      if (out?.ok === false) { setErroModal(out.message || "Não foi possível salvar."); return; }
      setModal(null);
      const dataInicio = form.periodicidade === "AVULSA" || modal?.inicial?.ocorrenciaId ? form.dataInicio : out?.obrigacao?.ocorrencias?.[0]?.dataInicio;
      const dataFim = form.periodicidade === "AVULSA" || modal?.inicial?.ocorrenciaId ? form.dataFim : out?.obrigacao?.ocorrencias?.[0]?.dataFim;
      setSalvoEm(dataInicio ? { data: dataInicio, companyId: form.companyId } : null);
      onCreated?.({ out, companyId: form.companyId, dataInicio, dataFim });
      const ampliarInicio = dataInicio && periodoInicio && dataInicio < periodoInicio;
      const ampliarFim = dataFim && periodoFim && dataFim > periodoFim;
      if (ampliarInicio) setPeriodoInicio(dataInicio);
      if (ampliarFim) setPeriodoFim(dataFim);
      const limparFiltros = Boolean(filtroSituacao || busca.trim());
      if (limparFiltros) { setFiltroSituacao(""); setBusca(""); }
      // Diz o que aconteceu de fato, não um "salvo" liso: o número é a prova de que entrou no
      // calendário.
      setAviso(
        (out.ocorrenciasCriadas
          ? `Item salvo — ${out.ocorrenciasCriadas} ocorrência(s) no calendário.`
          : "Item salvo.") + (ampliarInicio || ampliarFim ? " O filtro de período foi ampliado para mostrar o item salvo." : "") + (limparFiltros ? " Busca e situação foram limpas para mostrar o item salvo." : ""),
      );
      if (form.companyId && form.companyId !== companyId) setCompanyId(form.companyId);
      else await carregar();
    } catch (err) {
      setErroModal(err?.message || "Não foi possível salvar.");
    } finally { setSalvando(false); }
  }

  async function concluir(ocorrenciaId) {
    try {
      const out = await api.concluirOcorrencia(ocorrenciaId);
      if (out?.ok === false) { setErro(out.message || "Não foi possível concluir."); return; }
      await carregar();
    } catch (err) { setErro(err?.message || "Não foi possível concluir."); }
  }

  async function excluir(o) {
    if (!window.confirm(`Excluir "${o.nome}"? Os vencimentos já concluídos também são apagados.`)) return;
    try {
      const out = await api.deleteObrigacao(o.obrigacaoId);
      if (out?.ok === false) { setErro(out.message || "Não foi possível excluir."); return; }
      setAviso(`"${o.nome}" removida.`);
      await carregar();
    } catch (err) { setErro(err?.message || "Não foi possível excluir."); }
  }

  // ⚠ SEM `dados` NÃO HÁ RESUMO — e o default `{0,0,0}` que morava aqui era a mentira inteira.
  const resumo = dados?.resumo || null;
  const resumoIndisponivel = !resumo;
  const motivoDoResumo = falha
    ? `${falha.titulo}. ${falha.motivo}`
    : carregando
      ? "Os números estão sendo carregados."
      : "Os números ainda não chegaram do servidor.";
  const legendaDoResumo = falha
    ? { falhou: true, texto: falha.semAcesso ? "sem acesso" : "não carregou" }
    : { falhou: false, texto: carregando ? "carregando…" : "sem resposta" };

  // Ao voltar das regras, recarrega: propagar cria e remove obrigações nas empresas, e a lista
  // atrás estaria desatualizada.
  if (verRegras) {
    return (
      <AppShell>
        <RegrasObrigacao
          api={api}
          empresas={empresas}
          onVoltar={() => { setVerRegras(false); carregar(); }}
        />
      </AppShell>
    );
  }

  // Página inteira (Configurações ▾ → Obrigações do escritório), não mais um bloco embutido no
  // dashboard — daí o AppShell aqui dentro, como nas outras páginas de topo.
  return (
    <AppShell>
    <section aria-label="Tarefas e obrigações">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {onBack && <BackButton onClick={onBack} label={onBackLabel} />}
        <h1 style={{ margin: 0, color: COR.texto, fontSize: "1.25rem" }}>Tarefas e obrigações</h1>
        <span style={{ color: COR.suave, fontSize: "0.875rem" }}>
          organize o trabalho e acompanhe os prazos
        </span>
        {carregando && <span style={{ color: COR.suave, fontSize: "0.875rem" }}>carregando…</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={() => setVerRegras(true)}>Regras e recorrências</Button>
          <Button variant="primary" onClick={() => { setErroModal(null); setModal({ inicial: { companyId } }); }}>
            + Nova tarefa ou obrigação
          </Button>
        </div>
      </div>

      {erro && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: "1px solid var(--danger)", color: "var(--danger)", marginBottom: 12, fontSize: "0.82rem" }}>
          {erro}
        </div>
      )}
      {aviso && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(80,250,123,0.10)", border: `1px solid ${COR.concluida}`, color: COR.concluida, marginBottom: 12, fontSize: "0.82rem" }}>
          {aviso}
        </div>
      )}

      {salvoEm && onViewDate && <div style={{ marginBottom: 14 }}><Button variant="secondary" onClick={() => onViewDate(salvoEm.data, salvoEm.companyId)}>Ver no calendário · {fmtData(salvoEm.data)}</Button></div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <CartaoResumo
          rotulo="Pendentes" valor={resumo?.pendentes} cor={COR.pendente}
          indisponivel={resumoIndisponivel} legenda={legendaDoResumo} motivo={motivoDoResumo}
        />
        <CartaoResumo
          rotulo="Vencendo em 7 dias" valor={resumo?.vencendoEm7Dias} cor={COR.alerta}
          indisponivel={resumoIndisponivel} legenda={legendaDoResumo} motivo={motivoDoResumo}
        />
        <CartaoResumo
          rotulo="Vencidas" valor={resumo?.vencidas} cor={COR.vencida}
          indisponivel={resumoIndisponivel} legenda={legendaDoResumo} motivo={motivoDoResumo}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          aria-label="Buscar tarefas e obrigações" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, categoria ou empresa"
          style={{ ...campo, width: "auto", minWidth: 260, flex: "1 1 260px" }}
        />
        <select aria-label="Filtrar empresa" value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={{ ...campo, width: "auto" }}>
          <option value="">Todas as empresas</option>
          {empresas.map((e) => <option key={e.companyId} value={e.companyId}>{e.razao}</option>)}
        </select>
        <select aria-label="Filtrar situação" value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value)} style={{ ...campo, width: "auto" }}>
          <option value="">Toda situação</option>
          <option value="PENDENTE">Só pendentes</option>
          <option value="VENCIDA">Só vencidas</option>
          <option value="CONCLUIDA">Com ocorrências concluídas</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Campo label="Período a partir de"><input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} style={campo} /></Campo>
        <Campo label="Período até"><input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} style={campo} /></Campo>
        {(periodoInicio || periodoFim) && <Button variant="secondary" onClick={() => { setPeriodoInicio(""); setPeriodoFim(""); }}>Limpar período</Button>}
      </div>
      <datalist id="categorias-obrigacao">
        {categorias.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* ⚠ TRÊS ESTADOS, TRÊS PAINÉIS. Antes eram um: carga falhada saía como "Nenhuma obrigação
          cadastrada." — a tela afirmando sobre a carteira inteira uma coisa que ela não sabe. */}
      {!carregando && falha && (
        <div
          role="alert"
          style={{ padding: "24px 16px", textAlign: "center", background: COR.fundo, border: `2px solid ${falha.semAcesso ? COR.borda : COR.vencida}`, borderRadius: 8 }}
        >
          <div style={{ color: falha.semAcesso ? COR.texto : COR.vencida, fontWeight: 700, fontSize: "1rem", marginBottom: 4 }}>
            {falha.titulo}
          </div>
          <div style={{ color: COR.texto, fontSize: "0.8rem", marginBottom: 4 }}>{falha.motivo}</div>
          <div style={{ color: COR.suave, fontSize: "0.875rem", marginBottom: 10 }}>
            Isto não quer dizer que não há obrigações — quer dizer que esta tela não conseguiu vê-las.
          </div>
          <Button variant="secondary" onClick={carregar}>Tentar de novo</Button>
        </div>
      )}

      {!carregando && !falha && !obrigacoes.length && (
        <div style={{ padding: "28px 16px", textAlign: "center", background: COR.fundo, border: `1px dashed ${COR.borda}`, borderRadius: 8 }}>
          <div style={{ color: COR.texto, fontWeight: 600, marginBottom: 4 }}>
            {dados?.obrigacoes?.length ? "Nada com esses filtros." : "Nenhuma tarefa ou obrigação cadastrada."}
          </div>
          <div style={{ color: COR.suave, fontSize: "0.8rem" }}>
            {dados?.obrigacoes?.length
              ? "Limpe a busca ou troque a empresa."
              : "Cadastre a primeira e ela aparece no calendário."}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {obrigacoes.map((o) => {
          const ocorrencias = ocorrenciasDoFiltro(o, periodoInicio, periodoFim, filtroSituacao);
          if (!ocorrencias.length && (periodoInicio || periodoFim || filtroSituacao)) return null;
          const proxima = ocorrencias.find((oc) => oc.situacao !== "CONCLUIDA") || null;
          const exibidas = expandidas[o.obrigacaoId] ? ocorrencias : [proxima || ocorrencias[0]].filter(Boolean);
          const situacao = proxima?.situacao || "CONCLUIDA";
          const corSituacao =
            situacao === "VENCIDA" ? COR.vencida : situacao === "CONCLUIDA" ? COR.concluida : COR.pendente;
          return (
            <article
              key={o.obrigacaoId}
              style={{ background: COR.fundo, border: `1px solid ${COR.borda}`, borderRadius: 8, padding: "10px 12px" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: o.cor || corSituacao, flex: "0 0 auto" }} />
                <strong style={{ color: COR.texto, fontSize: "0.92rem" }}>{o.nome}</strong>
                <Selo cor={COR.suave}>{o.tipo === "TAREFA" ? "Tarefa" : "Obrigação"}</Selo>
                <Selo cor={COR.suave}>{ROTULO_PERIODICIDADE[o.periodicidade] || o.periodicidade}</Selo>
                {o.categoria && <Selo cor={COR.suave}>{o.categoria}</Selo>}
                {!companyId && o.empresa && (
                  <span style={{ color: COR.suave, fontSize: "0.875rem" }}>· {o.empresa}</span>
                )}
                {o.conclusaoAutomatica && (
                  <Selo cor={COR.automatica} title="O sistema conclui sozinho ao observar o serviço feito">
                    automática
                  </Selo>
                )}

                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Selo
                    cor={corSituacao}
                    title={
                      situacao === "VENCIDA" ? `Venceu em ${fmtData(proxima.dataVencimento)} e não foi concluída`
                        : situacao === "CONCLUIDA" ? "Nenhum vencimento pendente"
                        : `Vence em ${fmtData(proxima.dataVencimento)}`
                    }
                  >
                    {situacao === "VENCIDA" ? `Vencida · ${fmtData(proxima.dataVencimento)}`
                      : situacao === "CONCLUIDA" ? "Em dia"
                      : `Vence ${fmtData(proxima.dataVencimento)}`}
                  </Selo>
                  {/* Sem botão quando a conclusão é automática: oferecer um clique que o backend
                      recusa é pior que não oferecer nada. */}
                  {proxima && !o.conclusaoAutomatica && (
                    <Button variant="secondary" onClick={() => concluir(proxima.ocorrenciaId)}>✓ Concluir</Button>
                  )}
                  {!(o.periodicidade === "AVULSA" && o.ocorrencias?.some((oc) => oc.situacao === "CONCLUIDA")) && <Button variant="secondary" onClick={() => { setErroModal(null); const oc = o.ocorrencias?.[0]; setModal({ inicial: o.periodicidade === "AVULSA" && oc ? { ...o, dataInicio: oc.dataInicio || o.dataInicio, dataFim: oc.dataFim || o.dataFim, dataVencimento: oc.dataVencimento || o.dataVencimento } : o }); }}>{o.periodicidade === "AVULSA" ? "Editar" : "Editar recorrência"}</Button>}
                  <Button variant="secondary" onClick={() => excluir(o)}>Excluir</Button>
                </div>
              </div>

              {o.descricao && <p style={{ color: COR.suave, margin: "8px 0" }}>{o.descricao}</p>}
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {exibidas.map((oc) => <div key={oc.ocorrenciaId} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${COR.borda}` }}>
                  <div style={{ flex: "1 1 260px", fontSize: "0.875rem" }}>Trabalho: {fmtData(oc.dataInicio || oc.dataVencimento)} até {fmtData(oc.dataFim || oc.dataVencimento)}<br /><span style={{ color: COR.suave }}>{o.tipo === "TAREFA" ? "Prazo da tarefa" : "Vencimento fiscal"}: {fmtData(oc.dataVencimento)} · {oc.situacao === "CONCLUIDA" ? "Concluída" : oc.situacao === "VENCIDA" ? "Vencida" : "Pendente"}</span></div>
                  {onViewDate && <Button variant="secondary" onClick={() => onViewDate(oc.dataInicio || oc.dataVencimento, o.companyId)}>Ver no calendário</Button>}
                  {oc.situacao !== "CONCLUIDA" && o.periodicidade !== "AVULSA" && <Button variant="secondary" onClick={() => { setErroModal(null); setModal({ inicial: { ...o, ...oc } }); }}>Editar ocorrência</Button>}
                  {oc.situacao !== "CONCLUIDA" && !o.conclusaoAutomatica && oc !== proxima && <Button variant="secondary" onClick={() => concluir(oc.ocorrenciaId)}>Concluir ocorrência</Button>}
                </div>)}
                {ocorrencias.length > 1 && <div><Button variant="secondary" aria-expanded={Boolean(expandidas[o.obrigacaoId])} onClick={() => setExpandidas((atual) => ({ ...atual, [o.obrigacaoId]: !atual[o.obrigacaoId] }))}>{expandidas[o.obrigacaoId] ? "Recolher ocorrências" : `Ver todas as ${ocorrencias.length} ocorrências`}</Button></div>}
              </div>
              <div style={{ marginTop: 4, fontSize: "0.875rem", color: COR.suave }}>
                {proxima?.competenciaRef && <>competência {proxima.competenciaRef} · </>}
                {o.conclusaoAutomatica
                  ? "conclui sozinha quando o serviço for observado pelo sistema"
                  : `você marca quando concluir · avisa ${o.antecedenciaLembreteDias} dia(s) antes`}
              </div>
            </article>
          );
        })}
      </div>

      {modal && (
        <ModalObrigacao
          empresas={empresas}
          opcoes={dados?.opcoes}
          inicial={modal.inicial}
          salvando={salvando}
          erro={erroModal}
          onFechar={() => setModal(null)}
          onSalvar={salvar}
        />
      )}
    </section>
    </AppShell>
  );
}
