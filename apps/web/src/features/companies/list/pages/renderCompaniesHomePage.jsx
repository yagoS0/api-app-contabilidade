import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { situacaoFiscalComSimbolo } from "../../../../lib/vocabulario";
import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { Tabs } from "../../../../components/ui/Tabs";
import { CompanyCard, getComplianceTags } from "../components/renderCompanyCard";
import { AnnualGrid } from "../components/renderAnnualGrid";
import { CompaniesTable } from "../components/renderCompaniesTable";
import { CalendarioGrid } from "../../../calendario/components/renderCalendarioGrid";
import { estadoCertificado } from "../lib/certificado";
import { APURACAO, ORDEM_APURACAO, contarApuracao, estadoApuracao } from "../lib/estadoApuracao";

// Q17: dropdown de "Configurações" — abre um seletor (não navega para um hub).
function SettingsMenu({ items }) {
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
  const usable = items.filter((it) => typeof it.onClick === "function");
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <Button variant="secondary" className="dashboard-home__action" onClick={() => setOpen((o) => !o)}>
        Configurações ▾
      </Button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 220, overflow: "hidden",
        }}>
          {usable.map((it) => (
            <button
              key={it.label}
              type="button"
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
          ))}
        </div>
      )}
    </div>
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
  onOpenBatchEmail,
  onOpenApuracao,
  onOpenRotinas,
  onOpenPlanejamento,
  onOpenSerproFuncoes,
  onOpenObrigacoes,
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
  // Situação fiscal (SITFIS) e regime — combinam com os demais filtros.
  const [fiscalFilter, setFiscalFilter] = useState("all"); // all | comPendencia | semPendencia | emParcelamento
  const [regimeFilter, setRegimeFilter] = useState("all"); // all | SIMPLES | LUCRO_PRESUMIDO
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

  /** Empresas com pelo menos uma guia GERADA e não enviada — a ação rápida do fim do mês. */
  const empresasFaltaEnviar = useMemo(() => {
    const set = new Set();
    for (const c of companies || []) {
      if (getComplianceTags(c.guideCompliance).some((t) => t.state === "gerada")) set.add(c.companyId);
    }
    return set;
  }, [companies]);
  const contagemFaltaEnviar = empresasFaltaEnviar.size;

  /**
   * Progresso do fechamento, em segmentos proporcionais.
   *
   * ⚠ VAZIO CONTA COMO CONCLUÍDO — é o ponto todo da bifurcação: empresa sem movimento não pode
   * parecer eternamente pendente. Aqui isso entra pelo `podeFechar`/`fechado`, que já não dependem
   * de guia existir; o chip cinza é o outro lado da mesma decisão.
   */
  const segmentosProgresso = useMemo(() => {
    if (!contagemApuracao?.total) return [];
    // ⚠ ORDEM CINZA → ÂMBAR → VERDE, e é ela que mata o paredão.
    //
    // A barra antiga pintava "falta check-list" de âmbar e, no começo do mês, praticamente toda a
    // carteira caía ali: uma faixa âmbar de ponta a ponta, alarmando durante trinta dias seguidos.
    // Agora "falta apurar" — que É o estado normal do dia 1 — é CINZA, e a barra nasce cinza e vai
    // colorindo conforme o trabalho anda. Ela conta a história do mês em vez de gritar o mês
    // inteiro; quando fica âmbar, é porque de fato há coisa esperando ação.
    return ORDEM_APURACAO
      .map((chave) => ({
        chave,
        n: contagemApuracao[chave] || 0,
        cor: APURACAO[chave].cor,
        rotulo: APURACAO[chave].rotulo.toLowerCase(),
      }))
      .filter((s) => s.n > 0)
      .sort((a, b) => ORDEM_APURACAO.indexOf(b.chave) - ORDEM_APURACAO.indexOf(a.chave));
  }, [contagemApuracao]);

  /**
   * Fecha, uma a uma, as empresas que o servidor disse estarem prontas.
   *
   * O laço é sequencial de propósito: são escritas, e disparar N em paralelo contra o mesmo backend
   * para ganhar dois segundos não paga o risco. A rota de fechar **revalida cada empresa** — se
   * alguém lançou algo entre a leitura do agregado e o clique, aquela empresa é recusada e as
   * demais seguem. Por isso o relatório final conta recusas em vez de abortar no primeiro erro.
   */
  async function fecharAsProntas() {
    if (fechandoLote || !contagemTravas?.prontas) return;
    const alvos = [...travas.values()].filter((l) => l.podeFechar);
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
    // Sem o de-para, o chip mostrava a constante crua ("Regime: LUCRO_PRESUMIDO") — o valor do
    // banco vazando para a tela.
    regimeFilter: { rotulo: "Regime", valores: { SIMPLES: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real" } },
  };
  const valoresFiltro = {
    documentFilter, serproFilter, emailFilter, apuracaoFilter,
    certFilter, fiscalFilter, regimeFilter,
  };
  // Cada filtro precisa saber se DESLIGAR sozinho — é isso que permite o chip removível.
  const RESET_FILTRO = {
    documentFilter: () => setDocumentFilter("pending"),
    serproFilter: () => setSerproFilter("all"),
    emailFilter: () => setEmailFilter("all"),
    apuracaoFilter: () => setApuracaoFilter("all"),
    certFilter: () => setCertFilter("all"),
    fiscalFilter: () => setFiscalFilter("all"),
    regimeFilter: () => setRegimeFilter("all"),
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
    setRegimeFilter("all");
    setFechamentoFilter("all");
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
      if (regimeFilter !== "all") {
        const regime = String(company?.legacyCompany?.regimeTributario || company?.regimeTributario || "").trim().toUpperCase();
        if (regime !== regimeFilter) return false;
      }
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
  }, [companies, documentFilter, search, serproFilter, emailFilter, apuracaoFilter, certFilter, fiscalFilter, regimeFilter, travaFiltro, travas, empresasFaltaEnviar]);

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
                <h1 className="dashboard-home__title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  Empresas
                  <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>·</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
                  </span>
                </h1>
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

          <nav className="dashboard-home__actions" aria-label="Atalhos">
            {/* ⚠ "Nova empresa" deixou de ser verde. Dois botões verdes lado a lado competem entre
                si e nenhum vira o primário de verdade. O verde fica com "Envio de e-mails em
                lote", que é A ação do fluxo mensal; criar empresa é episódico. */}
            <Button
              variant="secondary"
              className="dashboard-home__action"
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
            {/* Q17: ordem — Nova empresa · Envio de e-mails · Apuração · Configurações */}
            {onOpenBatchEmail && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenBatchEmail}>
                Envio de e-mails em lote
              </Button>
            )}
            {onOpenApuracao && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenApuracao}>
                Apuração
              </Button>
            )}
            {/* O botão "Calendário" saiu daqui: o calendário virou VISÃO, ao lado de Cards e Ano.
                Ter as duas portas para a mesma coisa só dividiria o caminho. */}
            {onOpenRotinas && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenRotinas}>
                Rotinas
              </Button>
            )}
            {/* Fica no dashboard, e nao dentro de uma empresa, de proposito: a simulacao LIVRE e o
                cenario de reuniao com prospect, quando a empresa ainda nao existe no sistema. */}
            {onOpenPlanejamento && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenPlanejamento}>
                Planejamento
              </Button>
            )}
            {/* C10: "Pendências" saiu do dashboard — virou a aba "Situação Fiscal"
                dentro de Consultas (antiga "Funções em lote"). */}
            {onOpenSerproFuncoes && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenSerproFuncoes}>
                Consultas
              </Button>
            )}
            <SettingsMenu
              items={[
                // Cadastrar obrigação é CONFIGURAÇÃO do escritório (define o que passa a ser
                // cobrado de todo mundo), não uma forma de olhar a carteira — por isso saiu do
                // seletor de visões e entrou aqui.
                { label: "Obrigações do escritório", onClick: onOpenObrigacoes },
                { label: "Configuração SERPRO", onClick: onOpenGuideSettings },
                { label: "Plano de Contas Global", onClick: onOpenChartGlobal },
                { label: "Pendências (debug)", onClick: onOpenPendingReport },
              ]}
            />
            {/* Atualizar lista vira um ícone discreto */}
            <Button
              variant="secondary"
              className="dashboard-home__action"
              onClick={onRefreshCompanies}
              disabled={loadingCompanies}
              title="Atualizar lista"
              aria-label="Atualizar lista"
              style={{ minWidth: 40, padding: "8px 12px" }}
            >
              {loadingCompanies ? "…" : "↻"}
            </Button>
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
              {/* Só aparece dentro do recorte "Prontas": um botão de fechar em lote solto na barra
                  seria fácil de clicar sem ter olhado quem vai ser fechado. */}
              {travaFiltro === "prontas" && contagemTravas.prontas > 0 && (
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
                  {fechandoLote ? "Fechando…" : `🔒 Fechar as ${contagemTravas.prontas}`}
                </button>
              )}
            </div>
          )}

          {/* A BARRA DE PROGRESSO. Os números acima dizem quanto falta; a barra diz o quanto já
              andou — é a única coisa na tela que responde "estou perto do fim do mês?".
              Cada segmento é o mesmo filtro dos chips: clicar aplica o recorte. */}
          {(modoVisao === "cards" || modoVisao === "tabela") && segmentosProgresso.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div
                role="img"
                aria-label={`Progresso do fechamento: ${segmentosProgresso.map((s) => `${s.n} ${s.rotulo}`).join(", ")}`}
                style={{ display: "flex", flex: "1 1 auto", height: 6, borderRadius: 999, overflow: "hidden", background: "var(--state-neutral-surface)" }}
              >
                {segmentosProgresso.map((s) => (
                  <button
                    key={s.chave}
                    type="button"
                    title={`${s.n} ${s.rotulo} — clique para filtrar`}
                    onClick={() => setTravaFiltro(travaFiltro === s.chave ? "all" : s.chave)}
                    style={{
                      flex: `${s.n} 0 0`, background: s.cor, border: "none", padding: 0,
                      cursor: "pointer", height: "100%",
                      opacity: travaFiltro === "all" || travaFiltro === s.chave ? 1 : 0.35,
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {contagemTravas.fechadas}/{contagemTravas.total} fechadas
              </span>
            </div>
          )}

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
                placeholder="Ex.: Clinica ou 00.000.000/0001-00"
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

                  <label style={FILTER_LABEL}>
                    Regime
                    <select value={regimeFilter} onChange={(event) => setRegimeFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todos</option>
                      <option value="SIMPLES">Simples Nacional</option>
                      <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
                    </select>
                  </label>

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

          {modoVisao === "calendario" ? (
            <CalendarioGrid api={api} empresas={companies} onOpenCompany={onOpenCompany} />
          ) : modoVisao === "ano" ? (
            <AnnualGrid api={api} onOpenCompany={onOpenCompany} />
          ) : modoVisao === "tabela" ? (
            <div data-print-area>
              {/* Só existe no papel (`display:none` na tela, ligado pelo @media print). É o que
                  permite conferir a folha meses depois: qual competência, quando foi impressa,
                  quantas empresas e — o mais importante — se estava filtrada. */}
              <div data-print-only style={{ display: "none" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
                  Empresas · {rotuloCompetencia(dashboardCompetencia)}
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem" }}>
                  {filteredCompanies.length} empresa(s) · impresso em {new Date().toLocaleString("pt-BR")}
                  {descricaoFiltros ? ` · Filtros — ${descricaoFiltros}` : " · sem filtros"}
                  {search.trim() ? ` · Busca: "${search.trim()}"` : ""}
                </p>
              </div>
              <CompaniesTable
                companies={filteredCompanies}
                travas={travas}
                competencia={dashboardCompetencia}
                onOpenCompany={onOpenCompany}
                acoesGuia={acoesGuia}
                busca={search}
                imprimindo={imprimindo}
              />
            </div>
          ) : (
          <section className="cards-grid cards-grid--dashboard" aria-label="Lista de empresas">
            {filteredCompanies.map((company) => (
              <CompanyCard key={company.companyId} company={company} onAccess={onOpenCompany} acoesGuia={acoesGuia} />
            ))}
          </section>
          )}

          {/* A tabela já diz "nenhuma empresa" na própria linha vazia — repetir aqui duplicaria a
              mensagem embaixo dela. */}
          {!loadingCompanies && modoVisao !== "tabela" && filteredCompanies.length === 0 ? (
            <p className="text-muted dashboard-home__empty">Nenhuma empresa encontrada para os filtros atuais.</p>
          ) : null}
        </section>

        <Feedback message={message} error={error} />
      </AppShell>
    </div>
  );
}
