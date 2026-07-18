// Navegação da empresa em 2 níveis: 3 grupos grandes (Contabilidade, Fiscal, Cadastro)
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
      { key: "parcelamento", label: "Parcelamento" },
    ],
  },
  {
    key: "fiscal",
    label: "Fiscal",
    // Cadastro absorve Sugestão e Pendências (viram sub-abas INTERNAS do painel Cadastro).
    tabs: [
      { key: "guides", label: "Guias" },
      { key: "cadastroFiscal", label: "Apuração" },
      { key: "sitfis", label: "Situação Fiscal" },
      { key: "notasFiscais", label: "Notas Fiscais" },
    ],
  },
  {
    // Abre a FICHA (read-only). Editar é um botão dentro dela, que leva à aba `edit`.
    key: "cadastro",
    label: "Cadastro",
    tabs: [{ key: "cadastro", label: "Cadastro" }],
  },
];


// Abas que não são sub-aba de ninguém, mas pertencem a um grupo (o grupo fica destacado).
// `edit` abre pela ficha (botão Editar) e `planoContas` por Lançamentos → Configurações.
const TAB_TO_GROUP = { edit: "cadastro", planoContas: "contabilidade" };

export function CompanySectionHeader({ company, activeTab, onBack, onTabChange, canEditCompany = false }) {
  const activeGroup =
    GROUPS.find((g) => g.tabs.some((t) => t.key === activeTab))
    || GROUPS.find((g) => g.key === TAB_TO_GROUP[activeTab])
    || GROUPS[0];
  const subTabs = activeGroup.tabs;

  return (
    <header className="company-section-header">
      {/* Voltar fica FORA da barra (pílula) — só a seta, mesmo padrão de design. */}
      <button type="button" className="company-section-header__back" onClick={onBack} aria-label="Voltar" title="Voltar">
        ←
      </button>

      {/* Barra em pílula: nome da empresa + os 3 grupos juntos. */}
      <div className="company-topbar">
        <div className="company-topbar__brand">
          <strong className="company-topbar__name">{company?.razao || "Empresa"}</strong>
          <span className="company-topbar__cnpj">{company?.cnpj || "CNPJ não informado"}</span>
        </div>
        <nav className="company-topbar__nav" aria-label="Grupos da empresa">
          {GROUPS.map((group) => {
            const isActive = group.key === activeGroup.key;
            const isDisabled = group.requiresEdit && !canEditCompany;
            return (
              <button
                key={group.key}
                type="button"
                className={`company-topbar__link${isActive ? " is-active" : ""}`}
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
      </div>

      {/* Nível 2 — sub-abas do grupo ativo, em formato de aba (Chrome). Oculto quando o grupo
          tem só 1 (ex.: Cadastro → abre direto a ficha). */}
      {subTabs.length > 1 && (
        <nav className="company-section-header__subtabs" aria-label={`Seções de ${activeGroup.label}`}>
          <div className="company-section-header__subtabs-pill">
            {subTabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`company-section-header__subtab${isActive ? " is-active" : ""}`}
                  onClick={isActive ? undefined : () => onTabChange(tab.key)}
                  aria-current={isActive ? "page" : undefined}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
