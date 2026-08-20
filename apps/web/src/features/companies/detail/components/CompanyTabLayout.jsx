// A MOLDURA DE TODA ABA DA EMPRESA — uma só.
//
// ⚠ O QUE ISTO CONSERTA. O bloco abaixo estava escrito à mão **16 vezes** em
// `renderCompanyDetailPage.jsx`, e as cópias já tinham divergido:
//
//   <div style={{ minHeight: "100vh", background: "#1A1B26", … }}>   ← hex literal, 16×
//     <CompanySectionHeader … />                                     ← 8 props repetidas, 16×
//     <div style={{ flex: 1 }}>{conteúdo}</div>
//     <Feedback … />                                                 ← em algumas, não em todas
//
// E o pior não era a repetição: era a **largura**, que cada aba decidia por dentro. Medido antes
// desta mudança — `maxWidth:1100` na ficha, `900` em Senhas e em Anotações, `1400` no SITFIS e
// `var(--content-wide)` em Documentos e Apuração. Trocar de sub-aba dentro do MESMO grupo
// ("Empresa": Cadastro → Documentos → Senhas) fazia o conteúdo saltar de largura três vezes, e
// nenhuma das três tinha razão registrada em lugar nenhum — eram números que foram ficando.
//
// ⚠ SÃO DUAS LARGURAS, E SÓ DUAS, e elas já existiam em `styles/tokens.css` com o porquê escrito:
//   - `leitura`  (`--content-max`)  — ficha, formulário, cofre, auditoria. Onde se LÊ texto e se
//     preenche campo; linha longa demais cansa (o olho perde a volta para a próxima).
//   - `trabalho` (`--content-wide`) — tabelas e listas de registro. Coluna a mais visível é uma
//     rolagem horizontal a menos.
//   - `cheia` — sem contêiner. Só para quem já é uma tela inteira por dentro (Lançamentos,
//     Circular), onde um `max-width` por fora espremeria a matriz.
// Largura nova NÃO entra aqui: entra em `tokens.css`, ou não entra.
//
// ⚠ Isto mora em `features/companies/detail/`, não em `components/layout/`, de propósito: ele
// conhece o `CompanySectionHeader`. Um componente de `components/` importando de `features/`
// inverte a direção das dependências do projeto.
import { Suspense } from "react";
import { CompanySectionHeader } from "./renderCompanyDetailHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { ErrorBoundary } from "../../../../components/ui/ErrorBoundary";

export const LARGURAS = Object.freeze(["leitura", "trabalho", "cheia"]);

const ESTILO_POR_LARGURA = {
  leitura: {
    width: "100%",
    maxWidth: "var(--content-max)",
    margin: "0 auto",
    padding: "var(--space-5) var(--space-4)",
  },
  trabalho: {
    width: "var(--content-wide)",
    margin: "0 auto",
    padding: "var(--space-5) 0",
  },
  cheia: null,
};

/**
 * ⚠ Largura desconhecida cai em `cheia`, NUNCA numa das duas contidas. Cair em "leitura" por
 * engano espremeria uma tabela de 12 colunas em 1200px e ninguém saberia por quê; sem contêiner,
 * o defeito é a tela ficar larga demais — visível e barato.
 */
function estiloDoConteudo(largura) {
  return ESTILO_POR_LARGURA[largura] !== undefined ? ESTILO_POR_LARGURA[largura] : null;
}

export function CompanyTabLoading() {
  return (
    <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-muted)" }}>
      Carregando…
    </div>
  );
}

export function CompanyTabLayout({
  company,
  activeTab,
  onBack,
  onTabChange,
  canEditCompany = false,
  competencia,
  onCompetenciaChange,
  largura = "cheia",
  /** Passe o objeto INTEIRO do `useManageAppFeedback` — ver `apps/web/CLAUDE.md`. */
  feedback = null,
  /** `lazy` + render que pode quebrar: envolve em ErrorBoundary + Suspense aqui, não na aba. */
  suspense = false,
  children,
}) {
  const estilo = estiloDoConteudo(largura);
  const conteudo = suspense ? (
    <ErrorBoundary>
      <Suspense fallback={<CompanyTabLoading />}>{children}</Suspense>
    </ErrorBoundary>
  ) : (
    children
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
      <CompanySectionHeader
        company={company}
        activeTab={activeTab}
        onBack={onBack}
        onTabChange={onTabChange}
        canEditCompany={canEditCompany}
        competencia={competencia}
        onCompetenciaChange={onCompetenciaChange}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        {estilo ? <div style={estilo}>{conteudo}</div> : conteudo}
      </div>

      {feedback ? <Feedback message={feedback.message} error={feedback.error} /> : null}
    </div>
  );
}

export default CompanyTabLayout;
