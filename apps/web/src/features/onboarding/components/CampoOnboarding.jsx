import { CAMPOS_ENDERECO, empresaIndividual, pessoaPreenchida } from '@contabilidade/shared/onboarding';
import { Button } from "../../../components/ui/Button";
import { permiteRespostaEspecial, respostaEspecial } from "@contabilidade/shared/onboarding-dados";
// Um campo do formulário, renderizado A PARTIR DO DESCRITOR.
//
// A tela nunca decide rótulo, obrigatoriedade nem visibilidade — isso é da spec. Aqui só se traduz
// `tipo` em controle. É essa separação que faz o wizard e a ficha de leitura do escritório
// mostrarem exatamente as mesmas perguntas, na mesma ordem.

import { ehObrigatorio } from "../lib/onboardingSpec";
import { SeloDeclarado } from "./SeloDeclarado";

const INPUT_STYLE = {
  width: "100%",
  minWidth: 0,
  minHeight: 44,
  boxSizing: "border-box",
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

function ListaDeLinhas({ descritor, valor, onChange, onAdequarPessoas, id, dados, acessibilidade }) {
  const titular = descritor.campo === 'titular';
  const conflito = descritor.campo === 'socios' && empresaIndividual(dados) || titular && !empresaIndividual(dados);
  const preenchidas = Array.isArray(valor) ? valor : [];
  const quantidade = titular ? 1 : Math.max(1, Math.min(100, Number(dados?.cartoesPessoas) || 1));
  const linhas = Array.from({ length: Math.max(preenchidas.length, quantidade) }, (_, i) => preenchidas[i] || {});
  const colunas = descritor.colunas || [];

  function alterar(indice, campo, novo) {
    const copia = linhas.map((l, i) => (i === indice ? { ...l, [campo]: novo } : l));
    onChange(copia);
  }

  return (
    <div id={id} role="group" {...acessibilidade} style={{ display: "grid", gap: "var(--space-2)" }}>
      {conflito && <p role="alert">O tipo de empresa mudou. Transfira a pessoa para o bloco adequado ou volte ao tipo anterior. Os dados permanecem preservados até sua escolha.</p>}
      {conflito && !titular && (dados.titular || []).some(pessoaPreenchida) && <p role="status">Já há um titular definido. Confira as pessoas restantes e remova somente as que não devem constar nesta ficha, ou volte ao tipo anterior para manter a sociedade.</p>}
      {linhas.length === 0 && (
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>Nenhum item.</span>
      )}
      {linhas.map((linha, indice) => (
        <div
          key={indice}
          className="onboarding-field-row"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
            gap: "var(--space-2)",
            alignItems: "end",
          }}
        >
          <strong style={{ gridColumn: "1 / -1" }}>{titular ? "Titular" : `Sócio ${indice + 1}`}</strong>
          {conflito && onAdequarPessoas && <Button type="button" variant="secondary" disabled={!pessoaPreenchida(linha) || !titular && (dados.titular || []).some(pessoaPreenchida)} onClick={() => onAdequarPessoas(descritor.campo, indice)}>{titular ? 'Usar como sócio' : 'Usar como titular'}</Button>}
          {colunas.map((coluna) => (
            <label key={coluna.campo} className="onboarding-field-row__column" style={{ minWidth: 0, display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{coluna.rotulo}</span>
              <input
                {...acessibilidade} style={INPUT_STYLE}
                placeholder={coluna.rotulo}
                aria-label={`${descritor.rotulo} — ${coluna.rotulo} (linha ${indice + 1})`}
                value={linha?.[coluna.campo] ?? ""}
                onChange={(e) => alterar(indice, coluna.campo, e.target.value)}
              />
            </label>
          ))}
          <Button variant="secondary" size="sm"
            type="button"
            disabled={linhas.length === 1 && !conflito}
            onClick={() => onChange(linhas.filter((_, i) => i !== indice))}
            aria-label={`Remover ${titular ? "titular" : "sócio"} ${indice + 1}`}
            className="onboarding-field-row__remove"
          >
            {titular ? "Remover titular" : "Remover sócio"}
          </Button>
        </div>
      ))}
      {!titular && <Button variant="secondary"
        type="button"
        onClick={() => onChange([...linhas, {}])}
        className="onboarding-field-row__add"
      >
        + Adicionar sócio
      </Button>}
    </div>
  );
}

function EnderecoAbertura({ valor, onChange, id, legado, acessibilidade }) {
  const v = valor && typeof valor === 'object' ? valor : {};
  const alterar = (campo, novo) => onChange({ ...v, [campo]: novo });
  return <div id={id} role="group" {...acessibilidade} style={{ display: 'grid', gap: 'var(--space-3)', minWidth: 0 }}>
    {legado && <p>Endereço informado anteriormente: {legado}</p>}
    {CAMPOS_ENDERECO.map(c => <div key={c.campo} style={{ minWidth: 0 }}>
      <label htmlFor={`${id}-${c.campo}`}>{c.rotulo}</label>
      {c.campo === 'uf' ? <select aria-invalid={acessibilidade?.['aria-invalid']} aria-describedby={acessibilidade?.['aria-describedby']} id={`${id}-${c.campo}`} style={INPUT_STYLE} value={v.uf || ''} onChange={e => alterar('uf', e.target.value)}><option value="">Selecione</option>{'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').map(uf => <option key={uf}>{uf}</option>)}</select>
      : <input aria-invalid={acessibilidade?.['aria-invalid']} id={`${id}-${c.campo}`} style={INPUT_STYLE} value={v[c.campo] || ''} aria-describedby={[acessibilidade?.['aria-describedby'], c.campo === 'inscricaoImobiliaria' && `${id}-iptu-ajuda`].filter(Boolean).join(' ') || undefined} disabled={c.campo === 'numero' && v.semNumero || c.campo === 'inscricaoImobiliaria' && v.iptuDesconhecido} onChange={e => alterar(c.campo, e.target.value)} />}
      {c.campo === 'numero' && <label style={{ display: 'flex', alignItems: 'center', minHeight: 44, gap: 'var(--space-2)' }}><input type="checkbox" checked={v.semNumero === true} onChange={e => alterar('semNumero', e.target.checked)} /> Sem número</label>}
      {c.campo === 'inscricaoImobiliaria' && <><p id={`${id}-iptu-ajuda`} className="onboarding-help">Informe o número de identificação do imóvel que aparece no carnê ou cadastro do IPTU. Não é o valor do imposto.</p><label style={{ display: 'flex', alignItems: 'center', minHeight: 44, gap: 'var(--space-2)' }}><input type="checkbox" checked={v.iptuDesconhecido === true} onChange={e => alterar('iptuDesconhecido', e.target.checked)} /> Não tenho essa informação agora</label></>}
    </div>)}
  </div>;
}

export function CampoOnboarding({
  descritor,
  dados,
  valor,
  erro,
  onChange,
  onAdequarPessoas,
  origemPreenchimento,
  mostrarSelo = false,
  acaoExtra = null,
  idPrefix = "onb",
}) {
  const id = `${idPrefix}-${descritor.campo}`;
  const comum = {
    id, style: INPUT_STYLE,
    "aria-invalid": erro ? "true" : undefined,
    "aria-describedby": [descritor.ajuda && `${id}-ajuda`, erro && `${id}-erro`].filter(Boolean).join(" ") || undefined,
  };

  const especial = respostaEspecial(valor) && permiteRespostaEspecial(descritor);
  if (especial) valor = "";
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
    case "textarea":
      controle = <textarea {...comum} rows={4} value={valor ?? ''} onChange={e => onChange(e.target.value)} />;
      break;
    case "endereco":
      controle = <EnderecoAbertura valor={valor} onChange={onChange} id={id} legado={dados?.enderecoPretendido} acessibilidade={{ 'aria-label': descritor.rotulo, 'aria-invalid': comum['aria-invalid'], 'aria-describedby': comum['aria-describedby'] }} />;
      break;
    case "lista":
      controle = <ListaDeLinhas descritor={descritor} dados={dados} valor={valor} onChange={onChange} onAdequarPessoas={onAdequarPessoas} id={id} acessibilidade={{ 'aria-label': descritor.rotulo, 'aria-invalid': comum['aria-invalid'], 'aria-describedby': comum['aria-describedby'] }} />;
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
          inputMode={descritor.tipo === "moeda" ? "decimal" : ["inteiro", "cnpj", "cpf", "telefone"].includes(descritor.tipo) ? "numeric" : undefined}
          value={valor ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div className="onboarding-field" style={{ marginBottom: "var(--space-4)", minWidth: 0 }}>
      <Rotulo
        descritor={descritor}
        dados={dados}
        htmlFor={id}
        mostrarSelo={mostrarSelo}
        origemPreenchimento={origemPreenchimento}
      />
      <div className="onboarding-field__control" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "flex-start" }}>
        <div className="onboarding-field__input" style={{ flex: "1 1 16rem", minWidth: 0 }}>
          {permiteRespostaEspecial(descritor) && <select aria-label={`Como responder: ${descritor.rotulo.toLowerCase()}`} value={especial ? (dados?.[descritor.campo] || "") : "VALOR"} onChange={e => onChange(e.target.value === "VALOR" ? "" : e.target.value)} style={{ ...INPUT_STYLE, marginBottom: 6 }}>
            <option value="VALOR">Informar resposta</option><option value="NAO_SEI">Não sei / preciso confirmar</option><option value="NAO_APLICAVEL">Não se aplica</option>
          </select>}
          {!especial && controle}
        </div>
        {acaoExtra && <div className="onboarding-field__action">{acaoExtra}</div>}
      </div>
      {descritor.ajuda && (
        <span id={`${id}-ajuda`} style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {descritor.ajuda}
        </span>
      )}
      {erro && <span id={`${id}-erro`} style={ERRO_STYLE}>{erro}</span>}
    </div>
  );
}

export default CampoOnboarding;
