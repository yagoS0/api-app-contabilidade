import { Children, Fragment, isValidElement, useId, useState } from "react";

function expandir(children) {
  return Children.toArray(children).flatMap(child => isValidElement(child) && child.type === Fragment ? expandir(child.props.children) : [child]);
}

// As ações permanecem montadas ao trocar de guia, preservando os campos digitados.
export function AcoesDaEtapa({ children, tituloPrincipal = "Ação da etapa", preferirAlternativa = false }) {
  const id = useId(), itens = expandir(children), principais = [], alternativas = [];
  for (const item of itens) {
    if (isValidElement(item) && item.type === "details") {
      const conteudo = Children.toArray(item.props.children);
      const titulo = conteudo.find(c => isValidElement(c) && c.type === "summary")?.props.children;
      alternativas.push({ titulo: titulo || "Outra ação", conteudo: conteudo.filter(c => !isValidElement(c) || c.type !== "summary") });
    } else principais.push(item);
  }
  const abas = [...(principais.length ? [{ titulo: tituloPrincipal, conteudo: principais }] : []), ...alternativas];
  const [selecionada, setSelecionada] = useState(preferirAlternativa && principais.length && alternativas.length ? 1 : 0);
  const atual = Math.min(selecionada, abas.length - 1);
  if (abas.length <= 1) return <div className="lead-stage-action">{abas[0]?.conteudo}</div>;
  return <div className="lead-stage-action"><div className="lead-action-tabs" role="tablist" aria-label="Ações desta etapa">{abas.map((aba, i) => <button key={i} id={`${id}-aba-${i}`} role="tab" type="button" aria-selected={atual === i} aria-controls={`${id}-painel-${i}`} tabIndex={atual === i ? 0 : -1} onClick={() => setSelecionada(i)} onKeyDown={e => {
    const proxima = e.key === "ArrowRight" ? (i + 1) % abas.length : e.key === "ArrowLeft" ? (i + abas.length - 1) % abas.length : e.key === "Home" ? 0 : e.key === "End" ? abas.length - 1 : null;
    if (proxima !== null) { e.preventDefault(); setSelecionada(proxima); document.getElementById(`${id}-aba-${proxima}`)?.focus(); }
  }}>{aba.titulo}</button>)}</div>{abas.map((aba, i) => <div key={i} id={`${id}-painel-${i}`} role="tabpanel" aria-labelledby={`${id}-aba-${i}`} hidden={atual !== i}>{aba.conteudo}</div>)}</div>;
}
