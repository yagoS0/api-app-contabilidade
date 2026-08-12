import { lazy, Suspense, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { DeleteCompanyModal } from "../components/DeleteCompanyModal";
import { CompanySectionHeader } from "../components/renderCompanyDetailHeader";
import { CompanyFichaTab } from "../components/renderCompanyFichaTab";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { BackButton } from "../../../../components/ui/BackButton";
import { ErrorBoundary } from "../../../../components/ui/ErrorBoundary";
// Q14.2: hook próprio da Apuração v2 (escopo da empresa atual)
import { useApuracaoV2 } from "../../../apuracao-v2/hooks/useApuracaoV2";
// Q41: hook próprio da aba Situação Fiscal (SITFIS)
import { useSitfis } from "../../../fiscal/sitfis/hooks/useSitfis";
import { createApiClient } from "../../../../api/client";
import { competenciaPadrao, deslocarCompetencia, formatCompetencia } from "../../../../lib/competencia";
import { ENTREGA_POR_ARQUIVO_LIBERADA } from "../../../obrigacoes/entregas/lib/liberacao";
// ⚠ A regra de QUEM DEVE a DEFIS e o painel da dispensa entram EAGER, ao contrário do `EspelhoDefis`:
// a decisão precisa acontecer antes de qualquer chunk, e o painel é um parágrafo. Fazer a dispensa
// esperar um `lazy` mostraria "Carregando…" para dizer que não há trabalho a fazer.
import { obrigatoriedadeDefis } from "../../../obrigacoes/defis/lib/obrigatoriedadeDefis";
import { DefisNaoDevida } from "../../../obrigacoes/defis/components/DefisNaoDevida";
import { useCompanyDocuments, useCompanyNotes } from "../../documents/hooks/useCompanyDocuments";
import { useCompanyCredentials } from "../../credentials/hooks/useCompanyCredentials";

// Q8.C.3: lazy load das tabs pesadas. Bundle inicial cai (~30-40% segundo medições típicas),
// e cada tab só carrega seu JS quando o contador clica nela pela 1ª vez.
// Vantagem extra: erro em uma tab (parse error, missing prop) NÃO derruba as outras.
const CompanyGuidesTable = lazy(() =>
  import("../../../guides/list/components/renderCompanyGuidesTable").then((m) => ({ default: m.CompanyGuidesTable }))
);
const CompanyForm = lazy(() =>
  import("../../form/components/renderCompanyForm").then((m) => ({ default: m.CompanyForm }))
);
const AccountingEntriesTab = lazy(() =>
  import("../../../accounting/entries/components/renderAccountingEntriesTab").then((m) => ({ default: m.AccountingEntriesTab }))
);
const CircularTab = lazy(() =>
  import("../../../accounting/circular/components/renderCircularTab").then((m) => ({ default: m.CircularTab }))
);
const ChartOfAccountsPage = lazy(() =>
  import("../../../accounting/chart-of-accounts/pages/renderChartOfAccountsPage").then((m) => ({ default: m.ChartOfAccountsPage }))
);
const ParcelamentoTab = lazy(() =>
  import("../../../accounting/parcelamento/pages/renderParcelamentoTab").then((m) => ({ default: m.ParcelamentoTab }))
);
// Aba Obrigações da empresa = o calendário do dashboard travado numa empresa.
const CalendarioGrid = lazy(() =>
  import("../../../calendario/components/renderCalendarioGrid").then((m) => ({ default: m.CalendarioGrid }))
);
// Q12.A: módulo Notas Fiscais — lazy, sem inflar o bundle inicial.
const NotasFiscaisTab = lazy(() =>
  import("../../../notas/components/renderNotasFiscaisTab").then((m) => ({ default: m.NotasFiscaisTab }))
);
// Q14.2: Apuração v2 — cadastro fiscal + produtos/serviços + pendências
const ApuracaoV2Tab = lazy(() =>
  import("../../../apuracao-v2/pages/renderApuracaoV2Tab").then((m) => ({ default: m.ApuracaoV2Tab }))
);
// Q41: aba Situação Fiscal (SITFIS)
const SitfisTab = lazy(() =>
  import("../../../fiscal/sitfis/components/renderSitfisTab").then((m) => ({ default: m.SitfisTab }))
);
// Q12.B+++: painel de cert A1 da empresa
const CompanyCertificatePanel = lazy(() =>
  import("../../certificate/components/CompanyCertificatePanel").then((m) => ({ default: m.CompanyCertificatePanel }))
);

function TabLoadingFallback() {
  return (
    <div style={{ padding: 32, textAlign: "center", color: "#aeb6d3" }}>
      Carregando…
    </div>
  );
}

// Documentos e Anotações da empresa (grupo Cadastro). Lazy como as demais abas: só carregam o JS
// quando o contador abre a aba.
const CompanyDocumentsTab = lazy(() =>
  import("../../documents/components/renderCompanyDocumentsTab").then((m) => ({ default: m.CompanyDocumentsTab }))
);
const CompanyNotesTab = lazy(() =>
  import("../../documents/components/renderCompanyNotesTab").then((m) => ({ default: m.CompanyNotesTab }))
);
// Cofre de senhas + "outras informações" (grupo Empresa). Lazy pelo mesmo motivo das demais.
const CompanyCredentialsTab = lazy(() =>
  import("../../credentials/components/renderCompanyCredentialsTab").then((m) => ({ default: m.CompanyCredentialsTab }))
);

function CompanyDocumentsTabWrapper({ companyId, feedback }) {
  const docs = useCompanyDocuments({ api: companyDocsApi, companyId, feedback });
  return <CompanyDocumentsTab docs={docs} />;
}

function CompanyNotesTabWrapper({ companyId, feedback }) {
  const notes = useCompanyNotes({ api: companyDocsApi, companyId, feedback });
  return <CompanyNotesTab notes={notes} />;
}

// ⚠ `feedback` INTEIRO, nunca `{ message, error }`. O hook do cofre chama `notifyError` — com a
// função ausente o optional call vira no-op silencioso, e toda falha de carga/revelação sumiria
// sem uma linha na tela. É o defeito que já custou uma semana no FechamentoModal.
function CompanyCredentialsTabWrapper({ companyId, feedback }) {
  const vault = useCompanyCredentials({ api: companyDocsApi, companyId, feedback });
  return <CompanyCredentialsTab vault={vault} />;
}

// Q14.2: wrapper que instancia hook próprio da Apuração v2 (state da empresa atual)
const apuracaoV2Api = createApiClient();
const companyDocsApi = createApiClient();
// O CalendarioGrid chama a API por conta própria (mesmo padrão do SITFIS e do Apuração v2) —
// a página de detalhe não tem `api` em escopo.
const obrigacoesApi = createApiClient();
const RelatoriosTab = lazy(() =>
  import("../../../relatorios/components/RelatoriosTab").then((m) => ({ default: m.RelatoriosTab })),
);
// Carregado sob demanda: são ~40 campos e a especificação inteira da DEFIS, e quem abre a aba de
// Obrigações quase sempre quer o calendário, não o espelho.
const EspelhoDefis = lazy(() =>
  import("../../../obrigacoes/defis/components/EspelhoDefis").then((m) => ({ default: m.EspelhoDefis })),
);
const EntregaPorArquivo = lazy(() =>
  import("../../../obrigacoes/entregas/components/EntregaPorArquivo").then((m) => ({ default: m.EntregaPorArquivo })),
);
/**
 * A aba Obrigações da empresa: o calendário + a porta de entrada do ESPELHO DA DEFIS.
 *
 * ⚠ O espelho é o trabalho anual que não cabe no calendário — a DEFIS tem ~40 campos numerados e
 * uma ficha por estabelecimento. Deixá-lo só como uma ocorrência no dia 31/03 seria transformar a
 * entrega mais pesada do ano numa linha de agenda. Aqui ele é botão, ao lado do calendário.
 *
 * ⚠ O ANO PADRÃO é o ANTERIOR: a DEFIS de 2025 se entrega em 2026, então quem abre a tela em
 * qualquer mês de 2026 quer o espelho de 2025. Abrir no ano corrente mostraria um espelho de um
 * ano que nem terminou.
 */
const setaEfd = {
  background: "transparent", border: "1px solid #44475A", color: "#F8F8F2", borderRadius: 6,
  padding: "2px 9px", font: "inherit", fontSize: "0.85rem", cursor: "pointer", lineHeight: 1.2,
};

function ObrigacoesDaEmpresa({ companyId, companyRegime }) {
  const [abrirDefis, setAbrirDefis] = useState(false);
  const [anoDefis, setAnoDefis] = useState(() => new Date().getFullYear() - 1);
  const [espelhoSalvo, setEspelhoSalvo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  // A EFD-Contribuições é MENSAL e a DEFIS é ANUAL — dois períodos diferentes na mesma aba, cada um
  // com o seu seletor. Um só campo obrigaria um dos dois a mentir sobre o próprio período.
  const [competenciaEfd, setCompetenciaEfd] = useState(() => competenciaPadrao());

  // ⚠ A TELA NÃO PERGUNTAVA O REGIME. O botão "📄 Espelho da DEFIS" era oferecido a TODA empresa —
  // o defeito relatado pelo dono ("empresas do presumido estão com espelho da DEFIS, mas empresas
  // presumidas não têm DEFIS") era AUSÊNCIA de regra, não regra errada. A DEFIS é declaração do
  // Simples Nacional; a regra (com a fonte oficial) vive em `defis/lib/obrigatoriedadeDefis.js`.
  //
  // Três respostas, não duas: `obrigada` abre o fluxo, `dispensada` e `indefinida` o SUBSTITUEM por
  // um painel que diz o motivo. Empresa sem regime cadastrado não é afirmada como dispensada —
  // ausência nunca é resposta.
  const vereditoDefis = obrigatoriedadeDefis({ regime: companyRegime, anoCalendario: anoDefis });
  const defisDevida = vereditoDefis.situacao === "obrigada";

  async function abrir() {
    setCarregando(true);
    try {
      const r = await obrigacoesApi.getDefisEspelho?.(companyId, anoDefis);
      setEspelhoSalvo(r?.dados || r?.espelho?.dados || null);
    } catch { setEspelhoSalvo(null); }
    finally { setCarregando(false); setAbrirDefis(true); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* ⚠ O BLOCO APARECE SEMPRE, mas o que ele mostra depende do REGIME. A DEFIS é declaração do
          Simples Nacional (Manual do PGDAS-D e DEFIS, seção 9; LC 123/2006, art. 25, caput), e para
          quem não é optante a tela mostra a DISPENSA COM O MOTIVO no lugar do fluxo. Não é o mesmo
          que sumir — some da tela quem não deve nada, e aí ninguém sabe se foi dispensa ou
          esquecimento. Mesmo desenho da EFD-Contribuições, com o sinal invertido. */}
      {defisDevida ? (
        <div style={{ width: "var(--content-wide)", margin: "0 auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Entrega anual:</span>
          <input
            type="number"
            value={anoDefis}
            onChange={(e) => setAnoDefis(Number(e.target.value) || anoDefis)}
            style={{ width: 92, background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2", padding: "5px 8px", fontSize: "0.82rem" }}
            aria-label="Ano-calendário da DEFIS"
          />
          <button
            type="button"
            onClick={abrir}
            disabled={carregando}
            style={{ background: "transparent", border: "1px solid #BD93F9", color: "#BD93F9", borderRadius: 6, padding: "5px 12px", font: "inherit", fontSize: "0.8rem", cursor: "pointer" }}
          >
            {carregando ? "Abrindo…" : "📄 Espelho da DEFIS"}
          </button>
        </div>
      ) : (
        <DefisNaoDevida
          anoCalendario={anoDefis}
          veredito={vereditoDefis}
          // ⚠ A dispensa não pode virar BECO SEM SAÍDA. A própria regra documenta o caso em que ela
          // é derrubada: empresa excluída do Simples continua devendo a DEFIS do ano em que foi
          // optante, e o sistema guarda só o regime de hoje. Por isso a saída existe — escondida
          // dentro da lista de hipóteses, que é exatamente onde o motivo dela está escrito — e só
          // para `dispensada`: em `indefinida` a ação certa é cadastrar o regime, não contornar.
          onAbrirMesmoAssim={vereditoDefis.situacao === "dispensada" ? abrir : null}
          abrindo={carregando}
        />
      )}

      {/* ⚠ A EFD-Contribuições fica ACIMA do calendário, não como uma ocorrência dentro dele.
          Ela não é um dia na agenda: é um trabalho de três passos, dois deles FORA do app, e a
          pergunta que ela precisa responder ("esta competência já foi entregue?") não cabe num
          marcador de célula.

          ⚠ O BLOCO APARECE SEMPRE, mas o que ele mostra depende do REGIME: optante do Simples
          Nacional nunca entrega EFD-Contribuições (IN RFB 1.252/2012), e para ela o bloco diz a
          dispensa com a norma citada, no lugar dos três passos. Não é o mesmo que sumir — some da
          tela quem não deve nada, e aí ninguém sabe se foi dispensa ou esquecimento. */}
      {/* ⚠ DESLIGADO em 07/08/2026 por decisão do dono — ver `entregas/lib/liberacao.js` e
          `docs/efd-contribuicoes-onde-paramos.md`. Não é bug: o fluxo nunca foi exercido contra a
          API real, e a EFD merece desenvolvimento próprio. Nada foi apagado; é uma trava de uma
          linha, e o backend recusa pelo mesmo motivo. */}
      {ENTREGA_POR_ARQUIVO_LIBERADA && (
        <div style={{ width: "var(--content-wide)", margin: "0 auto", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Entrega mensal:</span>
            <button type="button" onClick={() => setCompetenciaEfd((c) => deslocarCompetencia(c, -1))} style={setaEfd} aria-label="Competência anterior">‹</button>
            <strong style={{ fontSize: "0.82rem", minWidth: 130, textAlign: "center" }}>{formatCompetencia(competenciaEfd)}</strong>
            <button type="button" onClick={() => setCompetenciaEfd((c) => deslocarCompetencia(c, 1))} style={setaEfd} aria-label="Próxima competência">›</button>
          </div>
          <Suspense fallback={<TabLoadingFallback />}>
            <EntregaPorArquivo companyId={companyId} regime={companyRegime} competencia={competenciaEfd} />
          </Suspense>
        </div>
      )}

      <CalendarioGrid api={obrigacoesApi} companyIdFixo={companyId} />

      {abrirDefis && (
        <Suspense fallback={<TabLoadingFallback />}>
          <EspelhoDefis
            anoCalendario={anoDefis}
            valorInicial={espelhoSalvo}
            onSalvar={(e) => obrigacoesApi.salvarDefisEspelho?.(companyId, anoDefis, e)}
            onMarcarTransmitida={async (e) => {
              await obrigacoesApi.salvarDefisEspelho?.(companyId, anoDefis, e);
              await obrigacoesApi.marcarDefisTransmitida?.(companyId, anoDefis);
              setAbrirDefis(false);
            }}
            onClose={() => setAbrirDefis(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function ApuracaoV2TabWrapper({ companyId, feedback, razao, competencia, onCompetenciaChange }) {
  const panel = useApuracaoV2({ api: apuracaoV2Api, companyId, feedback });
  return (
    <ApuracaoV2Tab
      panel={panel} api={apuracaoV2Api} companyId={companyId} feedback={feedback} razao={razao}
      competencia={competencia} onCompetenciaChange={onCompetenciaChange}
    />
  );
}

// Q41: wrapper que instancia o hook da Situação Fiscal (SITFIS) — companyId = portalClient id.
const sitfisApi = createApiClient();
function SitfisTabWrapper({ companyId }) {
  const panel = useSitfis({ api: sitfisApi, companyId });
  return <SitfisTab sitfisPanel={panel} />;
}

export function CompanyDetailPage({ company, guidesPanel, editPanel, accountingPanel, circularPanel, notasPanel, certPanel, feedback, dangerActions }) {
  const { selectedCompany, canEditCompany, companyDetailTab, setCompanyDetailTab, onBack } = company;
  const companyId = selectedCompany?.companyId;
  // ⚠ O regime mora em `legacyCompany` (é do cadastro legado) e NUNCA no topo do payload — o
  // `buildFirmCompanyPayload` só o inclui dentro de `legacyCompany`. Ler do topo devolvia
  // `undefined` sempre, e três telas dependiam disso em silêncio: "+ Parcelamento Simples" nunca
  // aparecia, e o filtro por regime da Circular e do "+ Subir Guia" recebia undefined.
  const companyRegime =
    selectedCompany?.legacyCompany?.regimeTributario
    || selectedCompany?.legacyCompany?.tipoTributario
    || selectedCompany?.regimeTributario
    || selectedCompany?.tipoTributario
    || null;
  // Q11.1: state do modal de exclusão (zona de risco)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // R4 — "＋ Criar novo…" no modal de anexo de guia: leva à aba Parcelamentos E abre o wizard.
  // Sem esta intenção, o clique só trocava de aba e o contador tinha de achar o botão de novo —
  // que é onde a intenção se perde. A criação continua tendo UMA porta só (o wizard).
  const [abrirWizardParcelamento, setAbrirWizardParcelamento] = useState(false);

  function switchTab(tab) {
    setCompanyDetailTab(tab);
    if (tab === "lancamentos") { accountingPanel.onLoadAccounts(); accountingPanel.onLoadEntries(); }
    if (tab === "circular") { accountingPanel.onLoadAccounts(); circularPanel.onLoadCircular(); }
    if (tab === "planoContas") { accountingPanel.onLoadAccounts(); }
    // Guias precisa do plano de contas: o modal de ingestão de parcelamento sugere as contas D/C.
    if (tab === "guides") { accountingPanel.onLoadAccounts(); }
    // Parcelamento: o modal de config de contas usa o plano de contas.
    if (tab === "parcelamento") { accountingPanel.onLoadAccounts(); }
    if (tab === "notasFiscais") { notasPanel?.reload?.(); }
  }

  // ─── Aba Lançamentos: layout full-screen com barra de topo compacta ────────

  if (companyDetailTab === "lancamentos") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="lancamentos"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        {/* Conteúdo full-width — sem restrição de max-width */}
        <div style={{ flex: 1 }}>
          <Suspense fallback={<TabLoadingFallback />}>
          <AccountingEntriesTab
            companyId={companyId}
            entries={accountingPanel.entries}
            total={accountingPanel.total}
            loading={accountingPanel.loading}
            filters={accountingPanel.filters}
            onFilterChange={accountingPanel.onFilterChange}
            onLoad={accountingPanel.onLoadEntries}
            onSyncSerproPgdas={accountingPanel.onSyncSerproPgdas}
            onCaptureSerproLp={accountingPanel.onCaptureSerproLp}
            onCreateEntry={accountingPanel.onCreateEntry}
            onCreateFolha={accountingPanel.onCreateFolha}
            onLoadPayrollTemplate={accountingPanel.onLoadPayrollTemplate}
            onUpdateEntry={accountingPanel.onUpdateEntry}
            onDeleteEntry={accountingPanel.onDeleteEntry}
            onBulkDeleteEntries={accountingPanel.onBulkDeleteEntries}
            onPreviewOFX={accountingPanel.onPreviewOFX}
            onImportOFX={accountingPanel.onImportOFX}
            onPreviewExcel={accountingPanel.onPreviewExcel}
            onImportExcel={accountingPanel.onImportExcel}
            companyRegime={companyRegime}
            accountingFunctions={accountingPanel.accountingFunctions}
            savingEntry={accountingPanel.savingEntry}
            accounts={accountingPanel.accounts}
            onLoadAccounts={accountingPanel.onLoadAccounts}
            onCreateAccount={accountingPanel.onCreateAccount}
            onUpdateAccount={accountingPanel.onUpdateAccount}
            onDeleteAccount={accountingPanel.onDeleteAccount}
            onImportAccountsFile={accountingPanel.onImportAccountsFile}
            onOpenChartOfAccountsTab={() => switchTab("planoContas")}
            onExportCsv={accountingPanel.onExportCsv}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
            onLoadBaixaTemplate={accountingPanel.onLoadBaixaTemplate}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
            onLoadAllHistoricos={accountingPanel.onLoadAllHistoricos}
            onUpdateHistorico={accountingPanel.onUpdateHistorico}
            onDeleteHistorico={accountingPanel.onDeleteHistorico}
            message={accountingPanel.message}
            error={accountingPanel.error}
          />
          </Suspense>
        </div>
      </div>
    );
  }

  if (companyDetailTab === "guides") {
      return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="guides"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        <AppShell className="guides-page-shell">
          <Suspense fallback={<TabLoadingFallback />}>
          <CompanyGuidesTable
            companyId={companyId}
            competencia={circularPanel?.competencia}
            companyRegime={companyRegime}
            guides={guidesPanel.guides}
            loadingGuides={guidesPanel.loading}
            onResendGuide={guidesPanel.onResendGuide}
            onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment}
            onDeleteGuide={guidesPanel.onDeleteGuide}
            onRecalculateGuide={guidesPanel.onRecalculateGuide}
            onRecalcularInss={guidesPanel.onRecalcularInss}
            recalcInssBusy={guidesPanel.recalcInssBusy}
            onLiberarGuia={guidesPanel.onLiberarGuia}
            liberarGuiasBusy={guidesPanel.liberarGuiasBusy}
            resendingGuideId={guidesPanel.resendingGuideId}
            confirmingGuideId={guidesPanel.confirmingGuideId}
            recalculatingGuideId={guidesPanel.recalculatingGuideId}
            onUploadGuide={guidesPanel.onUploadGuide}
            uploadingGuide={guidesPanel.uploadingGuide}
            onIdentifyGuide={guidesPanel.onIdentifyGuide}
            onFetchGuidePdf={guidesPanel.onFetchGuidePdf}
            parcelamentos={accountingPanel.parcelamentos}
            /* "＋ Criar novo…" no modal de anexo leva ao WIZARD, que vive na aba Parcelamentos —
               uma porta de criação só, em vez de um segundo formulário aqui. */
            onCriarParcelamento={() => { setAbrirWizardParcelamento(true); switchTab("parcelamento"); }}
            accounts={accountingPanel.accounts}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
          />
          </Suspense>

          <Feedback message={feedback.message} error={feedback.error} />
        </AppShell>
      </div>
    );
  }

  if (companyDetailTab === "planoContas") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="planoContas"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <Suspense fallback={<TabLoadingFallback />}>
          <ChartOfAccountsPage
            accounts={accountingPanel.accounts || []}
            onCreateAccount={accountingPanel.onCreateAccount}
            onUpdateAccount={accountingPanel.onUpdateAccount}
            onDeleteAccount={accountingPanel.onDeleteAccount}
            onImportFile={accountingPanel.onImportAccountsFile}
            onBack={() => switchTab("lancamentos")}
          />
          </Suspense>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  // Ficha de cadastro (read-only) — a tela de consulta. Editar leva à aba `edit`.
  if (companyDetailTab === "cadastro") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="cadastro"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <CompanyFichaTab
            selectedCompany={selectedCompany}
            canEditCompany={canEditCompany}
            onEdit={() => switchTab("edit")}
          />
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  if (companyDetailTab === "documentos" || companyDetailTab === "anotacoes") {
    const ehDocumentos = companyDetailTab === "documentos";
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab={companyDetailTab}
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<div style={{ padding: 24, color: "#8A8FA3" }}>Carregando…</div>}>
              {ehDocumentos
                ? <CompanyDocumentsTabWrapper companyId={companyId} feedback={feedback} />
                : <CompanyNotesTabWrapper companyId={companyId} feedback={feedback} />}
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  // Cofre de senhas + "outras informações". Mesmo molde de Documentos/Anotações: ErrorBoundary por
  // fora do Suspense, e nenhuma competência (a aba não filtra por mês).
  if (companyDetailTab === "credenciais") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="credenciais"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<div style={{ padding: 24, color: "#8A8FA3" }}>Carregando…</div>}>
              <CompanyCredentialsTabWrapper companyId={companyId} feedback={feedback} />
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  if (companyDetailTab === "edit") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="edit"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        <AppShell className="company-form-page-shell">
          <section className="company-form-page__panel">
            <div className="company-form-page__intro">
              <h1 className="company-form-page__title">Editar cadastro</h1>
              <p className="company-form-page__description">
                Atualize os dados cadastrais da empresa no mesmo padrão visual das demais telas.
              </p>
            </div>

            {!canEditCompany ? (
              <p className="text-muted">Apenas admin ou contador pode alterar os dados.</p>
            ) : (
              <Suspense fallback={<TabLoadingFallback />}>
              <CompanyForm
                form={editPanel.form}
                onChange={editPanel.onChange}
                onSubmit={editPanel.onSubmit}
                submitting={editPanel.submitting}
                submitLabel="Salvar alterações"
                showOwnerPassword={false}
                cnpjReadOnly
                // Q11.1: zona de risco
                status={selectedCompany?.status}
                dangerSaving={dangerActions?.saving}
                onSuspend={dangerActions?.onSuspend}
                onResume={dangerActions?.onResume}
                onDelete={dangerActions?.onDelete ? () => setShowDeleteModal(true) : null}
              />
              </Suspense>
            )}

            {/* Q12.B+++: cert A1 da empresa, abaixo do form e acima do feedback */}
            {canEditCompany && certPanel?.api && (
              <Suspense fallback={<TabLoadingFallback />}>
                <CompanyCertificatePanel
                  api={certPanel.api}
                  companyId={selectedCompany?.companyId}
                  feedback={certPanel.feedback}
                />
              </Suspense>
            )}

            <Feedback message={feedback.message} error={feedback.error} />
          </section>
        </AppShell>

        {/* Q11.1: modal de confirmação de exclusão por CNPJ */}
        {showDeleteModal && dangerActions?.onDelete && (
          <DeleteCompanyModal
            company={selectedCompany}
            saving={dangerActions.saving}
            onConfirm={async ({ confirmCnpj }) => {
              await dangerActions.onDelete({ confirmCnpj });
              setShowDeleteModal(false);
              // hook handler já navega de volta pra /companies
            }}
            onClose={() => setShowDeleteModal(false)}
          />
        )}
      </div>
    );
  }

  // ─── Aba Notas Fiscais (Q12.A): layout full-screen ───────────────────────────

  if (companyDetailTab === "notasFiscais") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="notasFiscais"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <NotasFiscaisTab
                notasPanel={notasPanel}
                hasInscricaoEstadual={Boolean(String(selectedCompany?.legacyCompany?.inscricaoEstadual || "").trim())}
                competencia={circularPanel?.competencia}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // Grupo Fiscal — sub-abas Cadastro Fiscal / Sugestão / Pendências (mesmo hook via wrapper único).
  // Fiscal → Cadastro. Sugestão e Pendências são sub-abas INTERNAS deste painel (estado local).
  if (companyDetailTab === "cadastroFiscal") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="cadastroFiscal"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1, padding: 24 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <ApuracaoV2TabWrapper
                companyId={companyId} feedback={feedback} razao={selectedCompany?.razao}
                competencia={circularPanel?.competencia}
                onCompetenciaChange={circularPanel?.onCompetenciaChange}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // Q41: Aba Situação Fiscal (SITFIS) — autônoma (hook próprio via wrapper)
  if (companyDetailTab === "sitfis") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="sitfis"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <SitfisTabWrapper companyId={companyId} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // ─── Aba Circular: layout full-screen ────────────────────────────────────────

  if (companyDetailTab === "circular") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="circular"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        <div style={{ flex: 1 }}>
          <ErrorBoundary>
          <Suspense fallback={<TabLoadingFallback />}>
          <CircularTab
            companyId={companyId}
            companyRegime={companyRegime}
            /* Só para o cabeçalho da IMPRESSÃO: a folha sai sem o header do app, e uma tabela de
               12 meses sem o nome da empresa serve para qualquer uma. */
            companyName={selectedCompany?.razao}
            circularData={circularPanel.circularData}
            loading={circularPanel.loading}
            year={circularPanel.year}
            competencia={circularPanel.competencia}
            onCompetenciaChange={circularPanel.onCompetenciaChange}
            onYearChange={circularPanel.onYearChange}
            onLoad={circularPanel.onLoadCircular}
            accounts={accountingPanel.accounts}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
            onLoadBaixaTemplate={accountingPanel.onLoadBaixaTemplate}
            error={circularPanel.error}
            message={circularPanel.message}
            onUpdateEntry={accountingPanel.onUpdateEntry}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
            onPreviewEstorno={circularPanel.onPreviewEstorno}
            onEstornarBaixa={circularPanel.onEstornarBaixa}
            parcelamentos={accountingPanel.parcelamentos}
            onSaveCircular={circularPanel.onSaveCircular}
            savingCircular={circularPanel.savingCircular}
          />
          </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // ─── Aba Parcelamento (grupo Contabilidade) ──────────────────────────────────
  if (companyDetailTab === "parcelamento") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="parcelamento"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <ParcelamentoTab
                companyId={companyId}
                parcelamentos={accountingPanel.parcelamentos}
                accounts={accountingPanel.accounts}
                onSearchHistoricos={accountingPanel.onSearchHistoricos}
                onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
                /* A guia é anexada na aba Guias (+ Subir Guia → PARCELAMENTO). O card leva até lá
                   em vez de mostrar um item desabilitado sem saída. */
                onIrParaGuias={() => switchTab("guides")}
                abrirWizardAoMontar={abrirWizardParcelamento}
                onWizardAberto={() => setAbrirWizardParcelamento(false)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  // ─── Aba Obrigações (grupo Contabilidade) ───────────────────────────────────
  // É o MESMO calendário do dashboard, travado nesta empresa (`companyIdFixo`) — não uma segunda
  // tela que precisaria ser mantida em paralelo. Sem `onOpenCompany`: já se está dentro dela.
  if (companyDetailTab === "obrigacoes") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="obrigacoes"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              {/* Sem companyId ainda, o calendário buscaria a carteira INTEIRA dentro da página de
                  uma empresa — espera a empresa carregar antes de montar. */}
              {companyId ? <ObrigacoesDaEmpresa companyId={companyId} companyRegime={companyRegime} /> : <TabLoadingFallback />}
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  if (companyDetailTab === "relatorios") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="relatorios"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              {companyId ? (
                <RelatoriosTab
                  companyId={companyId}
                  /* ⚠ A competência global é a ÂNCORA do intervalo, não o intervalo em si: os
                     períodos oferecidos (mês, trimestre, ano, 12 meses) terminam nela. Por isso
                     esta aba NÃO está em `TABS_COM_COMPETENCIA` — o seletor do header não aparece
                     aqui, e quem manda no período são os chips da própria tela. */
                  competenciaReferencia={circularPanel?.competencia}
                  razaoSocial={selectedCompany?.razao}
                />
              ) : <TabLoadingFallback />}
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  // ─── Demais abas: layout padrão ────────────────────────────────────────────

  return (
    <AppShell>
      <PageHeader
          title={selectedCompany?.razao || "Empresa"}
          description="Dados cadastrais, guias e lançamentos contábeis."
          actions={<BackButton onClick={onBack} />}
      />

      {selectedCompany && (
        <section className="panel">
          <div className="company-card">
            <p><span className="text-muted">CNPJ:</span> {selectedCompany.cnpj}</p>
            <p><span className="text-muted">E-mail do responsável:</span> {selectedCompany.ownerEmail || selectedCompany.email || "—"}</p>
            <p><span className="text-muted">E-mail das guias:</span> {selectedCompany.guideNotificationEmail || "—"}</p>
            <p><span className="text-muted">Pró-labore:</span> {selectedCompany.hasProlabore ? "Sim" : "Não"}</p>
            <p><span className="text-muted">Folha de pagamento:</span> {selectedCompany.temFolha ? "Sim" : "Não"}</p>
            <p><span className="text-muted">Município / UF:</span> {selectedCompany.municipio || "—"} / {selectedCompany.uf || "—"}</p>
          </div>
          <div className="toolbar">
            <Button variant="secondary" type="button"
              onClick={() => switchTab("guides")}
              disabled={companyDetailTab === "guides"}>
              Guias
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("lancamentos")}>
              Lançamentos
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("circular")}>
              Circular
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("cadastro")}
              disabled={companyDetailTab === "cadastro"}>
              Cadastro
            </Button>
          </div>
        </section>
      )}

      {companyDetailTab === "guides" && (
          <Suspense fallback={<TabLoadingFallback />}>
          <CompanyGuidesTable guides={guidesPanel.guides} loadingGuides={guidesPanel.loading} onRefresh={guidesPanel.onRefresh} onResendGuide={guidesPanel.onResendGuide} onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment} onRecalculateGuide={guidesPanel.onRecalculateGuide} onRecalcularInss={guidesPanel.onRecalcularInss} recalcInssBusy={guidesPanel.recalcInssBusy} onLiberarGuia={guidesPanel.onLiberarGuia} liberarGuiasBusy={guidesPanel.liberarGuiasBusy} resendingGuideId={guidesPanel.resendingGuideId} confirmingGuideId={guidesPanel.confirmingGuideId} recalculatingGuideId={guidesPanel.recalculatingGuideId} />
          </Suspense>
        )}

      <Feedback message={feedback.message} error={feedback.error} />
    </AppShell>
  );
}
