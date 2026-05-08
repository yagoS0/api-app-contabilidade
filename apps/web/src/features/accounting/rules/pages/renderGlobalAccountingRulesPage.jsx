import { AppShell } from "../../../../components/layout/AppShell";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Button } from "../../../../components/ui/Button";
import { AccountingRulesContainer } from "../components/renderAccountingRulesContainer";

export function GlobalAccountingRulesPage({ api, onBack }) {
  return (
    <AppShell>
      <PageHeader
        title="Padrões Globais de Lançamentos"
        description="Defina contas e históricos padrão usados por todas as empresas. Cada empresa pode sobrescrever na sua aba Configurações."
        actions={<Button variant="secondary" onClick={onBack}>Voltar</Button>}
      />
      <AccountingRulesContainer api={api} scope="GLOBAL" />
    </AppShell>
  );
}
