import { Button } from "../../../components/ui/Button";

export function CompanyCard({ company, onAccess }) {
  return (
    <article className="company-tile">
      <h3>{company.razao}</h3>
      <p>{company.cnpj}</p>
      <Button onClick={() => onAccess(company.companyId)}>Acessar</Button>
    </article>
  );
}

