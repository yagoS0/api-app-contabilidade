import { Button } from "../../../../components/ui/Button";

function tagsFromCompliance(guideCompliance) {
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
  const tags = tagsFromCompliance(company.guideCompliance);
  return (
    <article className="company-tile">
      <h3>{company.razao}</h3>
      <p>{company.cnpj}</p>
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
      </p>
      <Button type="button" onClick={() => onAccess(company.companyId)}>
        Acessar
      </Button>
    </article>
  );
}
