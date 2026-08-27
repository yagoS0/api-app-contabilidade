import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { situacaoFiscalComSimbolo } from "../../../../lib/vocabulario";
import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { Tabs } from "../../../../components/ui/Tabs";
import { CompanyCard, getComplianceTags } from "../components/renderCompanyCard";
import { AnnualGrid } from "../components/renderAnnualGrid";
import { CompaniesTable } from "../components/renderCompaniesTable";
import { BarraSelecaoEmpresas } from "../components/BarraSelecaoEmpresas";
import { CalendarioGrid } from "../../../calendario/components/renderCalendarioGrid";
import { estadoCertificado } from "../lib/certificado";
import { APURACAO, ORDEM_APURACAO, contarApuracao, estadoApuracao } from "../lib/estadoApuracao";
import {
  ABA_PADRAO, abasVisiveis, contarPorAba, empresasDaAba, normalizarAba, rotuloAba,
} from "../lib/abaRegime";
import { LogoAltan } from "../../../../components/ui/LogoAltan";

// Q17: dropdown — abre um seletor (não navega para um hub).
//
// ⚠ ELE PASSOU A SER O MENU "Mais ▾", e a diferença entre isso e remover função é o assunto todo:
// tudo o que estava na barra continua alcançável, com o MESMO rótulo e o MESMO handler. Mover para
// dentro de um menu é LAYOUT; tirar da tela seria decisão de produto, que não é desta passada.
//
// `grupo` desenha uma régua com título — sem ela "Rotinas" e "Configuração SERPRO" viram uma lista
// de sete itens sem hierarquia, que é o mesmo problema da barra, um nível abaixo.
// ⚠⚠ ESTE COMPONENTE FICOU SEM CONSUMIDOR EM 18/08/2026 e NÃO FOI APAGADO.
// O menu "Mais ▾" virou a GAVETA LATERAL (`GavetaFerramentas`, logo abaixo) a pedido do dono. Ele
// não tem outro chamador — nem neste arquivo nem em nenhum outro. Apagar componente é decisão à
// parte (o precedente registrado do projeto é o `DefisNaoDevida.jsx`), então ele fica aqui,
// marcado, até alguém decidir. Não o religue sem pedido: seriam duas portas para o mesmo menu.
function SettingsMenu({ items, label = "Configurações ▾" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);
  // ⚠ Item sem handler NÃO VIRA LINHA — a página monta o menu com os `onOpen*` que recebeu, e
  // renderizar um item morto ofereceria uma função que não existe naquele contexto.
  const usable = items.filter((it) => typeof it.onClick === "function");
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <Button
        variant="secondary"
        className="dashboard-home__action dashboard-home__action--outline"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {label}
      </Button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
            background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 240, overflow: "hidden",
          }}
        >
          {usable.map((it, i) => (
            <div key={it.label}>
              {it.grupo && (
                <div style={{
                  padding: "8px 14px 4px", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: "var(--text-muted)",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  marginTop: i > 0 ? 4 : 0,
                }}>
                  {it.grupo}
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); it.onClick(); }}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "9px 14px",
                  background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", fontSize: "0.85rem",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A GAVETA LATERAL ESQUERDA — o que era o menu "Mais ▾".
 *
 * Pedido do dono (18/08/2026): *"retire o botão de envio de e-mails em lote, e coloque o de
 * apuração e de consulta dentro de mais, em ferramentas. Pegue a aba de mais e coloque na lateral
 * esquerda, com 3 traços para abrir ela e fechar; padrão dela deve ser fechado"*.
 *
 * ⚠ É MUDANÇA DE LUGAR, NÃO REMOÇÃO. Cada função continua com o MESMO rótulo e o MESMO handler;
 * o que muda é onde se clica. Apuração e Consultas entraram no grupo "Ferramentas", ao lado de
 * Rotinas e Planejamento.
 *
 * ⚠ NASCE FECHADA E NÃO LEMBRA. "Padrão fechado" quer dizer fechada a cada carregamento — por isso
 * o estado inicial é `false` cravado, e não uma leitura de `localStorage` como a do modo de visão.
 * Aquilo é preferência de leitura da carteira; isto é um menu.
 *
 * ⚠ O FOCO VAI E VOLTA. Ao abrir, ele entra na gaveta; ao fechar, volta para o hambúrguer. Sem o
 * retorno, quem usa teclado é largado no fim do documento e precisa tabular a página inteira de
 * volta. Fecha por Esc, por clique no fundo e pelo próprio botão.
 */
function GavetaFerramentas({ items }) {
  const [aberta, setAberta] = useState(false);
  const botaoRef = useRef(null);
  const gavetaRef = useRef(null);
  // ⚠ Item sem handler NÃO VIRA LINHA — a página monta o menu com os `onOpen*` que recebeu, e
  // renderizar um item morto ofereceria uma função que não existe naquele contexto.
  const usable = items.filter((it) => typeof it.onClick === "function");

  function fechar() {
    setAberta(false);
    // `requestAnimationFrame`: o foco só pode voltar depois que a gaveta saiu do DOM. Se a ação
    // navegou para outra tela, a ref já é nula e o `?.` resolve.
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => botaoRef.current?.focus());
    } else {
      botaoRef.current?.focus();
    }
  }

  useEffect(() => {
    if (!aberta) return undefined;
    function onEsc(e) {
      if (e.key === "Escape") {
        setAberta(false);
        botaoRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onEsc);
    // O foco entra na gaveta assim que ela abre.
    gavetaRef.current?.querySelector("button")?.focus();
    return () => document.removeEventListener("keydown", onEsc);
  }, [aberta]);

  return (
    <>
      <Button
        ref={botaoRef}
        variant="secondary"
        className="dashboard-home__action dashboard-home__action--outline"
        onClick={() => (aberta ? fechar() : setAberta(true))}
        aria-expanded={aberta}
        aria-controls="dashboard-gaveta"
        /* ⚠ O rótulo acessível DIZ O QUE ABRE. "Menu" sozinho não distingue esta gaveta do menu do
           navegador nem do popover de uma linha da tabela. */
        aria-label={aberta ? "Fechar o menu de ferramentas e configurações" : "Abrir o menu de ferramentas e configurações"}
        title="Ferramentas e configurações"
      >
        {/* Os três traços, desenhados — o caractere ☰ some em fonte sem o glifo e não escala com
            a cor do botão. `aria-hidden`: quem anuncia é o `aria-label` acima. */}
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
          <g fill="currentColor">
            <rect x="0" y="0" width="16" height="2" rx="1" />
            <rect x="0" y="5" width="16" height="2" rx="1" />
            <rect x="0" y="10" width="16" height="2" rx="1" />
          </g>
        </svg>
      </Button>

      {/* ⚠ A GAVETA SAI PARA O `body` (portal). O hambúrguer mora dentro do `<nav aria-label=
          "Atalhos">`, e renderizar ali um `role="dialog"` com um `<nav>` dentro aninharia uma
          navegação na outra e poria a caixa de diálogo dentro da barra de atalhos. Fora, ela
          também fica imune a qualquer `transform`/`overflow` de ancestral, que é o que costuma
          quebrar `position: fixed` sem avisar. */}
      {aberta && createPortal(
        <>
          {/* O fundo fecha ao clique. Ele é `aria-hidden` porque o botão de fechar dentro da gaveta
              é o caminho anunciado; o clique no fundo é atalho de mouse. */}
          <div className="dashboard-gaveta__fundo" aria-hidden="true" onClick={fechar} />
          <aside
            id="dashboard-gaveta"
            ref={gavetaRef}
            className="dashboard-gaveta"
            role="dialog"
            aria-modal="true"
            aria-label="Ferramentas e configurações"
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 14px", borderBottom: "1px solid var(--border)",
            }}>
              <strong style={{ fontSize: "0.82rem", letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                Mais
              </strong>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar o menu"
                style={{
                  background: "transparent", border: "none", color: "var(--text-muted)",
                  cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: 4,
                }}
              >
                ✕
              </button>
            </div>
            <nav aria-label="Ferramentas e configurações" style={{ padding: "6px 0" }}>
              {usable.map((it, i) => (
                <div key={it.label}>
                  {/* O grupo desenha uma régua com título — sem ela "Rotinas" e "Configuração
                      SERPRO" viram uma lista de sete itens sem hierarquia. */}
                  {it.grupo && (
                    <div style={{
                      padding: "10px 14px 4px", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.04em",
                      textTransform: "uppercase", color: "var(--text-muted)",
                      borderTop: i > 0 ? "1px solid var(--border)" : "none",
                      marginTop: i > 0 ? 4 : 0,
                    }}>
                      {it.grupo}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { fechar(); it.onClick(); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                      background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", fontSize: "0.88rem",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {it.label}
                  </button>
                </div>
              ))}
            </nav>
          </aside>
        </>,
        document.body,
      )}
    </>
  );
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasPendingCompliance(company) {
  return getComplianceTags(company?.guideCompliance).some((tag) => !tag.ok);
}

// Q17: filtros compactos (campos menores), com competência junto deles.
const FILTER_LABEL = { display: "grid", gap: 3, fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" };
const FILTER_CONTROL = { background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "5px 8px", fontSize: "0.8rem", colorScheme: "dark" };
// C7: setas de navegação da competência (‹ ›).
const COMP_ARROW = { ...FILTER_CONTROL, padding: "5px 9px", cursor: "pointer", fontWeight: 700, lineHeight: 1 };

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-07" → "julho de 2026". Sem `Date` — a competência é texto, não instante no tempo. */
function rotuloCompetencia(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return competencia || "—";
  const mes = MESES_PT[Number(m[2]) - 1];
  // Capitaliza só a primeira letra: `text-transform: capitalize` viraria "Julho De 2026".
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} de ${m[1]}`;
}

// C7: anda N meses na competência YYYY-MM (aceita negativo). Sem dependência de Date pra não
// escorregar em fuso — é aritmética de ano/mês pura.
function shiftCompetencia(competencia, delta) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return competencia;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export function CompaniesHomePage({
  user,
  companies,
  loadingCompanies,
  onCreateCompany,
  onOpenGuideUpload,
  onOpenGuideSettings,
  onOpenChartGlobal,
  onRefreshCompanies,
  onOpenPendingReport,
  // ⚠ SEM CONSUMIDOR desde 18/08/2026: o botão "Envio de e-mails em lote" saiu da barra a pedido
  // do dono, e ele era o único uso desta prop nesta página. O `App.jsx` continua fornecendo-a
  // (`onOpenBatchEmail={() => session.setPage("batchEmail")}`) e a rota `/guides/batch-email`
  // continua de pé. Apagar a prop e o handler é decisão à parte — está relatado, não escondido.
  onOpenBatchEmail, // eslint-disable-line no-unused-vars
  onOpenApuracao,
  onOpenRotinas,
  onOpenPlanejamento,
  onOpenSerproFuncoes,
  onOpenObrigacoes,
  onOpenOnboardings,
  onLogout,
  onOpenCompany,
  globalChartStatus, // { isConfigured, tiposFaltantes, ... } — pré-requisito para criar empresa
  dashboardCompetencia, // Q17: competência do filtro (default mês anterior)
  onChangeCompetencia,
  backgroundJobs, // C9: { total, processadas, empresas } — processos rodando em segundo plano
  api, // C8: usado pela visão anual (busca própria, não reusa a lista de cards)
  message,
  error,
}) {
  // Quatro formas de ver a MESMA carteira: tabela (densa, o padrão no desktop), cards (padrão no
  // celular), grade anual e calendário.
  //
  // ⚠ A escolha PERSISTE. Antes era `useState` puro: quem preferia cards voltava para o padrão a
  // cada refresh. E o padrão depende da largura — a tabela de 6 colunas não sobrevive a 375px,
  // e o card mostra 8 empresas onde a tabela mostra 15+.
  const [modoVisao, setModoVisao] = useState(() => {
    try {
      const salvo = localStorage.getItem("dashboard:modoVisao");
      if (salvo) return salvo;
    } catch { /* localStorage bloqueado (modo privado) não pode derrubar a tela */ }
    // `window.innerWidth` 0 significa "ainda não sei" (container sem layout), não "estreito" —
    // a mesma armadilha que já fez o calendário abrir em modo celular numa janela grande.
    const largura = typeof window !== "undefined" ? window.innerWidth : 0;
    return largura === 0 || largura >= 1024 ? "tabela" : "cards";
  });
  function trocarVisao(modo) {
    setModoVisao(modo);
    try { localStorage.setItem("dashboard:modoVisao", modo); } catch { /* idem */ }
  }

  // ─── IMPRESSÃO ───────────────────────────────────────────────────────────────────────────────
  // Duas coisas precisam acontecer ANTES do diálogo do navegador abrir: a visão vira tabela (cards
  // em papel não servem) e as fechadas se expandem. Por isso não dá para chamar `window.print()`
  // no clique — o React ainda não renderizou. O clique só liga a flag; o efeito imprime depois do
  // render, que é o único momento em que o DOM já está do jeito que vai para o papel.
  const [imprimindo, setImprimindo] = useState(false);
  useEffect(() => {
    if (!imprimindo) return undefined;
    document.body.classList.add("imprimindo");
    const limpar = () => setImprimindo(false);
    window.addEventListener("afterprint", limpar);
    // Um quadro de folga para o layout assentar antes do snapshot da impressão.
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", limpar);
      document.body.classList.remove("imprimindo");
    };
  }, [imprimindo]);

  function imprimirListagem() {
    if (modoVisao !== "tabela") trocarVisao("tabela");
    setImprimindo(true);
  }
  const [search, setSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState("pending");
  const [serproFilter, setSerproFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all"); // all | sent | notSent (Q16)
  const [apuracaoFilter, setApuracaoFilter] = useState("all"); // all | apurados | naoApurados
  const [certFilter, setCertFilter] = useState("all"); // all | comCert | semCert | vencido
  // Situação fiscal (SITFIS) — combina com os demais filtros.
  const [fiscalFilter, setFiscalFilter] = useState("all"); // all | comPendencia | semPendencia | emParcelamento
  // ⚠ O FILTRO "REGIME" SAIU INTEIRO (pedido do dono, 18/08/2026): *"exclua o filtro de regime,
  // pois já estarão separados"*. Quem separa por regime agora são as ABAS acima da tabela
  // (`lib/abaRegime.js`). Saíram JUNTOS o estado, a entrada do de-para dos chips, o reset, a
  // condição do `useMemo` e a dependência — deixar qualquer metade produziria o "filtro fantasma"
  // que o `CLAUDE.md` desta pasta nomeia: um recorte agindo sem chip removível na tela.
  // Fechamento CONTÁBIL do mês filtrado (o mesmo 🔒 do card) — não confundir com apuração.
  // C7: os filtros secundários ficam num painel; só busca e competência seguem aparentes.
  const [showFilters, setShowFilters] = useState(false);
  // F2: "o que trava a carteira" — resposta agregada do servidor para a competência da tela.
  // Não vem do card: o card sabe se a empresa está fechada, não POR QUE ela ainda não pode ser.
  const [travas, setTravas] = useState(null);          // Map companyId → linha do servidor
  const [travaFiltro, setTravaFiltro] = useState("all"); // all | problema | fechar | apurar | fechada | enviar
  const [fechandoLote, setFechandoLote] = useState(false);
  const carregarTravas = useCallback(async () => {
    if (!api?.getCarteiraFechamento || !dashboardCompetencia) { setTravas(null); return; }
    try {
      const out = await api.getCarteiraFechamento(dashboardCompetencia);
      if (out?.ok === false) { setTravas(null); return; }
      setTravas(new Map((out?.empresas || []).map((e) => [e.companyId, e])));
    } catch {
      // Silencioso de propósito: isto é um atalho sobre a lista, e falhar aqui não pode derrubar
      // o dashboard. Sem resposta, a barra some e os cards continuam como sempre foram.
      setTravas(null);
    }
  }, [api, dashboardCompetencia]);
  useEffect(() => { carregarTravas(); }, [carregarTravas]);

  /**
   * Ações do chip de guia, feitas DA LISTAGEM — sem entrar na empresa.
   *
   * ⚠ Enviar e-mail é ação externa e irreversível: quem confirma é o popover do chip (destinatário
   * à vista), nunca o clique. Aqui só se executa o que já foi confirmado.
   *
   * Depois de qualquer uma delas a lista é recarregada: o estado do chip vem do servidor, e sem o
   * reload ele mostraria o valor de antes da ação — o mesmo tipo de mentira que o "mock inerte"
   * produzia offline.
   *
   * O objeto é extensível de propósito: o canal de WhatsApp entra aqui como mais uma ação quando a
   * conta na Meta estiver liberada, sem redesenhar o chip.
   */
  const acoesGuia = useMemo(() => ({
    onAbrirEmpresa: (companyId) => onOpenCompany?.(companyId),
    /**
     * Consulta a situação fiscal DE UMA empresa, direto da listagem.
     *
     * ⚠ Chamada PAGA, com trava de 4h por empresa — e o limite do `/Apoiar` é por CONTRATANTE, ou
     * seja, do escritório inteiro. Quem confirma o custo é o chip (mini-confirm antes de chamar);
     * aqui só resta recarregar a lista para o chip trocar de estado sozinho.
     */
    onConsultarFiscal: async (companyId) => {
      const out = await api.getSitfis?.(companyId).catch((e) => ({ ok: false, message: e?.message }));
      await onRefreshCompanies?.();
      return out;
    },
    onEnviar: async (guideId) => {
      const out = await api.liberarGuiaCliente(guideId);
      if (out?.ok === false) return out;
      // `sent:false` com ok:true acontece quando a liberação passou mas o e-mail falhou — o chip
      // precisa dizer isso em vez de pintar de verde.
      if (out && out.sent === false) {
        onRefreshCompanies?.();
        return { ok: false, message: out.message || "Guia liberada, mas o e-mail não saiu. Tente de novo." };
      }
      onRefreshCompanies?.();
      return out;
    },
    onMarcarVazio: async (companyId, tipo, competencia, motivo) => {
      const out = await api.markGuideVazio(companyId, tipo, competencia || dashboardCompetencia, motivo);
      if (out?.ok === false) return out;
      onRefreshCompanies?.();
      return out;
    },
    onDesfazerVazio: async (companyId, tipo, competencia) => {
      const out = await api.undoGuideVazio(companyId, tipo, competencia || dashboardCompetencia);
      if (out?.ok === false) return out;
      onRefreshCompanies?.();
      return out;
    },
  }), [api, dashboardCompetencia, onOpenCompany, onRefreshCompanies]);

  const contagemTravas = useMemo(() => {
    if (!travas) return null;
    const linhas = [...travas.values()];
    return {
      total: linhas.length,
      prontas: linhas.filter((l) => l.podeFechar).length,
      fechadas: linhas.filter((l) => l.fechado).length,
    };
  }, [travas]);

  /**
   * As contagens do PIPELINE DO MÊS — a mesma leitura da coluna Apuração, não um cálculo paralelo.
   *
   * ⚠ Isto substituiu quatro contagens que rodavam por conta própria sobre `travas`. Elas
   * divergiam da coluna: dava para a barra dizer uma coisa e a linha da empresa dizer outra, na
   * mesma tela. Chip de filtro, barra de progresso e ordenação saem TODOS de `estadoApuracao`.
   */
  const contagemApuracao = useMemo(
    () => (travas ? contarApuracao(companies || [], travas) : null),
    [companies, travas],
  );

  /**
   * Empresas com pelo menos uma guia gerada e NÃO enviada — a ação rápida do fim do mês.
   *
   * ⚠ `falhou` conta aqui. Ela é o caso mais agudo de "falta enviar": já se tentou, não saiu, e
   * nada tentará de novo. Fora deste recorte, a empresa cujo e-mail falhou desaparecia justamente
   * do filtro que existe para varrer os envios pendentes.
   */
  const empresasFaltaEnviar = useMemo(() => {
    const set = new Set();
    for (const c of companies || []) {
      if (getComplianceTags(c.guideCompliance).some((t) => t.state === "gerada" || t.state === "falhou")) {
        set.add(c.companyId);
      }
    }
    return set;
  }, [companies]);
  const contagemFaltaEnviar = empresasFaltaEnviar.size;

  // ⚠ `segmentosProgresso` (o cálculo da barra de progresso) foi REMOVIDO junto com a barra em
  // 15/08/2026 — sem consumidor, era `useMemo` morto rodando a cada render. `contagemApuracao`
  // continua: é dele que saem os chips de filtro. Ver o comentário no lugar onde a barra ficava.

  /**
   * Fecha, uma a uma, as empresas que o servidor disse estarem prontas.
   *
   * O laço é sequencial de propósito: são escritas, e disparar N em paralelo contra o mesmo backend
   * para ganhar dois segundos não paga o risco. A rota de fechar **revalida cada empresa** — se
   * alguém lançou algo entre a leitura do agregado e o clique, aquela empresa é recusada e as
   * demais seguem. Por isso o relatório final conta recusas em vez de abortar no primeiro erro.
   */
  async function fecharAsProntas() {
    // ⚠⚠ O ALVO É `prontasVisiveis`, não a carteira inteira. Ler `travas.values()` aqui fecharia
    // empresas fora do recorte que o contador está olhando — e a confirmação abaixo lista só as 12
    // primeiras, então ele nem veria os nomes das demais.
    if (fechandoLote || !prontasVisiveis.length) return;
    const alvos = prontasVisiveis;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Fechar o mês ${dashboardCompetencia} de ${alvos.length} empresa(s)?\n\n`
      + alvos.slice(0, 12).map((a) => `• ${a.razao}`).join("\n")
      + (alvos.length > 12 ? `\n… e mais ${alvos.length - 12}` : "")
      + "\n\nCada empresa é revalidada no servidor; quem não estiver pronta é recusada.",
    );
    if (!ok) return;
    setFechandoLote(true);
    let fechadas = 0;
    const recusadas = [];
    try {
      for (const alvo of alvos) {
        try {
          const r = await api.fecharFechamentoContabil(alvo.companyId, dashboardCompetencia);
          if (r?.ok === false) recusadas.push(alvo.razao);
          else fechadas += 1;
        } catch (e) {
          recusadas.push(`${alvo.razao} (${e?.message || "falhou"})`);
        }
      }
    } finally {
      setFechandoLote(false);
      await carregarTravas();
      onRefreshCompanies?.();
    }
    // eslint-disable-next-line no-alert
    window.alert(
      `${fechadas} empresa(s) fechada(s).`
      + (recusadas.length ? `\n\nRecusadas (${recusadas.length}):\n${recusadas.slice(0, 12).map((r) => `• ${r}`).join("\n")}` : ""),
    );
  }
  // "pending" é o default de Documentos (não conta como filtro ativo).
  // ⚠ Os filtros ativos vão IMPRESSOS no papel. Uma folha filtrada que não diz que está filtrada
  // mente por omissão — quem a receber vai contar as empresas e concluir que a carteira é aquela.
  const ROTULO_FILTRO = {
    documentFilter: { rotulo: "Documentos", valores: { pending: null, all: "todos", withDocs: "com documento", withoutDocs: "sem documento" } },
    serproFilter: { rotulo: "SERPRO", valores: { aptas: "aptas", naoAptas: "não aptas" } },
    emailFilter: { rotulo: "E-mail do mês", valores: { sent: "enviado", notSent: "não enviado" } },
    apuracaoFilter: { rotulo: "Apuração", valores: { apurados: "apurados", naoApurados: "não apurados" } },
    certFilter: { rotulo: "Certificado", valores: { comCert: "com certificado válido", semCert: "sem certificado", vencido: "certificado vencido" } },
    fiscalFilter: { rotulo: "Situação fiscal", valores: { comPendencia: "com pendência", semPendencia: "sem pendência", emParcelamento: "em parcelamento" } },
    // ⚠ A ENTRADA `regimeFilter` SAIU DAQUI JUNTO COM O FILTRO. A aba de regime NÃO ocupa o lugar
    // dela: aba é navegação, não filtro removível — ela não vira chip e não pode entrar na contagem
    // do botão "Filtros" (que sai desta MESMA lista). Onde a aba precisa aparecer é no CABEÇALHO
    // IMPRESSO, e aparece.
  };
  const valoresFiltro = {
    documentFilter, serproFilter, emailFilter, apuracaoFilter,
    certFilter, fiscalFilter,
  };
  // Cada filtro precisa saber se DESLIGAR sozinho — é isso que permite o chip removível.
  const RESET_FILTRO = {
    documentFilter: () => setDocumentFilter("pending"),
    serproFilter: () => setSerproFilter("all"),
    emailFilter: () => setEmailFilter("all"),
    apuracaoFilter: () => setApuracaoFilter("all"),
    certFilter: () => setCertFilter("all"),
    fiscalFilter: () => setFiscalFilter("all"),
  };

  /**
   * Os filtros ativos, prontos para virar chip.
   *
   * ⚠ CRITÉRIO INEGOCIÁVEL: nenhum filtro pode estar ligado sem rastro visível com o painel
   * fechado. O painel antigo escondia o estado atrás de um botão, e o contador via uma carteira
   * pela metade sem entender por quê — o "filtro fantasma", que fazia empresa parecer sumida.
   */
  const chipsDeFiltro = Object.entries(valoresFiltro)
    .filter(([chave, valor]) => valor !== "all" && !(chave === "documentFilter" && valor === "pending"))
    .map(([chave, valor]) => {
      const meta = ROTULO_FILTRO[chave] || {};
      return {
        chave,
        texto: `${meta.rotulo || chave}: ${meta.valores?.[valor] || valor}`,
        remover: RESET_FILTRO[chave],
      };
    });
  const descricaoFiltros = chipsDeFiltro.map((c) => c.texto).join(" · ");
  // A contagem sai da MESMA lista que desenha os chips — dois cálculos dariam no botão dizendo "3"
  // com dois chips na barra.
  const filtrosAtivos = chipsDeFiltro.length;

  function limparFiltros() {
    setDocumentFilter("pending");
    setSerproFilter("all");
    setEmailFilter("all");
    setApuracaoFilter("all");
    setCertFilter("all");
    setFiscalFilter("all");
    // ⚠ AQUI HAVIA UM `setFechamentoFilter("all")` — um setter que NÃO EXISTE. O estado
    // `fechamentoFilter` saiu quando o filtro "Fechamento" foi removido do painel (ele duplicava os
    // chips de Apuração do topo), e a linha da limpeza ficou para trás. Como é uma referência a
    // identificador inexistente, o clique em "Limpar tudo" / "Limpar filtros" lançava
    // `ReferenceError` e NENHUM filtro era limpo — o botão simplesmente não funcionava, sem dizer
    // por quê. Não é regressão desta passada; estava vivo na `dev` e nenhum teste montava esta
    // página para pegá-lo.
    // ⚠ Nada mais foi acrescentado no lugar: reintroduzir o filtro é decisão de produto.
  }

  const filteredCompanies = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);

    // 1) Busca por nome/CNPJ continua filtrando (remove quem não bate).
    //    Q16: filtro "Enviados/Só não enviados" também REMOVE quem não bate.
    //    Novos filtros (apuração / certificado) também REMOVEM quem não bate.
    const searched = companies.filter((company) => {
      // F2: REMOVE quem não bate — é uma lista de trabalho ("me mostre só as que posso fechar"),
      // não uma ordenação. Empresa sem linha no agregado fica de fora de qualquer recorte: dizer
      // "pronta" sem ter a resposta do servidor seria pior que omitir.
      if (travaFiltro !== "all") {
        // "Falta enviar guia" sai dos CHIPS, não do agregado de fechamento — é a única do conjunto
        // que fala de guia, não de lançamento.
        if (travaFiltro === "enviar") {
          if (!empresasFaltaEnviar.has(company?.companyId)) return false;
        } else {
          const t = travas?.get(company?.companyId);
          if (!t) return false;
          // O recorte usa o MESMO `estadoApuracao` do chip e da coluna. Antes cada um relia
          // `travas` do seu jeito, e clicar num chip trazia um conjunto diferente do que o chip
          // tinha acabado de contar.
          if (estadoApuracao(company, t).chave !== travaFiltro) return false;
        }
      }
      if (emailFilter === "notSent" && company?.monthEmailSent) return false;
      if (emailFilter === "sent" && !company?.monthEmailSent) return false;
      if (apuracaoFilter === "apurados" && !company?.apuracao?.apurada) return false;
      if (apuracaoFilter === "naoApurados" && company?.apuracao?.apurada) return false;
      // ⚠ "Com certificado" agora quer dizer certificado VÁLIDO. Antes olhava só a presença, e
      // empresa com A1 vencido — justamente a que não captura NFS-e — caía no grupo dos que estão
      // em dia. A leitura é a mesma da pílula na linha (`estadoCertificado`).
      const cert = estadoCertificado(company);
      if (certFilter === "comCert" && !cert.ativo) return false;
      if (certFilter === "semCert" && cert.chave !== "ausente") return false;
      if (certFilter === "vencido" && cert.chave !== "vencido") return false;
      // Situação fiscal (SITFIS). "Sem pendência" = REGULAR de verdade: empresa nunca consultada
      // (fiscalSituacao null) NÃO entra — não afirmamos que está limpa sem ter consultado.
      const fiscal = String(company?.fiscalSituacao || "");
      if (fiscalFilter === "comPendencia" && fiscal !== "COM_PENDENCIA") return false;
      if (fiscalFilter === "semPendencia" && fiscal !== "REGULAR") return false;
      if (fiscalFilter === "emParcelamento" && fiscal !== "EM_PARCELAMENTO") return false;
      // ⚠ O filtro "Fechamento" SAIU do painel: os chips de Apuração no topo já respondem a mesma
      // pergunta, e dois controles para o mesmo estado divergem — dava para filtrar "abertas" no
      // painel e "fechadas" no chip, e a tela ficava vazia sem explicar por quê.
      // ⚠ AQUI FICAVA O RECORTE POR REGIME. Ele saiu porque quem separa por regime agora é a ABA
      // (abaixo, `empresasVisiveis`) — e o recorte da aba acontece DEPOIS deste `useMemo` de
      // propósito: é desta lista, já filtrada por tudo o mais, que saem as CONTAGENS das abas.
      // Contar antes faria a aba prometer um número e a tabela mostrar outro.
      if (!normalizedQuery) return true;
      return (
        normalizeSearch(company?.razao).includes(normalizedQuery) ||
        normalizeSearch(company?.cnpj).includes(normalizedQuery)
      );
    });

    // 2) Filtros de documento e SERPRO agora apenas REORDENAM:
    //    quem bate no critério vai pra frente, sem remover ninguém.
    function priority(company) {
      let p = 0;
      if (documentFilter === "pending" && hasPendingCompliance(company)) p += 2;
      if (documentFilter === "ok" && !hasPendingCompliance(company)) p += 2;
      if (serproFilter === "eligible" && company?.serproStatus?.eligible) p += 1;
      if (serproFilter === "ineligible" && !company?.serproStatus?.eligible) p += 1;
      return p;
    }

    // Ordena estável por prioridade desc; preserva ordem original como tiebreaker.
    return searched
      .map((company, index) => ({ company, index, p: priority(company) }))
      .sort((a, b) => (b.p - a.p) || (a.index - b.index))
      .map((item) => item.company);
  }, [companies, documentFilter, search, serproFilter, emailFilter, apuracaoFilter, certFilter, fiscalFilter, travaFiltro, travas, empresasFaltaEnviar]);

  // ─── ABAS DE REGIME ───────────────────────────────────────────────────────────────────────────
  //
  // Pedido do dono (18/08/2026): *"ter duas tabelas na página principal, uma para presumido e outra
  // simples nacional, deve ficar indicado em cima da tabela, como uma aba de navegador"*.
  //
  // ⚠ AS CONTAGENS SAEM DE `filteredCompanies`, a lista JÁ recortada por busca, competência e pelos
  // filtros do painel. Contar sobre a carteira inteira faria a aba prometer 22 e a tabela mostrar 7.
  //
  // ⚠ A ABA ATIVA É DERIVADA, não o estado cru: `normalizarAba` devolve o padrão quando a aba
  // guardada é "Outros" e "Outros" não está mais desenhada (ninguém nela). Sem isso, a escolha
  // salva apontaria para uma aba inexistente e a tabela ficaria vazia sem nenhum botão marcado.
  //
  // ⚠ A ESCOLHA PERSISTE, como o modo de visão já persiste. Quem trabalha o dia no Presumido não
  // pode voltar ao Simples a cada recarga.
  const [abaSalva, setAbaSalva] = useState(() => {
    try {
      return localStorage.getItem("dashboard:abaRegime") || ABA_PADRAO;
    } catch { /* localStorage bloqueado (modo privado) não pode derrubar a tela */ }
    return ABA_PADRAO;
  });
  const contagensPorAba = useMemo(() => contarPorAba(filteredCompanies), [filteredCompanies]);
  const abasDaCarteira = useMemo(() => abasVisiveis(contagensPorAba), [contagensPorAba]);
  const abaAtiva = normalizarAba(abaSalva, contagensPorAba);
  function trocarAba(aba) {
    setAbaSalva(aba);
    try { localStorage.setItem("dashboard:abaRegime", aba); } catch { /* idem */ }
  }

  /**
   * A lista que a tabela e os cards realmente mostram.
   *
   * ⚠ É ELA que alimenta `idsVisiveis` logo abaixo — e é por isso que TROCAR DE ABA PODA A SELEÇÃO
   * exatamente como um filtro poda, pelo MESMO caminho, sem uma segunda regra. Sem isso, marcar 8
   * empresas no Simples e ir para o Presumido deixaria a barra agindo sobre linhas que o contador
   * não está mais vendo — o risco que a poda existe para impedir.
   */
  const empresasVisiveis = useMemo(
    () => empresasDaAba(filteredCompanies, abaAtiva),
    [filteredCompanies, abaAtiva],
  );

  /**
   * O universo DESTA aba sem os filtros — o denominador do "Exibindo X de N" da tabela.
   *
   * ⚠ Era a carteira inteira, e com as abas isso passou a mentir: o rodapé dizia "Exibindo 5 de 6"
   * e oferecia "Limpar filtros", um botão que não traz a sexta empresa (ela está na OUTRA aba).
   * Quem explica a diferença entre 5 e 6 é a barra de abas, que mostra as duas contagens.
   */
  const totalDaAba = useMemo(
    () => empresasDaAba(companies || [], abaAtiva).length,
    [companies, abaAtiva],
  );

  // ─── SELEÇÃO NA TABELA ────────────────────────────────────────────────────────────────────────
  //
  // ⚠ A SELEÇÃO É RECORTADA PELO FILTRO, E ISSO É DECISÃO, NÃO EFEITO COLATERAL.
  //
  // A pergunta do dono era: *"seleção que sobrevive a um filtro pode mandar guia para empresa que o
  // contador não está mais vendo"*. É verdade, e é o risco caro. Mas apagar tudo a cada tecla
  // digitada na busca também não serve — quem marca 8 empresas e digita uma letra perde o trabalho.
  //
  // O meio-termo que preserva a garantia: a seleção é **podada para o que está na lista**. Nunca
  // sobra id invisível (a barra só pode agir sobre linhas que estão na tela), e marcar 4 num
  // recorte e depois LIMPAR o filtro mantém as 4 marcadas, porque elas continuam visíveis.
  // A poda **não é silenciosa**: quando ela tira alguém, a barra diz quantas saíram.
  //
  // ⚠ TROCAR A COMPETÊNCIA LIMPA TUDO. Guias, apuração e situação fiscal são POR MÊS: uma seleção
  // feita olhando julho, executada em agosto, mandaria a guia errada. Aqui não há meio-termo.
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [recortadas, setRecortadas] = useState(0);

  // ⚠ `empresasVisiveis`, não `filteredCompanies`: o que está na TELA é a aba ativa. É esta única
  // troca que faz a poda da seleção valer também para a troca de aba.
  const idsVisiveis = useMemo(
    () => new Set((empresasVisiveis || []).map((c) => c.companyId)),
    [empresasVisiveis],
  );

  useEffect(() => {
    const fora = [...selecionados].filter((id) => !idsVisiveis.has(id));
    if (!fora.length) return;
    setSelecionados(new Set([...selecionados].filter((id) => idsVisiveis.has(id))));
    setRecortadas(fora.length);
  }, [idsVisiveis, selecionados]);

  useEffect(() => {
    setSelecionados(new Set());
    setRecortadas(0);
  }, [dashboardCompetencia]);

  function alternarSelecao(companyId) {
    setRecortadas(0);
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }
  function selecionarTodos(ids, marcar) {
    setRecortadas(0);
    setSelecionados((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (marcar) next.add(id); else next.delete(id); }
      return next;
    });
  }
  function limparSelecao() {
    setRecortadas(0);
    setSelecionados(new Set());
  }

  /**
   * A FRASE DA PODA, escrita UMA vez.
   *
   * ⚠ ELA PRECISA SOBREVIVER À SELEÇÃO VAZIA — e é a troca de aba que expôs isso. A
   * `BarraSelecaoEmpresas` devolve `null` sem seleção, então quando a poda leva TODAS as marcadas
   * (o caso normal ao sair do Simples para o Presumido: nenhuma empresa está nas duas abas) a barra
   * some levando o aviso junto, e as marcações desaparecem em silêncio — exatamente o que a poda
   * anunciada existe para impedir. Por isso o aviso também é renderizado sozinho, com a MESMA
   * frase, quando não sobrou ninguém selecionado.
   */
  const avisoDeRecorte = recortadas > 0
    ? `${recortadas} empresa(s) saíram da seleção porque não estão mais nesta lista.`
    : null;

  // ⚠ AS LINHAS, não os ids: o plano de ações lê regime, certificado, `guideCompliance` e
  // `fiscalCheckedAt` de cada empresa. Uma lista de ids obrigaria a barra a buscar o que a página
  // já tem na mão.
  const empresasSelecionadas = useMemo(
    () => (empresasVisiveis || []).filter((c) => selecionados.has(c.companyId)),
    [empresasVisiveis, selecionados],
  );

  /**
   * ⚠⚠ AS QUE DÁ PARA FECHAR **E** ESTÃO NA TELA — as duas condições, e a segunda é a que faltava.
   *
   * `contagemTravas.prontas` conta `podeFechar` na CARTEIRA INTEIRA. Usá-la para um botão que age
   * fecharia empresas que o contador não está olhando — exatamente o risco que o comentário do botão
   * nomeia (*"fácil de clicar sem ter olhado quem vai ser fechado"*). A regra de qual população vale
   * já está escrita neste arquivo: **`empresasVisiveis`, não `filteredCompanies` — o que está na TELA
   * é a aba ativa**.
   */
  const prontasVisiveis = useMemo(() => {
    if (!travas) return [];
    return (empresasVisiveis || [])
      .map((c) => travas.get(c.companyId))
      .filter((l) => l?.podeFechar);
  }, [empresasVisiveis, travas]);

  return (
    <div className="dashboard-home-page">
      <AppShell className="dashboard-home-shell">
        <section className="dashboard-home">
          <header className="dashboard-home__header">
            <div className="dashboard-home__brand">
              <div>
                {/* Subtítulo removido: descrevia o óbvio ("busca, filtros e acesso rápido") numa
                    tela que JÁ é a carteira, e ainda vinha sem acentuação. Legenda que explica o
                    que se vê é sinal de que a tela não se explica sozinha. */}
                {/* A COMPETÊNCIA SOBE PARA O TÍTULO. Ela é o contexto de tudo o que a tela mostra —
                    contadores, guias, notas, fechamento — e estava perdida no meio dos filtros,
                    onde parecia mais um recorte opcional. Aqui fica claro que o mês é o assunto. */}
                {/* ⚠⚠ O `<h1>` TERMINA NA PALAVRA "Empresas" — os três controles são IRMÃOS dele,
                    não filhos. Até 24/08/2026 os `‹ ›` e o "↻" viviam DENTRO do `<h1>`, e o efeito
                    não era visual: o nome acessível do cabeçalho passava a ser *"Empresas · Mês
                    anterior Agosto de 2026 Próximo mês Recarregar a lista de Agosto de 2026"*. Quem
                    navega por cabeçalhos ouve o título da tela; ali ouvia a barra de ferramentas.
                    ⚠ **O DESENHO NÃO MUDOU** — a linha flex subiu um nível, com o mesmo `gap` e o
                    mesmo `align-items`, e a decisão de 20/08 (*"a competência sobe para o título
                    porque ela é o contexto de tudo o que a tela mostra"*) continua de pé: ela
                    continua na mesma linha, ao lado do título. O que mudou é de quem ela é filha. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h1 className="dashboard-home__title" style={{ margin: 0 }}>Empresas</h1>
                  <span aria-hidden="true" style={{ color: "var(--text-faint)", fontWeight: 400 }}>·</span>
                  {/* ⚠ `role="group"` com nome: sem ele os três controles ficam soltos na leitura
                      linear, e o mês que eles comandam vira um texto qualquer ao lado. */}
                  <span role="group" aria-label="Competência da carteira" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => onChangeCompetencia(shiftCompetencia(dashboardCompetencia, -1))}
                      title="Mês anterior" aria-label="Mês anterior"
                      style={{ ...COMP_ARROW, fontSize: "0.9rem" }}
                    >‹</button>
                    <span style={{ fontSize: "1.05rem", color: "var(--text-muted)", fontWeight: 600, minWidth: 150, textAlign: "center" }}>
                      {rotuloCompetencia(dashboardCompetencia)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onChangeCompetencia(shiftCompetencia(dashboardCompetencia, 1))}
                      title="Próximo mês" aria-label="Próximo mês"
                      style={{ ...COMP_ARROW, fontSize: "0.9rem" }}
                    >›</button>
                    {/* ⚠ O RECARREGAR MORA AQUI, e não na fileira de atalhos, porque é ESTA lista —
                        a da competência escrita à esquerda dele — que ele recarrega. Na barra de
                        botões ele era um "↻" sem contexto no meio de sete rótulos; ao lado do mês,
                        o que ele atualiza está dito. */}
                    <Button
                      variant="secondary"
                      onClick={onRefreshCompanies}
                      disabled={loadingCompanies}
                      title={`Recarregar a lista de ${rotuloCompetencia(dashboardCompetencia)}`}
                      aria-label={`Recarregar a lista de ${rotuloCompetencia(dashboardCompetencia)}`}
                      style={{ minHeight: 30, minWidth: 34, padding: "2px 8px", marginLeft: 4, fontSize: "0.9rem" }}
                    >
                      <span aria-hidden="true">{loadingCompanies ? "…" : "↻"}</span>
                    </Button>
                  </span>
                </div>
              </div>
            </div>

            <div className="dashboard-home__user">
              <div className="dashboard-home__user-meta">
                <span className="dashboard-home__user-label">Contador logado</span>
                <strong className="dashboard-home__user-name">{user?.name || "Conta escritorio"}</strong>
              </div>
              <Button variant="secondary" className="dashboard-home__logout" onClick={onLogout}>
                Sair
              </Button>
            </div>
          </header>

          {globalChartStatus && !globalChartStatus.isConfigured && (
            <div
              role="alert"
              style={{
                margin: "12px 0",
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(255,179,71,0.15)",
                border: "1px solid var(--state-warn)",
                color: "var(--state-warn)",
                fontSize: "0.875rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>
                ⚠ <strong>Plano de contas global incompleto</strong>. Antes de criar novas empresas,
                cadastre contas dos tipos:{" "}
                <strong>{(globalChartStatus.tiposFaltantes || []).join(", ") || "—"}</strong>.
              </span>
              {onOpenChartGlobal && (
                <Button variant="secondary" onClick={onOpenChartGlobal}>
                  Abrir Plano de Contas Global
                </Button>
              )}
            </div>
          )}

          {/* ─── BARRA DE AÇÕES ──────────────────────────────────────────────────────────────────
              ⚠ ERAM OITO BOTÕES NO MESMO PESO, SEIS DELES ROXO CHEIO. Uma fileira em que tudo é
              primário não tem primário: o olho não encontra "a ação desta tela" e passa a ler os
              oito rótulos toda vez.

              A hierarquia agora tem três degraus, e nenhuma função saiu da tela:
                1. `Nova empresa` — SÓLIDO (accent). É a única ação de CRIAR daqui.
                2. Onboardings · Apuração · Consultas · Envio de e-mails — CONTORNO. São o fluxo
                   frequente do mês.
                3. Rotinas · Planejamento · Configurações — dentro de `Mais ▾`, com os mesmos
                   rótulos e os mesmos handlers.

              ⚠ SÓLIDO É ROXO (accent), NUNCA VERDE. Verde quer dizer CONCLUÍDO neste app — a guia
              paga, o `D = C ✓ ok`, "Guias concluídas" nesta mesma tabela. Um botão verde de "faça
              isto" na primeira linha da tela estraga a leitura do verde em todo o resto dela.

              ⚠ NENHUM BOTÃO GANHOU CONTADOR. O plano sugeria "Onboardings · 3"; esta página não
              recebe contagem de onboarding nenhuma (só o handler `onOpenOnboardings`), e um número
              inventado — ou um zero que na verdade quer dizer "não perguntei" — é exatamente o
              defeito que `lib/falhaDeCarga.js` existe para matar.

              ⚠ A VERSÃO "COMPLETA" DO PLANO NÃO FOI FEITA, de propósito: ela move Rotinas e
              Planejamento para uma "navegação de módulos (sidebar ou abas)" que NÃO EXISTE aqui —
              não há `<Routes>` no `App.jsx`, o despacho é uma cadeia de `if` (ver
              `apps/web/CLAUDE.md`). Criar navegação nova é decisão de produto do dono. */}
          <nav className="dashboard-home__actions" aria-label="Atalhos">
            {/* ⚠ O HAMBÚRGUER VEM PRIMEIRO porque a gaveta abre à ESQUERDA — botão à direita
                abrindo painel à esquerda faz o olho atravessar a tela atrás do que acabou de
                clicar. */}
            <GavetaFerramentas
              items={[
                // ⚠ APURAÇÃO E CONSULTAS MUDARAM DE LUGAR, NÃO SAÍRAM (dono, 18/08/2026: *"coloque
                // o de apuração e de consulta dentro de mais, em ferramentas"*). Mesmo rótulo,
                // mesmo handler, um clique a mais.
                { grupo: "Ferramentas", label: "Apuração", onClick: onOpenApuracao },
                // C10: "Pendências" já tinha virado a aba "Situação Fiscal" dentro de Consultas.
                { label: "Consultas", onClick: onOpenSerproFuncoes },
                // Planejamento é cenário de reunião com PROSPECT (por isso mora no dashboard e não
                // dentro de uma empresa); Rotinas é configuração de recorrência. Nenhuma das duas é
                // o trabalho do dia — são episódicas, e é isso que as põe aqui dentro.
                { label: "Rotinas", onClick: onOpenRotinas },
                { label: "Planejamento", onClick: onOpenPlanejamento },
                // Cadastrar obrigação é CONFIGURAÇÃO do escritório (define o que passa a ser
                // cobrado de todo mundo), não uma forma de olhar a carteira — por isso saiu do
                // seletor de visões e entrou aqui.
                { grupo: "Configurações", label: "Obrigações do escritório", onClick: onOpenObrigacoes },
                { label: "Configuração SERPRO", onClick: onOpenGuideSettings },
                { label: "Plano de Contas Global", onClick: onOpenChartGlobal },
                // ⚠ Chamava-se "Pendências (debug)". É a ÚNICA tela que lista guia por guia o
                // status do e-mail, as tentativas e o `emailLastError` — e o rótulo "(debug)"
                // dizia ao contador que aquilo não era assunto dele. Ferramenta de diagnóstico
                // escondida atrás de um aviso de "não mexa" é o mesmo que não existir.
                { label: "Pendências de e-mail", onClick: onOpenPendingReport },
                // ⚠⚠ ESTA TELA EXISTIA E NÃO TINHA NENHUM LINK — de sempre até 27/08/2026.
                // `onOpenGuideUpload` era desestruturada nas props (`:297`) e **nunca referenciada**
                // no arquivo; `/guides/upload` só se alcançava digitando a URL.
                // ⚠ E ela é a ÚNICA tela que mostra o PDF de guia que o parser NÃO conseguiu casar
                // com empresa nenhuma. Sem porta, essas guias eram invisíveis: ninguém as vê no
                // dashboard (não pertencem a empresa nenhuma) e ninguém as vê aqui.
                // ⚠ Fica junto de "Pendências de e-mail" porque as duas respondem à mesma pergunta —
                // *o que ficou pelo caminho?* — e nenhuma das duas é rotina diária.
                { label: "Guias não identificadas", onClick: onOpenGuideUpload },
              ]}
            />
            <Button
              variant="secondary"
              className="dashboard-home__action dashboard-home__action--accent"
              onClick={() => {
                if (globalChartStatus && !globalChartStatus.isConfigured) {
                  const faltantes = (globalChartStatus.tiposFaltantes || []).join(", ");
                  window.alert(
                    "Configure o plano de contas global antes de criar empresas.\n\n"
                    + `Faltam contas dos tipos: ${faltantes}.\n\n`
                    + "Acesse: Configurações da Firma → Plano de Contas Global."
                  );
                  return;
                }
                onCreateCompany();
              }}
              title={
                globalChartStatus && !globalChartStatus.isConfigured
                  ? "Plano de contas global incompleto — configure antes de criar empresas"
                  : undefined
              }
            >
              Nova empresa
              {globalChartStatus && !globalChartStatus.isConfigured && (
                <span style={{ marginLeft: 6, fontSize: "0.7rem" }} aria-label="Plano global incompleto">⚠</span>
              )}
            </Button>
            {/* Onboardings fica ao LADO de "Nova empresa", e as duas portas continuam existindo:
                "Nova empresa" serve a quem já tem tudo em mãos; o funil serve ao que acontece
                ANTES disso (empresa que ainda vai abrir, papelada chegando em partes). */}
            {/* Onboardings fica ao LADO de "Nova empresa", e as duas portas continuam existindo:
                "Nova empresa" serve a quem já tem tudo em mãos; o funil serve ao que acontece
                ANTES disso (empresa que ainda vai abrir, papelada chegando em partes). */}
            {onOpenOnboardings && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--outline" onClick={onOpenOnboardings}>
                Onboardings
              </Button>
            )}
            {/* ⚠ APURAÇÃO E CONSULTAS FORAM PARA A GAVETA (☰), no grupo "Ferramentas" — pedido do
                dono, 18/08/2026. Continuam com o mesmo rótulo e o mesmo handler.

                ⚠ O BOTÃO "ENVIO DE E-MAILS EM LOTE" FOI REMOVIDO da barra, e este é o único caso
                em que uma porta se fechou: *"não é tirar o botão de enviar, é tirar o botão que
                abre a aba de envio de email, aquela ao lado de consultas"* (dono, 18/08/2026). Ele
                era o único link para `/guides/batch-email`; a rota e a página continuam existindo.
                ⚠ ENVIAR GUIA EM LOTE NÃO DEPENDIA DELE e continua em dois caminhos: a seleção na
                tabela (marcar as linhas → "Enviar guias", que roda sobre a seleção e mostra a
                prévia) e, guia a guia, "Liberar ao cliente" dentro da empresa.

                O botão "Calendário" também não está aqui: o calendário virou VISÃO, ao lado de
                Cards e Ano. Ter duas portas para a mesma coisa só dividiria o caminho. */}
            {/* ⚠ O "↻" SAIU DAQUI e foi para o lado do seletor de competência, no título. Ele não é
                um atalho como os outros: é a recarga DA LISTA da competência exibida — o que ele
                atualiza está escrito ao lado dele agora. Numa fileira de atalhos, um ícone mudo
                entre botões nomeados era a coisa que ninguém sabia dizer o que fazia. */}
          </nav>

          {/* C9: avisa que há processo rodando em segundo plano (downloads de notas / situações
              fiscais) mesmo depois de sair da página que disparou. O progresso detalhado
              continua na página do job — aqui é só o aviso. */}
          {backgroundJobs?.total > 0 && (
            <div
              role="status"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 12,
                padding: "6px 12px", borderRadius: 999,
                background: "var(--state-neutral-surface)", border: "1px solid var(--accent-cyan)", color: "var(--accent-cyan)",
                fontSize: "0.82rem", fontWeight: 600,
              }}
              title="Downloads em lote rodando no servidor. Acompanhe o progresso em Consultas."
            >
              ⏳ {backgroundJobs.total} processo{backgroundJobs.total > 1 ? "s" : ""} em segundo plano
              {backgroundJobs.empresas > 0 && (
                <span style={{ color: "var(--state-neutral)", fontWeight: 400 }}>
                  ({backgroundJobs.processadas}/{backgroundJobs.empresas} empresas)
                </span>
              )}
            </div>
          )}

          {/* Três visões da MESMA carteira: cards (uma competência), grade anual (12 meses) e
              calendário (o que vence no dia). O calendário era uma página separada; virou visão
              porque é a mesma pergunta — "como está a carteira" — só com outro eixo de tempo.
              Obrigações SAIU daqui: cadastrar obrigação é configuração do escritório, não uma
              forma de olhar a carteira; foi para o menu Configurações. O que se ENTREGA continua
              visível aqui, dentro do calendário. */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
            {/* `mode="view"`: trocar de visão não navega, então é `aria-pressed`, não
                `aria-current="page"`. */}
            <Tabs
              mode="view"
              ariaLabel="Visão da carteira"
              items={[
                { key: "tabela", label: "Tabela" },
                { key: "cards", label: "Cards" },
                { key: "ano", label: "Ano" },
                { key: "calendario", label: "Calendário" },
              ]}
              active={modoVisao}
              onChange={trocarVisao}
            />
            {/* Imprimir mora ao lado das visões porque É uma visão — a da carteira no papel. Ele
                troca para Tabela sozinho e expande as fechadas: imprimir a lista pela metade, em
                silêncio, seria pior que não ter o botão.
                ⚠ NÃO entra na barra de abas: é ação, não recorte — clicar nele não deixa a barra
                num estado "selecionado". */}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={imprimirListagem}
              disabled={imprimindo}
              title="Imprimir a listagem (ou salvar em PDF). Sai em tabela, com as fechadas incluídas."
              style={{ marginLeft: "auto" }}
            >
              🖨 {imprimindo ? "Preparando…" : "Imprimir"}
            </Button>
          </div>

          {/* F2 — o que trava a carteira nesta competência.
              A pergunta "quais eu já posso fechar?" só tinha uma resposta: abrir empresa por
              empresa e olhar o cadeado. Aqui ela vira contagem, e cada contagem vira lista de
              trabalho. Some inteira quando o servidor não responde: um número errado sobre
              fechamento é pior que número nenhum. */}
          {(modoVisao === "cards" || modoVisao === "tabela") && contagemApuracao && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontWeight: 700, marginRight: 2 }}>
                APURAÇÃO DO MÊS
              </span>
              {/* ⚠ Estes chips SÃO a coluna Apuração, contada. Vêm do mesmo `estadoApuracao` que
                  desenha o chip de cada linha e que ordena a lista — antes eram um cálculo próprio
                  sobre `travas`, e as duas leituras discordavam na mesma tela.
                  Cada estado carrega cor E superfície: derivar o fundo com `${cor}22` quebra em
                  silêncio assim que a cor vira `var(--…)`. */}
              {[
                ["all", `Todas · ${contagemApuracao.total}`, "var(--state-neutral)", "var(--state-neutral-surface)"],
                ...ORDEM_APURACAO
                  .filter((k) => contagemApuracao[k] > 0)
                  .map((k) => [k, `${APURACAO[k].icone} ${APURACAO[k].rotulo} · ${contagemApuracao[k]}`, APURACAO[k].cor, APURACAO[k].fundo]),
                // A pergunta mais frequente da SEGUNDA METADE do fluxo: as guias já existem, falta
                // mandar. Sai da leitura dos chips de guia, não do pipeline do mês.
                ["enviar", `✈ Falta enviar guia · ${contagemFaltaEnviar}`, "var(--state-warn)", "var(--state-warn-surface)"],
              ].map(([chave, label, cor, superficie]) => {
                const ativo = travaFiltro === chave;
                return (
                  <button
                    key={chave}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => setTravaFiltro(ativo ? "all" : chave)}
                    style={{
                      padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                      border: `1px solid ${ativo ? cor : "var(--border)"}`,
                      background: ativo ? superficie : "transparent",
                      color: ativo ? cor : "var(--state-neutral)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              {/* ⚠⚠ ESTE BOTÃO NUNCA APARECEU NA TELA — de 25/07/2026 até 27/08/2026.
                  A condição era `travaFiltro === "prontas"`, e **`"prontas"` não é chave de chip
                  nenhum**: as que existem são `all`, `problema`, `fechar`, `apurar`, `fechada` e
                  `enviar` (`estadoApuracao.js` + o ramo `enviar` logo acima). A palavra só vivia em
                  `contagemTravas.prontas` e no guard de `fecharAsProntas` — nunca em `setTravaFiltro`.
                  ⚠ Conferido no navegador antes de mexer: clicando o chip "☑ Falta fechar · 2", o
                  botão não aparecia. O fechamento contábil em lote existia, é sequencial, revalida no
                  servidor e relata as recusas — **e não tinha porta**.
                  ⚠ O `features/companies/CLAUDE.md` descrevia o botão como se ele estivesse na tela.

                  A intenção original fica: ele **só aparece dentro de um recorte**, para ninguém
                  fechar em lote sem ter olhado quem vai ser fechado. O recorte é "Falta fechar", que
                  é literalmente *"apurada — falta concluir o fechamento do mês"*. */}
              {travaFiltro === "fechar" && prontasVisiveis.length > 0 && (
                <button
                  type="button"
                  onClick={fecharAsProntas}
                  disabled={fechandoLote}
                  style={{
                    padding: "4px 12px", borderRadius: 999, fontSize: "0.78rem", fontWeight: 700,
                    border: "1px solid var(--state-closed)", background: "var(--state-closed-surface)", color: "var(--state-closed)",
                    cursor: fechandoLote ? "wait" : "pointer",
                  }}
                >
                  {/* ⚠ O número é o das VISÍVEIS que dá para fechar — ele pode ser MENOR que o do
                      chip, e isso é certo: "falta fechar" inclui quem ainda tem lançamento com
                      problema, e essa o servidor recusaria. */}
                  {fechandoLote ? "Fechando…" : `🔒 Fechar as ${prontasVisiveis.length}`}
                </button>
              )}
            </div>
          )}

          {/* ⚠ A BARRA DE PROGRESSO FOI REMOVIDA — decisão do dono, 15/08/2026: *"tire também
              aquela barra de progresso da página principal, está poluindo"*. Ela ficava aqui, em
              cards e tabela, com um segmento por estado de `estadoApuracao` e o contador
              "N/M fechadas" ao lado.
              ⚠ O que ela dizia NÃO se perdeu: os chips de APURAÇÃO DO MÊS, logo acima, saem do
              MESMO `contagemApuracao` — inclusive "🔒 Fechada · N" e "Todas · N", que eram os dois
              números do rótulo. O que sumiu é a proporção desenhada, não o dado.
              ⚠ Só a barra saiu: chip de filtro e ordenação continuam lendo `estadoApuracao`. */}

          {/* Os filtros abaixo são da visão de cards — a grade anual tem navegação própria (ano). */}
          {(modoVisao === "cards" || modoVisao === "tabela") && (
          <section
            aria-label="Filtros"
            style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}
          >
            <label style={{ ...FILTER_LABEL, flex: "1 1 220px", minWidth: 180 }}>
              Buscar empresa ou CNPJ
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                /* "Clinica" sem acento era erro de digitação, não escolha: a busca já normaliza
                   acento nos dois lados (`normalizeSearch`), então o exemplo não precisava ser
                   escrito errado para funcionar. */
                placeholder="Ex.: Clínica ou 00.000.000/0001-00"
                style={{ ...FILTER_CONTROL, width: "100%" }}
              />
            </label>

            {/* ⚠ O SELETOR DE COMPETÊNCIA QUE FICAVA AQUI FOI REMOVIDO. Havia dois na mesma tela —
                este e o do título — controlando o mesmo estado. Dois controles para uma coisa só
                fazem o usuário duvidar de qual vale, e um deles sempre parece não funcionar. Ficou
                o do título ("Empresas · ‹ Julho de 2026 ›"), que é onde o contexto da tela mora. */}

            {/* Chips do que está ATIVO — o rastro que o painel fechado não pode esconder. */}
            {chipsDeFiltro.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {chipsDeFiltro.map((c) => (
                  <button
                    key={c.chave}
                    type="button"
                    onClick={c.remover}
                    title="Remover este filtro"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
                      borderRadius: 999, cursor: "pointer", fontSize: "0.76rem", fontWeight: 600,
                      border: "1px solid var(--accent-purple)", background: "rgba(189,147,249,0.16)",
                      color: "var(--text)", font: "inherit",
                    }}
                  >
                    {c.texto}<span aria-hidden="true" style={{ color: "var(--text-muted)" }}>✕</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={limparFiltros}
                  style={{
                    padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontSize: "0.76rem",
                    background: "transparent", border: "1px solid var(--border)",
                    color: "var(--text-muted)", font: "inherit",
                  }}
                >
                  Limpar tudo
                </button>
              </div>
            )}

            {/* C7: os demais filtros saem da barra e vão pra um painel — o dono só quer
                busca e competência sempre visíveis. O badge mostra quantos estão ativos. */}
            <div style={{ position: "relative" }}>
              <Button
                type="button"
                variant={filtrosAtivos > 0 ? "primary" : "secondary"}
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                title="Mais filtros"
              >
                Filtros{filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ""}
              </Button>
              {showFilters && (
                <div
                  style={{
                    // Ancorado à DIREITA do botão: crescendo pra esquerda ele não vaza pra fora
                    // da tela quando o botão está na ponta direita da barra de filtros.
                    position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
                    background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10,
                    // ⚠ DUAS COLUNAS, e não uma tira alta. O painel de uma coluna descia por cima
                    // da tabela e o contador perdia de vista justamente as linhas que estava
                    // tentando filtrar. Em duas colunas ele cabe acima dos dados.
                    padding: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 1fr))",
                    gap: 12, maxWidth: "min(90vw, 380px)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                  }}
                >
                  <label style={FILTER_LABEL}>
                    Documentos
                    <select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="pending">Com pendências</option>
                      <option value="ok">Em dia</option>
                      <option value="all">Todas</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    SERPRO
                    <select value={serproFilter} onChange={(event) => setSerproFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="eligible">Aptas</option>
                      <option value="ineligible">Não aptas</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    Envio de guias
                    <select value={emailFilter} onChange={(event) => setEmailFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="sent">Só enviados</option>
                      <option value="notSent">Só não enviados</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    Apuração
                    <select value={apuracaoFilter} onChange={(event) => setApuracaoFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="apurados">Apurados</option>
                      <option value="naoApurados">Não apurados</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    Certificado
                    <select value={certFilter} onChange={(event) => setCertFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="comCert">Com certificado válido</option>
                      <option value="semCert">Sem certificado</option>
                      <option value="vencido">Certificado vencido</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    Situação fiscal
                    <select value={fiscalFilter} onChange={(event) => setFiscalFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      {/* Símbolo + palavra: é aqui que se aprende o que o ⚠ do card significa. */}
                      <option value="comPendencia">{situacaoFiscalComSimbolo("COM_PENDENCIA")}</option>
                      <option value="semPendencia">{situacaoFiscalComSimbolo("REGULAR")}</option>
                      <option value="emParcelamento">{situacaoFiscalComSimbolo("EM_PARCELAMENTO")}</option>
                    </select>
                  </label>

                  {/* ⚠ O SELETOR "REGIME" FOI REMOVIDO DAQUI — decisão do dono, 18/08/2026:
                      *"exclua o filtro de regime, pois já estarão separados"*. A separação por
                      regime é a barra de ABAS acima da tabela. Reintroduzir este `<select>` daria
                      dois controles para a mesma pergunta, e eles podem se contradizer: filtrar
                      "Simples" aqui com a aba "Lucro Presumido" ativa esvaziaria a tela sem que
                      nada na página explicasse por quê. */}

                  {/* Rodapé ocupando as duas colunas. "Aplicar" só FECHA o painel: os selects já
                      filtram ao mudar, e segurar a aplicação até o clique faria a lista mentir
                      enquanto o painel estivesse aberto. O botão existe para dar um jeito óbvio de
                      sair — não para adiar o efeito. */}
                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <Button type="button" variant="secondary" onClick={limparFiltros} disabled={filtrosAtivos === 0}>
                      Limpar filtros
                    </Button>
                    <Button type="button" onClick={() => setShowFilters(false)}>
                      Aplicar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
          )}

          {/* ─── ABAS DE REGIME ─────────────────────────────────────────────────────────────────
              *"ter duas tabelas na página principal, uma para presumido e outra simples nacional,
              deve ficar indicado em cima da tabela, como uma aba de navegador"* (dono, 18/08/2026).

              ⚠ REUSA `components/ui/Tabs` — a ÚNICA barra de abas do app. Uma segunda barra
              divergiria da primeira na correção seguinte, que é a razão de o componente existir.

              ⚠ `mode="view"`, não `nav`: trocar de aba não navega para lugar nenhum, é o mesmo
              recorte da mesma tela. Com `nav` o leitor de tela anunciaria "página atual" para um
              botão que não mudou de página.

              ⚠ SÓ EM TABELA E CARDS. "Ano" e "Calendário" são o outro eixo (o tempo): a grade anual
              é 12 meses × empresas e o calendário é o que vence no dia; recortá-los por regime não
              é o que o dono pediu, e a grade anual nem passa por `filteredCompanies` (ela tem busca
              própria no servidor).

              ⚠ A CONTAGEM VAI NO TEXTO, não no `badge` do componente — aquele badge é vermelho
              (`--state-danger`), e o 22 pareceria 22 problemas. O ponto colorido é a MESMA cor de
              categoria do card e da linha (ciano Simples · laranja Presumido), nunca `--state-*`. */}
          {(modoVisao === "cards" || modoVisao === "tabela") && (
            <div style={{ marginBottom: 10 }}>
              <Tabs
                mode="view"
                align="start"
                ariaLabel="Regime tributário"
                items={abasDaCarteira.map((aba) => ({
                  key: aba.key,
                  title: aba.title,
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span aria-hidden="true" style={{ color: aba.cor, fontSize: "0.72em" }}>●</span>
                      {aba.rotulo}
                      <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({aba.contagem})</span>
                    </span>
                  ),
                }))}
                active={abaAtiva}
                onChange={trocarAba}
              />
            </div>
          )}

          {modoVisao === "calendario" ? (
            <CalendarioGrid api={api} empresas={companies} onOpenCompany={onOpenCompany} />
          ) : modoVisao === "ano" ? (
            <AnnualGrid api={api} onOpenCompany={onOpenCompany} />
          ) : modoVisao === "tabela" ? (
            <>
            {/* ⚠ FORA do `data-print-area`: a barra é gesto de tela, e uma folha impressa com
                "8 empresas selecionadas" descreveria um estado que o papel não tem. */}
            <BarraSelecaoEmpresas
              api={api}
              empresasSelecionadas={empresasSelecionadas}
              competencia={dashboardCompetencia}
              /* ⚠ O MESMO indicador de processo em segundo plano que já desenha o selo acima —
                 não um segundo contador. É ele que impede disparar o mesmo lote duas vezes. */
              jobsAtivos={backgroundJobs?.total || 0}
              onLimparSelecao={limparSelecao}
              onConcluido={async () => { await onRefreshCompanies?.(); await carregarTravas(); }}
              avisoDeRecorte={avisoDeRecorte}
            />
            {/* A mesma frase, quando a poda não deixou ninguém marcado e a barra acima não existe.
                O ✕ existe para o aviso não ficar grudado na tela depois de lido — ele descreve algo
                que já aconteceu, não um estado atual. */}
            {avisoDeRecorte && empresasSelecionadas.length === 0 && (
              <div
                role="status"
                style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
                  padding: "8px 12px", borderRadius: 8,
                  background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
                  color: "var(--state-warn)", fontSize: "0.78rem", fontWeight: 600,
                }}
              >
                {avisoDeRecorte}
                <button
                  type="button"
                  onClick={() => setRecortadas(0)}
                  aria-label="Dispensar o aviso"
                  style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", marginLeft: "auto", font: "inherit" }}
                >
                  ✕
                </button>
              </div>
            )}
            <div data-print-area>
              {/* Só existe no papel (`display:none` na tela, ligado pelo @media print). É o que
                  permite conferir a folha meses depois: qual competência, quando foi impressa,
                  quantas empresas e — o mais importante — se estava filtrada. */}
              <div data-print-only style={{ display: "none" }}>
        {/* ⚠ `tom="papel"` NÃO É DETALHE: este portal é escuro, e a tinta dele (`--logo-tinta`,
            `#F8F8F2`) sairia INVISÍVEL no branco da folha. A variante crava o par de fundo claro e
            liga `print-color-adjust: exact`, senão o navegador descarta a cor da cúpula.
            ⚠ E ela precisa estar DENTRO do `[data-print-area]`: a regra do `@media print` é
            `body.imprimindo > * { visibility: hidden }`, e só os descendentes da área voltam. */}
        <LogoAltan tom="papel" altura={22} />
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
                  Empresas · {rotuloCompetencia(dashboardCompetencia)}
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem" }}>
                  {/* ⚠ A ABA ATIVA SAI IMPRESSA, e vem ANTES dos filtros porque é ela que explica o
                      tamanho da lista. Uma folha com 11 linhas que não diz "Lucro Presumido" é
                      exatamente a folha filtrada que não diz que está filtrada. */}
                  Regime: {rotuloAba(abaAtiva)} · {empresasVisiveis.length} empresa(s) · impresso em {new Date().toLocaleString("pt-BR")}
                  {descricaoFiltros ? ` · Filtros — ${descricaoFiltros}` : " · sem filtros"}
                  {search.trim() ? ` · Busca: "${search.trim()}"` : ""}
                </p>
              </div>
              <CompaniesTable
                /* ⚠ A LISTA DA ABA ATIVA — a mesma de onde saem `idsVisiveis` e a seleção. */
                companies={empresasVisiveis}
                travas={travas}
                competencia={dashboardCompetencia}
                onOpenCompany={onOpenCompany}
                acoesGuia={acoesGuia}
                busca={search}
                imprimindo={imprimindo}
                carregando={loadingCompanies}
                /* ⚠ O universo DA ABA, não o da carteira — ver `totalDaAba`. É a diferença entre
                   este número e o de linhas que responde ao "o chip diz 33 e eu conto 12 linhas";
                   a diferença para a carteira inteira quem conta é a barra de abas. */
                totalSemFiltro={totalDaAba}
                /* ⚠ Para o vazio saber dizer "esta ABA não tem empresa" em vez de mandar cadastrar
                   a primeira a quem tem a carteira cheia. */
                rotuloDoRecorte={rotuloAba(abaAtiva)}
                totalDaCarteira={(companies || []).length}
                /* ⚠ `error` é o feedback GERAL do app, não um erro dedicado desta carga; a tabela
                   só o usa quando a lista está VAZIA, que é o único momento em que confundir
                   "não carregou" com "não há" custa caro. Com 33 empresas na tela ele é ignorado. */
                erroDeCarga={error || null}
                onLimparFiltros={() => { limparFiltros(); setTravaFiltro("all"); setSearch(""); }}
                selecionados={selecionados}
                onAlternarSelecao={alternarSelecao}
                onSelecionarTodos={selecionarTodos}
              />
            </div>
            </>
          ) : (
          <section className="cards-grid cards-grid--dashboard" aria-label="Lista de empresas">
            {empresasVisiveis.map((company) => (
              <CompanyCard key={company.companyId} company={company} onAccess={onOpenCompany} acoesGuia={acoesGuia} />
            ))}
          </section>
          )}

          {/* A tabela já diz "nenhuma empresa" na própria linha vazia — repetir aqui duplicaria a
              mensagem embaixo dela. */}
          {!loadingCompanies && modoVisao !== "tabela" && empresasVisiveis.length === 0 ? (
            <p className="text-muted dashboard-home__empty">Nenhuma empresa encontrada para os filtros atuais.</p>
          ) : null}
        </section>

        <Feedback message={message} error={error} />
      </AppShell>
    </div>
  );
}
