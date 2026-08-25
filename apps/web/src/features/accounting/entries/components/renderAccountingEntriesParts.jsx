import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";
import { valorUtilizavel } from "../lib/valorFormula";
import { avisoContaSintetica, motivoContaSintetica, contasSugeriveis } from "../lib/contaSintetica";
import { selosDaConta } from "../lib/tipoDaConta";
import {
  ACCOUNTING_PANEL,
  COL_COUNT,
  INPUT,
  ORIGEM_LABELS,
  PANEL_FIELD_STYLE,
  PANEL_ICON_BUTTON_STYLE,
  PANEL_LABEL_STYLE,
  STATUS_LABELS,
  SUBTIPO_OPTIONS,
  TDv,
  TIPO_LABELS,
  fmtDate,
  fmtValor,
  getCompRange,
  resolveHistoricoText,
} from "../lib/accountingEntriesShared";

// ⚠⚠ AQUI HAVIA UM `TIPO_COLOR` — UM CHIP CHEIO, UM POR TIPO DE CONTA — E ELE FOI REMOVIDO EM
// 24/08/2026. Ele pintava **RECEITA de `var(--success)`** e **PASSIVO de `#FFB347`**, que são literalmente
// `--state-ok` e `--state-warn`: nesta casa, *"concluído"* e *"pendência"*. Uma conta de passivo
// aparecia como trabalho a fazer, e uma de receita como algo já resolvido — sobre um fato que não é
// nem uma coisa nem outra. O `tipoDaConta.js` escreve a regra com todas as letras: *"o selo NÃO usa
// verde, âmbar nem vermelho (…) todos os tipos usam o MESMO chip neutro, e quem carrega o
// significado é a palavra"*.
//
// ⚠ E o defeito era **meia migração**: o commit `d3682cb4` levou TRÊS pontos deste arquivo ao
// `SelosDaConta` e deixou o quarto (`AccountSuggestionRow`) para trás — o próprio comentário de lá
// diz *"três grafias para a mesma informação fazem o contador aprender três vocabulários"*. Eram
// quatro. Agora são quatro usando o mesmo selo.

/**
 * ⚠ O DROPDOWN É `position: fixed` — e coordenada fixa não acompanha o scroll.
 *
 * `fixed` é obrigatório aqui: a tabela de lançamentos tem `overflow` e recortava um dropdown
 * `absolute`. O preço é que a lista fica ancorada a um ponto da JANELA, não ao campo: ao rolar a
 * tabela com a lista aberta, o campo subia e a lista ficava parada — sobre OUTRA linha. Quem
 * escolhesse ali estaria preenchendo o campo de cima com a sugestão de baixo.
 *
 * Por isso o `scroll` é escutado em CAPTURA: quem rola é um container interno, e evento de scroll
 * de elemento não borbulha até o `window`. Só enquanto aberto — fechado não há o que medir.
 */
function useCoordenadasAncoradas(open, anchorRef, chaveDeRemedicao, folga = 3) {
  const [coords, setCoords] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    const medir = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords({ left: r.left, top: r.bottom + folga, width: r.width });
    };
    medir();
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
    };
  }, [open, anchorRef, chaveDeRemedicao, folga]);
  return coords;
}

/**
 * ⚠ SUGESTÃO NÃO ENTRA NA ORDEM DE TABULAÇÃO (`tabIndex={-1}`).
 *
 * São `<button>`, então nasciam tabuláveis: com a lista aberta, o Tab do campo de conta caía DENTRO
 * das sugestões em vez de ir ao próximo campo — e, como o handler é `onMouseDown`, a sugestão que o
 * Tab acabara de focar não podia ser aceita por tecla nenhuma. O teclado entrava num beco.
 * A escolha por teclado é o par ↑↓ + Enter/Tab, tratado no input; o mouse continua no `onMouseDown`
 * (que precisa do `preventDefault` para o blur não fechar a lista antes do clique).
 */
/**
 * O selo do TIPO da conta (Ativo · Passivo · Receita · Despesa · Patrimônio) e o código completo.
 *
 * ## Por que existe (pedido do dono, 24/08/2026)
 *
 * > *"incluir no sugestor o tipo de conta que estamos selecionando, se é despesa, passivo ou ativo,
 * > ou receita"*
 *
 * É o conserto **na origem** do defeito que ele relatou: `1.2.1.06.0003 CSLL` (ATIVO, sob INCENTIVOS
 * FISCAIS) foi parar no crédito de uma provisão de CSLL, onde deveria estar `2.1.1.05.0007 CSLL A
 * RECOLHER`. As duas se chamam "CSLL" no plano e os reduzidos (`137` × `256`) não dizem nada.
 *
 * ⚠⚠ **CHIP NEUTRO PARA TODOS OS TIPOS, DE PROPÓSITO.** Nesta casa verde = concluído, âmbar =
 * pendência e vermelho = bloqueia o fechamento. O tipo da conta não é nenhuma das três; pintá-lo com
 * a paleta de estado faria "Ativo" parecer problema e "Receita" parecer conclusão. Quem carrega o
 * significado é a palavra.
 *
 * ⚠ Conta sem tipo NÃO ganha selo "desconhecido" — ver `rotuloDoTipo` em `lib/tipoDaConta.js`.
 */
function SelosDaConta({ conta }) {
  const { tipo, completo } = selosDaConta(conta);
  if (!tipo && !completo) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
      {completo && (
        <span style={{ fontSize: "0.6875rem", color: ACCOUNTING_PANEL.muted, fontVariantNumeric: "tabular-nums" }}>{completo}</span>
      )}
      {tipo && (
        <span style={{ fontSize: "0.625rem", padding: "2px 6px", borderRadius: 999, fontWeight: 700, letterSpacing: ".02em", background: ACCOUNTING_PANEL.surface, color: ACCOUNTING_PANEL.muted, border: `1px solid ${ACCOUNTING_PANEL.border}` }}>{tipo}</span>
      )}
    </span>
  );
}

function AccountSuggestionRow({ account, onClick, rowRef, selected, onHover }) {
  const isDevedora = account.natureza === "DEVEDORA";
  return (
    <button
      ref={rowRef}
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      onMouseEnter={onHover}
      style={{
        display: "grid", gridTemplateColumns: "1fr auto",
        alignItems: "center", gap: 8,
        width: "100%", textAlign: "left",
        padding: "8px 10px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`,
        background: selected ? ACCOUNTING_PANEL.surface : ACCOUNTING_PANEL.field,
        border: "none", color: ACCOUNTING_PANEL.text,
        outline: selected ? "2px solid var(--success)" : "none",
        outlineOffset: "-2px", cursor: "pointer",
      }}
    >
      <div>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: 3 }}>{account.nome}</div>
        <div style={{ fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}>
          <span style={{ fontWeight: 700, color: isDevedora ? "#8BE9FD" : "var(--success)" }}>
            {isDevedora ? `D ${account.codigo}` : `C ${account.codigo}`}
          </span>
        </div>
      </div>
      {/* ⚠ O MESMO selo dos outros três pontos. Ele traz o `codigoCompleto` pontuado junto do tipo,
          e isso é o conserto na origem do caso que criou o selo: `1.2.1.06.0003 CSLL` (ATIVO) foi
          atrelada onde devia estar `2.1.1.05.0007 CSLL A RECOLHER`, e o reduzido (`137` × `256`)
          não distinguia as duas. Esta linha mostrava só o reduzido. */}
      <SelosDaConta conta={account} />
    </button>
  );
}

function HistoricoSuggestionRow({ item, onClick, rowRef, selected, onHover }) {
  return (
    <button
      ref={rowRef}
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      onMouseEnter={onHover}
      style={{
        display: "grid", gridTemplateColumns: "1fr auto",
        alignItems: "center", gap: 8,
        width: "100%", textAlign: "left",
        padding: "8px 10px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`,
        background: selected ? ACCOUNTING_PANEL.surface : ACCOUNTING_PANEL.field,
        border: "none", color: ACCOUNTING_PANEL.text,
        outline: selected ? "2px solid #BD93F9" : "none",
        outlineOffset: "-2px", cursor: "pointer",
      }}
    >
      <div>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: 3 }}>{item.text}</div>
        <div style={{ display: "flex", gap: 12, fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}>
          {item.contaDebito && <span><span style={{ fontWeight: 700, color: "#8BE9FD" }}>D {item.contaDebito}</span></span>}
          {item.contaCredito && <span><span style={{ fontWeight: 700, color: "var(--success)" }}>C {item.contaCredito}</span></span>}
        </div>
      </div>
      <span style={{ fontSize: "0.6875rem", padding: "3px 8px", borderRadius: 999, fontWeight: 700, flexShrink: 0, background: item.scope === "GLOBAL" ? "#44475A" : "#BD93F9", color: item.scope === "GLOBAL" ? "#F8F8F2" : "#1A1B26", border: "none" }}>
        {item.scope === "GLOBAL" ? "Global" : "Empresa"}
      </span>
    </button>
  );
}

function SectionLabel({ children }) {
  return <div style={{ padding: "10px 12px", fontSize: "0.75rem", fontWeight: 700, color: ACCOUNTING_PANEL.muted, borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, textTransform: "uppercase", letterSpacing: "0.06em", background: ACCOUNTING_PANEL.surface }}>{children}</div>;
}

function StatusChip({ status }) {
  const map = {
    RASCUNHO: { bg: "#FFB347", color: "#1A1B26", border: "#FFB347" },
    CONFIRMADO: { bg: "var(--success)", color: "#1A1B26", border: "var(--success)" },
    EXPORTADO: { bg: "#BD93F9", color: "#1A1B26", border: "#BD93F9" },
  };
  const style = map[status] || map.RASCUNHO;
  return <span style={{ display: "inline-block", fontSize: "0.8125rem", fontWeight: 700, padding: "6px 12px", borderRadius: 999, background: style.bg, color: style.color, border: `1px solid ${style.border}`, whiteSpace: "nowrap" }}>{STATUS_LABELS[status] || status}</span>;
}

function TemplateBadge() {
  return <span style={{ display: "inline-block", fontSize: "0.8125rem", fontWeight: 700, padding: "6px 12px", borderRadius: 999, background: "#FFB347", color: "#1A1B26", border: "1px solid #FFB347", whiteSpace: "nowrap" }}>PREENCHER VALOR</span>;
}

// Input com autocomplete: busca conta no plano por código OU nome (substring, case-insensitive).
// Aceita digitar texto livre (ex: "receita serviç") — filtra ao vivo e mostra dropdown clicável.
// Aceita Tab/Enter pra selecionar o 1º resultado. Mostra Nome da conta resolvida ao lado.
function AccountSearchInput({ value, onChange, accounts, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selIdx, setSelIdx] = useState(-1);
  const ref = useRef(null);
  // sincroniza query com value externo quando muda de fora (ex: ao carregar entry)
  useEffect(() => { setQuery(String(value || "")); }, [value]);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const normalized = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const q = normalized(query);
  // ⚠ SUGERÍVEIS ≠ EXISTENTES. A conta sintética sai da OFERTA (oferecer é o sistema dizendo "use
  // esta") mas continua digitável, e `exactCodeMatch` segue olhando o plano INTEIRO — senão digitar
  // o código de uma sintética manteria o dropdown aberto insistindo em outra conta.
  const sugeriveis = useMemo(() => contasSugeriveis(accounts), [accounts]);
  const exactCodeMatch = q && accounts.some((a) => String(a.codigo).toLowerCase() === q);
  const matches = (q && !exactCodeMatch)
    ? sugeriveis.filter((a) =>
        String(a.codigo).toLowerCase().includes(q) ||
        normalized(a.nome).includes(q)
      ).slice(0, 12)
    : [];

  function pick(acc) {
    onChange(String(acc.codigo));
    setQuery(String(acc.codigo));
    setOpen(false);
    setSelIdx(-1);
  }

  // Digitou de novo? O destaque volta ao zero. Manter o índice enquanto a lista muda embaixo dele
  // é como o Tab confirmaria uma conta que a pessoa nunca chegou a ver destacada.
  useEffect(() => { setSelIdx(-1); }, [query]);

  /**
   * ⚠ CONTRATO ÚNICO DE TECLADO das três caixas de sugestão (aqui, `AccountCodeInput` e
   * `SmartHistoricoInput`) — antes cada uma tinha o seu, e este campo era o divergente.
   *
   *   ↑ ↓      destacam uma sugestão (↓ também ABRE a lista fechada)
   *   Enter    confirma a sugestão DESTACADA; sem destaque, segue o fluxo normal do campo
   *   Tab      confirma a sugestão DESTACADA e vai ao próximo campo; sem destaque, só fecha a
   *            lista e vai ao próximo campo
   *   Esc      fecha a LISTA (e só isso — o `stopPropagation` impede que o `<tr>` do rascunho
   *            entenda o Esc como "cancelar o lançamento")
   *
   * A escolha que muda o comportamento deste campo é o Tab: ele selecionava `matches[0]`
   * sozinho. Num campo de CONTA CONTÁBIL isso troca em silêncio o que o contador digitou pelo
   * primeiro palpite da lista — e "1.1.01" digitado inteiro casa por prefixo com "1.1.010", que
   * pode muito bem ser o primeiro da ordem do plano. Substituição de conta sem ninguém ter
   * apontado para ela é o tipo de erro que só aparece na exportação, semanas depois. Por isso
   * confirmar passou a exigir um destaque explícito; para o fluxo comum (digitar e seguir) o Tab
   * continua sendo uma tecla só, e agora ele leva ao PRÓXIMO CAMPO em vez de entrar na lista.
   */
  function handleKeyDown(e) {
    if (open && matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx((i) => Math.min(i + 1, matches.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") { if (selIdx >= 0) { e.preventDefault(); e.stopPropagation(); pick(matches[selIdx]); } return; }
      // Sem `preventDefault`: o foco precisa seguir para o próximo campo, que é o ponto do Tab.
      if (e.key === "Tab") { if (selIdx >= 0) pick(matches[selIdx]); else setOpen(false); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setSelIdx(-1); return; }
      return;
    }
    if (e.key === "ArrowDown" && matches.length > 0) { e.preventDefault(); setOpen(true); setSelIdx(0); }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        placeholder={placeholder || "Cód. ou nome"}
        autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          // Sempre propaga — backend tira não-dígitos no save se for código puro;
          // mas se o usuário ainda digitando texto, é a busca: não atualiza value até pick().
          // Para suportar usuários que colam o código direto: propaga só se for numérico.
          if (/^\d+$/.test(v.trim())) onChange(v.trim());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setSelIdx(-1); }}
        onKeyDown={handleKeyDown}
        style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", fontWeight: 700, width: "100%" }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, zIndex: 400,
          background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`,
          borderRadius: 6, boxShadow: "0 8px 28px rgba(0,0,0,0.25)",
          minWidth: 320, maxWidth: 480, maxHeight: 260, overflowY: "auto",
        }}>
          {matches.map((a, i) => (
            <button
              key={a.codigo}
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 10px", border: "none",
                borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`,
                background: selIdx === i ? ACCOUNTING_PANEL.surface : ACCOUNTING_PANEL.field,
                outline: selIdx === i ? "2px solid var(--success)" : "none", outlineOffset: "-2px",
                color: ACCOUNTING_PANEL.text, cursor: "pointer", fontSize: "0.78rem",
              }}
              onMouseEnter={() => setSelIdx(i)}
            >
              <div style={{ fontWeight: 700 }}>{a.codigo} · {a.nome}</div>
              {/* ⚠ Aqui o tipo JÁ APARECIA, mas cru (`ATIVO`) e sem o código completo. Passou ao
                  mesmo selo dos outros dois pontos: três grafias para a mesma informação fazem o
                  contador aprender três vocabulários. */}
              <SelosDaConta conta={a} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Códigos usados no lançamento que NÃO existem no plano de contas carregado.
 *
 * ⚠ POR QUE ISTO BLOQUEIA O SALVAR, e não só pinta de vermelho.
 * Digitar um código inexistente sempre foi possível: o backend só exigia que a conta não fosse
 * vazia. O lançamento entrava, participava da conciliação e do fechamento, e o erro só aparecia
 * na EXPORTAÇÃO para o ERP — longe do lançamento que o causou, às vezes semanas depois, e para
 * quem não o digitou. O servidor agora recusa (`conta_inexistente`); esta guarda é a antecipação,
 * para o contador não descobrir clicando em Salvar.
 *
 * Sem plano carregado (`accounts` vazio) NÃO acusa nada: ausência de dado não é prova de conta
 * inexistente, e travar o lançamento porque a lista ainda não chegou seria pior que o erro tardio.
 */
export function contasDesconhecidas(lines, accounts) {
  if (!accounts?.length) return [];
  const conhecidas = new Set(accounts.map((a) => String(a.codigo)));
  return [...new Set(
    (lines || [])
      .map((l) => String(l?.conta || "").trim())
      .filter((c) => c && !conhecidas.has(c)),
  )];
}

export function LineEditor({ lines, onChange, accounts }) {
  function updateLine(idx, field, val) { onChange(lines.map((l, i) => i === idx ? { ...l, [field]: val } : l)); }
  function removeLine(idx) { onChange(lines.filter((_, i) => i !== idx)); }
  function addLine(tipo) { onChange([...lines, { tipo, conta: "", valor: "" }]); }
  const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const diff = Math.abs(totalD - totalC);
  const balanced = diff < 0.01;
  const lineStyle = { display: "grid", gridTemplateColumns: "38px 140px 1fr 110px 28px", gap: 4, alignItems: "center", padding: "3px 0", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` };

  return (
    <div style={{ marginTop: 6, padding: 12, borderRadius: 8, background: ACCOUNTING_PANEL.field }}>
      <div style={{ display: "grid", gridTemplateColumns: "38px 140px 1fr 110px 28px", gap: 4, padding: "2px 0", fontSize: "0.6rem", fontWeight: 700, color: ACCOUNTING_PANEL.muted, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` }}>
        <span>D/C</span><span>Conta (cód/nome)</span><span>Nome resolvido</span><span style={{ textAlign: "right" }}>Valor (R$)</span><span></span>
      </div>
      {lines.map((l, idx) => {
        const resolved = accounts.find((a) => a.codigo === String(l.conta || "").trim());
        return (
          <div key={idx} style={lineStyle}>
            <select value={l.tipo} onChange={(e) => updateLine(idx, "tipo", e.target.value)} style={{ ...PANEL_FIELD_STYLE, width: "100%", height: 34, padding: "0 6px", fontWeight: 700, color: l.tipo === "D" ? "#8BE9FD" : "var(--success)", background: ACCOUNTING_PANEL.surface }}><option value="D">D</option><option value="C">C</option></select>
            <AccountSearchInput
              value={l.conta || ""}
              onChange={(v) => updateLine(idx, "conta", v)}
              accounts={accounts}
              placeholder="Cód. ou nome"
            />
            {/* ⚠ O TIPO APARECE NA LINHA QUE ESTÁ SENDO EDITADA, e é o momento que importa: é aqui
                que o contador vê "Ativo" ao lado da conta que ele acabou de pôr no crédito de uma
                provisão. O nome sozinho não distingue `137 CSLL` (ativo) de `256 CSLL A RECOLHER`. */}
            <div style={{ fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: resolved ? ACCOUNTING_PANEL.text : "var(--danger)", paddingLeft: 2, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {resolved ? resolved.nome : (l.conta ? `⚠ código ${l.conta} não encontrado` : "— vazio —")}
              </span>
              {resolved && <SelosDaConta conta={resolved} />}
            </div>
            <input type="number" step="0.01" min="0" placeholder="0,00" value={l.valor || ""} onChange={(e) => updateLine(idx, "valor", e.target.value)} style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", textAlign: "right" }} />
            {/* Idem `AccountingFunctionModals`: `style` só de MEDIDA, cor vinda do `.btn-danger`. */}
            <Button variant="danger" size="sm" onClick={() => removeLine(idx)}
              style={{ width: 24, minHeight: 24, padding: 0, fontSize: "0.7rem" }}>✕</Button>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => addLine("D")} style={{ ...PANEL_FIELD_STYLE, width: "auto", height: 32, padding: "0 12px", cursor: "pointer" }}>+ D</button>
        <button type="button" onClick={() => addLine("C")} style={{ ...PANEL_FIELD_STYLE, width: "auto", height: 32, padding: "0 12px", cursor: "pointer" }}>+ C</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", fontSize: "0.8rem" }}>
          <span>Débitos: <strong style={{ color: "#8BE9FD" }}>R$ {fmtValor(totalD)}</strong></span>
          <span>Créditos: <strong style={{ color: "var(--success)" }}>R$ {fmtValor(totalC)}</strong></span>
          {balanced ? <span style={{ color: "var(--success)", fontWeight: 700 }}>Balanceado</span> : <span style={{ color: "var(--danger)", fontWeight: 700 }}>Diferença: R$ {fmtValor(diff)}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * ⚠ O EDITOR DE N LINHAS — o que o ✎ abre quando o lançamento NÃO é 1D/1C.
 *
 * O ✎ abria sempre o `DraftEntryRow`, que é um editor de **1 débito / 1 crédito / 1 valor**. Num
 * lançamento de três linhas — `D principal · D juros · C total`, a forma da provisão de
 * parcelamento — ele lia `lines.find(D)` / `lines.find(C)`, montava um payload de DUAS linhas com o
 * valor do primeiro débito, e o `PUT /entries` (que faz `deleteMany` + `createMany`) apagava a
 * linha de juros do banco e ainda rebaixava o total. Sem erro, sem aviso, sem confirmação — e a
 * tela SABIA que era composto: ela desenha "2D / 1C ▶" na mesma linha e oferecia o ✎ igual.
 *
 * ⚠ ISTO NÃO MUDA A FORMA DE LANÇAMENTO NENHUM [[nao-mudar-forma-lancamentos]]. As linhas abrem
 * exatamente como estão gravadas e sobem exatamente como estão na tela; o que deixou de existir é
 * o caminho que as destruía em silêncio.
 *
 * ⚠ Reusa o `LineEditor` (acima, o mesmo que a Circular usa no seu modal de edição). Um segundo
 * editor de linhas divergiria do primeiro na primeira correção — é a classe de defeito que este
 * arquivo já documenta em três lugares.
 */
export function CompositeEntryEditorRow({ entry, accounts, saving, onSave, onClose, onSearchHistoricos }) {
  const [dateVal, setDateVal] = useState(entry.data ? String(entry.data).slice(0, 10) : "");
  const [historico, setHistorico] = useState(entry.historico || "");
  // Duas casas: é o formato que o `LineEditor` (input `type="number"`) lê de volta sem ambiguidade.
  const [lines, setLines] = useState(() => (entry.lines || []).map((l) => ({
    tipo: String(l.tipo || "D").toUpperCase(),
    conta: l.conta || "",
    valor: l.valor != null ? Number(l.valor).toFixed(2) : "",
  })));

  // ⚠ UMA LEITURA SÓ do valor, e é a MESMA do `LineEditor` (`Number(l.valor || 0)`): o número que
  // habilita o Salvar tem de ser o número que sobe no payload. Duas leituras da mesma string é
  // exatamente como o gate e o payload divergiriam depois.
  const valorDaLinha = (l) => Number(l.valor || 0);
  const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + valorDaLinha(l), 0);
  const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + valorDaLinha(l), 0);
  const diferenca = Math.abs(totalD - totalC);
  const semConta = lines.filter((l) => !String(l.conta || "").trim()).length;
  const semValor = lines.filter((l) => !(valorDaLinha(l) > 0)).length;
  const contasForaDoPlano = contasDesconhecidas(lines, accounts);
  // Mesma regra do `DraftEntryRow`: na edição só bloqueia a sintética que ESTA edição ACRESCENTA —
  // senão o lançamento que já está em conta de agregação ficaria preso no caminho que existe para
  // movê-lo.
  const codigosAtuais = useMemo(() => (entry?.lines || []).map((l) => l.conta), [entry]);
  const motivoSintetica = motivoContaSintetica(lines, accounts, codigosAtuais);
  const avisoSintetica = avisoContaSintetica(lines, accounts, codigosAtuais);

  const motivoNaoSalva = saving ? "Salvando…"
    : !dateVal ? "Informe a data do lançamento."
      : !historico ? "Informe o histórico."
        : !lines.length ? "O lançamento ficou sem linhas."
          : semConta ? `${semConta} linha(s) sem conta — preencha antes de salvar.`
            : semValor ? `${semValor} linha(s) sem valor (ou com valor ≤ 0).`
              : contasForaDoPlano.length ? `${contasForaDoPlano.join(", ")} — fora do plano de contas desta empresa.`
                : motivoSintetica ? motivoSintetica
                  : diferenca >= 0.01 ? `Débitos e créditos não fecham — diferença de R$ ${fmtValor(diferenca)}.`
                    : null;
  const canSave = !motivoNaoSalva;

  async function handleSave() {
    if (!canSave) return;
    const payload = {
      data: dateVal,
      historico,
      // O tipo e o subtipo são do lançamento — esta tela edita LINHAS, não reclassifica nada.
      tipo: entry.tipo,
      lines: lines.map((l, i) => ({
        conta: String(l.conta).trim(),
        tipo: l.tipo,
        valor: valorDaLinha(l),
        ordem: i,
      })),
    };
    if (entry.subtipo) payload.subtipo = entry.subtipo;
    const res = await onSave(payload);
    if (res !== null) onClose?.();
  }

  const dCount = lines.filter((l) => l.tipo === "D").length;
  const cCount = lines.filter((l) => l.tipo === "C").length;

  return (
    <tr style={{ background: "#202334", outline: "2px solid var(--success)", outlineOffset: "-2px" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose?.(); } }}>
      <td colSpan={COL_COUNT} style={{ ...TDv, padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <strong style={{ fontSize: "0.8125rem", color: ACCOUNTING_PANEL.text }}>
            Editando lançamento composto — {dCount}D / {cCount}C
          </strong>
          {entry.subtipo ? (
            <span style={{ fontSize: "0.72rem", color: ACCOUNTING_PANEL.muted }}>
              {TIPO_LABELS[entry.tipo] || entry.tipo} · {SUBTIPO_OPTIONS.find((o) => o.key === entry.subtipo)?.label || entry.subtipo}
            </span>
          ) : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "150px minmax(220px, 1fr)", gap: 10 }}>
          <label style={PANEL_LABEL_STYLE}>
            <span>Data</span>
            <input type="date" value={dateVal || ""} onChange={(e) => setDateVal(e.target.value)}
              style={{ ...PANEL_FIELD_STYLE, colorScheme: "dark", padding: "0 6px" }} />
          </label>
          <label style={PANEL_LABEL_STYLE}>
            <span>Histórico</span>
            <SmartHistoricoInput
              value={historico}
              onChange={setHistorico}
              // ⚠ O preenchimento por histórico salvo NÃO reescreve as linhas aqui: ele traz um par
              // D/C, e aplicá-lo a um lançamento de N linhas é o mesmo estrago que este editor
              // existe para impedir. Só o texto vem.
              onFillFromHistory={(h) => { if (h) setHistorico(h); }}
              onSearchHistoricos={onSearchHistoricos}
              accounts={accounts}
              competencia={entry.competencia}
            />
          </label>
        </div>
        {/* Colunas fixas do LineEditor: em telas estreitas rola só aqui. */}
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <LineEditor lines={lines} onChange={setLines} accounts={accounts} />
        </div>
        {contasForaDoPlano.length > 0 ? (
          <div style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--danger)", fontWeight: 600 }}>
            {contasForaDoPlano.join(", ")} — fora do plano de contas desta empresa
            <span style={{ fontWeight: 400, color: ACCOUNTING_PANEL.muted }}> — cadastre em Configurações → Plano de contas.</span>
          </div>
        ) : null}
        {avisoSintetica ? (
          <div style={{ marginTop: 6, fontSize: "0.78rem", color: motivoSintetica ? "var(--danger)" : "#FFB347", fontWeight: 600 }}>{avisoSintetica}</div>
        ) : null}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          {/* Botão desabilitado sem explicação é proibido neste projeto: o motivo fica à vista, não
              só no `title`. */}
          {motivoNaoSalva && !saving ? (
            <span style={{ fontSize: "0.78rem", color: "var(--danger)", fontWeight: 600 }}>{motivoNaoSalva}</span>
          ) : null}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => onClose?.()}>Cancelar</Button>
            <Button size="sm" variant="primary" onClick={handleSave} disabled={!canSave} title={motivoNaoSalva || "Salvar"}>{saving ? "..." : "Salvar"}</Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function detectSubtipoFromNome(nome) {
  const n = String(nome || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.includes("SIMPLES") || n.includes("DAS")) return "DAS";
  if (n.includes("IRRF") || (n.includes("IMPOSTO") && n.includes("RENDA"))) return "IRRF";
  if (n.includes("ISS")) return "ISS";
  // ⚠ PIS e COFINS separados: no plano de contas são contas distintas ("PIS A RECOLHER",
  // "COFINS A RECOLHER"), então a detecção é exata — "COFINS" não contém "PIS".
  // Conta COMBINADA ("PIS/COFINS A RECOLHER") é o único caso ambíguo: vence quem aparece primeiro
  // no nome, o que é determinístico e segue a ordem de leitura. Isto é SUGESTÃO num lançamento
  // manual — o contador escolhe o subtipo final na lista —, então um palpite explicável aqui não
  // grava nada errado sozinho.
  if (n.includes("PIS") && n.includes("COFINS")) return n.indexOf("PIS") < n.indexOf("COFINS") ? "PIS" : "COFINS";
  if (n.includes("COFINS")) return "COFINS";
  if (n.includes("PIS")) return "PIS";
  if (n.includes("FGTS")) return "FGTS";
  if (n.includes("FERI")) return "FERIAS";
  if (n.includes("13") || n.includes("DECIMO") || n.includes("NATALINO")) return "DECIMO_TERCEIRO";
  return "OUTROS_TRIBUTOS";
}

function detectTipoFromAccounts(contaD, contaC, accounts) {
  if (!contaD || !contaC || String(contaD).trim() === String(contaC).trim()) {
    return { tipo: "DESPESA", subtipo: null };
  }

  const accD = accounts.find((a) => a.codigo === String(contaD || "").trim());
  const accC = accounts.find((a) => a.codigo === String(contaC || "").trim());
  if (!accD && !accC) return { tipo: "DESPESA", subtipo: null };
  if (accC?.tipo === "RECEITA") return { tipo: "RECEITA", subtipo: null };
  if (accC?.tipo === "PASSIVO") {
    const n = String(accC.nome || "").toUpperCase();
    const isProvisao = /RECOLHER|PROVISAO|SIMPLES|DAS|IRRF|ISS|FGTS|PIS|COFINS|FERIAS|SALARIO|IMPOSTO|TRIBUT/.test(n);
    if (isProvisao) return { tipo: "PROVISAO", subtipo: detectSubtipoFromNome(accC.nome) };
  }
  if (accD) {
    const nd = String(accD.nome || "").toUpperCase();
    const isProvDed = /DAS|SIMPLES|IRRF|ISS|FGTS|PIS|COFINS/.test(nd);
    if (isProvDed && accC?.tipo === "PASSIVO") return { tipo: "PROVISAO", subtipo: detectSubtipoFromNome(accD.nome) };
  }
  if (accD?.tipo === "DESPESA") return { tipo: "DESPESA", subtipo: null };
  if (accD?.tipo === "RECEITA") return { tipo: "RECEITA", subtipo: null };
  return { tipo: "DESPESA", subtipo: null };
}

export function hasDuplicateAccountAcrossSides(lines) {
  const debitAccounts = new Set(
    (Array.isArray(lines) ? lines : [])
      .filter((line) => String(line.tipo || "").toUpperCase() === "D")
      .map((line) => String(line.conta || "").trim())
      .filter(Boolean)
  );

  return (Array.isArray(lines) ? lines : []).some((line) => {
    if (String(line.tipo || "").toUpperCase() !== "C") return false;
    const accountCode = String(line.conta || "").trim();
    return accountCode && debitAccounts.has(accountCode);
  });
}

export function AccountCodeInput({ id, value, onChange, onKeyDown, accounts, onGetHistoricosByCode, onSelectHistorico, placeholder, inputRef, competencia = null, onSearchHistoricos = null }) {
  const [open, setOpen] = useState(false);
  const [historicosRaw, setHistoricosRaw] = useState([]);
  // Q50: resolve o token {{competencia}} pro lançamento atual (exibição + texto aplicado).
  const historicos = useMemo(
    () => (competencia ? historicosRaw.map((h) => ({ ...h, text: resolveHistoricoText(h.text, competencia) })) : historicosRaw),
    [historicosRaw, competencia],
  );
  const ref = useRef(null);
  const debounceRef = useRef(null);
  const [selIdx, setSelIdx] = useState(-1);
  const itemRefs = useRef([]);

  // Q51: o campo aceita CÓDIGO ou PALAVRA-CHAVE ("caixa", "energia"…). Com letras, sugere
  // contas do plano pelo NOME e históricos pelo texto; selecionar preenche o código.
  const isKeyword = /[^\d.\s]/.test(String(value || ""));
  const normTxt = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Q31 fix: sugere contas do PLANO DE CONTAS pelo código digitado (prefixo). Antes só buscava históricos.
  const matchedAccounts = useMemo(() => {
    const v = String(value || "").trim();
    if (!v || !Array.isArray(accounts) || accounts.length === 0) return [];
    // ⚠ A conta SINTÉTICA sai da sugestão — ela é de agregação, e lançar nela é lançar num total.
    // Continua digitável (quem a digitar vê o aviso na linha); o que some é a OFERTA.
    const sugeriveis = contasSugeriveis(accounts);
    if (isKeyword) {
      if (v.length < 2) return [];
      const q = normTxt(v);
      return sugeriveis.filter((a) => normTxt(a.nome).includes(q)).slice(0, 8);
    }
    const starts = sugeriveis.filter((a) => String(a.codigo).startsWith(v));
    const contains = sugeriveis.filter((a) => !String(a.codigo).startsWith(v) && String(a.codigo).includes(v));
    return [...starts, ...contains].slice(0, 8);
  }, [value, accounts, isKeyword]);

  // Q31 fix: o dropdown é position:fixed (a tabela tem overflow:hidden e cortava a sugestão).
  const coords = useCoordenadasAncoradas(open, ref, historicos.length + matchedAccounts.length);

  useEffect(() => {
    const v = String(value || "").trim();
    if (v.length < 1) { setHistoricosRaw([]); return; }
    // Q51: palavra-chave → busca históricos pelo TEXTO (onSearchHistoricos); número → por código.
    const buscar = isKeyword
      ? (onSearchHistoricos && v.length >= 2 ? () => onSearchHistoricos(v) : null)
      : (onGetHistoricosByCode ? () => onGetHistoricosByCode(v) : null);
    if (!buscar) { setHistoricosRaw([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await buscar();
        setHistoricosRaw(Array.isArray(results) ? results : []);
        // ⚠ AQUI HAVIA UM `setOpen(true)` — e era ele que abria a lista sem ninguém ter pedido.
        //
        // O efeito reage ao VALOR, não a quem o escreveu. Três caminhos escrevem sem que haja
        // usuário digitando: abrir a linha em modo edição (os campos já vêm preenchidos),
        // preencher a conta programaticamente — inclusive a própria sugestão que acabou de ser
        // escolhida, que reabria a lista ~300 ms depois de fechá-la — e qualquer re-render que
        // trocasse a identidade das funções de busca.
        //
        // Abrir agora é decisão de quem digita: `onChange` do input, `onFocus` com sugestão
        // pronta e ↓. Chegar resultado só REABASTECE a lista; se ela estiver aberta, aparece.
      } catch {}
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [value, onGetHistoricosByCode, onSearchHistoricos, isKeyword]);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  // A lista exibida na ordem em que é RENDERIZADA (plano de contas e depois históricos) — o índice
  // do destaque tem de ser o mesmo que o olho conta na tela.
  const itens = useMemo(
    () => [
      ...matchedAccounts.map((a) => ({ _type: "account", ...a })),
      ...historicos.map((h) => ({ _type: "historico", ...h })),
    ],
    [matchedAccounts, historicos],
  );
  useEffect(() => { setSelIdx(-1); }, [value]);
  useEffect(() => { if (selIdx >= 0 && itemRefs.current[selIdx]) itemRefs.current[selIdx].scrollIntoView?.({ block: "nearest" }); }, [selIdx]);

  function aplicar(item) {
    if (item._type === "account") onChange(String(item.codigo));
    else onSelectHistorico?.(item.text, item.contaDebito, item.contaCredito);
    setOpen(false);
    setSelIdx(-1);
  }

  // Mesmo contrato de teclado do `AccountSearchInput` — ver o comentário grande lá em cima.
  // O que este campo não consome é repassado ao `onKeyDown` do pai (é ele que leva o Enter ao
  // próximo campo); consumir e repassar levaria o foco embora junto com a escolha.
  function handleKeyDown(e) {
    const temItens = itens.length > 0;
    if (e.key === "ArrowDown" && temItens) {
      e.preventDefault();
      if (!open) { setOpen(true); setSelIdx(0); } else setSelIdx((i) => Math.min(i + 1, itens.length - 1));
      return;
    }
    if (open && temItens) {
      if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" && selIdx >= 0) { e.preventDefault(); e.stopPropagation(); aplicar(itens[selIdx]); return; }
      if (e.key === "Tab") { if (selIdx >= 0) aplicar(itens[selIdx]); else setOpen(false); return; }
      // ⚠ Esc fecha a LISTA, não o lançamento. Sem o `stopPropagation` ele borbulhava até o `<tr>`
      // do `DraftEntryRow`, que o lê como "sair da linha": quem só queria se livrar do dropdown
      // perdia tudo o que já tinha digitado. Com a lista fechada o Esc passa adiante de novo — aí
      // sim ele fecha a linha, que é o único momento em que isso é o pedido.
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setSelIdx(-1); return; }
    }
    onKeyDown?.(e);
  }

  return (
    <div ref={ref} style={{ flexShrink: 0, position: "relative", minWidth: 0 }}>
      {/* Q51: aceita letras (palavra-chave) — antes o replace(/\D/g) apagava o que não era dígito. */}
      {/* ⚠ `onFocus` NÃO abre mais a lista, e `onBlur` fecha.
          Abrir no foco parecia inofensivo até o campo chegar preenchido: em modo edição, tabular
          por uma linha já digitada fazia um dropdown pular em cada campo, um por tecla. Abrir é
          decisão de quem digita (ou pede com ↓).
          Sem o `onBlur`, a lista continuava aberta depois do Tab levar o foco embora — e, como ela
          é `position: fixed`, duas listas de campos diferentes se sobrepunham na tela. O clique do
          mouse na sugestão não passa por aqui: o `onMouseDown` faz `preventDefault`, então o foco
          nunca chega a sair do input. */}
      <input ref={inputRef} id={id} type="text" value={value} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onKeyDown={handleKeyDown} onBlur={() => { setOpen(false); setSelIdx(-1); }} placeholder={placeholder || "Cód. ou palavra"} autoComplete="off" style={{ ...PANEL_FIELD_STYLE, padding: "0 8px", textAlign: "center" }} />
      {open && coords && (matchedAccounts.length > 0 || historicos.length > 0) && (
        <div style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 1000, background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 6, boxShadow: "0 8px 28px rgba(0,0,0,0.35)", minWidth: Math.max(300, coords.width), maxHeight: 260, overflowY: "auto" }}>
          {matchedAccounts.length > 0 && (
            <>
              <SectionLabel>Plano de contas — ↑↓ Enter/Tab para escolher</SectionLabel>
              {matchedAccounts.map((a, i) => (
                <button key={a.codigo} type="button" tabIndex={-1} ref={(el) => (itemRefs.current[i] = el)} onMouseDown={(e) => { e.preventDefault(); aplicar({ _type: "account", ...a }); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, background: selIdx === i ? ACCOUNTING_PANEL.surface : ACCOUNTING_PANEL.field, outline: selIdx === i ? "2px solid #8BE9FD" : "none", outlineOffset: "-2px", border: "none", cursor: "pointer", color: ACCOUNTING_PANEL.text }} onMouseEnter={() => setSelIdx(i)}>
                  {/* ⚠ O TIPO E O CÓDIGO COMPLETO FICAM À VISTA — pedido do dono, e é o conserto na
                      ORIGEM: com "Ativo" ao lado da conta 137, ninguém a escolhe para o crédito de
                      uma provisão. */}
                  <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.8rem" }}>{a.codigo}</span>
                      <span style={{ marginLeft: 6, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>{a.nome}</span>
                    </span>
                    <SelosDaConta conta={a} />
                  </span>
                </button>
              ))}
            </>
          )}
          {historicos.length > 0 && <SectionLabel>{isKeyword ? `Históricos com "${value}"` : `Históricos do código ${value}`}</SectionLabel>}
          {historicos.map((h, i) => { const globalIdx = matchedAccounts.length + i; return (
            <button key={h.id || i} type="button" tabIndex={-1} ref={(el) => (itemRefs.current[globalIdx] = el)} onMouseDown={(e) => { e.preventDefault(); aplicar({ _type: "historico", ...h }); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, background: selIdx === globalIdx ? ACCOUNTING_PANEL.surface : ACCOUNTING_PANEL.field, outline: selIdx === globalIdx ? "2px solid #BD93F9" : "none", outlineOffset: "-2px", border: "none", cursor: "pointer", color: ACCOUNTING_PANEL.text }} onMouseEnter={() => setSelIdx(globalIdx)}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{h.text}</div>
              <div style={{ fontSize: "0.65rem", color: ACCOUNTING_PANEL.muted, display: "flex", gap: 6, alignItems: "center" }}>
                {h.contaDebito && <span style={{ color: "#8BE9FD", fontWeight: 700 }}>D:{h.contaDebito}</span>}
                {h.contaCredito && <span style={{ color: "var(--success)", fontWeight: 700 }}>C:{h.contaCredito}</span>}
                <span style={{ fontSize: "0.6rem", padding: "1px 5px", borderRadius: 999, background: h.scope === "GLOBAL" ? "#44475A" : "#BD93F9", color: h.scope === "GLOBAL" ? "#F8F8F2" : "#1A1B26" }}>{h.scope === "GLOBAL" ? "Global" : "Empresa"}</span>
              </div>
            </button>
          ); })}
        </div>
      )}
    </div>
  );
}

export function SmartHistoricoInput({ value, onChange, onFillFromHistory, onSearchHistoricos, accounts, inputRef, inputStyle, preserveTypedText = false, competencia = null, onKeyDown = null }) {
  const [open, setOpen] = useState(false);
  const [historicosRaw, setHistoricosRaw] = useState([]);
  // Q50: históricos vêm tokenizados ({{competencia}}) — resolve pra competência do lançamento ATUAL,
  // tanto na exibição quanto no texto aplicado ao selecionar. Sem competência, mostra como está.
  const historicos = useMemo(
    () => (competencia ? historicosRaw.map((h) => ({ ...h, text: resolveHistoricoText(h.text, competencia) })) : historicosRaw),
    [historicosRaw, competencia],
  );
  const [selIdx, setSelIdx] = useState(-1);
  const ref = useRef(null);
  const itemRefs = useRef([]);
  const debounceRef = useRef(null);
  const accts = useMemo(() => {
    const q = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (q.length < 2 || !Array.isArray(accounts) || accounts.length === 0) return [];
    return accounts.filter((a) => String(a.nome || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q)).slice(0, 6);
  }, [value, accounts]);

  useEffect(() => {
    if (!onSearchHistoricos || value.trim().length < 2) { setHistoricosRaw([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => { try { const results = await onSearchHistoricos(value.trim()); setHistoricosRaw(Array.isArray(results) ? results : []); } catch {} }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [value, onSearchHistoricos]);

  const allItems = useMemo(() => [...historicos.map((h) => ({ _type: "historico", ...h })), ...accts.map((a) => ({ _type: "account", ...a }))], [historicos, accts]);
  // ⚠ AQUI HAVIA UM EFEITO QUE ABRIA A LISTA SOZINHO — `if (allItems.length > 0 && …) setOpen(true)`.
  //
  // Ele reagia ao conteúdo do campo sem saber quem o escreveu, e três coisas escrevem sem usuário
  // nenhum digitando: abrir a linha em modo edição (o histórico já vem preenchido), o
  // `onFillFromHistory` disparado ao escolher um histórico no campo de CONTA, e a própria escolha
  // feita aqui (que fecha a lista e via o texto mudar logo em seguida).
  //
  // E ele era redundante para o caso legítimo: quem digita já abre a lista pelo `onChange` do
  // input; quando as sugestões chegam, ela só se preenche. Aberto continua aberto.
  const coords = useCoordenadasAncoradas(open, ref, allItems.length, 4);
  useEffect(() => { if (selIdx >= 0 && itemRefs.current[selIdx]) itemRefs.current[selIdx].scrollIntoView?.({ block: "nearest" }); }, [selIdx]);
  useEffect(() => { setSelIdx(-1); }, [allItems.length]);

  function selectItem(item) {
    // Por padrão, ao escolher uma sugestão sobrescrevemos o texto digitado pelo
    // texto da sugestão (histórico salvo ou nome da conta). Quando `preserveTypedText`,
    // passamos o `value` atual — o consumidor mantém o que o usuário já digitou e só
    // aproveita as contas D/C. Útil em telas de texto livre longo (ex: modal OFX onde
    // o contador escreve "PAGO REFEICAO CONFRA EQUIPE" e a sugestão é só atalho para
    // descobrir o código contábil).
    let lines = null;
    if (item._type === "historico") {
      lines = [];
      if (item.contaDebito) lines.push({ tipo: "D", conta: item.contaDebito, valor: "" });
      if (item.contaCredito) lines.push({ tipo: "C", conta: item.contaCredito, valor: "" });
    } else {
      // account
      lines = item.natureza === "DEVEDORA"
        ? [{ tipo: "D", conta: item.codigo, valor: "" }]
        : [{ tipo: "C", conta: item.codigo, valor: "" }];
    }
    const textToPass = preserveTypedText
      ? value
      : (item._type === "historico" ? item.text : item.nome);
    onFillFromHistory(textToPass, lines.length ? lines : null);
    setOpen(false);
    setSelIdx(-1);
  }

  // Mesmo contrato de teclado dos campos de conta — ver o comentário grande no `AccountSearchInput`.
  // O que a LISTA não consome é repassado ao `onKeyDown` do pai: é assim que o Enter deste campo
  // chega ao próximo campo do formulário. Antes este `return` engolia tudo, e o Enter no Histórico
  // não levava a lugar nenhum (o campo era o fim da cadeia).
  function handleKeyDown(e) {
    if (!open || allItems.length === 0) {
      if (e.key === "ArrowDown" && allItems.length > 0) { setOpen(true); setSelIdx(0); e.preventDefault(); return; }
      onKeyDown?.(e);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx((i) => Math.min(i + 1, allItems.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && selIdx >= 0) { e.preventDefault(); e.stopPropagation(); selectItem(allItems[selIdx]); return; }
    // Mesmo contrato dos campos de conta: Tab confirma o que está DESTACADO e segue para o próximo
    // campo; sem destaque, só tira a lista do caminho. Sem `preventDefault` — o foco tem de andar.
    if (e.key === "Tab") { if (selIdx >= 0) selectItem(allItems[selIdx]); else setOpen(false); return; }
    // ⚠ `stopPropagation` — o Esc estava fechando o LANÇAMENTO INTEIRO.
    // Este componente vive dentro do `<tr>` do `DraftEntryRow`, que trata Esc como "sair da linha".
    // Fechar a lista e perder tudo o que já foi digitado eram a mesma tecla. Agora o Esc só chega
    // ao `<tr>` quando não há lista aberta para fechar antes.
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setSelIdx(-1); return; }
    // Enter SEM destaque (e qualquer outra tecla) segue o fluxo normal do campo — é o que mantém a
    // navegação viva com a lista aberta sem quebrar o "Enter confirma o destacado".
    onKeyDown?.(e);
  }

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      {/* Ver o comentário do `AccountCodeInput`: o foco deixou de abrir a lista (campo preenchido,
          em modo edição, fazia um dropdown pular a cada Tab) e o blur a fecha. */}
      <input ref={inputRef} type="text" value={value} placeholder="Histórico do lançamento..." onChange={(e) => { onChange(e.target.value); setOpen(true); }} onBlur={() => { setOpen(false); setSelIdx(-1); }} onKeyDown={handleKeyDown} style={{ ...PANEL_FIELD_STYLE, fontSize: "1.0625rem", fontWeight: 500, ...inputStyle }} />
      {open && coords && allItems.length > 0 && (
        <div style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 1000, background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.4)", minWidth: Math.max(420, coords.width), maxWidth: 760, maxHeight: 440, overflowY: "auto" }}>
          {historicos.length > 0 && <><SectionLabel>Históricos salvos — ↑↓ Enter/Tab para escolher</SectionLabel>{historicos.map((h, i) => <HistoricoSuggestionRow key={h.id || i} rowRef={(el) => (itemRefs.current[i] = el)} selected={selIdx === i} item={h} onClick={() => selectItem({ _type: "historico", ...h })} onHover={() => setSelIdx(i)} />)}</>}
          {accts.length > 0 && <><SectionLabel>Plano de contas</SectionLabel>{accts.map((a, i) => { const globalIdx = historicos.length + i; return <AccountSuggestionRow key={a.codigo} rowRef={(el) => (itemRefs.current[globalIdx] = el)} selected={selIdx === globalIdx} account={a} onClick={() => selectItem({ _type: "account", ...a })} onHover={() => setSelIdx(globalIdx)} />; })}</>}
        </div>
      )}
    </div>
  );
}

export function NewEntryForm({ accounts, onSave, saving, activeComp, onSearchHistoricos, onGetHistoricosByCode, listedTotalD, listedTotalC }) {
  const { min, max, defaultDate } = getCompRange(activeComp);
  const entryFontSize = "20px";
  const [dayStr, setDayStr] = useState(() => defaultDate ? String(Number(defaultDate.slice(8))) : "");
  const [dateVal, setDateVal] = useState(defaultDate);
  const [contaD, setContaD] = useState("");
  const [contaC, setContaC] = useState("");
  const [historico, setHistorico] = useState("");
  const [valor, setValor] = useState("");
  const [complexMode, setComplexMode] = useState(false);
  const [complexLines, setComplexLines] = useState([{ tipo: "D", conta: "", valor: "" }, { tipo: "C", conta: "", valor: "" }]);
  const dayRef = useRef(null);
  const dRef = useRef(null);
  const cRef = useRef(null);
  const histRef = useRef(null);
  const valRef = useRef(null);

  useEffect(() => {
    const { defaultDate: nd } = getCompRange(activeComp);
    setDateVal(nd);
    setDayStr(nd ? String(Number(nd.slice(8))) : "");
  }, [activeComp]);

  function handleDayChange(raw) {
    setDayStr(raw);
    if (raw === "" || raw === "0") { setDateVal(""); return; }
    const maxDay = max ? Number(max.slice(8)) : 31;
    const day = Math.max(1, Math.min(maxDay, Number(raw)));
    if (isNaN(day)) return;
    const [y, m] = (min || "").split("-");
    if (y && m) setDateVal(`${y}-${m}-${String(day).padStart(2, "0")}`);
  }

  const detected = useMemo(() => detectTipoFromAccounts(contaD, contaC, accounts), [contaD, contaC, accounts]);
  const simpleLines = [{ tipo: "D", conta: contaD, valor }, { tipo: "C", conta: contaC, valor }];
  const activeLines = complexMode ? complexLines : simpleLines;
  const totalD = activeLines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = activeLines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.01 && totalD > 0;
  const duplicateAcrossSides = hasDuplicateAccountAcrossSides(activeLines);
  const listedBalanceDelta = Number(listedTotalD || 0) - Number(listedTotalC || 0);
  const contasForaDoPlano = contasDesconhecidas(activeLines, accounts);
  // ⚠ ISTO ERA "AVISO, NÃO BLOQUEIO", E MUDOU: a ECD recusa partida em conta que não seja analítica
  // (registro I250, `IND_CTA = "A"`), então o servidor recusa também. Aqui é só a ANTECIPAÇÃO —
  // quem guarda é o backend. Este form só CRIA, então não há sintética preexistente a preservar.
  const motivoSintetica = motivoContaSintetica(activeLines, accounts);
  const avisoSintetica = avisoContaSintetica(activeLines, accounts);
  const canSave = dateVal && historico && balanced && !duplicateAcrossSides && !contasForaDoPlano.length && !motivoSintetica && !saving;

  function reset() {
    setContaD(""); setContaC(""); setHistorico(""); setValor(""); setComplexMode(false); setComplexLines([{ tipo: "D", conta: "", valor: "" }, { tipo: "C", conta: "", valor: "" }]);
    const { defaultDate: nd } = getCompRange(activeComp);
    setDateVal(nd); setDayStr(nd ? String(Number(nd.slice(8))) : "");
    setTimeout(() => dayRef.current?.focus(), 30);
  }

  async function handleSave() {
    if (!canSave) return;
    const payload = { data: dateVal, historico, tipo: detected.tipo, lines: activeLines.map((l, i) => ({ conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0), ordem: i })) };
    if (detected.tipo === "PROVISAO") payload.subtipo = detected.subtipo;
    await onSave(payload);
    reset();
  }

  const [labelY, labelM] = activeComp ? activeComp.split("-") : ["", ""];
  const monthLabel = activeComp ? new Date(Number(labelY), Number(labelM) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "";
  const tipoDetectadoLabel = detected.tipo === "PROVISAO" ? `Provisão · ${SUBTIPO_OPTIONS.find((o) => o.key === detected.subtipo)?.label || detected.subtipo || ""}` : TIPO_LABELS[detected.tipo] || detected.tipo;
  const hasConta = contaD || contaC;
  const totalCard = { display: "grid", gap: 2, padding: 8, borderRadius: 8, background: ACCOUNTING_PANEL.field, minWidth: 150, justifyItems: "center", textAlign: "center" };

  return (
    <div style={{ background: ACCOUNTING_PANEL.surface, borderRadius: 12, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 30, alignItems: "flex-end", flex: "1 1 860px", minWidth: 280, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "110px minmax(220px, 1fr) 72px 72px 140px", flex: "1 1 690px", minWidth: 280 }}>
            <label style={PANEL_LABEL_STYLE}><span>Data</span><input ref={dayRef} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Dia" value={dayStr} onChange={(e) => handleDayChange(e.target.value.replace(/\D/g, ""))} onBlur={() => { if (dayStr && Number(dayStr) > 0) handleDayChange(dayStr); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); histRef.current?.focus(); } }} style={{ ...PANEL_FIELD_STYLE, textAlign: "center", fontSize: entryFontSize, fontWeight: 500 }} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Histórico</span><SmartHistoricoInput value={historico} onChange={setHistorico} onFillFromHistory={(hist, histLines) => { if (hist) setHistorico(hist); if (histLines?.length) { const d = histLines.find((l) => l.tipo === "D"); const c = histLines.find((l) => l.tipo === "C"); if (d?.conta) setContaD(d.conta); if (c?.conta) setContaC(c.conta); if (d?.valor) setValor(String(d.valor)); } }} onSearchHistoricos={onSearchHistoricos} accounts={accounts} inputRef={histRef} inputStyle={{ fontSize: entryFontSize, fontWeight: 500 }} competencia={activeComp} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Débito</span><AccountCodeInput id="new-conta-d" value={contaD} onChange={setContaD} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); cRef.current?.focus(); } }} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode} onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }} placeholder="D" inputRef={dRef} competencia={activeComp} onSearchHistoricos={onSearchHistoricos} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Crédito</span><AccountCodeInput id="new-conta-c" value={contaC} onChange={setContaC} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); valRef.current?.focus(); } }} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode} onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }} placeholder="C" inputRef={cRef} competencia={activeComp} onSearchHistoricos={onSearchHistoricos} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Valor</span><input ref={valRef} className="accounting-entry-value-input" type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} placeholder="R$ 0,00" style={{ ...PANEL_FIELD_STYLE, textAlign: "right", fontSize: "1.0625rem", fontWeight: 500, minWidth: 140 }} /></label>
          </div>
          {/* ⚠ Era verde var(--success), na MESMA tela cujo rodapé usa verde para "D = C ✓ ok" — a linha
              de rascunho logo abaixo já tinha sido corrigida; este painel ficou para trás. */}
          <Button type="button" onClick={handleSave} disabled={!canSave} title={!dateVal ? "Informe o dia" : !historico ? "Informe o histórico" : !balanced ? "Valor ou contas incompletos" : duplicateAcrossSides ? "Débito e crédito não podem usar a mesma conta" : motivoSintetica || "Enter"} style={{ minHeight: 41, fontSize: entryFontSize, alignSelf: "end" }}>{saving ? "..." : "Salvar"}</Button>
        </div>
        <div style={{ display: "grid", gap: 4, minWidth: 150, width: 150, paddingTop: 16 }}>
          <div style={totalCard}><span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--success)" }}>Débito</span><span style={{ fontSize: "0.9375rem", fontWeight: 700, color: ACCOUNTING_PANEL.text }}>R$ {fmtValor(listedTotalD)}</span></div>
          <div style={totalCard}><span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--danger)" }}>Crédito</span><span style={{ fontSize: "0.9375rem", fontWeight: 700, color: ACCOUNTING_PANEL.text }}>R$ {fmtValor(listedTotalC)}</span></div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.875rem", color: listedBalanceDelta >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>Diferença: R$ {fmtValor(listedBalanceDelta)}</span>
        {monthLabel ? <span style={{ fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}>{monthLabel}</span> : null}
      </div>
      {duplicateAcrossSides ? (
        <div style={{ marginTop: 8, fontSize: "0.8125rem", color: "var(--danger)", fontWeight: 600 }}>
          Débito e crédito não podem usar a mesma conta.
        </div>
      ) : null}
      {/* O bloqueio se explica ANTES do clique — e diz o que fazer, não só o que está errado. */}
      {contasForaDoPlano.length > 0 ? (
        <div style={{ marginTop: 8, fontSize: "0.8125rem", color: "var(--danger)", fontWeight: 600 }}>
          {contasForaDoPlano.length === 1 ? "A conta " : "As contas "}
          {contasForaDoPlano.join(", ")}
          {contasForaDoPlano.length === 1 ? " não existe" : " não existem"} no plano desta empresa
          <span style={{ fontWeight: 400, color: ACCOUNTING_PANEL.muted }}> — cadastre em Configurações → Plano de contas.</span>
        </div>
      ) : null}
      {/* ⚠ A COR SEGUE O EFEITO, sempre: vermelho quando o Salvar está bloqueado por isto (o mesmo
          texto que está no `title` do botão), âmbar quando a conta é sintética mas o lançamento
          segue salvável. Vermelho ao lado de um Salvar habilitado esvaziaria o vermelho da linha
          acima, que bloqueia de verdade. */}
      {avisoSintetica ? (
        <div style={{ marginTop: 8, fontSize: "0.8125rem", color: motivoSintetica ? "var(--danger)" : "#FFB347", fontWeight: 600 }}>{avisoSintetica}</div>
      ) : null}
      {hasConta && <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}><span>Tipo detectado:</span><span style={{ fontWeight: 700, color: "#1A1B26", background: detected.tipo === "PROVISAO" ? "#FFB347" : detected.tipo === "RECEITA" ? "var(--success)" : "#BD93F9", border: "none", borderRadius: 999, padding: "4px 10px" }}>{tipoDetectadoLabel}</span></div>}
      {complexMode && <div style={{ marginTop: 8 }}><LineEditor lines={complexLines} onChange={setComplexLines} accounts={accounts} /></div>}
    </div>
  );
}

// Q18: linha editável de NOVO lançamento direto na tabela (substitui o form fixo).
// Ao salvar, limpa e mantém aberta (foca a Data) até ESC/Sair. Mesma lógica/payload do NewEntryForm.
export function DraftEntryRow({ accounts, onSave, saving, activeComp, onSearchHistoricos, onGetHistoricosByCode, onClose, mode = "create", entry = null }) {
  const isEdit = mode === "edit";
  // Q38: no modo edição, inicializa os campos a partir do lançamento (mesma disposição do criar).
  const initial = useMemo(() => {
    if (!isEdit || !entry) return null;
    const ls = entry.lines || [];
    const d = ls.find((l) => l.tipo === "D");
    const c = ls.find((l) => l.tipo === "C");
    const v = Number((d?.valor ?? c?.valor) || 0);
    return {
      dateVal: entry.data ? String(entry.data).slice(0, 10) : "",
      contaD: d?.conta || "",
      contaC: c?.conta || "",
      historico: entry.historico || "",
      // Formato BR ("1.234,56") e não `String(v)` ("1234.56"): é o mesmo formato que a tabela
      // exibe e que o parser lê de volta sem ambiguidade. Abrir a edição num formato e ler noutro
      // é como o valor mudaria sozinho ao salvar sem ninguém ter tocado no campo.
      valor: v ? fmtValor(v) : "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { min, max, defaultDate } = getCompRange(activeComp);
  const [dayStr, setDayStr] = useState(() => (isEdit ? "" : (defaultDate ? String(Number(defaultDate.slice(8))) : "")));
  const [dateVal, setDateVal] = useState(() => (initial ? initial.dateVal : defaultDate));
  const [contaD, setContaD] = useState(() => initial?.contaD || "");
  const [contaC, setContaC] = useState(() => initial?.contaC || "");
  const [historico, setHistorico] = useState(() => initial?.historico || "");
  const [valor, setValor] = useState(() => initial?.valor || "");
  const dayRef = useRef(null);
  const dRef = useRef(null);
  const cRef = useRef(null);
  const histRef = useRef(null);
  const valRef = useRef(null);
  // Motivo do Enter no Valor não ter salvado. Só aparece depois da tentativa — antes disso não há
  // nada a explicar, e um aviso permanente numa linha recém-aberta seria ruído.
  const [avisoSalvar, setAvisoSalvar] = useState(null);

  useEffect(() => {
    if (isEdit) return; // edição não re-deriva a data pela competência ativa
    const { defaultDate: nd } = getCompRange(activeComp);
    setDateVal(nd); setDayStr(nd ? String(Number(nd.slice(8))) : "");
  }, [activeComp, isEdit]);

  useEffect(() => { setTimeout(() => dayRef.current?.focus(), 30); }, []);

  function handleDayChange(raw) {
    setDayStr(raw);
    if (raw === "" || raw === "0") { setDateVal(""); return; }
    const maxDay = max ? Number(max.slice(8)) : 31;
    const day = Math.max(1, Math.min(maxDay, Number(raw)));
    if (isNaN(day)) return;
    const [y, m] = (min || "").split("-");
    if (y && m) setDateVal(`${y}-${m}-${String(day).padStart(2, "0")}`);
  }

  /**
   * ⚠ O CLAMP DO DIA DEIXOU DE SER SILENCIOSO — e o campo deixou de nascer armadilhado.
   *
   * O campo nasce preenchido (dia 1, quando a competência não é o mês corrente) e NÃO selecionava o
   * conteúdo ao focar: quem digitava "15" obtinha "115", que o `handleDayChange` prendia em 31 sem
   * que o texto do campo mudasse. A tela dizia 115, o payload levava 31, e ninguém era avisado —
   * numa DATA DE LANÇAMENTO CONTÁBIL, que é o campo em que errar custa mais caro.
   *
   * Duas correções, porque uma só não basta:
   *   1. `select()` no foco — ataca a causa: o "1" herdado some no primeiro dígito digitado.
   *   2. O valor corrigido APARECE. Enquanto o texto diverge do dia guardado a célula mostra
   *      "→ dia 31"; ao sair do campo, o próprio texto passa a ser o dia guardado. O princípio do
   *      projeto é que ausência de sinal nunca é resposta: valor que o sistema corrigiu sozinho
   *      precisa aparecer corrigido no campo, não só no payload.
   *
   * Corrigir e mostrar (em vez de recusar e travar) porque o clamp acerta o mês na esmagadora
   * maioria dos casos — "31" em fevereiro é o dia 28, e obrigar a redigitar não informaria mais
   * do que dizer qual dia ficou.
   */
  const diaGuardado = dateVal ? Number(String(dateVal).slice(8)) : null;
  const diaFoiCorrigido = !isEdit && dayStr !== "" && diaGuardado != null && String(diaGuardado) !== String(Number(dayStr));

  const detected = useMemo(() => detectTipoFromAccounts(contaD, contaC, accounts), [contaD, contaC, accounts]);
  // ⚠ UMA LEITURA SÓ do que foi digitado. Antes `Number(valor)` aparecia em três lugares — o gate
  // do Salvar, o payload e a init da edição — e três leituras independentes da mesma string é
  // exatamente como elas divergiriam depois. Aqui a célula aceita fórmula (`=10+10`), então
  // "o que está escrito" e "quanto vale" deixaram de ser a mesma coisa.
  const leitura = useMemo(() => valorUtilizavel(valor), [valor]);
  const lines = [{ tipo: "D", conta: contaD, valor }, { tipo: "C", conta: contaC, valor }];
  const duplicateAcrossSides = hasDuplicateAccountAcrossSides(lines);
  const contasForaDoPlano = contasDesconhecidas(lines, accounts);
  /**
   * ⚠ ISTO ERA "AVISO, NÃO BLOQUEIO", E A DECISÃO MUDOU — por um motivo externo: a ECD só aceita
   * partida em conta ANALÍTICA (registro I250, `IND_CTA = "A"`), então lançar numa conta de
   * agregação não é uma exceção legítima do escritório, é um arquivo que o PGE recusa na entrega.
   * O servidor recusa (`POST`/`PUT /entries` → 400 `CONTA_SINTETICA`); aqui é a antecipação.
   *
   * ⚠ `codigosAtuais` É O QUE MANTÉM A CORREÇÃO POSSÍVEL, e é a MESMA regra do backend: na EDIÇÃO
   * só bloqueia a sintética que ESTA edição acrescenta. Os 6 lançamentos que já existem em conta de
   * agregação continuam editáveis — inclusive para serem movidos à analítica certa, que é o que se
   * pede deles. Para QUAL analítica cada um vai é decisão do contador; o sistema não escolhe.
   */
  const codigosAtuais = useMemo(
    () => (isEdit ? (entry?.lines || []).map((l) => l.conta) : []),
    [isEdit, entry],
  );
  const motivoSintetica = motivoContaSintetica(lines, accounts, codigosAtuais);
  const avisoSintetica = avisoContaSintetica(lines, accounts, codigosAtuais);
  /**
   * ⚠ O GATE DO SALVAR VIROU UM MOTIVO, NÃO UM BOOLEANO — pelo mesmo argumento do `leitura`.
   *
   * Enquanto era só `canSave`, o botão desabilitava sem dizer por quê e o `handleSave` tinha um
   * `if (!canSave) return` mudo. Com o Enter passando a salvar a linha, esse `return` viraria a
   * troca de um defeito por outro: Enter que tenta salvar linha incompleta e falha em silêncio.
   * Uma leitura só alimenta o botão (`disabled` + `title`) e o aviso do Enter.
   *
   * Lançamento de 1 perna é válido (em aberto) — basta D OU C preenchido.
   * [[nao-mudar-forma-lancamentos]]
   */
  const motivoNaoSalva = saving ? "Salvando…"
    : !dateVal ? "Informe o dia do lançamento."
      : !historico ? "Informe o histórico."
        : (!contaD && !contaC) ? "Informe ao menos uma conta (débito ou crédito)."
          : leitura.vazio ? "Informe o valor."
            : !leitura.ok ? leitura.mensagem
              : duplicateAcrossSides ? "Débito e crédito não podem ser a mesma conta."
                : contasForaDoPlano.length ? `${contasForaDoPlano.join(", ")} — fora do plano de contas desta empresa.`
                  : motivoSintetica ? motivoSintetica
                    : null;
  const canSave = !motivoNaoSalva;
  // Resolvido o que faltava, o aviso sai sozinho: manter na tela um motivo já corrigido treina o
  // olho a ignorar a linha inteira.
  useEffect(() => { if (canSave) setAvisoSalvar(null); }, [canSave]);

  function reset() {
    setContaD(""); setContaC(""); setHistorico(""); setValor("");
    setAvisoSalvar(null);
    const { defaultDate: nd } = getCompRange(activeComp);
    setDateVal(nd); setDayStr(nd ? String(Number(nd.slice(8))) : "");
    setTimeout(() => dayRef.current?.focus(), 30);
  }

  async function handleSave() {
    if (!canSave) return;
    // Envia só as pernas preenchidas — permite lançamento de 1 perna (em aberto).
    const filled = lines.filter((l) => String(l.conta || "").trim());
    const payload = {
      data: dateVal,
      historico,
      tipo: isEdit ? entry.tipo : detected.tipo,
      // O valor vai da MESMA leitura que habilitou o Salvar — nunca de um `Number()` novo sobre o
      // texto, que devolveria NaN para "=10+10" e 0 para o `|| 0` logo em seguida.
      lines: filled.map((l, i) => ({ conta: String(l.conta).trim(), tipo: l.tipo, valor: leitura.valor, ordem: i })),
    };
    if (isEdit) {
      // Q38: preserva o tipo/subtipo do lançamento (não re-detecta).
      if (entry.subtipo) payload.subtipo = entry.subtipo;
    } else if (detected.tipo === "PROVISAO") {
      payload.subtipo = detected.subtipo;
    }
    const res = await onSave(payload);
    // Criar: sucesso → limpa e mantém aberta. Editar: sucesso → fecha. (onSave retorna null em falha.)
    if (res !== null) { if (isEdit) onClose?.(); else reset(); }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); onClose?.(); }
  }

  const cell = { ...TDv, padding: "6px 8px" };
  return (
    <tr style={{ background: "#202334", outline: "2px solid var(--success)", outlineOffset: "-2px" }} onKeyDown={onKeyDown}>
      <td style={{ ...cell, textAlign: "center" }} />
      {/* ⚠ A CADEIA DO ENTER SEGUE A MESMA ORDEM DO TAB — Dia → D → C → Histórico → Valor.
          Ela ia Dia → Histórico e MORRIA ali (o Histórico não repassava tecla nenhuma), enquanto a
          ordem visual e de tabulação (`COLS`) é Dia → D → C → Histórico → Valor. Quem usava Enter
          ficava preso no meio do formulário; quem usava Tab passava. Duas ordens para os mesmos
          cinco campos é uma a mais do que cabe na memória de quem lança cem linhas por dia.

          Isto NÃO conflita com o contrato do teclado das sugestões: com o dropdown aberto e uma
          sugestão destacada, o Enter é consumido lá dentro (confirma a sugestão) e nunca chega
          aqui. A navegação só vale quando não há destaque — que é o fluxo "digitei, segue". */}
      <td style={cell}>
        {isEdit ? (
          // Q47.1: coluna estreita — reduz o padding p/ o date (dd/mm/aaaa + ícone) não cortar o valor.
          <input ref={dayRef} type="date" value={dateVal || ""} onChange={(e) => setDateVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); dRef.current?.focus(); } }}
            style={{ ...PANEL_FIELD_STYLE, colorScheme: "dark", padding: "0 4px", minWidth: 0 }} />
        ) : (
          <input ref={dayRef} type="text" inputMode="numeric" placeholder="Dia" value={dayStr}
            onChange={(e) => handleDayChange(e.target.value.replace(/\D/g, ""))}
            // Seleciona o conteúdo ao focar: o campo nasce com o dia 1 e, sem isto, digitar "15"
            // produzia "115". Vale também no `reset()`, que refoca a linha nova.
            onFocus={(e) => e.target.select()}
            // Sair do campo alinha o texto ao dia que ficou guardado — ver o comentário do clamp.
            onBlur={() => { if (dayStr !== "" && diaGuardado != null) setDayStr(String(diaGuardado)); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); dRef.current?.focus(); } }}
            style={{ ...PANEL_FIELD_STYLE, textAlign: "center" }} />
        )}
        {diaFoiCorrigido ? (
          <div style={{ fontSize: "0.72rem", color: "#FFB347", marginTop: 2, textAlign: "center" }}>→ dia {diaGuardado}</div>
        ) : null}
      </td>
      <td style={cell}>
        <AccountCodeInput value={contaD} onChange={setContaD} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode}
          onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); cRef.current?.focus(); } }} placeholder="D" inputRef={dRef} competencia={activeComp} onSearchHistoricos={onSearchHistoricos} />
      </td>
      <td style={cell}>
        <AccountCodeInput value={contaC} onChange={setContaC} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode}
          onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); histRef.current?.focus(); } }} placeholder="C" inputRef={cRef} competencia={activeComp} onSearchHistoricos={onSearchHistoricos} />
      </td>
      <td style={cell}>
        <SmartHistoricoInput value={historico} onChange={setHistorico}
          onFillFromHistory={(hist, hl) => { if (hist) setHistorico(hist); if (hl?.length) { const d = hl.find((l) => l.tipo === "D"); const c = hl.find((l) => l.tipo === "C"); if (d?.conta) setContaD(d.conta); if (c?.conta) setContaC(c.conta); if (d?.valor) setValor(fmtValor(d.valor)); } }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); valRef.current?.focus(); } }}
          onSearchHistoricos={onSearchHistoricos} accounts={accounts} inputRef={histRef} competencia={activeComp} />
        {duplicateAcrossSides ? <div style={{ fontSize: "0.72rem", color: "var(--danger)", marginTop: 2 }}>Débito e crédito não podem ser a mesma conta.</div> : null}
        {contasForaDoPlano.length > 0 ? (
          <div style={{ fontSize: "0.72rem", color: "var(--danger)", marginTop: 2 }}>
            {contasForaDoPlano.join(", ")} — fora do plano de contas desta empresa.
          </div>
        ) : null}
        {/* ⚠ A COR SEGUE O EFEITO: vermelho quando ESTA edição está bloqueada por isto (o mesmo
            texto que o Salvar mostra como motivo), âmbar quando a sintética já estava no
            lançamento e ele segue salvável. Vermelho ao lado de um Salvar habilitado ensinaria a
            ignorar o vermelho da linha acima, que bloqueia de verdade. */}
        {avisoSintetica ? (
          <div style={{ fontSize: "0.72rem", color: motivoSintetica ? "var(--danger)" : "#FFB347", marginTop: 2 }}>{avisoSintetica}</div>
        ) : null}
        {/* O Enter no Valor tentou salvar e não deu: o motivo aparece aqui, na célula larga, junto
            dos outros bloqueios. Omitido quando o bloqueio já tem mensagem própria logo acima —
            dizer a mesma coisa duas vezes em cores diferentes é o começo de não ler nenhuma. */}
        {avisoSalvar && !duplicateAcrossSides && !contasForaDoPlano.length ? (
          <div style={{ fontSize: "0.72rem", color: "#FFB347", marginTop: 2 }}>{avisoSalvar}</div>
        ) : null}
      </td>
      <td style={cell}>
        {/* ⚠ `type="text"`, NÃO `type="number"`. Com `number` o browser devolve `""` para todo
            conteúdo que ele considera inválido — o `=` de uma fórmula zera o campo e a fórmula
            nunca chega ao handler. Não é preferência de estilo: é pré-requisito. `inputMode`
            mantém o teclado numérico no celular. */}
        <input ref={valRef} type="text" inputMode="decimal" autoComplete="off" value={valor} onChange={(e) => setValor(e.target.value)}
          // Último campo da cadeia: o Enter SALVA a linha. Quando não dá para salvar ele diz o
          // motivo em vez de não fazer nada — o `if (!canSave) return` mudo do `handleSave` seria,
          // aqui, um Enter que "não funciona" sem nunca explicar por quê.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (canSave) { setAvisoSalvar(null); handleSave(); } else setAvisoSalvar(motivoNaoSalva);
          }} placeholder="R$ 0,00 ou =10+10"
          // Ao sair do campo a fórmula VIRA o resultado — é o "=10+10 e vira 20" do pedido. Só
          // resolve quando deu certo: fórmula quebrada continua na tela como o usuário escreveu,
          // senão ele perde o que digitou e não sabe o que estava errado.
          //
          // ⚠ Lê o estado ATUAL na função de update, não o `leitura` do closure. Salvar com Enter
          // limpa o campo (`reset`), e um blur logo depois com o valor antigo em closure
          // RE-PREENCHERIA a linha nova com o valor do lançamento que acabou de ser salvo.
          onBlur={() => setValor((atual) => { const r = valorUtilizavel(atual); return r.ok && !r.vazio ? fmtValor(r.valor) : atual; })}
          style={{ ...PANEL_FIELD_STYLE, textAlign: "right", padding: "0 6px", minWidth: 0 }} />
        {/* ⚠ A PRÉVIA É O QUE TORNA A REGRA DO SEPARADOR SEGURA — não é enfeite.
            "2.500" pode ser dois mil e quinhentos ou dois e cinquenta, e o texto não distingue.
            Mostrar como o app leu ANTES de salvar transforma ambiguidade silenciosa em conferência
            de um relance. Fica DENTRO do <td>, abaixo do input — mesmo padrão dos avisos de conta
            duplicada e conta fora do plano: a célula cresce em altura e as colunas não se mexem. */}
        {!leitura.vazio && (
          <div style={{ fontSize: "0.72rem", marginTop: 2, textAlign: "right", color: leitura.ok ? ACCOUNTING_PANEL.muted : "var(--danger)" }}>
            {leitura.ok ? `= ${fmtValor(leitura.valor)}` : leitura.mensagem}
          </div>
        )}
      </td>
      {/* ⚠ AÇÕES EMPILHADAS, NÃO LADO A LADO — e isto conserta uma regressão.
          A coluna "Ações" foi estreitada para 92px (`COLS`, em `accountingEntriesShared`) porque nas
          linhas NORMAIS ela tem só dois ícones de 24px. A linha de rascunho, porém, tem dois botões
          de TEXTO: "Salvar" + "Sair"/"Cancelar" somam ~127-155px numa caixa de conteúdo de 76px. Com
          `flexWrap: nowrap` e `justify-content: flex-end`, o excesso transbordava **para a esquerda**
          — e como os botões têm fundo opaco, cobriam o campo Valor, que fica logo ao lado.

          Empilhar resolve sem alargar a coluna para as outras 99% das linhas: o rascunho já é alto
          (tem inputs), então o crescimento vertical não custa nada, e cada botão cabe sozinho nos
          76px. `minWidth: 0` deixa o flex encolher em vez de estourar. */}
      <td style={{ ...cell, textAlign: "right" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch", minWidth: 0 }}>
          {/* ⚠ Não é mais `variant="success"`. Verde significa CONCLUÍDO no vocabulário do app
              (`apps/web/CLAUDE.md`) — um botão verde de "faça isto" ensina o contrário na mesma tela
              em que o verde do rodapé (D = C ✓ ok) precisa ser lido como "está fechado". */}
          {/* Botão desabilitado sem explicação é o mesmo silêncio do Enter que não salva. */}
          <Button size="sm" variant="primary" onClick={handleSave} disabled={!canSave} title={motivoNaoSalva || "Salvar (Enter)"}>{saving ? "..." : "Salvar"}</Button>
          <Button size="sm" variant="secondary" onClick={() => onClose?.()}>{isEdit ? "Cancelar" : "Sair"}</Button>
        </div>
      </td>
    </tr>
  );
}

export function AccountRow({ entry, accounts, onUpdate, onDelete, saving, onCreateBaixa, savingBaixa, onSearchHistoricos, onGetHistoricosByCode = null, isSelected = false, onToggleSelect = null, onLoadBaixaTemplate = null }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showBaixa, setShowBaixa] = useState(false);
  // Ações da linha: discretas em repouso, nítidas no hover/foco. Ver `acaoLinhaStyle`.
  const [linhaAtiva, setLinhaAtiva] = useState(false);
  const exported = entry.status === "EXPORTADO";
  const isTemplate = entry.origem === "TEMPLATE" || entry.placeholder === true;
  const lines = entry.lines || [];
  const totalD = entry.totalD ?? lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
  const totalC = entry.totalC ?? lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor), 0);
  const dCount = lines.filter((l) => l.tipo === "D").length;
  const cCount = lines.filter((l) => l.tipo === "C").length;
  const hasDebitColumn = lines.some((l) => l.tipo === "D" && String(l.conta || "").trim());
  const hasCreditColumn = lines.some((l) => l.tipo === "C" && String(l.conta || "").trim());
  // Q26: lançamento de 1 perna ("em aberto") é válido — não marcar como "incompleto" (o balanço é no
  // total, não por lançamento). Só sinaliza falta de lado quando o lançamento tem 2+ linhas.
  const isIncompleteSides = lines.length > 1 && (!hasDebitColumn || !hasCreditColumn);
  // Q26: trata como linha limpa também o lançamento de 1 perna (só D ou só C) — sem dropdown/expand.
  // Só lançamento realmente composto (2+ de um lado) usa o selo "ND/NC" + expandir.
  const isSimple = dCount <= 1 && cCount <= 1;
  const dLine = lines.find((l) => l.tipo === "D");
  const cLine = lines.find((l) => l.tipo === "C");
  const dA = dLine ? accounts.find((a) => a.codigo === dLine.conta) : null;
  const cA = cLine ? accounts.find((a) => a.codigo === cLine.conta) : null;
  const duplicateAcrossSides = hasDuplicateAccountAcrossSides(lines);
  const incompleteRowStyle = isIncompleteSides ? { outline: "2px solid #8BE9FD", outlineOffset: "-2px" } : null;

  function startEdit() {
    setEditing(true);
  }

  // ⚠ COMPOSTO ABRE O EDITOR DE N LINHAS — o `DraftEntryRow` só sabe 1D/1C, e salvar por ele
  // APAGAVA as linhas que sobravam (o PUT faz `deleteMany` + `createMany`). A tela já sabia que era
  // composto: é o mesmo `isSimple` que desenha "2D / 1C ▶" logo abaixo.
  if (editing && !isSimple) {
    return (
      <CompositeEntryEditorRow
        entry={entry}
        accounts={accounts}
        saving={saving}
        onSave={(payload) => onUpdate(entry.id, payload)}
        onClose={() => setEditing(false)}
        onSearchHistoricos={onSearchHistoricos}
      />
    );
  }

  // Q38: editar usa a MESMA linha do criar (DraftEntryRow em modo "edit"), preservando tipo/subtipo.
  if (editing) {
    return (
      <DraftEntryRow
        mode="edit"
        entry={entry}
        accounts={accounts}
        saving={saving}
        onSave={(payload) => onUpdate(entry.id, payload)}
        onClose={() => setEditing(false)}
        onSearchHistoricos={onSearchHistoricos}
        onGetHistoricosByCode={onGetHistoricosByCode}
      />
    );
  }

  const rowBg = ACCOUNTING_PANEL.field;
  const rowBgHover = "#202334";
  return (
    <>
      {/* `id` é o alvo do "Falta para fechar": a tira do cadeado rola até a linha do lançamento
          com problema. */}
      {/* ⚠ `outline` estava declarado DUAS vezes aqui — o segundo sobrescrevia o do
          `incompleteRowStyle` mesmo com a linha não selecionada, então o contorno ciano de
          "falta um lado" nunca apareceu. Agora a seleção vence quando há seleção, e o aviso de
          incompleto aparece quando não há. */}
      <tr id={`lanc-${entry.id}`} style={{ background: isSelected ? "#2a2b3d" : rowBg, ...incompleteRowStyle, ...(isSelected ? { outline: "1px solid #BD93F9", outlineOffset: 0 } : incompleteRowStyle ? null : { outline: "none" }) }} onMouseEnter={(e) => { setLinhaAtiva(true); if (!isSelected) e.currentTarget.style.background = rowBgHover; }} onMouseLeave={(e) => { setLinhaAtiva(false); if (!isSelected) e.currentTarget.style.background = rowBg; }} onFocus={() => setLinhaAtiva(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setLinhaAtiva(false); }}>
        <td style={{ ...TDv, textAlign: "center", padding: "8px 4px" }}>
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" }}
              aria-label={`Selecionar ${entry.historico || "lançamento"}`}
            />
          )}
        </td>
        <td style={{ ...TDv, fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtDate(entry.data)}</td>
        {/* ⚠ O NOME DA CONTA SAIU DA CÉLULA E VIROU HOVER.
            Ele era uma segunda linha de 0.75rem sob o código, e a coluna é estreita demais para
            ele: chegava sempre cortado — "PARCELAMENTO SIM…", "RECEITA DE SERVIÇOS PRE…" e
            "RECEITA DE SERVIÇOS PRO…" ficam idênticos truncados, que é como se confere um
            lançamento na conta errada sem enxergar. Pior, a linha DOBRAVA a altura de toda linha
            da tabela para entregar um texto ilegível.

            Agora a célula mostra só o código (que é o que se compara de relance) e o `title` traz
            "código — nome completo" no hover, sem corte. `cursor: help` sinaliza que há mais ali —
            senão o hover seria mais uma coisa que só quem já sabe descobre. */}
        <td style={{ ...TDv, textAlign: isSimple ? "center" : "left" }} colSpan={isSimple ? 1 : 2} title={dA ? `${dLine?.conta} — ${dA.nome}` : undefined}>
          {isSimple ? <span style={{ display: "block", textAlign: "center", fontWeight: 700, fontSize: "0.9375rem", cursor: dA ? "help" : undefined }}>{dLine?.conta ? dLine.conta : <span style={{ color: ACCOUNTING_PANEL.muted, fontWeight: 400 }}>—</span>}</span> :<div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: "0.875rem", color: ACCOUNTING_PANEL.muted }}>{dCount}D / {cCount}C</span><button onClick={() => setExpanded((v) => !v)} style={{ fontSize: "0.75rem", background: ACCOUNTING_PANEL.surface, border: `1px solid ${ACCOUNTING_PANEL.border}`, color: ACCOUNTING_PANEL.text, borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>{expanded ? "▼" : "▶"}</button></div>}
        </td>
        {isSimple && <td style={{ ...TDv, textAlign: "center" }} title={cA ? `${cLine?.conta} — ${cA.nome}` : undefined}><span style={{ display: "block", textAlign: "center", fontWeight: 700, fontSize: "0.9375rem", cursor: cA ? "help" : undefined }}>{cLine?.conta ? cLine.conta :<span style={{ color: ACCOUNTING_PANEL.muted, fontWeight: 400 }}>—</span>}</span></td>}
        <td style={{ ...TDv, fontSize: "0.9375rem" }} title={entry.historico}>
          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.historico || "—"}</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
            {isTemplate
              ? <span style={{ fontSize: "0.7rem", color: "#1A1B26", background: "#FFB347", padding: "2px 7px", borderRadius: 999 }}>agendado</span>
              : entry.origem !== "MANUAL" && <span style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.text, background: ACCOUNTING_PANEL.surface, padding: "2px 7px", borderRadius: 999 }}>{ORIGEM_LABELS[entry.origem] || entry.origem}</span>}
            {entry.recalculatedAt && (
              <span
                style={{ fontSize: "0.7rem", color: "#1A1B26", background: "#FFB347", padding: "2px 7px", borderRadius: 999, fontWeight: 700 }}
                title={`Guia recalculada em ${fmtDate(entry.recalculatedAt)} — valor original R$ ${fmtValor(entry.recalculatedFromValor)} → atualizado R$ ${fmtValor(entry.recalculatedToValor)} (na circular). O valor do lançamento permanece o original.`}
              >
                Recalculada
              </span>
            )}
          </div>
        </td>
        <td style={{ ...TDv, textAlign: "right", fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{isTemplate ? <span style={{ color: ACCOUNTING_PANEL.text, fontSize: "0.875rem" }}>—</span> : fmtValor(totalD || totalC)}</td>
        {/* Q18: colunas Tipo e Status removidas. Status mostrado como chip discreto junto às ações pra template/exportado. */}
        <td style={{ ...TDv, textAlign: "right", borderRight: "none" }}>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
            {isTemplate && <TemplateBadge />}
            {/* ⚠ AÇÕES DISCRETAS EM REPOUSO. Eram roxo e VERMELHO fixos em toda linha: numa
                competência de 40 lançamentos, 40 botões vermelhos permanentes. Vermelho é a cor de
                "bloqueia/vencido" — gasto assim, ele para de significar isso justamente onde a tela
                precisa dele (D≠C, mês travado). O vermelho da exclusão vive no CONFIRM.

                Não usamos `opacity: 0`: o ícone continua legível em repouso, só sem cor. Ação que
                só existe depois do hover é ação que quem não passa o mouse nunca descobre — e some
                para leitor de tela e para teclado. Por isso `onFocus` também acende a linha. */}
            {!exported && <><button type="button" onClick={startEdit} disabled={saving} title="Editar lançamento" aria-label="Editar lançamento" style={{ ...PANEL_ICON_BUTTON_STYLE, background: linhaAtiva ? ACCOUNTING_PANEL.accent : "transparent", color: linhaAtiva ? "#1A1B26" : ACCOUNTING_PANEL.muted, border: `1px solid ${linhaAtiva ? "transparent" : ACCOUNTING_PANEL.border}` }}>✎</button><button type="button" onClick={() => onDelete(entry.id)} disabled={saving} title="Excluir lançamento" aria-label="Excluir lançamento" style={{ ...PANEL_ICON_BUTTON_STYLE, background: linhaAtiva ? "var(--danger)" : "transparent", color: linhaAtiva ? "#F8F8F2" : ACCOUNTING_PANEL.muted, border: `1px solid ${linhaAtiva ? "transparent" : ACCOUNTING_PANEL.border}` }}>⌫</button></>}
            {exported && <span style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.text }}>exportado</span>}
          </div>
        </td>
      </tr>
      {expanded && !isSimple && <tr style={{ background: ACCOUNTING_PANEL.surface }}><td colSpan={7} style={{ padding: "6px 16px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}><thead><tr><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>D/C</th><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Conta</th><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Nome</th><th style={{ textAlign: "right", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Valor</th></tr></thead><tbody>{lines.map((l, i) => { const acc = accounts.find((a) => a.codigo === l.conta); return <tr key={i}><td style={{ padding: "2px 6px", fontWeight: 700, color: l.tipo === "D" ? "#8BE9FD" : "var(--success)" }}>{l.tipo}</td><td style={{ padding: "2px 6px", fontWeight: 700 }}>{l.conta}</td><td style={{ padding: "2px 6px", color: ACCOUNTING_PANEL.muted }}>{acc?.nome || "—"}</td><td style={{ padding: "2px 6px", textAlign: "right" }}>{fmtValor(l.valor)}</td></tr>; })}</tbody></table></td></tr>}
      {showBaixa && <BaixaModal entry={entry} accounts={accounts} saving={savingBaixa} onSave={async (input) => { await onCreateBaixa(entry.id, input); setShowBaixa(false); }} onClose={() => setShowBaixa(false)} onLoadBaixaTemplate={onLoadBaixaTemplate} />}
    </>
  );
}

// =============================================================================
// PayrollEntryModal — botão "Folha / Pró-labore" cria lançamento com contas
// pré-preenchidas a partir do template, exibindo o INSS da guia no rodapé.
// =============================================================================

function competenciaToHistoricoLabel(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}

function lastDayOfCompetencia(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const day = new Date(yyyy, mm, 0).getDate();
  return `${m[1]}-${m[2]}-${String(day).padStart(2, "0")}`;
}

// Conjunto de roles que representam retenções no pró-labore/folha (subtraídas do bruto).
// Quando o template tiver novos roles (ex: CASP), basta adicionar aqui.
const RETENCAO_ROLES = new Set(["inss", "irrf", "casp", "fgts"]);

/**
 * ⚠ O QUE VAI PARA A TELA QUANDO O TEMPLATE NÃO CARREGA — e o que fica só no console.
 *
 * Enquanto `getPayrollTemplate` existia só no `realApi`, o modo mock estourava um `TypeError` e o
 * `err.message` ia **cru** para o lugar da tabela: *"api.getPayrollTemplate is not a function"*.
 * Isso não é mensagem para o contador — é o nome interno de uma função —, e não diz nem que ele
 * pode lançar a folha à mão enquanto isso.
 *
 * A recusa NOMEADA do servidor continua passando inteira: `UNKNOWN_PAYROLL_KIND` e afins dizem o
 * que fazer, e trocá-los por um texto genérico seria substituir um silêncio por outro.
 */
function mensagemDeFalhaDoTemplate(err) {
  const bruta = String(err?.message || "");
  const ehErroDePrograma = err instanceof TypeError || /is not a function|undefined is not|cannot read/i.test(bruta);
  if (bruta && !ehErroDePrograma) return bruta;
  // O detalhe técnico não se perde — ele vai para onde quem depura procura.
  if (err) console.error("[folha] falha ao carregar o template:", err);
  return "Não foi possível carregar o modelo de folha/pró-labore desta empresa. "
    + "As contas e os valores podem ser preenchidos à mão nas linhas abaixo; se a tabela não aparecer, "
    + "feche e abra o modal de novo.";
}

export function PayrollEntryModal({ accounts, defaultCompetencia, onLoadTemplate, onSave, saving, onClose }) {
  const [kind, setKind] = useState("PROLABORE");
  const [competencia, setCompetencia] = useState(defaultCompetencia || "");
  const [template, setTemplate] = useState(null);
  // Cada linha: { data, debito, credito, historico, valor, role?, _override? }
  // - role: vem do template ("salary"|"inss"|"irrf"|"liquid"|...). "_baixa" = linha de baixa.
  // - _override: true quando o usuário editou manualmente um valor que normalmente é calculado.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // F2: Repetir nos próximos N meses (0..12). Cria N+1 entries (este + N seguintes).
  const [repeatMonths, setRepeatMonths] = useState(0);
  // Quantos lançamentos a gravação em curso vai criar. Serve só para o aviso de progresso: com
  // 12 meses a chamada demora, e trocar o texto de um botão não comunica que algo está rodando —
  // dá a impressão de que o clique não pegou, e o contador clica de novo.
  const [gravandoTotal, setGravandoTotal] = useState(0);

  useEffect(() => {
    let canceled = false;
    if (!kind || !competencia) return undefined;
    setLoading(true);
    setError(null);
    onLoadTemplate(kind, competencia)
      .then((res) => {
        if (canceled) return;
        const tpl = res?.template || null;
        setTemplate(tpl);
        if (!tpl) return;
        const defaultDate = lastDayOfCompetencia(competencia);
        // Q34: valor da provisão do INSS vem da guia INSS da competência (editável).
        const inssGuideValor = tpl.inssGuide?.valor != null && Number(tpl.inssGuide.valor) > 0
          ? Number(tpl.inssGuide.valor).toFixed(2)
          : "";
        // Linhas da provisão: cada uma com apenas D OU C preenchido
        // F1: preserva `role` para reconhecer linha do líquido (cálculo automático).
        const provisaoRows = tpl.lines.map((l) => ({
          data: defaultDate,
          debito: l.side === "D" ? (l.accountCode || "") : "",
          credito: l.side === "C" ? (l.accountCode || "") : "",
          historico: l.historico || "",
          valor: l.role === "inss" ? inssGuideValor : "",
          role: l.role || null,
        }));
        // Linha de baixa: D + C preenchidos
        const baixaRow = tpl.baixa
          ? {
              data: defaultDate,
              debito: tpl.baixa.debitAccountCode || "",
              credito: tpl.baixa.creditAccountCode || "",
              historico: tpl.baixa.historico || "",
              valor: "",
              role: "_baixa",
            }
          : null;
        setRows(baixaRow ? [...provisaoRows, baixaRow] : provisaoRows);
      })
      .catch((err) => {
        if (canceled) return;
        setError(mensagemDeFalhaDoTemplate(err));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => { canceled = true; };
  }, [kind, competencia, onLoadTemplate]);

  // F1: Cálculo automático do líquido + baixa em tempo real.
  // Líquido = sum(linhas D com role "salary") - sum(linhas C com role retenção).
  // Preenche linha role="liquid" e linha role="_baixa" desde que o usuário não tenha
  // feito override manual (flag _override).
  useEffect(() => {
    const liquidIdx = rows.findIndex((r) => r.role === "liquid");
    if (liquidIdx === -1) return;
    const baixaIdx = rows.findIndex((r) => r.role === "_baixa");
    let totalSalary = 0;
    let totalRetencao = 0;
    for (const r of rows) {
      if (!r.role || r.role === "liquid" || r.role === "_baixa") continue;
      const v = Number(r.valor || 0);
      if (!Number.isFinite(v) || v <= 0) continue;
      if (r.role === "salary") {
        if (r.debito) totalSalary += v;
      } else if (RETENCAO_ROLES.has(r.role)) {
        if (r.credito) totalRetencao += v;
      }
    }
    const liquido = totalSalary - totalRetencao;
    const liquidoStr = liquido > 0 ? liquido.toFixed(2) : "";
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r, i) => {
        if (i !== liquidIdx && i !== baixaIdx) return r;
        if (r._override) return r;  // não sobrescreve edição manual
        if (r.valor === liquidoStr) return r;  // sem mudança
        changed = true;
        return { ...r, valor: liquidoStr };
      });
      return changed ? next : prev;
    });
    // Depende da "assinatura dos valores" das linhas — quando qualquer valor muda, recalcula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.role || ""}:${r.debito || ""}:${r.credito || ""}:${r.valor || ""}`).join("|")]);

  function updateRow(idx, field, value) {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, [field]: value };
      // F1: marca _override quando o usuário edita manualmente o valor de uma linha calculada
      if (field === "valor" && (r.role === "liquid" || r.role === "_baixa")) {
        // Se voltar a vazio, libera o auto-cálculo
        next._override = String(value || "").trim() !== "";
      }
      return next;
    }));
  }

  // F1: usuário clica no ícone ✎/⚙ para restaurar auto-cálculo de uma linha
  function restoreAutoCalc(idx) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, _override: false, valor: "" } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        data: lastDayOfCompetencia(competencia),
        debito: "",
        credito: "",
        historico: "",
        valor: "",
      },
    ]);
  }

  function removeRow(idx) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  // Linhas válidas: ao menos uma conta + valor > 0
  const validRows = rows.filter(
    (r) => Number(r.valor) > 0 && (String(r.debito || "").trim() || String(r.credito || "").trim())
  );

  // Provisão = linhas com APENAS um lado (D xor C)
  const provisaoRowsFilled = validRows.filter(
    (r) => Boolean(String(r.debito || "").trim()) !== Boolean(String(r.credito || "").trim())
  );
  // Baixas = linhas com AMBOS lados
  const baixaRowsFilled = validRows.filter(
    (r) => String(r.debito || "").trim() && String(r.credito || "").trim()
  );

  const totalD = provisaoRowsFilled
    .filter((r) => r.debito)
    .reduce((s, r) => s + Number(r.valor || 0), 0);
  const totalC = provisaoRowsFilled
    .filter((r) => r.credito)
    .reduce((s, r) => s + Number(r.valor || 0), 0);
  const provisaoBalanced =
    provisaoRowsFilled.length === 0 || (Math.abs(totalD - totalC) < 0.01 && totalD > 0);

  async function handleSave() {
    setError(null);
    if (validRows.length === 0) {
      setError("Preencha valor e contas em ao menos uma linha.");
      return;
    }
    if (!provisaoBalanced) {
      setError(`Provisão desbalanceada — débito R$ ${totalD.toFixed(2)} ≠ crédito R$ ${totalC.toFixed(2)}.`);
      return;
    }

    // Q52: cada linha da provisão vira UM lançamento individual (1 perna) no backend,
    // agrupado por loteImportacao — mesma regra dos parcelamentos (Q24.6).
    const provisoes = provisaoRowsFilled.map((r) => ({
      data: r.data || lastDayOfCompetencia(competencia),
      historico: (r.historico || "").trim()
        || `${kind === "PROLABORE" ? "PRÓ-LABORE" : "FOLHA"} — ${competenciaToHistoricoLabel(competencia)}`,
      line: {
        tipo: r.debito ? "D" : "C",
        conta: String(r.debito || r.credito).trim(),
        valor: Number(r.valor),
      },
    }));

    const baixas = baixaRowsFilled.map((r) => ({
      data: r.data || lastDayOfCompetencia(competencia),
      historico: (r.historico || "").trim() || `PAGAMENTO ${competenciaToHistoricoLabel(competencia)}`,
      lines: [
        { tipo: "D", conta: String(r.debito).trim(), valor: Number(r.valor), ordem: 0 },
        { tipo: "C", conta: String(r.credito).trim(), valor: Number(r.valor), ordem: 1 },
      ],
    }));

    // F2: Confirmação antes de criar múltiplas competências
    const repeatN = Math.max(0, Math.min(12, Number(repeatMonths) || 0));
    if (repeatN > 0) {
      const totalEntries = repeatN + 1;
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        `Isso vai criar ${totalEntries} lançamentos (este mês + ${repeatN} mês${repeatN === 1 ? "" : "es"} seguintes), `
        + `replicando valores e contas. Continuar?`,
      );
      if (!ok) return;
    }

    setGravandoTotal(repeatN + 1);
    try {
      await onSave({ competencia, subtipo: kind, provisoes, baixas, repeatMonths: repeatN });
    } finally {
      setGravandoTotal(0);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  };
  const modal = {
    background: "#24253A", border: "1px solid #44475A", borderRadius: 10,
    padding: 22, width: 980, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto",
    color: "#F8F8F2", boxSizing: "border-box",
    position: "relative", // âncora do overlay de progresso
  };
  const labelStyle = { display: "grid", gap: 4, fontSize: "0.8125rem", color: "#aeb6d3", marginBottom: 10 };
  const inputStyle = {
    background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6,
    color: "#F8F8F2", padding: "6px 8px", fontSize: "0.85rem", width: "100%", boxSizing: "border-box",
  };
  const cellStyle = { padding: "4px", verticalAlign: "middle", borderBottom: "1px solid #2D2F45" };
  const headStyle = {
    padding: "8px 6px", textAlign: "left", color: "#aeb6d3", fontSize: "0.75rem",
    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
    borderBottom: "1px solid #44475A", background: "#1A1B26",
  };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Nova Folha / Pró-labore</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6272A4", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <label style={labelStyle}>
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputStyle, padding: "8px 10px", fontSize: "0.9rem" }}>
              <option value="PROLABORE">Pró-labore</option>
              <option value="FOLHA">Folha de Pagamento</option>
            </select>
          </label>
          <label style={labelStyle}>
            Competência (AAAA-MM)
            <input
              type="text"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value.trim())}
              placeholder="2026-01"
              style={{ ...inputStyle, padding: "8px 10px", fontSize: "0.9rem" }}
            />
          </label>
        </div>


        {loading && <p style={{ color: "#6272A4" }}>Carregando template...</p>}

        {!loading && rows.length > 0 && (
          <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #44475A" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ ...headStyle, width: "150px" }}>Data</th>
                  <th style={{ ...headStyle, width: "100px" }}>Débito</th>
                  <th style={{ ...headStyle, width: "100px" }}>Crédito</th>
                  <th style={headStyle}>Histórico</th>
                  <th style={{ ...headStyle, width: "150px", textAlign: "right" }}>Valor (R$)</th>
                  <th style={{ ...headStyle, width: "36px" }} aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const dAccount = r.debito && accounts.find((a) => a.codigo === String(r.debito).trim());
                  const cAccount = r.credito && accounts.find((a) => a.codigo === String(r.credito).trim());
                  return (
                    <tr key={idx}>
                      <td style={cellStyle}>
                        <input
                          type="date"
                          value={r.data}
                          onChange={(e) => updateRow(idx, "data", e.target.value)}
                          style={{ ...inputStyle, colorScheme: "dark" }}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="text"
                          list={`payroll-acc-${idx}`}
                          value={r.debito}
                          onChange={(e) => updateRow(idx, "debito", e.target.value)}
                          placeholder="—"
                          style={{ ...inputStyle, fontWeight: 700, color: r.debito ? "#8BE9FD" : "#6272A4", textAlign: "center" }}
                        />
                        {dAccount && <div style={{ fontSize: "0.65rem", color: "#6272A4", marginTop: 2, textAlign: "center" }}>{dAccount.nome}</div>}
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="text"
                          list={`payroll-acc-${idx}`}
                          value={r.credito}
                          onChange={(e) => updateRow(idx, "credito", e.target.value)}
                          placeholder="—"
                          style={{ ...inputStyle, fontWeight: 700, color: r.credito ? "var(--success)" : "#6272A4", textAlign: "center" }}
                        />
                        {cAccount && <div style={{ fontSize: "0.65rem", color: "#6272A4", marginTop: 2, textAlign: "center" }}>{cAccount.nome}</div>}
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="text"
                          value={r.historico}
                          onChange={(e) => updateRow(idx, "historico", e.target.value)}
                          style={{ ...inputStyle }}
                        />
                        <datalist id={`payroll-acc-${idx}`}>
                          {accounts.map((a) => (
                            <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>
                          ))}
                        </datalist>
                      </td>
                      <td style={cellStyle}>
                        {/* F1: linhas calculadas (liquid/_baixa) ganham ícone ao lado do input */}
                        {(r.role === "liquid" || r.role === "_baixa") ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input
                              type="number"
                              step="0.01"
                              value={r.valor}
                              onChange={(e) => updateRow(idx, "valor", e.target.value)}
                              placeholder="0,00"
                              style={{
                                ...inputStyle, textAlign: "right",
                                background: r._override ? "#1A1B26" : "rgba(189,147,249,0.08)",
                                borderColor: r._override ? "#FFB347" : "#44475A",
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => r._override && restoreAutoCalc(idx)}
                              title={r._override
                                ? "Editado manualmente — clique para restaurar cálculo automático"
                                : "Valor calculado automaticamente (salário − retenções)"}
                              style={{
                                background: "transparent", border: "none",
                                color: r._override ? "#FFB347" : "#BD93F9",
                                width: 22, height: 22, padding: 0, cursor: r._override ? "pointer" : "default",
                                fontSize: "0.9rem", lineHeight: 1,
                              }}
                            >
                              {r._override ? "✎" : "⚙"}
                            </button>
                          </div>
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            value={r.valor}
                            onChange={(e) => updateRow(idx, "valor", e.target.value)}
                            placeholder="0,00"
                            style={{ ...inputStyle, textAlign: "right" }}
                          />
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          title="Remover linha"
                          style={{
                            background: "transparent",
                            border: "1px solid #44475A",
                            color: "#FF5757",
                            width: 26, height: 26, borderRadius: 6,
                            cursor: "pointer", fontSize: "0.85rem", lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={6} style={{ padding: "8px 12px", textAlign: "left" }}>
                    <button
                      type="button"
                      onClick={addRow}
                      style={{
                        background: "transparent",
                        border: "1px dashed #6272A4",
                        color: "#BD93F9",
                        padding: "6px 14px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      + Adicionar linha
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr style={{ background: "#1A1B26" }}>
                  <td colSpan={6} style={{ padding: "8px 12px", fontSize: "0.78rem", color: provisaoBalanced ? "var(--success)" : "#FFB347" }}>
                    Provisão — D R$ {totalD.toFixed(2)} / C R$ {totalC.toFixed(2)}{" "}
                    {provisaoBalanced ? "✓" : "(desbalanceado)"}
                    {baixaRowsFilled.length > 0 && (
                      <span style={{ marginLeft: 12, color: "#8BE9FD" }}>
                        {baixaRowsFilled.length} pagamento{baixaRowsFilled.length !== 1 ? "s" : ""} a registrar
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {template?.inssGuide && (
          <div style={{ marginTop: 10, padding: 8, fontSize: "0.78rem", color: "#aeb6d3" }}>
            <strong style={{ color: "#FFB347" }}>INSS da guia: R$ {fmtValor(template.inssGuide.valor)}</strong>
            {template.inssGuide.vencimento && <span> · vencimento {fmtDate(template.inssGuide.vencimento)}</span>}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
            {error}
          </div>
        )}

        {/* F2: Repetir N meses — útil para pró-labore fixo recorrente */}
        <div style={{
          display: "flex", gap: 12, alignItems: "center", marginTop: 14, padding: "10px 12px",
          background: "#1A1B26", borderRadius: 8, border: "1px solid #44475A",
        }}>
          <label style={{ fontSize: "0.8125rem", color: "#aeb6d3", display: "flex", alignItems: "center", gap: 8 }}>
            <span>↻ Repetir nos próximos</span>
            <input
              type="number"
              min={0}
              max={12}
              value={repeatMonths}
              onChange={(e) => {
                const n = Math.max(0, Math.min(12, Number(e.target.value) || 0));
                setRepeatMonths(n);
              }}
              style={{
                width: 60, background: "#24253A", border: "1px solid #44475A",
                borderRadius: 6, color: "#F8F8F2", padding: "4px 8px",
                fontSize: "0.9rem", textAlign: "center",
              }}
            />
            <span>meses</span>
          </label>
          <span style={{ fontSize: "0.7rem", color: "#6272A4", flex: 1 }}>
            {repeatMonths > 0
              ? `Vai criar ${repeatMonths + 1} lançamentos (este + ${repeatMonths} mês${repeatMonths === 1 ? "" : "es"} seguintes), substituindo MM/AAAA no histórico.`
              : "Padrão: 0 (só esta competência). Útil para pró-labore fixo mensal."}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || loading || validRows.length === 0}>
            {saving ? "Salvando..." : repeatMonths > 0 ? `Salvar ${repeatMonths + 1} lançamentos` : "Salvar lançamento"}
          </Button>
        </div>

        {/* Progresso da gravação. Cobre o modal inteiro de propósito: além de mostrar que está
            rodando, impede um segundo clique enquanto a primeira chamada não volta. */}
        {gravandoTotal > 0 && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute", inset: 0, borderRadius: 10,
              background: "rgba(36,37,58,0.88)", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center", padding: 24,
            }}
          >
            <div
              style={{
                width: 34, height: 34, borderRadius: "50%",
                border: "3px solid #44475A", borderTopColor: "var(--success)",
                animation: "girar 0.8s linear infinite",
              }}
            />
            <strong style={{ fontSize: "0.95rem" }}>
              {gravandoTotal === 1 ? "Gravando o lançamento…" : `Gravando ${gravandoTotal} lançamentos…`}
            </strong>
            {gravandoTotal > 1 && (
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Um por competência. Não feche esta janela.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CsvExportModal — escolhe intervalo de competências (AAAA-MM até AAAA-MM)
// =============================================================================

/**
 * Uma linha da conferência. Clicável quando há lançamento de origem — apontar um problema sem
 * levar até ele obriga a caçar a linha no meio de trezentas.
 *
 * Alerta de escopo do MÊS (mês não fechado) não tem `entryId`: aí não é botão, porque um clique
 * que não vai a lugar nenhum é pior que texto.
 */
function ItemConferencia({ item, cor, rotulo, onIr }) {
  const podeIr = Boolean(item.entryId && onIr);
  const conteudo = (
    <>
      <span style={{ color: cor, fontWeight: 800, fontSize: "0.66rem", letterSpacing: "0.04em" }}>{rotulo}</span>
      <span style={{ color: "#F8F8F2" }}>{item.motivo}</span>
      {item.ocorrencias > 1 && <span style={{ color: "var(--text-muted)" }}>· {item.ocorrencias}×</span>}
      {item.historico && <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>· {item.historico}</span>}
    </>
  );
  const estilo = {
    display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
    fontSize: "0.76rem", textAlign: "left", padding: "3px 6px", borderRadius: 6,
    border: `1px solid ${cor}44`, background: `${cor}14`,
  };
  if (!podeIr) return <span style={estilo}>{conteudo}</span>;
  return (
    <button type="button" onClick={() => onIr(item.entryId)} title="Ir até o lançamento" style={{ ...estilo, width: "100%", cursor: "pointer", font: "inherit" }}>
      {conteudo}
    </button>
  );
}

export function CsvExportModal({ defaultCompetencia, onExport, onClose, onPreflight, onIrAteLancamento, onReabrir }) {
  const [inicio, setInicio] = useState(defaultCompetencia || "");
  const [fim, setFim] = useState(defaultCompetencia || "");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [preflight, setPreflight] = useState(null);

  const validFormat = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ""));

  // ⚠ A CONFERÊNCIA É DE UM MÊS SÓ, e é por isso que ela só roda com início = fim.
  // O pré-voo responde "o que o ERP recusaria nesta competência"; fingir que ele cobre um intervalo
  // de doze meses seria dar um "tudo certo" que não foi verificado — pior que não conferir.
  const mesUnico = validFormat(inicio) && inicio === fim;

  // Trocar o intervalo invalida a conferência anterior. Sem isto, o painel continuaria verde
  // enquanto o usuário exporta OUTRO mês — exatamente o "verificado" que engana.
  useEffect(() => { setPreflight(null); }, [inicio, fim]);

  const temErros = (preflight?.erros?.length || 0) > 0;
  const temAlertas = (preflight?.alertas?.length || 0) > 0;

  async function conferir() {
    if (!mesUnico || !onPreflight) return;
    setError(""); setConferindo(true);
    try {
      setPreflight(await onPreflight(inicio));
    } catch (err) {
      setError(err?.message || "Não foi possível conferir o lote.");
    } finally {
      setConferindo(false);
    }
  }

  async function handleExport() {
    setError("");
    if (!validFormat(inicio) || !validFormat(fim)) {
      setError("Use o formato AAAA-MM (ex: 2026-01).");
      return;
    }
    if (fim < inicio) {
      setError("A competência final deve ser maior ou igual à inicial.");
      return;
    }
    // Erro é ERRO: não há confirmação que faça o ERP aceitar um lançamento desbalanceado.
    if (temErros) {
      setError("Corrija os erros abaixo antes de exportar — o ERP recusaria o arquivo.");
      return;
    }
    // Alerta CONFIRMA. A frase repete o que está em jogo em vez de perguntar "tem certeza?".
    if (temAlertas) {
      const lista = preflight.alertas.map((a) => `• ${a.motivo}`).join("\n");
      if (!window.confirm(`Exportar mesmo assim?\n\n${lista}\n\nO arquivo será gerado com estes alertas.`)) return;
    }
    setExporting(true);
    try {
      await onExport({ competenciaInicio: inicio, competenciaFim: fim });
      onClose();
    } catch (err) {
      setError(err?.message || "Falha ao exportar.");
    } finally {
      setExporting(false);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  };
  const modal = {
    background: "#24253A", border: "1px solid #44475A", borderRadius: 10,
    padding: 22, width: 460, maxWidth: "100%", color: "#F8F8F2", boxSizing: "border-box",
  };
  const labelStyle = { display: "grid", gap: 4, fontSize: "0.8125rem", color: "#aeb6d3", marginBottom: 12 };
  const inputStyle = {
    background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6,
    color: "#F8F8F2", padding: "8px 10px", fontSize: "0.95rem", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Exportar CSV</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6272A4", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <p style={{ fontSize: "0.85rem", color: "#aeb6d3", margin: "0 0 14px" }}>
          Selecione o intervalo de competências a exportar. O arquivo terá 5 colunas:
          Data, Código Débito, Código Crédito, Histórico, Valor.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={labelStyle}>
            Competência inicial
            <input
              type="month"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
            />
          </label>
          <label style={labelStyle}>
            Competência final
            <input
              type="month"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
            />
          </label>
        </div>

        {error && (
          <div style={{ padding: 8, marginTop: 4, marginBottom: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
            {error}
          </div>
        )}

        {/* ── CONFERÊNCIA DO LOTE ────────────────────────────────────────────
            O resultado do pré-voo. Erro bloqueia (é o que o ERP recusa), alerta confirma (é o que
            PODE estar certo e só o contador sabe). Cada item leva até a linha de origem — apontar
            um problema sem levar até ele obriga a caçar sete linhas no meio de trezentas. */}
        {onPreflight && (
          <div style={{ marginTop: 4, marginBottom: 10, padding: 10, borderRadius: 8, border: "1px solid #44475A", background: "#1A1B26" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.8rem" }}>Conferência do lote</strong>
              <Button variant="secondary" onClick={conferir} disabled={!mesUnico || conferindo}>
                {conferindo ? "Conferindo…" : preflight ? "Conferir de novo" : "Conferir"}
              </Button>
              {/* Opção desabilitada NUNCA fica sem explicação. */}
              {!mesUnico && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  a conferência é de um mês por vez — deixe início e fim iguais
                </span>
              )}
            </div>

            {preflight && (
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <div style={{ fontSize: "0.76rem", color: "#aeb6d3" }}>
                  {preflight.totais.entries} lançamento{preflight.totais.entries !== 1 ? "s" : ""} ·{" "}
                  {preflight.totais.linhas} linha{preflight.totais.linhas !== 1 ? "s" : ""} · D R$ {fmtValor(preflight.totais.totalD)} · C R$ {fmtValor(preflight.totais.totalC)}
                  {preflight.totais.diferenca > 0.01
                    ? <span style={{ color: "#FF5757", fontWeight: 700 }}> · diferença R$ {fmtValor(preflight.totais.diferenca)}</span>
                    : <span style={{ color: "var(--success)", fontWeight: 700 }}> · ✓ ok</span>}
                </div>

                {preflight.erros.map((e, i) => (
                  <ItemConferencia key={`e${i}`} item={e} cor="#FF5757" rotulo="ERRO" onIr={onIrAteLancamento} />
                ))}
                {preflight.alertas.map((a, i) => (
                  <ItemConferencia key={`a${i}`} item={a} cor="#FFB347" rotulo="ALERTA" onIr={onIrAteLancamento} />
                ))}

                {/* Princípio 7: ausência nunca é resposta — o lote limpo DIZ que está limpo. */}
                {!temErros && !temAlertas && (
                  <span style={{ fontSize: "0.78rem", color: "var(--success)" }}>✓ Nenhum problema encontrado neste lote.</span>
                )}

                {/* ⚠ SAÍDA PARA A MARCA DE EXPORTADO.
                    Lançamento exportado não pode mais ser editado (é a proteção contra alterar o
                    que já foi para a contabilidade). Sem um "reabrir" AQUI, a primeira correção
                    legítima depois de uma exportação viraria um beco sem saída — a mesma razão
                    pela qual o mês fechado tem "Reabrir". */}
                {preflight.jaExportados > 0 && onReabrir && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Reabrir ${preflight.jaExportados} lançamento(s) de ${inicio}?\n\nEles voltam a ser editáveis e deixam de constar como enviados à contabilidade.`)) return;
                      await onReabrir(inicio);
                      await conferir();
                    }}
                    style={{ justifySelf: "start", background: "transparent", border: "1px solid var(--state-warn)", color: "var(--state-warn)", borderRadius: 6, padding: "4px 10px", font: "inherit", fontSize: "0.75rem", cursor: "pointer" }}
                  >
                    ↩ Reabrir os lançamentos exportados
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <Button variant="secondary" onClick={onClose} disabled={exporting}>Cancelar</Button>
          <Button variant="primary" onClick={handleExport} disabled={exporting || temErros}>
            {exporting ? "Exportando..." : temErros ? "Corrija os erros para exportar" : "Exportar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
