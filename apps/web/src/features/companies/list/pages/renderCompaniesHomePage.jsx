import { useEffect, useMemo, useRef, useState } from "react";
import { situacaoFiscalComSimbolo } from "../../../../lib/vocabulario";
import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { CompanyCard, getComplianceTags } from "../components/renderCompanyCard";
import { AnnualGrid } from "../components/renderAnnualGrid";
import { CalendarioGrid } from "../../../calendario/components/renderCalendarioGrid";

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
          background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 220, overflow: "hidden",
        }}>
          {usable.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 14px",
                background: "transparent", border: "none", color: "#F8F8F2", cursor: "pointer", fontSize: "0.85rem",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#2f3147"; }}
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
const FILTER_LABEL = { display: "grid", gap: 3, fontSize: "0.68rem", color: "#aeb6d3", textTransform: "uppercase", letterSpacing: "0.03em" };
const FILTER_CONTROL = { background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2", padding: "5px 8px", fontSize: "0.8rem", colorScheme: "dark" };
// C7: setas de navegação da competência (‹ ›).
const COMP_ARROW = { ...FILTER_CONTROL, padding: "5px 9px", cursor: "pointer", fontWeight: 700, lineHeight: 1 };

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
  // C8: duas formas de ver a carteira — cards (competência única) ou grade anual (12 meses).
  const [modoVisao, setModoVisao] = useState("cards"); // "cards" | "ano"
  const [search, setSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState("pending");
  const [serproFilter, setSerproFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all"); // all | sent | notSent (Q16)
  const [apuracaoFilter, setApuracaoFilter] = useState("all"); // all | apurados | naoApurados
  const [certFilter, setCertFilter] = useState("all"); // all | comCert | semCert
  // Situação fiscal (SITFIS) e regime — combinam com os demais filtros.
  const [fiscalFilter, setFiscalFilter] = useState("all"); // all | comPendencia | semPendencia | emParcelamento
  const [regimeFilter, setRegimeFilter] = useState("all"); // all | SIMPLES | LUCRO_PRESUMIDO
  // Fechamento CONTÁBIL do mês filtrado (o mesmo 🔒 do card) — não confundir com apuração.
  const [fechamentoFilter, setFechamentoFilter] = useState("all"); // all | fechadas | abertas
  // C7: os filtros secundários ficam num painel; só busca e competência seguem aparentes.
  const [showFilters, setShowFilters] = useState(false);
  // F2: "o que trava a carteira" — resposta agregada do servidor para a competência da tela.
  // Não vem do card: o card sabe se a empresa está fechada, não POR QUE ela ainda não pode ser.
  const [travas, setTravas] = useState(null);          // Map companyId → linha do servidor
  const [travaFiltro, setTravaFiltro] = useState("all"); // all | prontas | checklist | problemas
  useEffect(() => {
    let vivo = true;
    if (!api?.getCarteiraFechamento || !dashboardCompetencia) { setTravas(null); return undefined; }
    api.getCarteiraFechamento(dashboardCompetencia)
      .then((out) => {
        if (!vivo) return;
        if (out?.ok === false) { setTravas(null); return; }
        setTravas(new Map((out?.empresas || []).map((e) => [e.companyId, e])));
      })
      // Silencioso de propósito: isto é um atalho sobre a lista, e falhar aqui não pode derrubar
      // o dashboard. Sem resposta, a barra some e os cards continuam como sempre foram.
      .catch(() => { if (vivo) setTravas(null); });
    return () => { vivo = false; };
  }, [api, dashboardCompetencia]);

  const contagemTravas = useMemo(() => {
    if (!travas) return null;
    const linhas = [...travas.values()];
    return {
      total: linhas.length,
      prontas: linhas.filter((l) => l.podeFechar).length,
      checklist: linhas.filter((l) => !l.fechado && l.checklistPendentes?.length > 0).length,
      problemas: linhas.filter((l) => !l.fechado && l.blockers?.length > 0).length,
      fechadas: linhas.filter((l) => l.fechado).length,
    };
  }, [travas]);
  // "pending" é o default de Documentos (não conta como filtro ativo).
  const filtrosAtivos = [
    documentFilter !== "pending",
    serproFilter !== "all",
    emailFilter !== "all",
    apuracaoFilter !== "all",
    certFilter !== "all",
    fiscalFilter !== "all",
    regimeFilter !== "all",
    fechamentoFilter !== "all",
  ].filter(Boolean).length;
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
        const t = travas?.get(company?.companyId);
        if (!t) return false;
        if (travaFiltro === "prontas" && !t.podeFechar) return false;
        if (travaFiltro === "checklist" && !(!t.fechado && t.checklistPendentes?.length > 0)) return false;
        if (travaFiltro === "problemas" && !(!t.fechado && t.blockers?.length > 0)) return false;
      }
      if (emailFilter === "notSent" && company?.monthEmailSent) return false;
      if (emailFilter === "sent" && !company?.monthEmailSent) return false;
      if (apuracaoFilter === "apurados" && !company?.apuracao?.apurada) return false;
      if (apuracaoFilter === "naoApurados" && company?.apuracao?.apurada) return false;
      const temCert = Boolean(company?.legacyCompany?.certStorageKey);
      if (certFilter === "comCert" && !temCert) return false;
      if (certFilter === "semCert" && temCert) return false;
      // Situação fiscal (SITFIS). "Sem pendência" = REGULAR de verdade: empresa nunca consultada
      // (fiscalSituacao null) NÃO entra — não afirmamos que está limpa sem ter consultado.
      const fiscal = String(company?.fiscalSituacao || "");
      if (fiscalFilter === "comPendencia" && fiscal !== "COM_PENDENCIA") return false;
      if (fiscalFilter === "semPendencia" && fiscal !== "REGULAR") return false;
      if (fiscalFilter === "emParcelamento" && fiscal !== "EM_PARCELAMENTO") return false;
      if (fechamentoFilter !== "all") {
        const fechada = Boolean(company?.fechamentoContabil?.fechado);
        if (fechamentoFilter === "fechadas" && !fechada) return false;
        if (fechamentoFilter === "abertas" && fechada) return false;
      }
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
  }, [companies, documentFilter, search, serproFilter, emailFilter, apuracaoFilter, certFilter, fiscalFilter, regimeFilter, fechamentoFilter, travaFiltro, travas]);

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
                <h1 className="dashboard-home__title">Empresas</h1>
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
                border: "1px solid #FFB347",
                color: "#FFB347",
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
            <Button
              variant="success"
              className="dashboard-home__action dashboard-home__action--success"
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
              <Button variant="success" className="dashboard-home__action dashboard-home__action--success" onClick={onOpenBatchEmail}>
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
                background: "rgba(139,233,253,0.10)", border: "1px solid #8BE9FD", color: "#8BE9FD",
                fontSize: "0.82rem", fontWeight: 600,
              }}
              title="Downloads em lote rodando no servidor. Acompanhe o progresso em Consultas."
            >
              ⏳ {backgroundJobs.total} processo{backgroundJobs.total > 1 ? "s" : ""} em segundo plano
              {backgroundJobs.empresas > 0 && (
                <span style={{ color: "#A7B0C0", fontWeight: 400 }}>
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
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {[["cards", "Cards"], ["ano", "Ano"], ["calendario", "Calendário"]].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setModoVisao(key)}
                style={{
                  padding: "5px 14px", borderRadius: 999, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600,
                  border: `1px solid ${modoVisao === key ? "#BD93F9" : "#44475A"}`,
                  background: modoVisao === key ? "rgba(189,147,249,0.16)" : "transparent",
                  color: modoVisao === key ? "#F8F8F2" : "#A7B0C0",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* F2 — o que trava a carteira nesta competência.
              A pergunta "quais eu já posso fechar?" só tinha uma resposta: abrir empresa por
              empresa e olhar o cadeado. Aqui ela vira contagem, e cada contagem vira lista de
              trabalho. Some inteira quando o servidor não responde: um número errado sobre
              fechamento é pior que número nenhum. */}
          {modoVisao === "cards" && contagemTravas && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "0.74rem", color: "#8A8FA3", fontWeight: 700, marginRight: 2 }}>
                FECHAMENTO DO MÊS
              </span>
              {[
                ["all", `Todas · ${contagemTravas.total}`, "#A7B0C0"],
                ["prontas", `✅ Prontas para fechar · ${contagemTravas.prontas}`, "#69FF47"],
                ["checklist", `☐ Falta check-list · ${contagemTravas.checklist}`, "#FFB347"],
                ["problemas", `⚠ Lançamento com problema · ${contagemTravas.problemas}`, "#FF5757"],
              ].map(([chave, label, cor]) => {
                const ativo = travaFiltro === chave;
                return (
                  <button
                    key={chave}
                    type="button"
                    onClick={() => setTravaFiltro(ativo ? "all" : chave)}
                    style={{
                      padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontSize: "0.78rem", fontWeight: 600,
                      border: `1px solid ${ativo ? cor : "#44475A"}`,
                      background: ativo ? `${cor}22` : "transparent",
                      color: ativo ? cor : "#A7B0C0",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              {contagemTravas.fechadas > 0 && (
                <span style={{ fontSize: "0.74rem", color: "#2DD4BF" }}>
                  🔒 {contagemTravas.fechadas} já fechada{contagemTravas.fechadas > 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}

          {/* Os filtros abaixo são da visão de cards — a grade anual tem navegação própria (ano). */}
          {modoVisao === "cards" && (
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

            {/* C7: competência com setas ‹ › pra andar mês a mês (antes só o picker). */}
            {onChangeCompetencia && (
              <label style={FILTER_LABEL}>
                Competência
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => onChangeCompetencia(shiftCompetencia(dashboardCompetencia, -1))}
                    style={COMP_ARROW}
                    aria-label="Competência anterior"
                    title="Mês anterior"
                  >
                    ‹
                  </button>
                  <input
                    type="month"
                    value={dashboardCompetencia || ""}
                    onChange={(e) => onChangeCompetencia(e.target.value)}
                    style={{ ...FILTER_CONTROL, width: 150 }}
                  />
                  <button
                    type="button"
                    onClick={() => onChangeCompetencia(shiftCompetencia(dashboardCompetencia, 1))}
                    style={COMP_ARROW}
                    aria-label="Próxima competência"
                    title="Próximo mês"
                  >
                    ›
                  </button>
                </span>
              </label>
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
                    background: "#21222C", border: "1px solid #44475A", borderRadius: 10,
                    padding: 12, display: "grid", gap: 10, width: 240, maxWidth: "90vw",
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
                    Enviados
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
                      <option value="comCert">Com certificado</option>
                      <option value="semCert">Sem certificado</option>
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
                    Fechamento
                    <select value={fechamentoFilter} onChange={(event) => setFechamentoFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="fechadas">Fechadas</option>
                      <option value="abertas">Abertas</option>
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

                  {filtrosAtivos > 0 && (
                    <Button type="button" variant="secondary" onClick={limparFiltros}>
                      Limpar filtros
                    </Button>
                  )}
                </div>
              )}
            </div>
          </section>
          )}

          {modoVisao === "calendario" ? (
            <CalendarioGrid api={api} empresas={companies} onOpenCompany={onOpenCompany} />
          ) : modoVisao === "ano" ? (
            <AnnualGrid api={api} onOpenCompany={onOpenCompany} />
          ) : (
          <section className="cards-grid cards-grid--dashboard" aria-label="Lista de empresas">
            {filteredCompanies.map((company) => (
              <CompanyCard key={company.companyId} company={company} onAccess={onOpenCompany} />
            ))}
          </section>
          )}

          {!loadingCompanies && filteredCompanies.length === 0 ? (
            <p className="text-muted dashboard-home__empty">Nenhuma empresa encontrada para os filtros atuais.</p>
          ) : null}
        </section>

        <Feedback message={message} error={error} />
      </AppShell>
    </div>
  );
}
