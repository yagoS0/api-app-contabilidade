// ⚠⚠ ÓRFÃO — NENHUM ARQUIVO DESTE APP IMPORTA `FirmSettingsHubPage`. Medido em 24/08/2026 por
// varredura do nome exportado em todo o `src`, testes inclusive: **zero consumidores**.
// Último commit que o tocou: d3d4dcc2 (02/07/2026).
//
// O hub de configurações do escritório. As configurações que ele reunia hoje têm porta própria no dashboard (o dropdown "Configurações"), então ele não perdeu a rota por engano: ele foi CONTORNADO.
//
// ⚠⚠ **ELE NÃO FOI APAGADO, E ISSO É DELIBERADO.** A decisão está escrita neste projeto, a
// propósito do `DefisNaoDevida.jsx`, que ficou no mesmo estado quando o dono mandou tirar a legenda
// da DEFIS: *"não foi apagado — apagar componente é decisão à parte"*. Apagar é irreversível na
// leitura de quem vier depois (some da árvore, some da busca), e "ninguém importa" não é o mesmo que
// "ninguém quer": pode ser tela adiada, pode ser desenho recusado.
//
// ⚠ O que ESTE aviso resolve é o silêncio. Sem ele o arquivo parece vivo — aparece na busca, entra
// nas varreduras, e alguém o "conserta" achando que está consertando uma tela.
//
// **Para o dono:** apagar ou reconectar é decisão sua. Os cinco órfãos estão listados juntos em
// `apps/web/CLAUDE.md`, seção "OS CINCO ÓRFÃOS".

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
