import { DADOS_ANALISE, conferenciasDaOrigem } from "../../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js";

export function DadosDaAnalise({ roteiro, onChange }) {
  return <><p>Registre o que o interessado informou. Campo vazio significa informação ainda não obtida; zero deve ser informado somente quando confirmado.</p><div className="lead-analysis-data">{DADOS_ANALISE.filter(c => !c.campoFicha).map(c => <label key={c.chave}>{c.rotulo}<input type={c.tipo === "texto" ? "text" : "number"} min={c.tipo === "texto" ? undefined : 0} step={c.tipo === "valor" ? "0.01" : c.tipo === "inteiro" ? "1" : undefined} maxLength={c.tipo === "texto" ? 500 : undefined} value={roteiro.dados[c.chave] ?? ""} onChange={e => onChange({ ...roteiro, dados: { ...roteiro.dados, [c.chave]: e.target.value === "" ? "" : c.tipo === "texto" ? e.target.value : Number(e.target.value) } })} /></label>)}</div></>;
}

export function ConferenciasDaAnalise({ roteiro, origem, onChange }) {
  const nomes = { PENDENTE: "Pendente", FEITO: "Conferido", NAO_APLICAVEL: "Não se aplica" };
  const mudar = (chave, valores) => onChange({ ...roteiro, conferencias: { ...roteiro.conferencias, [chave]: { ...roteiro.conferencias[chave], ...valores } } });
  return <><p>Consultas automáticas ajudam, mas não são obrigatórias. Registre documentos ou fontes usados. Uma pendência permanece visível na devolutiva e não vira confirmação de regularidade.</p>{conferenciasDaOrigem(origem).map(c => {
    const v = roteiro.conferencias[c.chave] || { estado: "PENDENTE", evidencia: "" };
    return <details key={c.chave} className="lead-analysis-check"><summary>{c.rotulo}<span>{nomes[v.estado]}</span></summary><label>{c.rotulo} — resultado<select value={v.estado} onChange={e => mudar(c.chave, { estado: e.target.value })}><option value="PENDENTE">Pendente</option><option value="FEITO">Conferido</option><option value="NAO_APLICAVEL">Não se aplica</option></select></label><label>{c.rotulo} — evidência ou motivo<textarea rows={2} maxLength={1200} value={v.evidencia || ""} onChange={e => mudar(c.chave, { evidencia: e.target.value })} placeholder="Fonte, data e leitura do contador; ou motivo da não aplicação." /></label>{c.chave === "comparativo" && <p>Registre os valores do cenário atual e da alternativa, as premissas e o Fator R quando aplicável. Não informe economia sem cálculo conferido.</p>}</details>;
  })}</>;
}
