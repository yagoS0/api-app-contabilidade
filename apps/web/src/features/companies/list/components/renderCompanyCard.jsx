import { Button } from "../../../../components/ui/Button";

// Tributos potencialmente exibidos no card de compliance.
// A ordem aqui define a ordem visual das tags (DAS primeiro para Simples; depois Presumidos; PARC_DAS no fim).
const COMPLIANCE_CANDIDATES = [
  { key: "das",       label: "DAS" },
  { key: "irpj",      label: "IRPJ" },
  { key: "csll",      label: "CSLL" },
  { key: "pisCofins", label: "PIS/COFINS" },
  { key: "iss",       label: "ISS" },
  { key: "inss",      label: "INSS" },
  // PARC_DAS — só aparece quando há parcelamento ativo. tone diferenciado (laranja) no render.
  { key: "parcDas",   label: "PARC DAS", accent: true },
];

export function getComplianceTags(guideCompliance) {
  if (!guideCompliance || typeof guideCompliance !== "object") return [];

  // Novo formato: cada tributo é um nó { required, ok }.
  // Itera todos os candidatos e inclui só os marcados como required pelo backend
  // (que decide com base no regime tributário + pró-labore).
  const tags = [];
  for (const { key, label, accent } of COMPLIANCE_CANDIDATES) {
    const node = guideCompliance[key];
    if (node?.required) {
      tags.push({ label, ok: Boolean(node.ok), accent: Boolean(accent) });
    }
  }
  if (tags.length > 0) return tags;

  // Fallback legado (formato antigo com `expected`).
  if (!guideCompliance?.expected) return [];
  return [
    {
      label: guideCompliance.expected === "SIMPLES" ? "DAS" : "INSS",
      ok: Boolean(guideCompliance.ok),
    },
  ];
}

export function CompanyCard({ company, onAccess }) {
  const tags = getComplianceTags(company.guideCompliance);
  const serproEligible = Boolean(company?.serproStatus?.eligible);

  return (
    <article className="company-tile">
      <div className="company-tile__body">
        <h3>{company.razao}</h3>
        <p>{company.cnpj}</p>
      </div>
      <p className="company-serpro-status" aria-label="Status da integração SERPRO">
        <span
          className={serproEligible ? "company-serpro-status__badge company-serpro-status__badge--ok" : "company-serpro-status__badge company-serpro-status__badge--off"}
          title={serproEligible ? "Empresa apta ao fluxo SERPRO" : "Empresa não apta ao fluxo SERPRO"}
        >
          SERPRO
        </span>
        {/* Q16: selo de e-mail do mês enviado */}
        <span
          style={{
            marginLeft: 8, fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            border: `1px solid ${company.monthEmailSent ? "#69FF47" : "#FFB347"}`,
            color: company.monthEmailSent ? "#69FF47" : "#FFB347",
            background: company.monthEmailSent ? "rgba(105,255,71,0.12)" : "rgba(255,179,71,0.12)",
          }}
          title={
            company.monthEmailSent
              ? `E-mail do mês (${company.monthEmailCompetencia || ""}) enviado`
              : `E-mail do mês (${company.monthEmailCompetencia || ""}) ainda não enviado`
          }
        >
          {company.monthEmailSent ? "✅ E-mail do mês" : "⏳ E-mail do mês"}
        </span>
      </p>
      <p className="compliance-tags" aria-label="Status de guias obrigatórias">
        {tags.map((tag) => {
          // Tag accent (PARC_DAS): cor laranja para destacar parcelamento ativo.
          const className = tag.accent
            ? "compliance-tag compliance-tag--accent"
            : tag.ok
              ? "compliance-tag compliance-tag--ok"
              : "compliance-tag compliance-tag--miss";
          const title = tag.accent
            ? `${tag.label} — parcelamento ativo`
            : tag.ok
              ? `${tag.label} em dia`
              : `${tag.label} pendente`;
          return (
            <span key={tag.label} className={className} title={title}>
              {tag.label}
            </span>
          );
        })}
        {!tags.length ? <span className="compliance-tag compliance-tag--neutral">Sem obrigacoes</span> : null}
      </p>
      <Button type="button" className="company-tile__action" onClick={() => onAccess(company.companyId)}>
        Acessar
      </Button>
    </article>
  );
}
