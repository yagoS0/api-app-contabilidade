// Navegação da empresa em 2 níveis: 3 grupos grandes (Contabilidade, Fiscal, Editar cadastro)
// e, abaixo, as sub-abas do grupo ativo. A aba ativa continua vindo do segmento da URL (activeTab);
// clicar num grupo navega pro seu 1º sub-tab. Nada de roteamento novo — só reagrupa o header.
const GROUPS = [
  {
    key: "contabilidade",
    label: "Contabilidade",
    // Plano de Contas NÃO é sub-aba: abre por dentro de Lançamentos (menu Configurações).
    // A rota /plano-contas segue válida — só não tem botão próprio aqui.
    tabs: [
      { key: "lancamentos", label: "Lançamentos" },
      { key: "circular", label: "Circular" },
    ],
  },
  {
    key: "fiscal",
    label: "Fiscal",
    tabs: [
      { key: "cadastroFiscal", label: "Cadastro" },
      { key: "sugestao", label: "Sugestão" },
      { key: "pendencias", label: "Pendências" },
      { key: "sitfis", label: "Situação Fiscal" },
      { key: "notasFiscais", label: "Notas Fiscais" },
      { key: "guides", label: "Guias" },
    ],
  },
  {
    key: "editar",
    label: "Editar cadastro",
    requiresEdit: true,
    tabs: [{ key: "edit", label: "Editar cadastro" }],
  },
];

const GROUP_BTN_STYLE = { fontSize: "1rem", fontWeight: 700, padding: "12px 26px" };

export function CompanySectionHeader({ company, activeTab, onBack, onTabChange, canEditCompany = false }) {
  const activeGroup = GROUPS.find((g) => g.tabs.some((t) => t.key === activeTab)) || GROUPS[0];
  const subTabs = activeGroup.tabs;

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

      {/* Nível 1 — os 3 grupos grandes */}
      <nav className="company-section-header__nav" aria-label="Grupos da empresa">
        {GROUPS.map((group) => {
          const isActive = group.key === activeGroup.key;
          const isDisabled = group.requiresEdit && !canEditCompany;
          return (
            <button
              key={group.key}
              type="button"
              style={GROUP_BTN_STYLE}
              className={`company-section-header__tab${isActive ? " is-active" : ""}`}
              onClick={isDisabled ? undefined : () => onTabChange(group.tabs[0].key)}
              disabled={isDisabled}
              aria-current={isActive ? "page" : undefined}
              title={isDisabled ? "Apenas admin ou contador pode editar." : undefined}
            >
              {group.label}
            </button>
          );
        })}
      </nav>

      {/* Nível 2 — sub-abas do grupo ativo (oculto quando o grupo tem só 1, ex.: Editar cadastro) */}
      {subTabs.length > 1 && (
        <nav className="company-section-header__nav" aria-label={`Seções de ${activeGroup.label}`}>
          {subTabs.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                className={`company-section-header__tab${isActive ? " is-active" : ""}`}
                onClick={isActive ? undefined : () => onTabChange(tab.key)}
                aria-current={isActive ? "page" : undefined}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
