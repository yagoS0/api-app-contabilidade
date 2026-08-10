import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../../../../api/client";
import { Button } from "../../../../components/ui/Button";
import { HistoricosModal } from "../../historicos/components/renderHistoricosModal";
import { ImportOFXModal } from "../../ofx-import/components/renderImportOfxModal";
import { ImportExcelModal } from "../../excel-import/components/renderImportExcelModal";
import { AccountRow, DraftEntryRow } from "./renderAccountingEntriesParts";
import { ACCOUNTING_PANEL, COLS, ORIGEM_LABELS, STATUS_LABELS, TIPO_LABELS, TIPO_GROUP_ORDER, TIPO_GROUP_LABELS, TIPO_GROUP_ACCENT, fmtValor, formatCompetenciaTitulo } from "../lib/accountingEntriesShared";
import { PayrollEntryModal, CsvExportModal } from "./renderAccountingEntriesParts";
import { FunctionListModal, FunctionEditModal, FunctionApplyModal } from "../../functions/components/AccountingFunctionModals";
import { ParcelamentoCreateModal } from "../../parcelamento/components/ParcelamentoModals";

const fechamentoApi = createApiClient();

// Q18: fechamento contábil compacto — um CADEADO que abre/fecha a empresa no mês.
// 🔒 fechada (clica → reabre) · 🔓 aberta (clica → fecha; bloqueado se houver pendência).
// Checklist de conferência do mês: cada item é uma confirmação MANUAL do contador (o sistema não
// tem como saber se "todas as despesas do mês entraram"). Todos precisam estar marcados pra fechar.
// A ordem aqui é a ordem exibida. As chaves batem com o CHECKLIST_FECHAMENTO do backend.
const CHECKLIST_ITENS = [
  { chave: "folhaProlabore", label: "Folha/Pró-labore", title: "Confirme que a folha e o pró-labore do mês foram lançados." },
  { chave: "despesas",       label: "Despesas",         title: "Confirme que as despesas do mês foram lançadas." },
  { chave: "receitas",       label: "Receitas",         title: "Confirme que as receitas do mês foram lançadas." },
  { chave: "provisoes",      label: "Provisões",        title: "Confirme que as provisões do mês foram lançadas." },
  { chave: "pagamentos",     label: "Pagamentos",       title: "Confirme que os pagamentos do mês foram lançados." },
];

/** Número → "R$ 18.500,75". Serve só para o aviso da recusa; nulo vira string vazia. */
function fmtMoedaCurta(v) {
  if (v == null) return "";
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

/** ISO → "12/05/2026 14:31". Sem data conhecida devolve "data desconhecida", nunca "Invalid Date". */
function fmtDataHora(iso) {
  if (!iso) return "data desconhecida";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "data desconhecida";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Leva o olho até o lançamento com problema e o marca por um instante. Rolar sem marcar deixa o
 * contador procurando qual das linhas da tela era a errada.
 */
function irAteOLancamento(id) {
  rolarAteEDestacar(`lanc-${id}`);
}

/** Rola até um `id` do DOM e o marca por ~2s. Elemento ausente = não faz nada (nunca rola errado). */
function rolarAteEDestacar(domId) {
  const el = document.getElementById(domId);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  const antes = el.style.outline;
  el.style.outline = "2px solid #FFB347";
  el.style.outlineOffset = "-2px";
  window.setTimeout(() => { el.style.outline = antes; }, 2200);
}

/**
 * O que falta para fechar, SEM precisar clicar no cadeado e levar um alerta.
 *
 * As duas listas já existiam dentro do cadeado — viravam `title` e `window.alert`, ou seja, só
 * apareciam para quem já suspeitava. Aqui elas ficam à vista, e cada lançamento com problema leva
 * até a linha.
 *
 * ⚠ `problemas` é conferência do LADO DO CLIENTE sobre os lançamentos carregados. Com filtro de
 * tipo/origem/status ativo, o servidor enxerga mais do que esta tela — por isso o aviso.
 */
function FaltaParaFechar({ problemas, filtroAtivo }) {
  const [aberto, setAberto] = useState(false);
  if (!problemas.length) return null;
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end",
      fontSize: "0.76rem", color: "#FFB347", maxWidth: 560, textAlign: "right",
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <strong style={{ color: "#FFB347" }}>Falta para fechar:</strong>
        {/* ⚠ As pendências do CHECK-LIST saíram daqui — hoje elas são o texto do próprio botão
            ("Fechar mês — Faltam: Provisões, Pagamentos"), e a mesma frase duas vezes a 40px de
            distância faz procurar a diferença entre elas. O que sobra aqui é o que o botão NÃO
            consegue dizer: a lista de lançamentos com problema, cada um clicável até a linha. */}
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          style={{ background: "transparent", border: "none", color: "var(--state-danger)", font: "inherit", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
        >
          {problemas.length} lançamento{problemas.length > 1 ? "s" : ""} com problema {aberto ? "▴" : "▾"}
        </button>
      </div>
      {aberto && (
        <ul style={{ listStyle: "none", margin: 0, padding: "6px 10px", background: "#24253A", border: "1px solid #44475A", borderRadius: 8, maxHeight: 180, overflowY: "auto", width: "100%" }}>
          {problemas.map((p) => (
            <li key={p.id} style={{ padding: "2px 0" }}>
              <button
                type="button"
                onClick={() => irAteOLancamento(p.id)}
                style={{ background: "transparent", border: "none", color: "#F8F8F2", font: "inherit", cursor: "pointer", textAlign: "right", width: "100%" }}
                title="Ir até o lançamento"
              >
                {p.historico || p.id} — <span style={{ color: "#FF5757" }}>{p.motivo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {filtroAtivo && (
        <span style={{ color: "#8A8FA3" }}>
          conferido só sobre os lançamentos filtrados — limpe os filtros para ver o mês inteiro
        </span>
      )}
    </div>
  );
}

function FechamentoCadeado({ companyId, competencia, entries, onState, onFechamentoData, filtroAtivo }) {
  const [fechado, setFechado] = useState(false);
  const [fechadoEm, setFechadoEm] = useState(null);
  const [fechadoPorNome, setFechadoPorNome] = useState(null);
  const [busy, setBusy] = useState(false);
  // Checklist (Q47 + Lote C): { folhaProlabore, despesas, receitas, provisoes, pagamentos }
  const [checklist, setChecklist] = useState({});
  const [checkBusy, setCheckBusy] = useState(null); // chave em gravação
  // "Mês sem faturamento" NÃO é um sexto item do checklist: o checklist confirma que algo FOI
  // lançado; isto afirma que algo NÃO EXISTIU. Por isso vive à parte, com estado próprio.
  const [semFaturamento, setSemFaturamento] = useState(false);
  const [faturamentoEmit, setFaturamentoEmit] = useState(null);
  const [semFatBusy, setSemFatBusy] = useState(false);
  // Segunda fonte do faturamento: { status: "ok"|"divergente"|"nao_conferivel"|null, em }.
  const [conferenciaAdn, setConferenciaAdn] = useState(null);

  const problemas = useMemo(() => {
    const out = [];
    // Q24/Q52: lançamentos individuais (1 perna) de parcelamento e de folha/pró-labore
    // balanceiam em GRUPO (parcelamentoId / loteImportacao "FOLHA-"/"PROLABORE-"), não por lançamento.
    const grupos = new Map();
    for (const e of entries || []) {
      if (String(e.tipo || "").toUpperCase() === "PARCELA") continue;
      const lines = e.lines || [];
      if (lines.length === 0) { out.push({ id: e.id, historico: e.historico, motivo: "em branco" }); continue; }
      if (lines.some((l) => !String(l.conta || "").trim())) { out.push({ id: e.id, historico: e.historico, motivo: "conta em branco" }); continue; }
      const folhaLote = String(e.tipo || "").toUpperCase() === "FOLHA" && /^(FOLHA|PROLABORE)-/.test(String(e.loteImportacao || ""));
      const groupKey = e.parcelamentoId || (folhaLote ? e.loteImportacao : null);
      const d = lines.filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
      const c = lines.filter((l) => String(l.tipo).toUpperCase() === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
      if (groupKey) {
        const g = grupos.get(groupKey) || { d: 0, c: 0, historico: e.historico };
        g.d += d; g.c += c;
        grupos.set(groupKey, g);
        continue;
      }
      if (Math.abs(d - c) > 0.01) out.push({ id: e.id, historico: e.historico, motivo: "D≠C" });
    }
    for (const [key, g] of grupos) {
      if (Math.abs(g.d - g.c) > 0.01) out.push({ id: key, historico: g.historico, motivo: "grupo D≠C" });
    }
    return out;
  }, [entries]);

  useEffect(() => {
    let alive = true;
    if (!companyId || !competencia) return undefined;
    fechamentoApi.getFechamentoContabil(companyId, competencia)
      .then((r) => {
        if (!alive) return;
        setFechado(Boolean(r?.fechado));
        setFechadoEm(r?.fechadoEm || null);
        setFechadoPorNome(r?.fechadoPorNome || null);
        // `checklist` é o formato novo; o fallback cobre um backend ainda sem ele (só a folha).
        setChecklist(r?.checklist || { folhaProlabore: r?.folhaProlaboreOk === true });
        setSemFaturamento(r?.semFaturamento === true);
        setFaturamentoEmit(r?.faturamentoEmit ?? null);
        setConferenciaAdn(r?.conferenciaAdn || null);
        onState?.(Boolean(r?.fechado));
        // Payload inteiro para quem precisa de mais que o booleano de fechado — hoje, o menu do
        // SERPRO, que lê `r.serpro` para avisar "já buscado em <data>" ANTES de gastar de novo.
        // Callback separado de propósito: `onState` também é chamado pelo `toggle()`, sem payload.
        onFechamentoData?.(r || null);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, competencia]);

  async function toggle() {
    if (busy) return;
    if (fechado) {
      // ⚠ Reabrir passa por confirmação. Reabrir é o que destrava a escrita num mês já entregue —
      // as buscas do SERPRO e o "+ Adicionar" respondem a este estado — e não tinha nem um "tem
      // certeza?", enquanto EXCLUIR um lançamento tinha. O peso estava invertido.
      const quando = fechadoEm ? ` (fechado em ${fmtDataCurta(fechadoEm)})` : "";
      if (!window.confirm(`Reabrir ${competencia}${quando}?\n\nO mês volta a aceitar lançamentos e buscas no SERPRO.`)) return;
      setBusy(true);
      try {
        await fechamentoApi.reabrirFechamentoContabil(companyId, competencia);
        setFechado(false); setFechadoEm(null); setFechadoPorNome(null); onState?.(false);
      } catch (e) { window.alert(e?.message || "Falha ao reabrir."); }
      finally { setBusy(false); }
      return;
    }
    // ⚠ Os dois alertas que ficavam aqui SUMIRAM. O motivo do bloqueio agora está no painel ANTES
    // do clique (`FaltaParaFechar` + o botão desabilitado que nomeia o que falta): alerta é a
    // resposta chegando depois da tentativa, para quem já suspeitava. O botão nem chega a chamar.
    if (problemas.length > 0 || pendentes.length > 0) return;
    setBusy(true);
    try {
      const r = await fechamentoApi.fecharFechamentoContabil(companyId, competencia);
      setFechado(true);
      setFechadoEm(r?.fechadoEm || new Date().toISOString());
      setFechadoPorNome(r?.fechadoPorNome || null);
      onState?.(true);
    } catch (e) { window.alert(e?.message || "Falha ao fechar."); }
    finally { setBusy(false); }
  }

  async function toggleItem(chave) {
    if (checkBusy || fechado) return;
    const next = !checklist[chave];
    setCheckBusy(chave);
    try {
      await fechamentoApi.setChecklistFechamento(companyId, competencia, chave, next);
      setChecklist((prev) => ({ ...prev, [chave]: next }));
    } catch (e) { window.alert(e?.message || "Falha ao salvar a conferência."); }
    finally { setCheckBusy(null); }
  }

  async function toggleSemFaturamento() {
    if (semFatBusy || fechado) return;
    const next = !semFaturamento;
    setSemFatBusy(true);
    try {
      const r = await fechamentoApi.setSemFaturamento(companyId, competencia, next);
      // A recusa vem do servidor (409 / ok:false) e traz o valor — mostrar o número é o que faz o
      // contador entender que não é capricho da tela.
      if (r?.ok === false) { window.alert(r.message || "Não foi possível marcar."); return; }
      setSemFaturamento(next);
    } catch (e) { window.alert(e?.message || "Não foi possível marcar."); }
    finally { setSemFatBusy(false); }
  }

  const temFaturamento = Number(faturamentoEmit || 0) > 0;
  // Zero de faturamento e "não conseguimos ver o faturamento" são a MESMA leitura na tela. Quando
  // o ADN não confirmou, o contador precisa saber que está afirmando por conta própria — o
  // servidor aceita, mas grava que aceitou sem conferir.
  const statusConferencia = String(conferenciaAdn?.status || "");
  const conferenciaDivergente = statusConferencia === "divergente";
  const semConferencia = !fechado && !temFaturamento && !conferenciaDivergente && statusConferencia !== "ok";

  const pendentes = CHECKLIST_ITENS.filter((i) => checklist[i.chave] !== true);
  const bloqueadoPorChecklist = !fechado && pendentes.length > 0;
  const color = fechado ? "#2DD4BF" : (problemas.length > 0 || bloqueadoPorChecklist) ? "#FF5757" : "#69FF47";

  // ⚠ O MOTIVO DO BLOQUEIO É TEXTO NO BOTÃO, não `title`.
  // `title` só existe depois de parar o mouse em cima — quem clica direto recebia um `window.alert`
  // com a resposta que a tela já tinha. E `problemas` nem desabilitava o botão: ele parecia
  // clicável, era clicado, e respondia com alerta. Agora os dois bloqueiam igual e se explicam.
  const motivoBloqueio = fechado
    ? null
    : problemas.length > 0
      ? `${problemas.length} lançamento${problemas.length > 1 ? "s" : ""} com problema`
      : pendentes.length > 0
        ? `Faltam: ${pendentes.map((p) => p.label).join(", ")}`
        : null;
  const btnDisabled = busy || Boolean(motivoBloqueio);
  const title = fechado
    ? `Mês fechado. Clique para reabrir — o mês volta a aceitar lançamentos.`
    : motivoBloqueio
      ? `${motivoBloqueio} — resolva antes de fechar ${competencia}.`
      : `Pronta para fechar (${competencia}).`;
  return (
    /* ⚠ UM PAINEL, NÃO TRÊS PEÇAS SOLTAS NUMA LINHA.
        O alternador de faturamento, o check-list e o cadeado eram três elementos independentes num
        `inline-flex` com `wrap`. Quando o check-list virou card (uma linha por item), a linha
        estourou: o card ia parar no meio da tela com um vão à direita, o botão caía sozinho embaixo
        e nada mais dizia que as três coisas eram O MESMO ASSUNTO. Agora são um bloco fechado, com
        título, largura fixa e o botão no rodapé — que é o que "check-list como painel" queria dizer.

        ⚠ Sem `inline-flex` e sem `flexWrap`: com largura fixa não há o que quebrar, e foi a quebra
        que produziu o layout torto. */
    <div
      style={{
        // A largura é da COLUNA que o hospeda, não do painel: assim ele acompanha quando a linha
        // quebra no estreito, sem um segundo número para sincronizar.
        display: "flex", flexDirection: "column", gap: 6,
        width: "100%", padding: "8px 8px",
        borderRadius: 12, border: `1px solid ${ACCOUNTING_PANEL.border}`, background: ACCOUNTING_PANEL.surface,
        boxSizing: "border-box",
      }}
    >
      {/* Só "FECHAMENTO": a competência já está escrita no seletor do header E no título grande
          sobre a tabela, a poucos centímetros. Uma terceira vez não informa — só ocupa a largura
          que a tabela precisa. */}
      <span style={{ fontSize: "0.68rem", color: "#8A8FA3", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        Fechamento
      </span>

      {/* Separado do "Confiro que lancei" de propósito: aquilo confirma que algo FOI lançado,
          isto afirma que algo NÃO EXISTIU. Misturar os dois faria parecer um sexto item de
          conferência — e o contador marcaria sem pensar no que está declarando. */}
      {!fechado && (
        <label
          title={
            temFaturamento
              ? `A competência tem ${fmtMoedaCurta(faturamentoEmit)} em notas emitidas — não dá para marcar sem faturamento.`
              : conferenciaDivergente
                ? "A conferência contra o ADN está divergente: o ADN tem nota que não temos. Resolva antes de afirmar que o mês não teve faturamento."
                : semConferencia
                  ? "Não conseguimos conferir esta competência contra o ADN — marcar aqui é uma afirmação sua, e fica registrada como tal."
                  : "Afirma que a competência não teve faturamento. Folha, despesas e parcelas seguem normais."
          }
          style={{
            display: "flex", alignItems: "flex-start", gap: 5, fontSize: "0.72rem", fontWeight: 600,
            padding: "5px 6px", borderRadius: 8,
            border: `1px solid ${semFaturamento ? "#FFB347" : conferenciaDivergente ? "#FF5757" : ACCOUNTING_PANEL.border}`,
            background: ACCOUNTING_PANEL.field,
            color: semFaturamento ? "#FFB347" : (temFaturamento || conferenciaDivergente) ? "#6272A4" : "#aeb6d3",
            cursor: semFatBusy || temFaturamento || conferenciaDivergente ? "not-allowed" : "pointer", userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={semFaturamento}
            // Divergência desabilita como o faturamento desabilita: nos dois casos há EVIDÊNCIA
            // contra a afirmação, e a recusa viria do servidor de qualquer jeito.
            disabled={semFatBusy || ((temFaturamento || conferenciaDivergente) && !semFaturamento)}
            onChange={toggleSemFaturamento}
            style={{ width: 13, height: 13, flex: "0 0 auto", marginTop: 1, cursor: semFatBusy || temFaturamento || conferenciaDivergente ? "not-allowed" : "pointer" }}
          />
          {/* ⚠ A ressalva vai para a LINHA DE BAIXO, não emendada no rótulo. Com `nowrap` num pill,
              "Mês sem faturamento · sem conferência do ADN" era uma tira de ~300px que sozinha
              estourava a largura da linha — foi ela quem começou a quebra do layout. */}
          <span style={{ display: "grid", gap: 1 }}>
            <span>Mês sem faturamento</span>
            {/* Não conseguimos conferir ≠ conferimos e deu zero. O aviso é o que separa os dois. */}
            {semConferencia && (
              <span style={{ color: "#8A8FA3", fontWeight: 400, fontSize: "0.72rem" }} title="Município fora do ADN, certificado ausente/vencido ou competência ainda não conferida.">
                sem conferência do ADN
              </span>
            )}
            {conferenciaDivergente && (
              <span style={{ color: "#FF5757", fontWeight: 400, fontSize: "0.72rem" }}>conferência divergente</span>
            )}
          </span>
        </label>
      )}
      {/* ⚠ O CHECKLIST VIROU PAINEL — uma linha por item, não cinco caixas soltas em fila.
          Em fila horizontal os cinco rótulos brigavam por espaço com o alternador de faturamento e
          com o cadeado, e nada dizia que eram confirmações do contador (pareciam filtros). Em
          linhas, cada item tem rótulo, estado e espaço para dizer de onde veio o check. */}
      {!fechado && (
        <div style={{ display: "grid", gap: 2 }}>
          {/* Sem caixa própria: o card externo já delimita o assunto, e uma borda dentro da outra
              lia como um segundo painel independente. */}
          <span style={{ fontSize: "0.7rem", color: "#8A8FA3", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 2 }}>
            Confiro que lancei
          </span>
          {CHECKLIST_ITENS.map((item) => {
            const marcado = checklist[item.chave] === true;
            const gravando = checkBusy === item.chave;
            return (
              <label
                key={item.chave}
                title={item.title}
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "2px 0",
                  fontSize: "0.72rem", fontWeight: 600,
                  color: marcado ? "#69FF47" : "#aeb6d3",
                  cursor: gravando ? "default" : "pointer", userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  disabled={Boolean(checkBusy)}
                  onChange={() => toggleItem(item.chave)}
                  /* 13px: o padrão do browser (~16px) somava 3px de largura por linha num painel
                     de 152px — e a caixa continua confortável de acertar com o mouse. */
                  style={{ width: 13, height: 13, flex: "0 0 auto", cursor: gravando ? "default" : "pointer" }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
                {gravando && <span style={{ fontSize: "0.66rem", color: "#8A8FA3", fontWeight: 400 }}>…</span>}
              </label>
            );
          })}
        </div>
      )}

      {/* Selo do mês fechado: QUANDO e por QUEM. Os dois já vinham do backend e a tela descartava —
          sobrava um "🔒 Fechada" que não dizia se o fechamento foi ontem ou em março. */}
      {fechado && (
        <span style={{ display: "grid", gap: 2, fontSize: "0.78rem", color: "#2DD4BF", fontWeight: 600 }}>
          <span>✓ Mês fechado</span>
          {(fechadoEm || fechadoPorNome) && (
            <span style={{ color: "#aeb6d3", fontWeight: 400, fontSize: "0.72rem" }}>
              {fechadoEm ? `em ${fmtDataCurta(fechadoEm)}` : ""}
              {fechadoEm && fechadoPorNome ? " · " : ""}
              {fechadoPorNome ? `por ${fechadoPorNome}` : ""}
            </span>
          )}
        </span>
      )}

      {/* Rodapé: só o botão.
          ⚠ A LINHA "Faltam: Folha/Pró-labore, Despesas, …" SAIU, e não é perda de informação —
          é o fim de uma repetição. Os itens que faltam são exatamente as caixas DESMARCADAS logo
          acima, a três centímetros de distância: escrever os mesmos cinco nomes de novo, em
          vermelho, era a lista mais comprida do painel dizendo o que o painel inteiro já mostrava.
          O motivo continua acessível no `title` do botão para quem não fizer a ligação. */}
      <div style={{ display: "grid", gap: 5, marginTop: 2 }}>
        <button
          type="button"
          onClick={toggle}
          disabled={btnDisabled}
          title={title}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
            width: "100%", padding: "6px 8px",
            borderRadius: 8, cursor: btnDisabled ? "not-allowed" : "pointer", fontSize: "0.76rem", fontWeight: 700,
            background: "transparent", color, border: `1px solid ${color}`, opacity: btnDisabled ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: "0.9rem" }}>{fechado ? "🔒" : "🔓"}</span>
          {fechado ? "Reabrir" : "Fechar mês"}
        </button>
        {/* Lançamento com problema NÃO sai: ele não está visível em lugar nenhum do painel, e cada
            item leva até a linha da tabela. É informação que só existe aqui. */}
        {!fechado && <FaltaParaFechar problemas={problemas} filtroAtivo={filtroAtivo} />}
      </div>
    </div>
  );
}

/** Data ISO → "05/08/2026". Vazio vira string vazia — nunca "Invalid Date" na tela. */
function fmtDataCurta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

function ActionMenu({ label, items, accent }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const triggerStyle = {
    minHeight: 33,
    padding: "8px 14px",
    borderRadius: 16,
    border: `1px solid ${accent ? accent : ACCOUNTING_PANEL.border}`,
    background: accent ? accent : ACCOUNTING_PANEL.surface,
    color: accent ? "#1A1B26" : ACCOUNTING_PANEL.text,
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  };
  const menuStyle = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    minWidth: 200,
    background: "#1A1B26",
    border: "1px solid #44475A",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    padding: 6,
    zIndex: 50,
  };
  const itemStyle = {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    color: ACCOUNTING_PANEL.text,
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.8125rem",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={triggerStyle} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div role="menu" style={menuStyle}>
          {items.filter(Boolean).map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick?.(); }}
              disabled={it.disabled}
              style={{
                ...itemStyle,
                opacity: it.disabled ? 0.5 : 1,
                cursor: it.disabled ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = ACCOUNTING_PANEL.surface; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {it.label}
              {it.hint && <div style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted, marginTop: 2 }}>{it.hint}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountingEntriesTab({
  companyId,
  entries,
  total,
  loading,
  filters,
  onFilterChange,
  onLoad,
  // Buscas PAGAS no SERPRO, disparadas pelo menu "SERPRO". Ausentes = item desabilitado.
  onSyncSerproPgdas,
  onCaptureSerproLp,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
  onImportOFX,
  onPreviewOFX,
  accounts,
  onLoadAccounts,
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
  onImportAccountsFile,
  savingEntry,
  onExportCsv,
  message,
  error,
  onCreateBaixa,
  savingBaixa,
  onLoadBaixaTemplate,
  onSearchHistoricos,
  onGetHistoricosByCode,
  onLoadAllHistoricos,
  onUpdateHistorico,
  onDeleteHistorico,
  onLoadPayrollTemplate,
  onCreateFolha,   // Q52: folha/pró-labore em lançamentos individuais (1 chamada por competência)
  onBulkDeleteEntries,
  onOpenChartOfAccountsTab,
  onPreviewExcel,
  onImportExcel,
  companyRegime,  // regime tributário — controla a visibilidade dos itens do menu SERPRO
  // Q6: Funções de Lançamento
  accountingFunctions,  // { functions, loading, saving, create, update, remove, apply } do hook useAccountingFunctions
  // Q9: Parcelamentos
  parcelamentos,        // { parcelamentos, loading, saving, create, ingest, rescindir } do hook useParcelamentos
}) {
  const [showOFX, setShowOFX] = useState(false);
  const [showHistoricos, setShowHistoricos] = useState(false);
  const [showPayroll, setShowPayroll] = useState(false);
  const [showCsvExport, setShowCsvExport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);   // filtros saíram da caixa → modal
  const [showExcel, setShowExcel] = useState(false);
  // Q6: Funções de Lançamento — modais
  const [showFunctionsList, setShowFunctionsList] = useState(false);
  const [editingFunction, setEditingFunction] = useState(null);    // null=fechado, {}=nova, {id,...}=editando existente
  const [applyingFunction, setApplyingFunction] = useState(null);  // function que vai ser aplicada
  // Q9: state pro modal de criar parcelamento (stand-alone, sem guia de origem)
  const [showCreateParcelamento, setShowCreateParcelamento] = useState(false);

  // Parcelamento Simples Nacional só faz sentido para empresas regime SIMPLES.
  const regimeUpper = String(companyRegime || "").trim().toUpperCase();
  const isSimples = regimeUpper === "SIMPLES";
  // Tem que casar EXATAMENTE com a guarda do backend (`LucroPresumidoProvisaoService`), inclusive
  // LUCRO_REAL — se divergir, o botão aparece e a rota devolve 409 na cara do contador.
  const isPresumido = regimeUpper === "LUCRO_PRESUMIDO" || regimeUpper === "LUCRO_REAL";
  // Estado das buscas pagas nesta competência, vindo do GET do fechamento. `null` = ainda não sei.
  const [buscasSerpro, setBuscasSerpro] = useState(null);
  const [buscandoSerpro, setBuscandoSerpro] = useState(null); // "extrato" | "presumido"
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [adding, setAdding] = useState(false); // Q18: linha de novo lançamento inline
  const [monthClosed, setMonthClosed] = useState(false); // Q18: mês fechado bloqueia adicionar

  const visibleIds = useMemo(() => entries.map((e) => e.id).filter(Boolean), [entries]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));
  const selectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }
  // Q32.1: select-all por grupo (cabeçalho de cada tipo).
  function toggleGroup(ids) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const all = ids.length > 0 && ids.every((id) => next.has(id));
      if (all) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleBulkDelete() {
    if (!onBulkDeleteEntries || selectedCount === 0) return;
    const ids = visibleIds.filter((id) => selectedIds.has(id));
    setBulkDeleting(true);
    const result = await onBulkDeleteEntries(ids);
    setBulkDeleting(false);
    if (result?.ok || result?.succeeded > 0) clearSelection();
  }

  const now = new Date();
  const defaultComp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const activeComp = filters.competencia || defaultComp;

  /**
   * Busca no SERPRO, confirmando ANTES quando já foi buscado nesta competência.
   *
   * A confirmação lê o estado que veio do GET, nunca a resposta do POST: quando o POST responde, a
   * chamada paga já saiu. E o Presumido são DUAS chamadas por clique (declaração + DARF), então um
   * duplo clique distraído custa quatro.
   *
   * Avisa e deixa seguir — refazer é legítimo depois de uma retificação; o que não pode é gastar
   * sem saber.
   */
  async function buscarNoSerpro(qual) {
    if (buscandoSerpro) return;
    const jaBuscado = qual === "extrato" ? buscasSerpro?.extrato : buscasSerpro?.presumido;
    if (jaBuscado?.buscado) {
      const oQue = qual === "extrato" ? "Este extrato" : "Estes tributos";
      // eslint-disable-next-line no-alert
      const seguir = window.confirm(
        `${oQue} já ${qual === "extrato" ? "foi buscado" : "foram buscados"} em ${fmtDataHora(jaBuscado.em)}.\n\n`
        + "Buscar de novo consome uma nova consulta paga no SERPRO e sobrescreve os valores da "
        + "competência.\n\nBuscar mesmo assim?",
      );
      if (!seguir) return;
    }
    setBuscandoSerpro(qual);
    try {
      // Os dois handlers recebem `{competencia}`, não a string solta.
      if (qual === "extrato") await onSyncSerproPgdas?.(companyId, { competencia: activeComp });
      else await onCaptureSerproLp?.(companyId, { competencia: activeComp });
    } finally {
      setBuscandoSerpro(null);
      // Marca no `finally`, não no sucesso: a chamada paga saiu do mesmo jeito, e o que a
      // confirmação protege é o BOLSO, não o resultado. O pré-voo vem do GET do fechamento, que só
      // roda na montagem e ao trocar de competência — sem isto, o segundo clique na mesma sessão
      // não avisaria nada, que é justamente o caso para o qual a confirmação existe.
      setBuscasSerpro((atual) => ({
        ...(atual || {}),
        [qual]: { ...(atual?.[qual] || {}), buscado: true, em: new Date().toISOString() },
      }));
    }
  }

  const listedTotals = useMemo(() => entries.reduce((acc, entry) => {
    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    const totalD = entry.totalD ?? lines.filter((line) => line.tipo === "D").reduce((sum, line) => sum + Number(line.valor || 0), 0);
    const totalC = entry.totalC ?? lines.filter((line) => line.tipo === "C").reduce((sum, line) => sum + Number(line.valor || 0), 0);
    const hasDebitColumn = lines.some((line) => line.tipo === "D" && String(line.conta || "").trim());
    const hasCreditColumn = lines.some((line) => line.tipo === "C" && String(line.conta || "").trim());
    if (hasDebitColumn) acc.debito += Number(totalD || 0);
    if (hasCreditColumn) acc.credito += Number(totalC || 0);
    return acc;
  }, { debito: 0, credito: 0 }), [entries]);

  // Agrupa lançamentos por tipo seguindo TIPO_GROUP_ORDER; tipos desconhecidos caem em "OUTRO".
  const groupedEntries = useMemo(() => {
    const groups = {};
    for (const tipo of TIPO_GROUP_ORDER) groups[tipo] = [];
    for (const entry of entries) {
      const tipo = String(entry.tipo || "OUTRO").toUpperCase();
      const bucket = groups[tipo] ? tipo : "OUTRO";
      groups[bucket].push(entry);
    }
    // Q32: dentro de cada tipo, ordena por DATA desc (mais nova em cima; dia 1 embaixo).
    // Desempate por createdAt desc.
    const ts = (v) => { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
    for (const tipo of TIPO_GROUP_ORDER) {
      groups[tipo].sort((a, b) => (ts(b.data) - ts(a.data)) || (ts(b.createdAt) - ts(a.createdAt)));
    }
    return groups;
  }, [entries]);

  const groupTotals = useMemo(() => {
    const totals = {};
    for (const tipo of TIPO_GROUP_ORDER) {
      const sum = groupedEntries[tipo].reduce((s, e) => s + Number(e.totalD || e.valor || 0), 0);
      totals[tipo] = sum;
    }
    return totals;
  }, [groupedEntries]);

  const actionButtonStyle = {
    minHeight: 33,
    padding: "8px 14px",
    borderRadius: 16,
    border: `1px solid ${ACCOUNTING_PANEL.border}`,
    background: ACCOUNTING_PANEL.surface,
    color: ACCOUNTING_PANEL.text,
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
  };

  // Q18: filtros compactos (como no dashboard).
  const filterLabelStyle = {
    display: "grid",
    gap: 3,
    minWidth: 0,
    fontSize: "0.68rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: ACCOUNTING_PANEL.muted,
  };

  const filterControlStyle = {
    width: "100%",
    height: 34,
    border: `1px solid ${ACCOUNTING_PANEL.border}`,
    borderRadius: 6,
    padding: "0 8px",
    font: "inherit",
    fontSize: "0.8rem",
    color: ACCOUNTING_PANEL.text,
    background: ACCOUNTING_PANEL.field,
    boxSizing: "border-box",
    outline: "none",
  };

  // Nº de filtros ativos (competência sempre tem valor, então não conta pro selo do botão).
  const activeFilterCount = ["tipo", "origem", "status"].filter((k) => filters?.[k]).length;

  return (
    /* ⚠ A MARGEM LATERAL VIVE AQUI, UMA VEZ SÓ (`--content-gutter`, 5%).
       Era um `maxWidth: 1600` repetido em quatro blocos com `margin: auto` — quatro lugares para
       manter em sincronia, e um teto fixo que deixava ~900px em branco num monitor de 2560. Com o
       padding no contêiner, cada bloco interno é simplesmente `width: 100%` e acompanha sozinho. */
    <div style={{ width: "100%", background: ACCOUNTING_PANEL.page, padding: "var(--space-3) var(--content-gutter)", boxSizing: "border-box" }}>
      {/* Caixa superior no mesmo padrão das pílulas: fundo sólido + borda roxa + cantos macios. */}
      <div style={{ display: "grid", gap: 12, marginBottom: 10, padding: 16, borderRadius: 16, border: "1px solid rgba(189,147,249,0.28)", background: ACCOUNTING_PANEL.surface }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionMenu
            label="Configurações"
            items={[
              { label: "Histórico de lançamentos", hint: "Templates de histórico reutilizáveis", onClick: () => setShowHistoricos(true) },
              { label: "Plano de contas", hint: "Visualizar e editar contas", onClick: () => { onLoadAccounts(); if (onOpenChartOfAccountsTab) onOpenChartOfAccountsTab(); }, disabled: !onOpenChartOfAccountsTab },
            ]}
          />
          <ActionMenu
            label="Import / Export"
            items={[
              { label: "Importar OFX", hint: "Extrato bancário", onClick: () => setShowOFX(true) },
              { label: "Importar Excel", hint: "Planilha (data; descrição; valor)", onClick: () => setShowExcel(true), disabled: !onPreviewExcel || !onImportExcel },
              { label: "Exportar CSV", hint: "Lançamentos por competência", onClick: () => setShowCsvExport(true), disabled: !onExportCsv },
            ]}
          />
          {/* Sem `accent`: um primário por tela, e ele é o "+ Adicionar lançamento". */}
          <ActionMenu
            label="Funções"
            items={[
              { label: "+ Folha / Pró-labore", hint: "Lançamento composto pré-preenchido", onClick: () => setShowPayroll(true), disabled: !onLoadPayrollTemplate },
              // ⚠ "+ Parcelamento Simples" SAIU (R1) — o botão CHAMAVA UMA ROTA QUE NÃO EXISTE MAIS.
              // Ele batia em `POST /entries/parcelamento`, removida no backend junto do subtipo
              // `PARC_DAS` que só ela escrevia (produção tem ZERO lançamentos com esse subtipo — a
              // rota nunca foi usada). Clicar aqui dava 404. O parcelamento hoje nasce na aba
              // Parcelamentos, pelo "+ Novo parcelamento", como CONTRATO — não como N provisões
              // recorrentes lançadas de uma vez.
              // Q6: Funções customizadas (templates reutilizáveis)
              ...(accountingFunctions ? [{
                label: "Aplicar função…",
                hint: "Use um template reutilizável da empresa ou global",
                onClick: () => setShowFunctionsList(true),
              }] : []),
              // Q9: Parcelamentos (Simples, INSS, DARF, OUTRO)
              ...(parcelamentos ? [{
                label: "+ Novo parcelamento…",
                hint: "Cria parcelamento com abertura + N parcelas (Simples, INSS, etc)",
                onClick: () => setShowCreateParcelamento(true),
              }] : []),
            ]}
          />
          {/* Buscar no SERPRO o que a competência já tem lá: o extrato do Simples (que traz as
              receitas e o DAS) ou os tributos do Presumido. Fica AQUI, e não só na aba Fiscal,
              porque é aqui que o contador está quando percebe que falta lançamento — e a aba de
              Apuração nem existe para o Presumido.

              ⚠ São chamadas PAGAS. O menu lê `buscasSerpro` (do GET do fechamento) para confirmar
              antes de repetir, e trava enquanto uma busca está em voo. */}
          {/* ⚠ Sem `accent="#FFB347"`. Âmbar significa "ação rápida PENDENTE", e este menu é uma
              porta, não uma pendência: ficava permanentemente aceso em toda competência, inclusive
              nas já buscadas, treinando o olho a ignorar âmbar — que é a cor de "falta enviar". */}
          <ActionMenu
            label="SERPRO"
            items={[
              ...(isSimples ? [{
                label: buscandoSerpro === "extrato" ? "Buscando extrato…" : "Buscar extrato do Simples",
                hint: buscasSerpro?.extrato?.buscado
                  ? `Já buscado em ${fmtDataHora(buscasSerpro.extrato.em)}`
                  : "Traz receitas e DAS da competência e gera os lançamentos",
                onClick: () => buscarNoSerpro("extrato"),
                disabled: Boolean(buscandoSerpro) || monthClosed || !onSyncSerproPgdas,
              }] : []),
              ...(isPresumido ? [{
                label: buscandoSerpro === "presumido" ? "Buscando tributos…" : "Buscar tributos do Presumido",
                // `disponivel === false` = a integração está desligada no servidor. Dizer isso ANTES
                // do clique poupa o contador de descobrir pelo 409.
                hint: buscasSerpro?.presumido?.disponivel === false
                  ? "Integração do Presumido desligada — a consulta ainda não foi validada em produção."
                  : buscasSerpro?.presumido?.buscado
                    ? `Já buscado em ${fmtDataHora(buscasSerpro.presumido.em)}`
                    : "Traz PIS, COFINS, IRPJ e CSLL da competência",
                onClick: () => buscarNoSerpro("presumido"),
                disabled: Boolean(buscandoSerpro) || monthClosed || !onCaptureSerproLp
                  || buscasSerpro?.presumido?.disponivel === false,
              }] : []),
              // Regime fora dos dois: item desabilitado que NOMEIA o regime. Um menu que some
              // deixa o contador procurando; um item que explica encerra a dúvida.
              ...(!isSimples && !isPresumido ? [{
                label: `Sem busca para ${regimeUpper || "regime não definido"}`,
                hint: "A busca automática existe para Simples Nacional e Lucro Presumido/Real.",
                onClick: () => {},
                disabled: true,
              }] : []),
              ...(monthClosed ? [{
                label: "Mês fechado",
                hint: "Reabra a empresa para buscar de novo — a busca grava lançamentos.",
                onClick: () => {},
                disabled: true,
              }] : []),
            ]}
          />
          {/* Filtros saíram da caixa: abrem num modal, deixando a caixa superior enxuta. */}
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            style={activeFilterCount ? { ...actionButtonStyle, borderColor: ACCOUNTING_PANEL.accent, color: ACCOUNTING_PANEL.accent } : actionButtonStyle}
            title="Filtrar lançamentos"
          >
            {/* Era "⚲", que não é uma lupa — é o símbolo de gênero neutro. */}
            🔍 Filtro{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>

        {/* Resumo por seção — chips CLICÁVEIS que rolam até o grupo correspondente na tabela.
            ⚠ A fonte passou a ser `groupTotals`, a MESMA das seções. Era `totals`, agregado pelo
            `entry.tipo` cru: um tipo desconhecido aparecia aqui com valor próprio e, na tabela,
            estava somado dentro de "OUTRO" — dois números diferentes para o mesmo dinheiro, na
            mesma tela, e o chip apontava para uma seção que não existia. */}
        {entries.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {TIPO_GROUP_ORDER.filter((tipo) => groupedEntries[tipo]?.length).map((tipo) => (
              <button
                key={tipo}
                type="button"
                onClick={() => rolarAteEDestacar(`secao-${tipo}`)}
                title={`Ir até ${TIPO_GROUP_LABELS[tipo] || tipo} na tabela`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "5px 10px", borderRadius: 999,
                  border: `1px solid ${ACCOUNTING_PANEL.border}`, background: ACCOUNTING_PANEL.field,
                  color: ACCOUNTING_PANEL.text, font: "inherit", fontSize: "0.75rem", cursor: "pointer",
                }}
              >
                <strong>{TIPO_GROUP_LABELS[tipo] || tipo}</strong>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>R$ {fmtValor(groupTotals[tipo])}</span>
                <span style={{ color: ACCOUNTING_PANEL.muted }}>({groupedEntries[tipo].length})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal de filtros (saíram da caixa superior pra deixá-la enxuta). */}
      {showFilters && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => e.target === e.currentTarget && setShowFilters(false)}
        >
          <div style={{ background: ACCOUNTING_PANEL.surface, border: "1px solid rgba(189,147,249,0.28)", borderRadius: 16, padding: 22, width: 420, maxWidth: "100%", color: ACCOUNTING_PANEL.text, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Filtros</h3>
              <button type="button" onClick={() => setShowFilters(false)} style={{ background: "none", border: "none", color: ACCOUNTING_PANEL.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              {/* ⚠ Competência NÃO é filtro deste painel — é estado da EMPRESA, e mora no header.
                  Aqui ela era o terceiro controle do mesmo valor (com as setas e o input do topo),
                  e o painel fechado ainda escondia qual estava valendo. Filtro que some atrás de um
                  botão foi o "filtro fantasma" que a listagem já teve de resolver. */}
              <label style={filterLabelStyle}>
                Tipo
                <select value={filters.tipo || ""} onChange={(e) => onFilterChange("tipo", e.target.value)} style={filterControlStyle}>
                  <option value="">Selecionar tipo</option>
                  {Object.entries(TIPO_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label style={filterLabelStyle}>
                Origem
                <select value={filters.origem || ""} onChange={(e) => onFilterChange("origem", e.target.value)} style={filterControlStyle}>
                  <option value="">Selecionar origem</option>
                  {Object.entries(ORIGEM_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label style={filterLabelStyle}>
                Status
                <select value={filters.status || ""} onChange={(e) => onFilterChange("status", e.target.value)} style={filterControlStyle}>
                  <option value="">Selecionar status</option>
                  {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => { onFilterChange("tipo", ""); onFilterChange("origem", ""); onFilterChange("status", ""); }}
                style={actionButtonStyle}
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => { if (onLoad) onLoad(); setShowFilters(false); }}
                style={{ ...actionButtonStyle, background: ACCOUNTING_PANEL.accent, color: "#1A1B26", border: "none" }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {message && message !== "Lançamento adicionado." && <p style={{ color: "var(--success)", margin: "0 0 8px", fontSize: "0.875rem" }}>{message}</p>}
      {error && <p style={{ color: "var(--danger)", margin: "0 0 8px", fontSize: "0.875rem" }}>{error}</p>}

      {/* Q18: toolbar junto da tabela — só o primário. O painel de fechamento desceu para o lado
          da TABELA (ver abaixo): ele fala do mês inteiro, e aqui em cima empurrava a tabela ~300px
          para baixo, à custa de três ou quatro lançamentos a menos visíveis de primeira. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {/* ⚠ ERA VERDE (#69FF47). Verde quer dizer CONCLUÍDO no vocabulário de cores do app — um
            botão verde de "faça isto" ensina o contrário exatamente na tela onde o verde do
            rodapé ("✓ ok", D=C) precisa ser lido como "está fechado". Ação primária é o accent.
            O estilo à mão (altura 34, raio 8) também saiu: é o `Button` do app. */}
        <Button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding || monthClosed}
          title={monthClosed ? "Mês fechado — reabra a empresa para lançar." : undefined}
        >
          + Adicionar lançamento
        </Button>
      </div>

      {selectedCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "#2D2F45", border: "1px solid #44475A", borderRadius: 8,
          padding: "8px 14px", marginTop: 8, fontSize: "0.875rem", color: ACCOUNTING_PANEL.text,
          boxSizing: "border-box",
        }}>
          <span style={{ fontWeight: 700, color: "#BD93F9" }}>
            {selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}
          </span>
          {/* `#FF5757` sólido virou `.btn-danger`. A gravidade continua onde sempre esteve: o
              `handleBulkDeleteEntries` confirma ("Esta ação não pode ser desfeita") antes de
              chamar o backend — não é a saturação do botão que segura o clique. */}
          {onBulkDeleteEntries && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? "Excluindo..." : `Excluir selecionado${selectedCount !== 1 ? "s" : ""}`}
            </Button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            style={{
              background: "none", border: "none", color: ACCOUNTING_PANEL.muted,
              fontSize: "0.8125rem", textDecoration: "underline", cursor: "pointer",
            }}
          >
            Limpar seleção
          </button>
        </div>
      )}

      {/* ⚠ TABELA E PAINEL DE FECHAMENTO LADO A LADO.
          O painel ficava ACIMA da tabela, na linha do "+ Adicionar": com ~300px de altura, empurrava
          a tabela para baixo e comia três ou quatro lançamentos da primeira olhada. Ele fala do MÊS,
          não de uma linha — ao lado, fica visível o tempo todo sem disputar altura com o trabalho.

          `alignItems: flex-start` para o painel não esticar até o fim de uma tabela de 60 linhas.
          `flexWrap` + `flex: "1 1 620px"` na tabela: abaixo de ~900px úteis o painel desce sozinho
          em vez de espremer as colunas. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginTop: 4, flexWrap: "wrap" }}>
      {/* ⚠ `minWidth: 0` é o que permite ESTA coluna encolher. Sem ele o flex usa a largura
          intrínseca da tabela como piso, e a linha estoura para fora da página em vez de a tabela
          rolar dentro do próprio contêiner. */}
      <div style={{ flex: "1 1 620px", minWidth: 0, overflowX: "auto", borderRadius: 16, border: `1px solid ${ACCOUNTING_PANEL.border}`, background: ACCOUNTING_PANEL.surface, padding: 20, boxSizing: "border-box" }}>
        {/* Q32: título da competência acima do cabeçalho (ex.: MAIO/2026).
            ⚠ As setas ◀ ▶ que ficavam aqui SAÍRAM: quem navega a competência é o seletor do header,
            um só para a empresa inteira. O título FICA — ele não é controle, é o rótulo do que a
            tabela está mostrando, e some no papel se sair daqui (a impressão não leva o header). */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 14 }}>
          <div style={{ minWidth: 200, textAlign: "center", fontSize: "1.4rem", fontWeight: 800, letterSpacing: "0.04em", color: ACCOUNTING_PANEL.text }}>
            {formatCompetenciaTitulo(activeComp)}
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", fontSize: "0.9375rem", borderRadius: 16, overflow: "hidden" }}>
          <colgroup>
            {COLS.map((col, index) => <col key={index} style={{ width: col.width }} />)}
          </colgroup>
          {/* Q32.1: cabeçalho de colunas não fica mais global — é repetido embaixo do título de cada tipo. */}
          <tbody>
            {adding && (
              <DraftEntryRow
                accounts={accounts}
                onSave={onCreateEntry}
                saving={savingEntry}
                activeComp={activeComp}
                onSearchHistoricos={onSearchHistoricos}
                onGetHistoricosByCode={onGetHistoricosByCode}
                onClose={() => setAdding(false)}
              />
            )}
            {loading && <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: ACCOUNTING_PANEL.text }}>Carregando...</td></tr>}
            {!loading && entries.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: ACCOUNTING_PANEL.text }}>Nenhum lançamento para esta competência.</td></tr>}
            {!loading && entries.length > 0 && TIPO_GROUP_ORDER.map((tipo) => {
              const items = groupedEntries[tipo];
              if (!items || items.length === 0) return null;
              const groupIds = items.map((e) => e.id);
              const groupAll = groupIds.every((id) => selectedIds.has(id));
              const groupSome = groupIds.some((id) => selectedIds.has(id));
              return (
                <Fragment key={tipo}>
                  {/* Âncora dos metric chips da toolbar (`secao-<tipo>`). */}
                  <tr id={`secao-${tipo}`} style={{ background: ACCOUNTING_PANEL.field }}>
                    <td
                      colSpan={7}
                      style={{
                        padding: "12px 16px",
                        borderTop: `3px solid ${ACCOUNTING_PANEL.border}`,
                        borderBottom: `2px solid ${ACCOUNTING_PANEL.border}`,
                        fontWeight: 800,
                        letterSpacing: "0.03em",
                        fontSize: "0.95rem",
                        textTransform: "uppercase",
                        color: ACCOUNTING_PANEL.text,
                        textAlign: "center",
                      }}
                    >
                      {/* Q32: separador de tipo mais destacado (maior, caixa-alta, borda superior grossa). */}
                      <span>{TIPO_GROUP_LABELS[tipo] || tipo}</span>
                      <span style={{ color: ACCOUNTING_PANEL.muted, fontWeight: 500, fontSize: "0.78rem", marginLeft: 12, textTransform: "none" }}>
                        {items.length} lançamento{items.length !== 1 ? "s" : ""}
                        {groupTotals[tipo] > 0 && <> · R$ {fmtValor(groupTotals[tipo])}</>}
                      </span>
                    </td>
                  </tr>
                  {/* Q32.1: cabeçalho de colunas embaixo do título do tipo. */}
                  <tr style={{ background: ACCOUNTING_PANEL.field, userSelect: "none" }}>
                    <th style={{ padding: "8px 8px", textAlign: "center", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, borderRight: `1px solid ${ACCOUNTING_PANEL.border}` }}>
                      <input
                        type="checkbox"
                        checked={groupAll}
                        ref={(el) => { if (el) el.indeterminate = groupSome && !groupAll; }}
                        onChange={() => toggleGroup(groupIds)}
                        style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" }}
                        aria-label={`Selecionar todos de ${TIPO_GROUP_LABELS[tipo] || tipo}`}
                      />
                    </th>
                    {COLS.slice(1).map(({ label, align }, index, arr) => (
                      <th key={index} style={{ padding: "8px 12px", textAlign: align, fontSize: "0.82rem", fontWeight: 700, color: ACCOUNTING_PANEL.muted, textTransform: "uppercase", letterSpacing: "0.02em", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, borderRight: index < arr.length - 1 ? `1px solid ${ACCOUNTING_PANEL.border}` : "none", whiteSpace: "nowrap" }}>{label}</th>
                    ))}
                  </tr>
                  {items.map((entry) => (
                    <AccountRow
                      key={entry.id}
                      entry={entry}
                      accounts={accounts}
                      onUpdate={onUpdateEntry}
                      onDelete={onDeleteEntry}
                      saving={savingEntry}
                      onCreateBaixa={onCreateBaixa}
                      savingBaixa={savingBaixa}
                      onLoadBaixaTemplate={onLoadBaixaTemplate}
                      onSearchHistoricos={onSearchHistoricos}
                      onGetHistoricosByCode={onGetHistoricosByCode}
                      isSelected={selectedIds.has(entry.id)}
                      onToggleSelect={() => toggleOne(entry.id)}
                    />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {total > 0 && (() => {
            // Q33: contagem + balanço Débito × Crédito — discreto, na mesma linha.
            const dTot = Number(listedTotals.debito) || 0;
            const cTot = Number(listedTotals.credito) || 0;
            const diff = Math.abs(dTot - cTot);
            const balanced = diff <= 0.01;
            return (
              <tfoot>
                <tr style={{ background: ACCOUNTING_PANEL.field }}>
                  <td colSpan={7} style={{ padding: "6px 12px", fontSize: "0.8rem", color: ACCOUNTING_PANEL.muted, borderTop: `1px solid ${ACCOUNTING_PANEL.border}` }}>
                    {total} lançamento{total !== 1 ? "s" : ""} no total
                    <span style={{ margin: "0 8px", color: ACCOUNTING_PANEL.border }}>·</span>
                    D R$ {fmtValor(dTot) || "0,00"}
                    <span style={{ margin: "0 6px", color: ACCOUNTING_PANEL.border }}>·</span>
                    C R$ {fmtValor(cTot) || "0,00"}
                    <span style={{ marginLeft: 8, color: balanced ? "#69FF47" : "#FFB347", fontWeight: 600 }}>
                      {balanced ? "✓ ok" : `⚠ dif. R$ ${fmtValor(diff) || "0,00"}`}
                    </span>
                  </td>
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>

        {/* Coluna direita — o painel do mês, ao lado do trabalho do mês.
            ⚠ ESTREITO DE PROPÓSITO (152px). Começou em 268 e encolheu três vezes: são cinco
            rótulos curtos e um botão, e cada pixel a mais aqui é um pixel a menos de coluna de
            lançamento. O painel é referência de canto de olho; a tabela é onde se trabalha.
            152px é o piso: abaixo disso "Folha/Pró-labore" quebra em duas linhas. */}
        <div style={{ flex: "0 0 152px", maxWidth: "100%" }}>
          <FechamentoCadeado
            companyId={companyId}
            competencia={activeComp}
            entries={entries}
            onState={(closed) => { setMonthClosed(closed); if (closed) setAdding(false); }}
            onFechamentoData={(dados) => setBuscasSerpro(dados?.serpro || null)}
            filtroAtivo={Boolean(filters.tipo || filters.origem || filters.status)}
          />
        </div>
      </div>

      {showOFX && (
        <ImportOFXModal
          companyId={companyId}
          accounts={accounts}
          onPreview={onPreviewOFX}
          onImport={onImportOFX}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
          onClose={() => setShowOFX(false)}
        />
      )}
      {showHistoricos && <HistoricosModal onClose={() => setShowHistoricos(false)} onLoadAll={onLoadAllHistoricos} onUpdate={(id, input) => onUpdateHistorico(id, input)} onDelete={(id) => onDeleteHistorico(id)} />}
      {showPayroll && (
        <PayrollEntryModal
          accounts={accounts}
          defaultCompetencia={activeComp}
          onLoadTemplate={onLoadPayrollTemplate}
          onSave={async ({ competencia, subtipo, provisoes, baixas, repeatMonths }) => {
            // Q52: cada linha do modal vira UM lançamento individual — o backend cria todos
            // os da competência numa transaction (POST /entries/folha, 1 lote por mês).
            // F2: Repetição N meses — repete provisões + baixas para cada competência seguinte.
            const repeatN = Math.max(0, Math.min(12, Number(repeatMonths) || 0));
            function addMonthsToCompetencia(comp, n) {
              const m = String(comp || "").match(/^(\d{4})-(\d{2})$/);
              if (!m) return comp;
              const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
              return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
            }
            function compToMmYyyy(comp) {
              const m = String(comp || "").match(/^(\d{4})-(\d{2})$/);
              return m ? `${m[2]}/${m[1]}` : "";
            }
            function shiftDate(dateStr, monthsToAdd) {
              if (!dateStr) return dateStr;
              const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (!m) return dateStr;
              // Mantém o dia se possível; se transbordar (ex: 31/02), usa último dia do mês.
              const targetYear = Number(m[1]);
              const targetMonth = Number(m[2]) - 1 + monthsToAdd;
              const day = Number(m[3]);
              const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
              const realDay = Math.min(day, lastDayOfTarget);
              const dt = new Date(Date.UTC(targetYear, targetMonth, realDay));
              return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
            }
            const baseComp = competencia || activeComp;
            const baseMmYyyy = compToMmYyyy(baseComp);
            const escapeRegex = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const subsHistorico = (texto, novaMmYyyy) => {
              if (!texto || !baseMmYyyy) return texto;
              // Substitui apenas o MM/YYYY exato do mês base (evita falso positivo com outros números).
              return String(texto).replace(new RegExp(escapeRegex(baseMmYyyy), "g"), novaMmYyyy);
            };

            try {
              for (let n = 0; n <= repeatN; n++) {
                const compN = addMonthsToCompetencia(baseComp, n);
                const mmYyyyN = compToMmYyyy(compN);
                const provisoesN = (provisoes || []).map((p) => ({
                  ...p,
                  data: shiftDate(p.data, n),
                  historico: subsHistorico(p.historico, mmYyyyN),
                }));
                const baixasN = (baixas || []).map((b) => ({
                  ...b,
                  data: shiftDate(b.data, n),
                  historico: subsHistorico(b.historico, mmYyyyN),
                }));
                if (provisoesN.length === 0 && baixasN.length === 0) continue;
                await onCreateFolha({ competencia: compN, subtipo, provisoes: provisoesN, baixas: baixasN });
              }
              setShowPayroll(false);
            } catch { /* erro já é tratado no onCreateFolha */ }
          }}
          saving={savingEntry}
          onClose={() => setShowPayroll(false)}
        />
      )}
      {showCsvExport && (
        <CsvExportModal
          defaultCompetencia={activeComp}
          onExport={(rangeOptions) => onExportCsv(rangeOptions)}
          onClose={() => setShowCsvExport(false)}
          onPreflight={(comp) => fechamentoApi.getExportPreflight(companyId, comp)}
          onReabrir={async (comp) => {
            await fechamentoApi.reabrirExportacao(companyId, { competenciaInicio: comp, competenciaFim: comp });
            await onLoad?.();
          }}
          /* ⚠ FECHA o modal antes de rolar. Sem isso o `scrollIntoView` acerta a linha certa
             debaixo do overlay, e a tela parece não ter feito nada. */
          onIrAteLancamento={(entryId) => { setShowCsvExport(false); setTimeout(() => irAteOLancamento(entryId), 60); }}
        />
      )}
      {showExcel && (
        <ImportExcelModal
          accounts={accounts}
          onPreview={onPreviewExcel}
          onCommit={onImportExcel}
          onClose={() => setShowExcel(false)}
        />
      )}
      {/* Q6: Funções de Lançamento */}
      {showFunctionsList && accountingFunctions && (
        <FunctionListModal
          functions={accountingFunctions.functions}
          loading={accountingFunctions.loading}
          onApply={(f) => { setShowFunctionsList(false); setApplyingFunction(f); }}
          onEdit={(f) => { setShowFunctionsList(false); setEditingFunction(f); }}
          onDelete={async (f) => {
            // eslint-disable-next-line no-alert
            if (!window.confirm(`Excluir a função "${f.name}"?`)) return;
            try { await accountingFunctions.remove(f.id); } catch {}
          }}
          onCreate={() => { setShowFunctionsList(false); setEditingFunction({}); }}
          onDuplicate={async (f) => {
            // Duplica como nova função da empresa (sem isSystem)
            const dup = {
              name: `${f.name} (cópia)`,
              description: f.description || null,
              entries: (f.entries || []).map((e, idx) => ({
                ordem: idx, historico: e.historico, tipo: e.tipo, subtipo: e.subtipo || null,
                lines: (e.lines || []).map((ln, lidx) => ({ ordem: lidx, conta: ln.conta, tipo: ln.tipo })),
              })),
            };
            try {
              await accountingFunctions.create(dup);
            } catch {}
          }}
          onClose={() => setShowFunctionsList(false)}
        />
      )}
      {editingFunction && accountingFunctions && (
        <FunctionEditModal
          initial={editingFunction.id ? editingFunction : null}
          accounts={accounts}
          saving={accountingFunctions.saving}
          onSave={async (payload) => {
            if (editingFunction.id) {
              await accountingFunctions.update(editingFunction.id, payload);
            } else {
              await accountingFunctions.create(payload);
            }
            setEditingFunction(null);
          }}
          onClose={() => setEditingFunction(null)}
        />
      )}
      {applyingFunction && accountingFunctions && (
        <FunctionApplyModal
          func={applyingFunction}
          defaultCompetencia={activeComp}
          saving={accountingFunctions.saving}
          onApply={async ({ competencia, entryValores }) => {
            await accountingFunctions.apply(applyingFunction.id, { competencia, entryValores });
            setApplyingFunction(null);
            // Recarrega lista de lançamentos para mostrar os criados
            if (onLoad) await onLoad();
          }}
          onClose={() => setApplyingFunction(null)}
        />
      )}

      {/* Q9: criar parcelamento stand-alone (sem guia de origem) */}
      {showCreateParcelamento && parcelamentos && accountingFunctions && (
        <ParcelamentoCreateModal
          accountingFunctions={accountingFunctions}
          saving={parcelamentos.saving}
          onCreate={async (body) => {
            await parcelamentos.create(body);
            setShowCreateParcelamento(false);
            if (onLoad) await onLoad();
          }}
          onClose={() => setShowCreateParcelamento(false)}
        />
      )}
    </div>
  );
}
