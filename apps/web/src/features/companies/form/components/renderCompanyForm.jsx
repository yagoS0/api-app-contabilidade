import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "../../../../components/ui/Button";
import { companyCreateFormSchema, companyUpdateFormSchema } from "../../../../lib/schemas/companySchema";

// Q11.2: estilo padrão pra mensagens de erro inline (vermelho, abaixo do input)
const ERROR_TEXT_STYLE = {
  display: "block",
  marginTop: 4,
  fontSize: 12,
  color: "#FF4757",
  fontWeight: 600,
};

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
  cnpjReadOnly = false, // true em modo edição: CNPJ é imutável após criação (UI + API)
  // Q11.1: zona de risco — botões só aparecem em modo edição (cnpjReadOnly=true)
  status,            // "ATIVA" | "SUSPENSA" (vem do servidor)
  onSuspend,         // (reason?) => Promise
  onResume,          // () => Promise
  onDelete,          // () => abre o modal de confirmação (parent gerencia)
  dangerSaving,      // bool — loading state pros botões da zona de risco
}) {
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState(null);

  // Q11.2: RHF "paralelo" — não possui o state (continua sendo `form` externo), só faz
  // validação visual em tempo real. Vantagem: zero refactor dos callers (continua chamando
  // `onChange(field, value)`). RHF é alimentado pelo `values: form` (resync automático)
  // e `trigger(field)` é chamado a cada onChange pra atualizar `errors`.
  const isEditMode = cnpjReadOnly; // edição usa schema menos rigoroso (senha opcional)
  const {
    register, formState: { errors }, trigger,
  } = useForm({
    resolver: zodResolver(isEditMode ? companyUpdateFormSchema : companyCreateFormSchema),
    values: form,
    mode: "onChange",
  });

  // Helper: chama onChange externo + dispara validação no RHF
  function handleChange(field, value) {
    onChange(field, value);
    // valida o campo modificado pra atualizar errors[field]
    trigger(field).catch(() => null);
  }

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
          onChange={(event) => handleChange("ownerEmail", event.target.value)}
          required
        />
        {errors.ownerEmail && (
          <span style={ERROR_TEXT_STYLE}>{errors.ownerEmail.message}</span>
        )}
      </label>
      {showOwnerPassword ? (
        <label>
          Senha do responsavel
          <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>
            (mínimo 8 caracteres)
          </span>
          <input
            type="password"
            value={form.ownerPassword}
            onChange={(event) => handleChange("ownerPassword", event.target.value)}
            minLength={8}
            required
          />
          {errors.ownerPassword && (
            <span style={ERROR_TEXT_STYLE}>{errors.ownerPassword.message}</span>
          )}
        </label>
      ) : null}
      <label>
        CNPJ
        {cnpjReadOnly && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>
            (não editável — para mudar, exclua a empresa e crie outra)
          </span>
        )}
        {!cnpjReadOnly && cnpjLoading && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>Consultando...</span>
        )}
        {!cnpjReadOnly && cnpjError && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#e55" }}>{cnpjError}</span>
        )}
        <input
          value={form.cnpj}
          onChange={(event) => {
            if (cnpjReadOnly) return;
            handleChange("cnpj", event.target.value);
            setCnpjError(null);
          }}
          onBlur={cnpjReadOnly ? undefined : handleCnpjBlur}
          placeholder="00.000.000/0000-00"
          required
          readOnly={cnpjReadOnly}
          style={cnpjReadOnly ? { background: "#1f2030", color: "#aeb6d3", cursor: "not-allowed" } : undefined}
        />
        {!cnpjReadOnly && errors.cnpj && (
          <span style={ERROR_TEXT_STYLE}>{errors.cnpj.message}</span>
        )}
      </label>
      <label>
        Razao social
        <input value={form.razaoSocial} onChange={(event) => handleChange("razaoSocial", event.target.value)} required />
        {errors.razaoSocial && (
          <span style={ERROR_TEXT_STYLE}>{errors.razaoSocial.message}</span>
        )}
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

      {/* Q11.1: Zona de Risco — só no modo edição (cnpjReadOnly), abaixo do form */}
      {cnpjReadOnly && (onSuspend || onResume || onDelete) && (
        <div className="full" style={{
          marginTop: 32, padding: "16px 18px", borderRadius: 8,
          background: "rgba(255, 71, 87, 0.06)", border: "1px solid #FF4757",
        }}>
          <h3 style={{ margin: "0 0 4px", color: "#FF4757", fontSize: "0.95rem" }}>
            ⚠ Zona de Risco
          </h3>
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "#aeb6d3" }}>
            Suspender desativa a captura SERPRO e bloqueia processamentos. Excluir apaga tudo.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status === "SUSPENSA" ? (
              onResume && (
                <Button
                  type="button" variant="success"
                  onClick={onResume}
                  disabled={dangerSaving}
                >
                  {dangerSaving ? "Reativando…" : "Reativar empresa"}
                </Button>
              )
            ) : (
              onSuspend && (
                <Button
                  type="button" variant="secondary"
                  onClick={() => {
                    // eslint-disable-next-line no-alert
                    const reason = window.prompt("Motivo da suspensão (opcional):", "");
                    if (reason === null) return; // cancelou
                    onSuspend(reason.trim() || null);
                  }}
                  disabled={dangerSaving}
                  style={{ background: "#FFB347", color: "#1A1B26" }}
                >
                  {dangerSaving ? "Suspendendo…" : "Suspender empresa"}
                </Button>
              )
            )}
            {onDelete && (
              <Button
                type="button"
                onClick={onDelete}
                disabled={dangerSaving}
                style={{ background: "#FF4757", color: "white", marginLeft: "auto" }}
              >
                Excluir empresa…
              </Button>
            )}
          </div>
          {status === "SUSPENSA" && (
            <div style={{
              marginTop: 12, padding: "8px 10px", background: "rgba(255, 179, 71, 0.10)",
              border: "1px solid #FFB347", borderRadius: 6, fontSize: "0.8rem", color: "#FFB347",
            }}>
              ⏸ Empresa SUSPENSA — workers SERPRO não vão capturar guias.
            </div>
          )}
        </div>
      )}
    </form>
  );
}
