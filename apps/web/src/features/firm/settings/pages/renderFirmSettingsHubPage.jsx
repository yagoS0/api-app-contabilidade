import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
};

const SETTING_CARDS = [
  {
    key: "guides",
    title: "Configuração de Guias",
    description: "Status do leitor de PDF e integrações de e-mail das guias.",
    accent: "#FFB347",
  },
  {
    key: "accountingRules",
    title: "Padrões de Lançamento",
    description: "Defina contas e históricos padrão para receitas, provisões e baixas usadas em todas as empresas.",
    accent: "#69FF47",
  },
  {
    key: "chartOfAccounts",
    title: "Plano de Contas Global",
    description: "Mantenha o plano de contas compartilhado entre todas as empresas. Cada empresa pode adicionar contas próprias.",
    accent: "#8BE9FD",
  },
];

export function FirmSettingsHubPage({ onBack, onOpen }) {
  return (
    <PageShell
      title="Configurações da Firma"
      subtitle="Configurações compartilhadas por todas as empresas."
      onBack={onBack}
    >
      <AppShell>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          marginTop: 16,
        }}
      >
        {SETTING_CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onOpen(card.key)}
            style={{
              textAlign: "left",
              background: PANEL.surface,
              border: `1px solid ${PANEL.border}`,
              borderLeft: `4px solid ${card.accent}`,
              borderRadius: 12,
              padding: 20,
              cursor: "pointer",
              color: PANEL.text,
              transition: "transform 0.12s ease, box-shadow 0.12s ease",
              fontFamily: "inherit",
              fontSize: "0.95rem",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.32)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: "1.05rem", fontWeight: 700, color: card.accent }}>
              {card.title}
            </h3>
            <p style={{ margin: 0, fontSize: "0.875rem", color: PANEL.muted, lineHeight: 1.45 }}>
              {card.description}
            </p>
            <p style={{ margin: "12px 0 0", fontSize: "0.8125rem", color: PANEL.accent, fontWeight: 600 }}>
              Abrir →
            </p>
          </button>
        ))}
      </section>
      </AppShell>
    </PageShell>
  );
}
