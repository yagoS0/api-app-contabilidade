import { useState } from "react";
import { Button } from "../../../../components/ui/Button";

async function fetchCnpjData(cnpj) {
  const digits = cnpj.replace(/\D/g, "");
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  if (!res.ok) throw new Error("CNPJ não encontrado");
  return res.json();
}

function applyBrasilApiData(data, onChange) {
  const telefone = [data.ddd_telefone_1, data.ddd_telefone_2].filter(Boolean).join(" / ");
  const cnae = data.cnae_fiscal ? String(data.cnae_fiscal) : "";

  onChange("razaoSocial", data.razao_social || "");
  onChange("nomeFantasia", data.nome_fantasia || "");
  onChange("telefone", telefone);
  onChange("cnaePrincipal", cnae);
  onChange("enderecoRua", [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(" "));
  onChange("enderecoNumero", data.numero || "");
  onChange("enderecoBairro", data.bairro || "");
  onChange("enderecoCidade", data.municipio || "");
  onChange("enderecoUf", (data.uf || "").toUpperCase());
  onChange("enderecoCep", data.cep || "");
  onChange("enderecoComplemento", data.complemento || "");
}

export function CompanyForm({
  form,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  showOwnerPassword,
}) {
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState(null);

  async function handleCnpjBlur() {
    const digits = form.cnpj.replace(/\D/g, "");
    if (digits.length !== 14) return;
    setCnpjLoading(true);
    setCnpjError(null);
    try {
      const data = await fetchCnpjData(digits);
      applyBrasilApiData(data, onChange);
    } catch {
      setCnpjError("CNPJ não encontrado ou inválido.");
    } finally {
      setCnpjLoading(false);
    }
  }

  return (
    <form className="form-grid two-col" onSubmit={onSubmit}>
      <label>
        Nome do responsavel
        <input value={form.ownerName} onChange={(event) => onChange("ownerName", event.target.value)} />
      </label>
      <label>
        E-mail do responsável (login do portal)
        <input
          type="email"
          value={form.ownerEmail}
          onChange={(event) => onChange("ownerEmail", event.target.value)}
          required
        />
      </label>
      {showOwnerPassword ? (
        <label>
          Senha do responsavel
          <input
            type="password"
            value={form.ownerPassword}
            onChange={(event) => onChange("ownerPassword", event.target.value)}
            required
          />
        </label>
      ) : null}
      <label>
        CNPJ
        {cnpjLoading && <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>Consultando...</span>}
        {cnpjError && <span style={{ marginLeft: 8, fontSize: 12, color: "#e55" }}>{cnpjError}</span>}
        <input
          value={form.cnpj}
          onChange={(event) => {
            onChange("cnpj", event.target.value);
            setCnpjError(null);
          }}
          onBlur={handleCnpjBlur}
          placeholder="00.000.000/0000-00"
          required
        />
      </label>
      <label>
        Razao social
        <input value={form.razaoSocial} onChange={(event) => onChange("razaoSocial", event.target.value)} required />
      </label>
      <label>
        Nome fantasia
        <input value={form.nomeFantasia} onChange={(event) => onChange("nomeFantasia", event.target.value)} />
      </label>
      <label className="full">
        E-mail para recebimento das guias
        <input
          type="email"
          value={form.guideNotificationEmail}
          onChange={(event) => onChange("guideNotificationEmail", event.target.value)}
          placeholder="pode ser o mesmo para várias empresas"
        />
      </label>
      <label>
        Telefone
        <input value={form.telefone} onChange={(event) => onChange("telefone", event.target.value)} />
      </label>
      <label>
        Regime tributario
        <select value={form.regimeTributario} onChange={(event) => onChange("regimeTributario", event.target.value)}>
          <option value="SIMPLES">SIMPLES</option>
          <option value="LUCRO_PRESUMIDO">LUCRO_PRESUMIDO</option>
          <option value="LUCRO_REAL">LUCRO_REAL</option>
        </select>
      </label>
      <label>
        Pró-labore
        <select
          value={form.hasProlabore ? "sim" : "nao"}
          onChange={(event) => onChange("hasProlabore", event.target.value === "sim")}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim</option>
        </select>
      </label>
      <label>
        CNAE principal
        <input value={form.cnaePrincipal} onChange={(event) => onChange("cnaePrincipal", event.target.value)} required />
      </label>
      <label>
        Endereco - rua
        <input value={form.enderecoRua} onChange={(event) => onChange("enderecoRua", event.target.value)} required />
      </label>
      <label>
        Endereco - numero
        <input
          value={form.enderecoNumero}
          onChange={(event) => onChange("enderecoNumero", event.target.value)}
          required
        />
      </label>
      <label>
        Endereco - bairro
        <input
          value={form.enderecoBairro}
          onChange={(event) => onChange("enderecoBairro", event.target.value)}
          required
        />
      </label>
      <label>
        Endereco - cidade
        <input
          value={form.enderecoCidade}
          onChange={(event) => onChange("enderecoCidade", event.target.value)}
          required
        />
      </label>
      <label>
        Endereco - UF
        <input value={form.enderecoUf} onChange={(event) => onChange("enderecoUf", event.target.value)} required />
      </label>
      <label>
        Endereco - CEP
        <input value={form.enderecoCep} onChange={(event) => onChange("enderecoCep", event.target.value)} required />
      </label>
      <label className="full">
        Endereco - complemento
        <input
          value={form.enderecoComplemento}
          onChange={(event) => onChange("enderecoComplemento", event.target.value)}
        />
      </label>
      <div className="full form-actions">
        <Button type="submit" variant="success" className="company-form-page__submit" disabled={submitting || cnpjLoading}>
          {submitting ? "Salvando..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
