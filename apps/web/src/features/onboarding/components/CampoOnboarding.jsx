// Um campo do formulário, renderizado A PARTIR DO DESCRITOR.
//
// A tela nunca decide rótulo, obrigatoriedade nem visibilidade — isso é da spec. Aqui só se traduz
// `tipo` em controle. É essa separação que faz o wizard e a ficha de leitura do escritório
// mostrarem exatamente as mesmas perguntas, na mesma ordem.

import { ehObrigatorio } from "../lib/onboardingSpec";
import { SeloDeclarado } from "./SeloDeclarado";

const INPUT_STYLE = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-page)",
  color: "var(--text)",
  fontSize: 14,
};

const ERRO_STYLE = {
  display: "block",
  marginTop: 4,
  fontSize: 12,
  color: "var(--state-warn)",
  fontWeight: 600,
};

function Rotulo({ descritor, dados, htmlFor, mostrarSelo, origemPreenchimento }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: 4 }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
        {descritor.rotulo}
        {ehObrigatorio(descritor, dados) && (
          <span aria-hidden="true" style={{ color: "var(--state-warn)" }}> *</span>
        )}
      </span>
      {mostrarSelo && descritor.sensivel && (
        <SeloDeclarado origemPreenchimento={origemPreenchimento} />
      )}
    </label>
  );
}

function ListaDeLinhas({ descritor, valor, onChange, id }) {
  const linhas = Array.isArray(valor) ? valor : [];
  const colunas = descritor.colunas || [];

  function alterar(indice, campo, novo) {
    const copia = linhas.map((l, i) => (i === indice ? { ...l, [campo]: novo } : l));
    onChange(copia);
  }

  return (
    <div id={id} style={{ display: "grid", gap: "var(--space-2)" }}>
      {linhas.length === 0 && (
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>Nenhum item.</span>
      )}
      {linhas.map((linha, indice) => (
        <div
          key={indice}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${colunas.length}, minmax(0, 1fr)) auto`,
            gap: "var(--space-2)",
            alignItems: "center",
          }}
        >
          {colunas.map((coluna) => (
            <input
              key={coluna.campo}
              style={INPUT_STYLE}
              placeholder={coluna.rotulo}
              aria-label={`${descritor.rotulo} — ${coluna.rotulo} (linha ${indice + 1})`}
              value={linha?.[coluna.campo] ?? ""}
              onChange={(e) => alterar(indice, coluna.campo, e.target.value)}
            />
          ))}
          <button
            type="button"
            onClick={() => onChange(linhas.filter((_, i) => i !== indice))}
            aria-label={`Remover linha ${indice + 1}`}
            style={{
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--text-muted)", borderRadius: "var(--radius-sm)",
              padding: "6px 10px", cursor: "pointer",
            }}
          >
            remover
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...linhas, {}])}
        style={{
          justifySelf: "start", border: "1px solid var(--border)", background: "transparent",
          color: "var(--text)", borderRadius: "var(--radius-sm)", padding: "6px 12px", cursor: "pointer",
        }}
      >
        + adicionar
      </button>
    </div>
  );
}

export function CampoOnboarding({
  descritor,
  dados,
  valor,
  erro,
  onChange,
  origemPreenchimento,
  mostrarSelo = false,
  acaoExtra = null,
}) {
  const id = `onb-${descritor.campo}`;
  const comum = { id, style: INPUT_STYLE, "aria-invalid": erro ? "true" : undefined };

  let controle;
  switch (descritor.tipo) {
    case "booleano":
      // ⚠ Três estados: `null` = ninguém respondeu, e é diferente de "respondeu que não". Um
      // checkbox de dois estados registraria "não há pró-labore" em toda ficha nunca preenchida.
      controle = (
        <select
          {...comum}
          value={valor === true ? "sim" : valor === false ? "nao" : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "sim")}
        >
          <option value="">— não informado —</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      );
      break;
    case "escolha":
      controle = (
        <select {...comum} value={valor ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">— selecione —</option>
          {(descritor.opcoes || []).map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </select>
      );
      break;
    case "lista":
      controle = <ListaDeLinhas descritor={descritor} valor={valor} onChange={onChange} id={id} />;
      break;
    case "mesAno":
      controle = (
        <input {...comum} type="month" value={valor ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case "email":
      controle = (
        <input {...comum} type="email" value={valor ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    default:
      controle = (
        <input
          {...comum}
          type="text"
          inputMode={["inteiro", "moeda", "cnpj", "cpf", "telefone"].includes(descritor.tipo) ? "numeric" : undefined}
          value={valor ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div style={{ marginBottom: "var(--space-4)" }}>
      <Rotulo
        descritor={descritor}
        dados={dados}
        htmlFor={id}
        mostrarSelo={mostrarSelo}
        origemPreenchimento={origemPreenchimento}
      />
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>{controle}</div>
        {acaoExtra}
      </div>
      {descritor.ajuda && (
        <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>
          {descritor.ajuda}
        </span>
      )}
      {erro && <span style={ERRO_STYLE}>{erro}</span>}
    </div>
  );
}

export default CampoOnboarding;
