import { Button } from "../../../components/ui/Button";

/** Rótulo curto no cartão: INSS ou DAS (Simples Nacional). */
function complianceTag(guideCompliance) {
  if (!guideCompliance?.expected) return null;
  const label = guideCompliance.expected === "SIMPLES" ? "DAS" : "INSS";
  return { label, ok: Boolean(guideCompliance.ok) };
}

export function CompanyCard({ company, onAccess }) {
  const tag = complianceTag(company.guideCompliance);
  return (
    <article className="company-tile">
      <h3>{company.razao}</h3>
      <p>{company.cnpj}</p>
      {tag ? (
        <p className="compliance-tags" aria-label={tag.ok ? `${tag.label} em dia` : `Falta guia ${tag.label}`}>
          <span className={tag.ok ? "compliance-tag compliance-tag--ok" : "compliance-tag compliance-tag--miss"}>
            {tag.label}
          </span>
        </p>
      ) : null}
      <Button type="button" onClick={() => onAccess(company.companyId)}>
        Acessar
      </Button>
    </article>
  );
}
