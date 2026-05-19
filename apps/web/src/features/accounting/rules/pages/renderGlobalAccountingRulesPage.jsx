import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { AccountingRulesContainer } from "../components/renderAccountingRulesContainer";

export function GlobalAccountingRulesPage({ api, onBack }) {
  return (
    <PageShell
      title="Padrões Globais de Lançamentos"
      subtitle="Contas e históricos padrão usados por todas as empresas. Cada empresa pode sobrescrever na sua aba Configurações."
      onBack={onBack}
    >
      <AppShell>
        <AccountingRulesContainer api={api} scope="GLOBAL" />
      </AppShell>
    </PageShell>
  );
}
