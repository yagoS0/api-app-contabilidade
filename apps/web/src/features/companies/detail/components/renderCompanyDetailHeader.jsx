const HEADER_TABS = [
  { key: "guides", label: "Guias" },
  { key: "lancamentos", label: "Lançamentos" },
  { key: "circular", label: "Circular" },
  { key: "edit", label: "Editar Cadastro" },
];

export function CompanySectionHeader({ company, activeTab, onBack, onTabChange, canEditCompany = false }) {
  return (
    <header className="company-section-header">
      <div className="company-section-header__brand">
        <button type="button" className="company-section-header__back" onClick={onBack}>
          Voltar
        </button>

        <div className="company-section-header__company">
          <strong className="company-section-header__company-name">{company?.razao || "Empresa"}</strong>
          <span className="company-section-header__company-meta">{company?.cnpj || "CNPJ nao informado"}</span>
        </div>
      </div>

      <nav className="company-section-header__nav" aria-label="Navegacao da empresa">
        {HEADER_TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          const isDisabled = tab.key === "edit" && !canEditCompany;

          return (
            <button
              key={tab.key}
              type="button"
              className={`company-section-header__tab${isActive ? " is-active" : ""}`}
              onClick={isActive || isDisabled ? undefined : () => onTabChange(tab.key)}
              disabled={isDisabled}
              aria-current={isActive ? "page" : undefined}
              title={isDisabled ? "Apenas admin ou contador pode editar." : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
