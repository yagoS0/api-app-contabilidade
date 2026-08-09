// CONVERSÃO — a ficha vira empresa de verdade.
//
// É o formulário de `POST /firm/companies` pré-preenchido, destacando os TRÊS pontos que o contador
// tem de resolver e que a ficha não coletou:
//
//  1. **CNPJ definitivo** (na abertura ele nem existia). O botão "consultar Receita" traz endereço
//     e CNAE de uma vez — a conversão exige endereço COMPLETO (rua, número, bairro, cidade, UF,
//     CEP) e `cnaePrincipal`, e a ficha não pergunta nenhum dos dois.
//  2. **Regime tributário**, restrito a SIMPLES | LUCRO_PRESUMIDO | LUCRO_REAL.
//     ⚠ ESTA RESTRIÇÃO É O PONTO. `companyCreateSchema` aceita "MEI" e "OUTRO", e
//     `validateAndNormalizeCompanyProfile` os RECUSA depois com
//     `company_regime_tributario_invalid`. O `tipoEmpresa: "MEI"` do wizard é tipo SOCIETÁRIO, não
//     regime — mandar "MEI" aqui é o bug que aparece no primeiro MEI real.
//  3. **Senha do dono**, com o `passwordChecklist` da política única do projeto (reusado, não
//     reescrito — duas políticas de senha divergiriam na primeira mudança de regra).

import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { passwordChecklist } from "../../../lib/schemas/passwordPolicy";
import { consultarCnpj, formatarCnpj, mapearParaFormularioEmpresa, soDigitosCnpj } from "../lib/brasilApi";

// ⚠ OS TRÊS, e só eles. Ver o comentário do cabeçalho.
const REGIMES_ACEITOS = [
  { valor: "SIMPLES", rotulo: "Simples Nacional" },
  { valor: "LUCRO_PRESUMIDO", rotulo: "Lucro Presumido" },
  { valor: "LUCRO_REAL", rotulo: "Lucro Real" },
];

const INPUT = {
  width: "100%", padding: "8px 10px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)", background: "var(--bg-page)", color: "var(--text)", fontSize: 14,
};

function Campo({ rotulo, obrigatorio, children, ajuda }) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
        {rotulo}
        {obrigatorio && <span aria-hidden="true" style={{ color: "var(--state-warn)" }}> *</span>}
      </label>
      {children}
      {ajuda && (
        <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--text-faint)" }}>{ajuda}</span>
      )}
    </div>
  );
}

function estadoInicial(onboarding) {
  const dados = onboarding?.dados || {};
  return {
    cnpj: onboarding?.cnpj ? formatarCnpj(onboarding.cnpj) : "",
    razaoSocial: onboarding?.razaoSocial || "",
    nomeFantasia: dados.nomeFantasia || "",
    // ⚠ NÃO herda `regimeAtual`/`regimePretendido` da ficha: eles admitem "MEI", "NAO_SEI" e
    // "A_DEFINIR", que a criação de empresa recusa. O contador ESCOLHE aqui, conscientemente.
    regimeTributario: "",
    cnaePrincipal: "",
    telefone: dados.responsavelTelefone || "",
    ownerEmail: onboarding?.responsavelEmail || "",
    ownerName: onboarding?.responsavelNome || "",
    ownerPassword: "",
    hasProlabore: dados.temProLabore === true,
    endereco: { rua: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", cep: "" },
  };
}

export function ConversaoModal({ onboarding, onFechar, onConverter, onVincular, erro }) {
  const [form, setForm] = useState(() => estadoInicial(onboarding));
  const [consultando, setConsultando] = useState(false);
  const [avisoConsulta, setAvisoConsulta] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const checklistSenha = useMemo(() => passwordChecklist(form.ownerPassword), [form.ownerPassword]);
  const senhaOk = checklistSenha.every((r) => r.ok);
  const emailJaExiste = onboarding?.emailJaCadastrado === true;

  // ⚠ A senha só é EXIGIDA quando o dono ainda não tem conta. Uma pessoa com duas empresas é caso
  // normal, e o provisionamento reusa o `User` existente — pedir senha ali travaria a conversão.
  const senhaExigida = !emailJaExiste;

  const camposEndereco = ["rua", "numero", "bairro", "cidade", "uf", "cep"];
  const enderecoCompleto = camposEndereco.every((c) => String(form.endereco[c] || "").trim());
  const podeConverter =
    soDigitosCnpj(form.cnpj).length === 14 &&
    String(form.razaoSocial).trim() &&
    REGIMES_ACEITOS.some((r) => r.valor === form.regimeTributario) &&
    String(form.cnaePrincipal).trim() &&
    enderecoCompleto &&
    String(form.ownerEmail).trim() &&
    (!senhaExigida || senhaOk);

  function set(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }
  function setEndereco(campo, valor) {
    setForm((atual) => ({ ...atual, endereco: { ...atual.endereco, [campo]: valor } }));
  }

  async function consultarReceita() {
    setConsultando(true);
    setAvisoConsulta(null);
    const r = await consultarCnpj(form.cnpj);
    setConsultando(false);
    if (!r.ok) {
      setAvisoConsulta(r.mensagem);
      return;
    }
    const mapeado = mapearParaFormularioEmpresa(r.bruto);
    setForm((atual) => ({
      ...atual,
      razaoSocial: mapeado.razaoSocial || atual.razaoSocial,
      nomeFantasia: mapeado.nomeFantasia || atual.nomeFantasia,
      telefone: mapeado.telefone || atual.telefone,
      cnaePrincipal: mapeado.cnaePrincipal || atual.cnaePrincipal,
      endereco: { ...atual.endereco, ...mapeado.endereco },
    }));
    if (r.situacao?.texto && !r.situacao.ativa) {
      setAvisoConsulta(`Situação cadastral na Receita: ${r.situacao.texto}.`);
    }
  }

  async function confirmar() {
    // ⚠ Confirmação final repetindo razão social + CNPJ + e-mail do dono. A criação de empresa é
    // irreversível na prática (o CNPJ é imutável depois, e desfazer exige excluir a empresa).
    const resumo =
      `Criar a empresa?\n\n${form.razaoSocial}\nCNPJ ${formatarCnpj(form.cnpj)}\n` +
      `Acesso do cliente: ${form.ownerEmail}`;
    if (!window.confirm(resumo)) return;

    setEnviando(true);
    try {
      await onConverter({
        ownerEmail: form.ownerEmail.trim().toLowerCase(),
        ownerName: form.ownerName || null,
        ...(senhaExigida ? { ownerPassword: form.ownerPassword } : {}),
        hasProlabore: Boolean(form.hasProlabore),
        company: {
          razaoSocial: form.razaoSocial.trim(),
          nomeFantasia: form.nomeFantasia || null,
          cnpj: soDigitosCnpj(form.cnpj),
          regimeTributario: form.regimeTributario,
          cnaePrincipal: form.cnaePrincipal.trim(),
          telefone: form.telefone || null,
          endereco: form.endereco,
        },
      });
    } finally {
      setEnviando(false);
    }
  }

  // Recuperação: o backend devolveu 409 `cnpj_ja_na_carteira` com o id da empresa existente.
  const conflito = erro?.code === "cnpj_ja_na_carteira" ? erro : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Criar a empresa a partir do onboarding"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "var(--space-5)", overflowY: "auto",
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 720, background: "var(--bg-surface)",
          border: "1px solid var(--border)", borderRadius: "var(--radius)",
          padding: "var(--space-5)",
        }}
      >
        <h2 style={{ margin: "0 0 var(--space-2)", fontSize: 18 }}>Criar a empresa</h2>
        <p style={{ margin: "0 0 var(--space-4)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          O cadastro exige CNPJ, endereço completo e CNAE principal — a ficha de onboarding não
          coleta os três. Consultar a Receita traz todos de uma vez.
        </p>

        {conflito && (
          <div style={avisoStyle("var(--state-warn)")}>
            <strong style={{ color: "var(--state-warn)" }}>Este CNPJ já está na carteira.</strong>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {conflito.payload?.razao ? `${conflito.payload.razao} — ` : ""}
              vincular esta ficha à empresa existente em vez de criar outra.
            </span>
            <Button
              size="sm"
              type="button"
              onClick={() => onVincular(conflito.payload?.portalClientId)}
              disabled={!conflito.payload?.portalClientId}
            >
              Vincular ao existente
            </Button>
          </div>
        )}

        {erro && !conflito && (
          <div style={avisoStyle("var(--state-warn)")}>
            <strong style={{ color: "var(--state-warn)" }}>Não foi possível criar a empresa</strong>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{erro.message}</span>
          </div>
        )}

        {/* ── 1) CNPJ definitivo ───────────────────────────────────────── */}
        <Campo rotulo="CNPJ definitivo" obrigatorio>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <input style={INPUT} value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={consultarReceita}
              disabled={consultando || soDigitosCnpj(form.cnpj).length !== 14}
            >
              {consultando ? "consultando…" : "consultar Receita"}
            </Button>
          </div>
        </Campo>

        {avisoConsulta && (
          <div style={avisoStyle("var(--state-warn)")}>
            <span style={{ fontSize: 13, color: "var(--state-warn)" }}>{avisoConsulta}</span>
          </div>
        )}

        <Campo rotulo="Razão social" obrigatorio>
          <input style={INPUT} value={form.razaoSocial} onChange={(e) => set("razaoSocial", e.target.value)} />
        </Campo>
        <Campo rotulo="Nome fantasia">
          <input style={INPUT} value={form.nomeFantasia} onChange={(e) => set("nomeFantasia", e.target.value)} />
        </Campo>

        {/* ── 2) Regime ────────────────────────────────────────────────── */}
        <Campo
          rotulo="Regime tributário"
          obrigatorio
          ajuda="O cadastro opera só nestes três. 'MEI' é tipo societário e não vale como regime aqui."
        >
          <select style={INPUT} value={form.regimeTributario} onChange={(e) => set("regimeTributario", e.target.value)}>
            <option value="">— selecione —</option>
            {REGIMES_ACEITOS.map((r) => (
              <option key={r.valor} value={r.valor}>{r.rotulo}</option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="CNAE principal" obrigatorio>
          <input style={INPUT} value={form.cnaePrincipal} onChange={(e) => set("cnaePrincipal", e.target.value)} />
        </Campo>

        <fieldset style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "var(--space-3)", marginBottom: "var(--space-3)" }}>
          <legend style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 6px" }}>
            Endereço (todos os campos são exigidos pelo cadastro)
          </legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--space-2)" }}>
            {[
              ["rua", "Rua"], ["numero", "Número"], ["complemento", "Complemento"],
              ["bairro", "Bairro"], ["cidade", "Cidade"], ["uf", "UF"], ["cep", "CEP"],
            ].map(([campo, rotulo]) => (
              <label key={campo} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {rotulo}
                {campo !== "complemento" && <span aria-hidden="true" style={{ color: "var(--state-warn)" }}> *</span>}
                <input
                  style={{ ...INPUT, marginTop: 2 }}
                  value={form.endereco[campo]}
                  onChange={(e) => setEndereco(campo, e.target.value)}
                />
              </label>
            ))}
          </div>
        </fieldset>

        {/* ── 3) Acesso do cliente ─────────────────────────────────────── */}
        <Campo rotulo="E-mail do dono (acesso do cliente)" obrigatorio>
          <input style={INPUT} value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} />
        </Campo>
        <Campo rotulo="Nome do dono">
          <input style={INPUT} value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
        </Campo>

        {emailJaExiste ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
            Este e-mail já tem conta no portal — o acesso existente é reaproveitado e nenhuma senha é
            pedida.
          </p>
        ) : (
          <Campo rotulo="Senha de acesso do dono" obrigatorio>
            <input
              style={INPUT}
              type="password"
              value={form.ownerPassword}
              onChange={(e) => set("ownerPassword", e.target.value)}
            />
            <ul style={{ margin: "var(--space-2) 0 0", padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
              {checklistSenha.map((r) => (
                <li key={r.key} style={{ fontSize: 12, color: r.ok ? "var(--state-ok)" : "var(--text-faint)" }}>
                  {r.ok ? "✓" : "○"} {r.label}
                </li>
              ))}
            </ul>
          </Campo>
        )}

        <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: 13, marginBottom: "var(--space-4)" }}>
          <input
            type="checkbox"
            checked={form.hasProlabore}
            onChange={(e) => set("hasProlabore", e.target.checked)}
          />
          Há pró-labore (exige guia de INSS na competência)
        </label>

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="secondary" type="button" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirmar} disabled={!podeConverter || enviando}>
            {enviando ? "criando…" : "Criar empresa"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function avisoStyle(cor) {
  return {
    display: "grid", gap: "var(--space-2)", justifyItems: "start",
    padding: "var(--space-3)", marginBottom: "var(--space-3)",
    borderRadius: "var(--radius-sm)", border: `1px solid ${cor}`, borderLeft: `3px solid ${cor}`,
  };
}

export default ConversaoModal;
