import { AppShell } from "../../../../components/layout/AppShell";
import { CompanySectionHeader } from "../components/renderCompanyDetailHeader";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { CompanyGuidesTable } from "../../../guides/list/components/renderCompanyGuidesTable";
import { CompanyForm } from "../../form/components/renderCompanyForm";
import { AccountingEntriesTab } from "../../../accounting/entries/components/renderAccountingEntriesTab";
import { CircularTab } from "../../../accounting/circular/components/renderCircularTab";

export function CompanyDetailPage({ company, guidesPanel, editPanel, accountingPanel, circularPanel, feedback }) {
  const { selectedCompany, canEditCompany, companyDetailTab, setCompanyDetailTab, onBack } = company;
  const companyId = selectedCompany?.companyId;

  function switchTab(tab) {
    setCompanyDetailTab(tab);
    if (tab === "lancamentos") { accountingPanel.onLoadAccounts(); accountingPanel.onLoadEntries(); }
    if (tab === "circular") { accountingPanel.onLoadAccounts(); circularPanel.onLoadCircular(); }
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
          <AccountingEntriesTab
            companyId={companyId}
            entries={accountingPanel.entries}
            total={accountingPanel.total}
            loading={accountingPanel.loading}
            filters={accountingPanel.filters}
            onFilterChange={accountingPanel.onFilterChange}
            onLoad={accountingPanel.onLoadEntries}
            onCreateEntry={accountingPanel.onCreateEntry}
            onUpdateEntry={accountingPanel.onUpdateEntry}
            onDeleteEntry={accountingPanel.onDeleteEntry}
            onPreviewOFX={accountingPanel.onPreviewOFX}
            onImportOFX={accountingPanel.onImportOFX}
            savingEntry={accountingPanel.savingEntry}
            accounts={accountingPanel.accounts}
            onLoadAccounts={accountingPanel.onLoadAccounts}
            onCreateAccount={accountingPanel.onCreateAccount}
            onUpdateAccount={accountingPanel.onUpdateAccount}
            onDeleteAccount={accountingPanel.onDeleteAccount}
            onImportAccountsFile={accountingPanel.onImportAccountsFile}
            onExportCsv={accountingPanel.onExportCsv}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
            onLoadAllHistoricos={accountingPanel.onLoadAllHistoricos}
            onUpdateHistorico={accountingPanel.onUpdateHistorico}
            onDeleteHistorico={accountingPanel.onDeleteHistorico}
            message={accountingPanel.message}
            error={accountingPanel.error}
          />
        </div>
      </div>
    );
  }

  // ─── Aba Circular: layout full-screen ────────────────────────────────────────

  if (companyDetailTab === "circular") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <div style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "white", borderBottom: "1px solid var(--border)",
          height: 46, display: "flex", alignItems: "center",
          padding: "0 16px", gap: 12, flexShrink: 0,
        }}>
          <Button variant="secondary" size="sm" onClick={onBack}>← Voltar</Button>

          <div style={{ width: 1, height: 24, background: "var(--border)" }} />

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontWeight: 700, fontSize: "0.9375rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {selectedCompany?.razao || "Empresa"}
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
              {selectedCompany?.cnpj}
            </span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
            <button onClick={() => switchTab("guides")} style={tabBtn(false)}>Guias</button>
            <button onClick={() => switchTab("lancamentos")} style={tabBtn(false)}>Lançamentos</button>
            <button style={tabBtn(true)}>Circular</button>
            {canEditCompany && (
              <button onClick={() => switchTab("edit")} style={tabBtn(false)}>Editar cadastro</button>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <CircularTab
            circularData={circularPanel.circularData}
            loading={circularPanel.loading}
            year={circularPanel.year}
            onYearChange={circularPanel.onYearChange}
            onLoad={circularPanel.onLoadCircular}
            accounts={accountingPanel.accounts}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
          />
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
          <CompanyGuidesTable guides={guidesPanel.guides} loadingGuides={guidesPanel.loading} onRefresh={guidesPanel.onRefresh} onResendGuide={guidesPanel.onResendGuide} resendingGuideId={guidesPanel.resendingGuideId} />
        )}

      {companyDetailTab === "edit" && (
        <section className="panel">
          <h2 className="panel__title">Editar cadastro</h2>
          {!canEditCompany ? (
            <p className="text-muted">Apenas admin ou contador pode alterar os dados.</p>
          ) : (
            <CompanyForm
              form={editPanel.form}
              onChange={editPanel.onChange}
              onSubmit={editPanel.onSubmit}
              submitting={editPanel.submitting}
              submitLabel="Salvar alterações"
              showOwnerPassword={false}
            />
          )}
        </section>
      )}

      <Feedback message={feedback.message} error={feedback.error} />
    </AppShell>
  );
}

// ─── Estilo dos botões de aba na barra compacta ────────────────────────────────

function tabBtn(active) {
  return {
    padding: "4px 12px",
    fontSize: "0.8125rem",
    fontWeight: active ? 700 : 500,
    border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
    borderRadius: 6,
    background: active ? "var(--primary)" : "white",
    color: active ? "white" : "var(--text)",
    cursor: active ? "default" : "pointer",
    whiteSpace: "nowrap",
  };
}
