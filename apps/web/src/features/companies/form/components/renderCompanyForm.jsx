import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "../../../../components/ui/Button";
import { companyCreateFormSchema, companyUpdateFormSchema } from "../../../../lib/schemas/companySchema";
import { passwordChecklist } from "../../../../lib/schemas/passwordPolicy";

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

// Porte da BrasilAPI ("MICRO EMPRESA", "EMPRESA DE PEQUENO PORTE"...) → como a ficha escreve.
function porteDaBrasilApi(data) {
  const raw = String(data.porte || data.descricao_porte || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("MICRO EMPRESA") || raw === "ME") return "MICROEMPRESA";
  if (raw.includes("PEQUENO PORTE") || raw === "EPP") return "EMPRESA DE PEQUENO PORTE";
  if (raw.includes("DEMAIS")) return "DEMAIS";
  return raw;
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

  // A BrasilAPI já devolvia tudo abaixo e a gente jogava fora — o contador redigitava
  // (ou simplesmente ficava sem). Agora entra direto na ficha.
  onChange("porte", porteDaBrasilApi(data));
  onChange("naturezaJuridica", String(data.codigo_natureza_juridica || data.natureza_juridica || "").trim());
  onChange("dataAbertura", data.data_inicio_atividade || "");
  if (data.capital_social !== undefined && data.capital_social !== null) {
    onChange("capitalSocial", String(data.capital_social));
  }
  // Traz TODOS os CNAEs, com descrição. O classificador consolida a sugestão de anexo sobre o
  // CONJUNTO (principal + secundários): apoio administrativo que também faz obra e engenharia é
  // outro caso. Antes só o código era guardado, e a tela virava uma fileira de números sem
  // sentido — dava pra ter o dado certo e ainda assim não saber o que ele significa.
  if (Array.isArray(data.cnaes_secundarios)) {
    const secundarios = data.cnaes_secundarios
      .map((c) => String(c?.codigo || "").replace(/\D+/g, ""))
      .filter(Boolean);
    onChange("cnaesSecundarios", secundarios.join(", "));
  }
}

// Descrições dos CNAEs vindas da consulta — só para EXIBIR ao lado do código. O que é gravado
// continua sendo o código; a descrição é conveniência de leitura, não dado fiscal.
function descricoesDosCnaes(data) {
  const mapa = new Map();
  const norm = (v) => String(v || "").replace(/\D+/g, "").slice(0, 7);
  if (data?.cnae_fiscal) mapa.set(norm(data.cnae_fiscal), String(data.cnae_fiscal_descricao || ""));
  for (const c of Array.isArray(data?.cnaes_secundarios) ? data.cnaes_secundarios : []) {
    const k = norm(c?.codigo);
    if (k) mapa.set(k, String(c?.descricao || ""));
  }
  return mapa;
}

// Formata "8219999" → "8219-9/99", que é como o cartão CNPJ escreve.
function formatarCnae(valor) {
  const d = String(valor || "").replace(/\D+/g, "").slice(0, 7);
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : String(valor || "");
}

// Mostra o CNAE do jeito que o cartão CNPJ escreve (8219-9/99) + a descrição, quando conhecida.
// Sem isso o campo é só um número, e conferir contra o cartão vira trabalho manual.
function CnaeLegenda({ valor, descricoes }) {
  const digitos = String(valor || "").replace(/\D+/g, "").slice(0, 7);
  if (digitos.length !== 7) return null;
  const desc = descricoes?.get(digitos) || "";
  return (
    <span style={{ fontSize: 11, color: "#8A8FA3" }}>
      {formatarCnae(digitos)}{desc ? ` — ${desc}` : ""}
    </span>
  );
}

function ListaCnaesSecundarios({ valor, descricoes }) {
  const codigos = String(valor || "")
    .split(",")
    .map((c) => c.replace(/\D+/g, "").slice(0, 7))
    .filter((c) => c.length === 7);
  if (!codigos.length) return null;
  return (
    <div className="full" style={{ marginTop: -4 }}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "#8A8FA3", lineHeight: 1.7 }}>
        {codigos.map((c) => (
          <li key={c}>
            <strong style={{ color: "#F8F8F2", fontWeight: 600 }}>{formatarCnae(c)}</strong>
            {descricoes?.get(c) ? ` — ${descricoes.get(c)}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MINI_INPUT = {
  background: "#282A36", border: "1px solid #44475A", borderRadius: 5,
  color: "#F8F8F2", padding: "5px 7px", fontSize: "0.8rem", width: "100%",
  colorScheme: "dark",
};
const MINI_TH = { padding: "4px 6px", fontSize: "0.68rem", color: "#6b7280", textTransform: "uppercase", textAlign: "left" };

// Sócios: lista editável. Sócio que saiu NÃO é removido — preenche "Saiu em" e ele fica no
// histórico (é assim que a ficha do escritório trata).
function SociosEditor({ socios, onChange }) {
  const linhas = Array.isArray(socios) ? socios : [];
  function setLinha(i, campo, valor) {
    onChange(linhas.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)));
  }
  function add() {
    onChange([...linhas, { name: "", documento: "", participacao: "", rg: "", rgOrgaoEmissor: "", dataNascimento: "", dataSaida: "", representante: false }]);
  }
  function remove(i) {
    onChange(linhas.filter((_, idx) => idx !== i));
  }
  const totalPerc = linhas
    .filter((s) => !s.dataSaida)
    .reduce((sum, s) => sum + (Number(String(s.participacao).replace(",", ".")) || 0), 0);

  return (
    <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Sócios</strong>
        <span style={{ fontSize: 11, color: totalPerc > 100 ? "#FF4757" : "#6b7280" }}>
          {linhas.length > 0 && `Soma dos ativos: ${totalPerc}%`}
          {totalPerc > 100 && " — passa de 100%"}
        </span>
      </div>
      {linhas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={MINI_TH}>Nome</th>
                <th style={{ ...MINI_TH, width: 120 }}>CPF</th>
                <th style={{ ...MINI_TH, width: 60 }}>%</th>
                <th style={{ ...MINI_TH, width: 110 }}>Nascimento</th>
                <th style={{ ...MINI_TH, width: 110 }}>RG</th>
                <th style={{ ...MINI_TH, width: 80 }}>Órgão</th>
                <th style={{ ...MINI_TH, width: 110 }}>Saiu em</th>
                <th style={{ width: 26 }} />
              </tr>
            </thead>
            <tbody>
              {linhas.map((s, i) => (
                <tr key={i} style={{ opacity: s.dataSaida ? 0.6 : 1 }}>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.name} onChange={(e) => setLinha(i, "name", e.target.value)} placeholder="nome do sócio" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.documento} onChange={(e) => setLinha(i, "documento", e.target.value)} placeholder="000.000.000-00" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.participacao} onChange={(e) => setLinha(i, "participacao", e.target.value)} placeholder="100" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={s.dataNascimento} onChange={(e) => setLinha(i, "dataNascimento", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.rg} onChange={(e) => setLinha(i, "rg", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.rgOrgaoEmissor} onChange={(e) => setLinha(i, "rgOrgaoEmissor", e.target.value)} placeholder="DIC/RJ" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={s.dataSaida} onChange={(e) => setLinha(i, "dataSaida", e.target.value)} /></td>
                  <td style={{ padding: 3, textAlign: "center" }}>
                    <button type="button" onClick={() => remove(i)} title="Remover linha" style={{ background: "transparent", border: "none", color: "#FF5757", cursor: "pointer" }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={add} style={{ marginTop: 6, background: "none", border: "1px dashed #44475A", color: "#8BE9FD", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: "0.8rem" }}>
        + Adicionar sócio
      </button>
    </div>
  );
}

// Histórico de regime. INFORMATIVO: a apuração continua usando o regime atual da empresa.
function RegimeHistoricoEditor({ historico, onChange }) {
  const linhas = Array.isArray(historico) ? historico : [];
  function setLinha(i, campo, valor) {
    onChange(linhas.map((r, idx) => (idx === i ? { ...r, [campo]: valor } : r)));
  }
  function add() {
    onChange([...linhas, { regime: "SIMPLES", vigenciaInicio: "", vigenciaFim: "", impostos: "", desoneracao: false }]);
  }
  function remove(i) {
    onChange(linhas.filter((_, idx) => idx !== i));
  }

  return (
    <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Histórico de regime</strong>
        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
          Registro para consulta. A apuração usa o regime atual selecionado acima.
        </span>
      </div>
      {linhas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead>
              <tr>
                <th style={{ ...MINI_TH, width: 150 }}>Regime</th>
                <th style={{ ...MINI_TH, width: 120 }}>De</th>
                <th style={{ ...MINI_TH, width: 120 }}>Até</th>
                <th style={MINI_TH}>Impostos</th>
                <th style={{ ...MINI_TH, width: 70 }}>Desone</th>
                <th style={{ width: 26 }} />
              </tr>
            </thead>
            <tbody>
              {linhas.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 3 }}>
                    <select style={MINI_INPUT} value={r.regime} onChange={(e) => setLinha(i, "regime", e.target.value)}>
                      <option value="SIMPLES">Simples Nacional</option>
                      <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
                      <option value="LUCRO_REAL">Lucro Real</option>
                      <option value="MEI">MEI</option>
                    </select>
                  </td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={r.vigenciaInicio} onChange={(e) => setLinha(i, "vigenciaInicio", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={r.vigenciaFim} onChange={(e) => setLinha(i, "vigenciaFim", e.target.value)} placeholder="vigente" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={r.impostos} onChange={(e) => setLinha(i, "impostos", e.target.value)} placeholder="ISS/PIS/COFINS/CSLL/IRPJ" /></td>
                  <td style={{ padding: 3, textAlign: "center" }}>
                    <input type="checkbox" checked={Boolean(r.desoneracao)} onChange={(e) => setLinha(i, "desoneracao", e.target.checked)} />
                  </td>
                  <td style={{ padding: 3, textAlign: "center" }}>
                    <button type="button" onClick={() => remove(i)} title="Remover linha" style={{ background: "transparent", border: "none", color: "#FF5757", cursor: "pointer" }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={add} style={{ marginTop: 6, background: "none", border: "1px dashed #44475A", color: "#8BE9FD", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: "0.8rem" }}>
        + Adicionar período
      </button>
    </div>
  );
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
  // Descrições dos CNAEs da última consulta — só para exibir; o que é gravado é o código.
  const [cnaeDescricoes, setCnaeDescricoes] = useState(() => new Map());

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
      setCnaeDescricoes(descricoesDosCnaes(data));
    } catch {
      setCnpjError("CNPJ não encontrado ou inválido.");
    } finally {
      setCnpjLoading(false);
    }
  }

  return (
    <form className="form-grid two-col" onSubmit={onSubmit}>
      <div className="full" style={{ paddingBottom: 4 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Responsável pelo acesso</strong>
        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
          Quem vai entrar no portal do cliente.
        </span>
      </div>
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
          <input
            type="password"
            value={form.ownerPassword}
            onChange={(event) => handleChange("ownerPassword", event.target.value)}
            required
          />
          {/* Q27.A: checklist ao vivo dos requisitos da senha forte */}
          <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", fontSize: 12 }}>
            {passwordChecklist(form.ownerPassword).map((r) => (
              <li key={r.key} style={{ color: r.ok ? "#69FF47" : "#aeb6d3" }}>
                {r.ok ? "✓" : "○"} {r.label}
              </li>
            ))}
          </ul>
          {errors.ownerPassword && (
            <span style={ERROR_TEXT_STYLE}>{errors.ownerPassword.message}</span>
          )}
        </label>
      ) : null}
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Identificação da empresa</strong>
        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
          Digite o CNPJ e saia do campo: o resto preenche sozinho.
        </span>
      </div>
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
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Regime e obrigações</strong>
      </div>
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
        Empresa zerada (sem movimento)
        <select
          value={form.empresaZerada ? "sim" : "nao"}
          onChange={(event) => onChange("empresaZerada", event.target.value === "sim")}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim — só obrigações zeradas</option>
        </select>
      </label>
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Atividades (CNAE)</strong>
        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
          Todos os CNAEs contam: a sugestão de anexo é feita sobre o conjunto, não só o principal.
        </span>
      </div>
      <label>
        CNAE principal
        <input value={form.cnaePrincipal} onChange={(event) => onChange("cnaePrincipal", event.target.value)} required />
        <CnaeLegenda valor={form.cnaePrincipal} descricoes={cnaeDescricoes} />
      </label>
      <label>
        CNAEs secundários
        <input
          value={form.cnaesSecundarios}
          onChange={(event) => onChange("cnaesSecundarios", event.target.value)}
          placeholder="4330405, 4321500"
        />
        <span style={{ fontSize: 11, color: "#6b7280" }}>Separados por vírgula. Preenchem sozinhos pelo CNPJ.</span>
      </label>
      {/* Lista legível: o campo de texto é uma fileira de números; aqui dá pra CONFERIR se os
          CNAEs batem com o cartão CNPJ antes de salvar. */}
      <ListaCnaesSecundarios valor={form.cnaesSecundarios} descricoes={cnaeDescricoes} />
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Endereço</strong>
      </div>
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

      {/* ── Ficha de cadastro ── */}
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Dados da ficha</strong>
        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>
          Porte, natureza jurídica, capital e abertura preenchem sozinhos pelo CNPJ.
        </span>
      </div>
      <label>
        Data de abertura
        <input type="date" value={form.dataAbertura} onChange={(event) => onChange("dataAbertura", event.target.value)} />
      </label>
      <label>
        Porte
        <input value={form.porte} onChange={(event) => onChange("porte", event.target.value)} placeholder="MICROEMPRESA" />
      </label>
      <label>
        Natureza jurídica
        <input value={form.naturezaJuridica} onChange={(event) => onChange("naturezaJuridica", event.target.value)} placeholder="230-5" />
      </label>
      <label>
        Capital social
        <input value={form.capitalSocial} onChange={(event) => onChange("capitalSocial", event.target.value)} placeholder="100.000,00" />
      </label>
      <label>
        Abriu com
        <input value={form.abriuCom} onChange={(event) => onChange("abriuCom", event.target.value)} placeholder="JEFFERSON" />
      </label>
      <label>
        Diário nº
        <input value={form.diarioNumero} onChange={(event) => onChange("diarioNumero", event.target.value)} />
      </label>
      <label>
        Nº de registro
        <input value={form.numeroRegistro} onChange={(event) => onChange("numeroRegistro", event.target.value)} placeholder="33.6.0068899-0" />
      </label>
      <label>
        Tipo de registro
        <input value={form.tipoRegistro} onChange={(event) => onChange("tipoRegistro", event.target.value)} placeholder="JUNTA COMERCIAL" />
      </label>
      <label>
        Desoneração da folha
        <select
          value={form.desoneracao ? "sim" : "nao"}
          onChange={(event) => onChange("desoneracao", event.target.value === "sim")}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim — c/ desoneração</option>
        </select>
      </label>
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Inscrições</strong>
      </div>
      <label>
        Inscrição municipal
        <input value={form.inscricaoMunicipal} onChange={(event) => onChange("inscricaoMunicipal", event.target.value)} />
      </label>
      <label>
        Data da IM
        <input type="date" value={form.inscricaoMunicipalData} onChange={(event) => onChange("inscricaoMunicipalData", event.target.value)} />
      </label>
      <div />
      <label>
        Inscrição estadual
        <input value={form.inscricaoEstadual} onChange={(event) => onChange("inscricaoEstadual", event.target.value)} />
      </label>
      <label>
        Data da IE
        <input type="date" value={form.inscricaoEstadualData} onChange={(event) => onChange("inscricaoEstadualData", event.target.value)} />
      </label>
      <div />
      <label>
        Nº da última alteração
        <input value={form.alteracaoNumero} onChange={(event) => onChange("alteracaoNumero", event.target.value)} placeholder="2" />
      </label>
      <label>
        Data da alteração
        <input type="date" value={form.alteracaoData} onChange={(event) => onChange("alteracaoData", event.target.value)} />
      </label>
      <div />

      <SociosEditor socios={form.socios} onChange={(next) => onChange("socios", next)} />
      <RegimeHistoricoEditor historico={form.regimeHistorico} onChange={(next) => onChange("regimeHistorico", next)} />

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
