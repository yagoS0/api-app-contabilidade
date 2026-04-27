import { Button } from "../../../../components/ui/Button";

export function getComplianceTags(guideCompliance) {
  if (!guideCompliance || typeof guideCompliance !== "object") return [];

  // Novo formato: dois status independentes.
  if (guideCompliance.inss || guideCompliance.das) {
    const tags = [];
    if (guideCompliance?.inss?.required) {
      tags.push({ label: "INSS", ok: Boolean(guideCompliance?.inss?.ok) });
    }
    if (guideCompliance?.das?.required) {
      tags.push({ label: "DAS", ok: Boolean(guideCompliance?.das?.ok) });
    }
    return tags;
  }

  // Compatibilidade com formato legado (um tipo esperado).
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
      </p>
      <p className="compliance-tags" aria-label="Status de guias obrigatórias">
        {tags.map((tag) => (
          <span
            key={tag.label}
            className={tag.ok ? "compliance-tag compliance-tag--ok" : "compliance-tag compliance-tag--miss"}
            title={tag.ok ? `${tag.label} em dia` : `${tag.label} pendente`}
          >
            {tag.label}
          </span>
        ))}
        {!tags.length ? <span className="compliance-tag compliance-tag--neutral">Sem obrigacoes</span> : null}
      </p>
      <Button type="button" className="company-tile__action" onClick={() => onAccess(company.companyId)}>
        Acessar
      </Button>
    </article>
  );
}
