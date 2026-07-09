import { lazy, Suspense, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { DeleteCompanyModal } from "../components/DeleteCompanyModal";
import { CompanySectionHeader } from "../components/renderCompanyDetailHeader";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { ErrorBoundary } from "../../../../components/ui/ErrorBoundary";
// Q14.2: hook próprio da Apuração v2 (escopo da empresa atual)
import { useApuracaoV2 } from "../../../apuracao-v2/hooks/useApuracaoV2";
// Q41: hook próprio da aba Situação Fiscal (SITFIS)
import { useSitfis } from "../../../fiscal/sitfis/hooks/useSitfis";
import { createApiClient } from "../../../../api/client";

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
const AccountingRulesContainer = lazy(() =>
  import("../../../accounting/rules/components/renderAccountingRulesContainer").then((m) => ({ default: m.AccountingRulesContainer }))
);
const ChartOfAccountsPage = lazy(() =>
  import("../../../accounting/chart-of-accounts/pages/renderChartOfAccountsPage").then((m) => ({ default: m.ChartOfAccountsPage }))
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

// Q14.2: wrapper que instancia hook próprio da Apuração v2 (state da empresa atual)
const apuracaoV2Api = createApiClient();
function ApuracaoV2TabWrapper({ companyId, feedback }) {
  const panel = useApuracaoV2({ api: apuracaoV2Api, companyId, feedback });
  return <ApuracaoV2Tab panel={panel} />;
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
  // Q11.1: state do modal de exclusão (zona de risco)
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  function switchTab(tab) {
    setCompanyDetailTab(tab);
    if (tab === "lancamentos") { accountingPanel.onLoadAccounts(); accountingPanel.onLoadEntries(); }
    if (tab === "circular") { accountingPanel.onLoadAccounts(); circularPanel.onLoadCircular(); }
    if (tab === "configuracoes") { accountingPanel.onLoadAccounts(); }
    if (tab === "planoContas") { accountingPanel.onLoadAccounts(); }
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
            onCreateParcelamento={accountingPanel.onCreateParcelamento}
            companyRegime={selectedCompany?.regimeTributario || selectedCompany?.tipoTributario}
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
        />

        <AppShell className="guides-page-shell">
          <Suspense fallback={<TabLoadingFallback />}>
          <CompanyGuidesTable
            companyId={companyId}
            companyRegime={selectedCompany?.regimeTributario || selectedCompany?.tipoTributario}
            guides={guidesPanel.guides}
            loadingGuides={guidesPanel.loading}
            onResendGuide={guidesPanel.onResendGuide}
            onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment}
            onDeleteGuide={guidesPanel.onDeleteGuide}
            onRecalculateGuide={guidesPanel.onRecalculateGuide}
            onRecalcularInss={guidesPanel.onRecalcularInss}
            recalcInssBusy={guidesPanel.recalcInssBusy}
            onLiberarGuias={guidesPanel.onLiberarGuias}
            onRevogarGuias={guidesPanel.onRevogarGuias}
            liberarGuiasBusy={guidesPanel.liberarGuiasBusy}
            resendingGuideId={guidesPanel.resendingGuideId}
            confirmingGuideId={guidesPanel.confirmingGuideId}
            recalculatingGuideId={guidesPanel.recalculatingGuideId}
            onUploadGuide={guidesPanel.onUploadGuide}
            uploadingGuide={guidesPanel.uploadingGuide}
            onIdentifyGuide={guidesPanel.onIdentifyGuide}
            onFetchGuidePdf={guidesPanel.onFetchGuidePdf}
            parcelamentos={accountingPanel.parcelamentos}
            accountingFunctions={accountingPanel.accountingFunctions}
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

  if (companyDetailTab === "configuracoes") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="configuracoes"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />
        <AppShell>
          <Suspense fallback={<TabLoadingFallback />}>
          <AccountingRulesContainer
            api={accountingPanel.api}
            scope="COMPANY"
            companyId={companyId}
            accounts={accountingPanel.accounts || []}
            onOpenChartOfAccounts={() => switchTab("planoContas")}
          />
          </Suspense>
          <Feedback message={feedback.message} error={feedback.error} />
        </AppShell>
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
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <NotasFiscaisTab notasPanel={notasPanel} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // Q14.2: Apuração v2 — autônoma (busca dados via hook próprio)
  if (companyDetailTab === "apuracaoV2") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="apuracaoV2"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />
        <div style={{ flex: 1, padding: 24 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <ApuracaoV2TabWrapper companyId={selectedCompany?.id} feedback={feedback} />
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
        />

        <div style={{ flex: 1 }}>
          <ErrorBoundary>
          <Suspense fallback={<TabLoadingFallback />}>
          <CircularTab
            companyRegime={selectedCompany?.regimeTributario || selectedCompany?.tipoTributario}
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
            onCancelBaixa={circularPanel.onCancelBaixa}
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

  // ─── Demais abas: layout padrão ────────────────────────────────────────────

  return (
    <AppShell>
      <PageHeader
          title={selectedCompany?.razao || "Empresa"}
          description="Dados cadastrais, guias e lançamentos contábeis."
          actions={<Button variant="secondary" onClick={onBack}>Voltar</Button>}
      />

      {selectedCompany && (
        <section className="panel">
          <div className="company-card">
            <p><span className="text-muted">CNPJ:</span> {selectedCompany.cnpj}</p>
            <p><span className="text-muted">E-mail do responsável:</span> {selectedCompany.ownerEmail || selectedCompany.email || "—"}</p>
            <p><span className="text-muted">E-mail das guias:</span> {selectedCompany.guideNotificationEmail || "—"}</p>
            <p><span className="text-muted">Pró-labore:</span> {selectedCompany.hasProlabore ? "Sim" : "Não"}</p>
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
              onClick={() => switchTab("edit")}
              disabled={!canEditCompany || companyDetailTab === "edit"}
              title={!canEditCompany ? "Apenas admin ou contador pode editar." : undefined}>
              Editar cadastro
            </Button>
          </div>
        </section>
      )}

      {companyDetailTab === "guides" && (
          <Suspense fallback={<TabLoadingFallback />}>
          <CompanyGuidesTable guides={guidesPanel.guides} loadingGuides={guidesPanel.loading} onRefresh={guidesPanel.onRefresh} onResendGuide={guidesPanel.onResendGuide} onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment} onRecalculateGuide={guidesPanel.onRecalculateGuide} onRecalcularInss={guidesPanel.onRecalcularInss} recalcInssBusy={guidesPanel.recalcInssBusy} onLiberarGuias={guidesPanel.onLiberarGuias} onRevogarGuias={guidesPanel.onRevogarGuias} liberarGuiasBusy={guidesPanel.liberarGuiasBusy} resendingGuideId={guidesPanel.resendingGuideId} confirmingGuideId={guidesPanel.confirmingGuideId} recalculatingGuideId={guidesPanel.recalculatingGuideId} />
          </Suspense>
        )}

      <Feedback message={feedback.message} error={feedback.error} />
    </AppShell>
  );
}
