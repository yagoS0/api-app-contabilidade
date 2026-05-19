/**
 * PageShell — wrapper unificado para páginas full-screen do app.
 *
 * Padrão acordado:
 *  - Voltar SEMPRE à esquerda do header (mesma posição do CompanySectionHeader).
 *  - Título centralizado/à esquerda do header (subtitle opcional embaixo).
 *  - Ações (botões logout, salvar, etc.) à direita.
 *  - Conteúdo abaixo, dentro de um container que aceita className/style livres.
 *
 * Uso típico:
 *   <PageShell
 *     title="Configuração SERPRO"
 *     subtitle="Certificado, credenciais e agenda"
 *     onBack={() => session.setPage("firmSettings")}
 *     actions={<Button onClick={handleSave}>Salvar</Button>}
 *   >
 *     ... conteúdo ...
 *   </PageShell>
 *
 * Variantes:
 *  - `tabs` (opcional): array { key, label, disabled?, title? } para abas no header.
 *    Quando passado, exibe uma navegação à direita (igual CompanySectionHeader).
 *  - `headerExtra` (opcional): nó adicional após o subtítulo, dentro do bloco brand.
 *  - `contentClassName` / `contentStyle`: customização do container de conteúdo.
 */
export function PageShell({
  title,
  subtitle,
  onBack,
  backLabel = "Voltar",
  actions,
  tabs,
  activeTab,
  onTabChange,
  headerExtra,
  children,
  contentClassName,
  contentStyle,
}) {
  return (
    <div className="page-shell">
      <header className="page-shell__header">
        <div className="page-shell__brand">
          {onBack && (
            <button
              type="button"
              className="page-shell__back"
              onClick={onBack}
              aria-label={backLabel}
            >
              ← {backLabel}
            </button>
          )}

          {(title || subtitle) && (
            <div className="page-shell__title-block">
              {title && <strong className="page-shell__title">{title}</strong>}
              {subtitle && <span className="page-shell__subtitle">{subtitle}</span>}
              {headerExtra}
            </div>
          )}
        </div>

        {Array.isArray(tabs) && tabs.length > 0 && (
          <nav className="page-shell__tabs" aria-label="Navegação da página">
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`page-shell__tab${isActive ? " is-active" : ""}`}
                  onClick={isActive || tab.disabled ? undefined : () => onTabChange?.(tab.key)}
                  disabled={tab.disabled}
                  aria-current={isActive ? "page" : undefined}
                  title={tab.title}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        )}

        {actions && <div className="page-shell__actions">{actions}</div>}
      </header>

      <div className={`page-shell__content${contentClassName ? ` ${contentClassName}` : ""}`} style={contentStyle}>
        {children}
      </div>
    </div>
  );
}

export default PageShell;
