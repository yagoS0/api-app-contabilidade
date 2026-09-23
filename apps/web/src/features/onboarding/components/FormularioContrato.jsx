import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { AbrirBiblioteca } from "./AbrirBiblioteca";
import { camposDoContrato, sugerirVariaveisContrato, problemasDosCamposContrato } from "../../../../../../packages/shared/src/onboarding/contratoComercialCampos.js";
import { motivoIncompatibilidadeContrato } from "../../../../../../packages/shared/src/onboarding/modeloContrato.js";

export function FormularioContrato({ onboarding, proposta, recursos, onGerar }) {
  const [edicoes, setEdicoes] = useState({}), [validou, setValidou] = useState(false);
  const raiz = useRef(null);
  const opcao = proposta.snapshot?.opcoes?.find(o => o.chave === proposta.opcaoAceita);
  const compativeis = recursos.filter(modelo => !motivoIncompatibilidadeContrato({ modelo, onboarding, opcao })).sort((a, b) => b.versao - a.versao);
  const recentes = compativeis.filter((m, index) => compativeis.findIndex(v => (v.chave || v.id) === (m.chave || m.id) && Boolean(v.aprovadoEm) === Boolean(m.aprovadoEm)) === index);
  const aprovados = recentes.filter(m => m.aprovadoEm);
  const automatico = aprovados.length === 1 ? aprovados[0] : recentes.length === 1 ? recentes[0] : null;
  const [selecao, setSelecao] = useState(() => automatico ? { id: automatico.id, versao: automatico.versao } : null);
  // A atualização da biblioteca não troca a versão que está sendo conferida.
  const escolhido = compativeis.find(m => m.id === selecao?.id && m.versao === selecao?.versao);
  const indisponivel = Boolean(selecao?.id && (!escolhido || selecao.indisponivel));
  const modelo = indisponivel ? null : escolhido;
  const modelos = escolhido && !recentes.some(m => m.id === escolhido.id) ? [escolhido, ...recentes] : recentes;
  useEffect(() => {
    if (selecao === null && automatico) setSelecao({ id: automatico.id, versao: automatico.versao });
    else if (selecao?.id && !escolhido && !selecao.indisponivel) setSelecao(s => ({ ...s, indisponivel: true }));
  }, [selecao, automatico, escolhido]);
  const institucional = recursos.filter(r => r.tipo === "INSTITUCIONAL" && r.chave === "escritorio" && r.aprovadoEm).sort((a, b) => b.versao - a.versao)[0];
  const contexto = { onboarding, proposta, modelo: modelo || {}, institucional: institucional || {}, variaveis: edicoes };
  const campos = camposDoContrato(contexto), valores = sugerirVariaveisContrato(contexto);
  const problemas = problemasDosCamposContrato(campos, valores);
  const grupos = [...new Set(campos.filter(c => !c.protegido).map(c => c.grupo))];
  const protegidos = campos.filter(c => c.protegido);
  function gerar() {
    setValidou(true);
    if (!modelo?.aprovadoEm) return;
    if (problemas.length) { raiz.current?.querySelector('[name="' + problemas[0].chave + '"]')?.focus(); return; }
    onGerar({ modeloId: modelo.id, variaveis: Object.fromEntries(campos.filter(c => !c.protegido).map(c => [c.chave, valores[c.chave]])) });
  }
  const previa = modelo?.texto.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, k) => {
    const valor = valores[k];
    if (valor == null || String(valor).trim() === "") return "— preencher —";
    return campos.find(c => c.chave === k)?.tipo === "date" ? String(valor).split("-").reverse().join("/") : String(valor);
  });
  return <section ref={raiz} className="commercial-contract-form" aria-label="Preenchimento do contrato">
    <p>Confira os dados preenchidos pela ficha e complete o que falta. Os valores e o escopo permanecem vinculados à proposta aceita.</p>
    {!onboarding.cnpj && onboarding.origem === "ABERTURA" && <p>A contratação inicial identifica a pessoa responsável pela abertura, com CPF e endereço próprio. O CNPJ definitivo será registrado na ficha quando a empresa for constituída.</p>}
    {indisponivel && <p role="alert">A versão do modelo que estava sendo preenchida não está mais disponível para esta contratação. Selecione explicitamente outro modelo e confira seus campos antes de gerar o contrato.</p>}
    {!modelos.length ? <p role="status">{!onboarding.cnpj ? "Falta um modelo próprio para abertura antes do CNPJ, na modalidade aceita." : opcao?.recorrente === false ? "Falta um modelo de serviço avulso compatível com esta solicitação." : "Falta um modelo de contabilidade mensal compatível com esta solicitação."} Revise e aprove a versão adequada na biblioteca. <AbrirBiblioteca /></p> : <label>Modelo do contrato<select value={modelo?.id || ""} onChange={e => { const m = compativeis.find(r => r.id === e.target.value); setSelecao({ id: m?.id || "", versao: m?.versao }); setEdicoes({}); setValidou(false); }}><option value="">Selecione o modelo</option>{modelos.map(m => <option key={m.id} value={m.id}>{m.titulo} · v{m.versao} · {m.aprovadoEm ? "Aprovado" : "Rascunho"}</option>)}</select></label>}
    {modelo && !modelo.aprovadoEm && <p role="status"><strong>Rascunho da biblioteca.</strong> Você pode preencher os dados e conferir a prévia. Revise e aprove o modelo na biblioteca para gerar contrato. <AbrirBiblioteca /></p>}
    {modelo && <>
      {grupos.map(grupo => <fieldset key={grupo}><legend>{grupo}</legend>{campos.filter(c => c.grupo === grupo && !c.protegido).map(c => {
        const problema = validou && problemas.find(p => p.chave === c.chave);
        const props = { name: c.chave, value: valores[c.chave] ?? "", required: true, maxLength: 10000, "aria-invalid": Boolean(problema), "aria-describedby": problema ? "contrato-erro-" + c.chave : undefined, onChange: e => setEdicoes(v => ({ ...v, [c.chave]: e.target.value })) };
        return <div key={c.chave}><label>{c.rotulo}{c.multiline ? <textarea {...props} rows={3} /> : <input {...props} type={c.tipo} min={c.min} max={c.max} inputMode={c.documento ? "numeric" : undefined} />}</label>{problema && <small id={"contrato-erro-" + c.chave}>{problema.mensagem}</small>}</div>;
      })}</fieldset>)}
      {!!protegidos.length && <section aria-label="Dados vinculados à proposta"><strong>Da proposta aceita e do cadastro</strong><dl>{protegidos.map(c => <div key={c.chave}><dt>{c.rotulo}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{valores[c.chave] === 0 ? "0" : valores[c.chave] || "Não informado na proposta"}</dd></div>)}</dl></section>}
      {validou && problemas.length > 0 && <p role="alert">Complete os campos indicados antes de gerar o contrato.{problemas.some(p => campos.find(c => c.chave === p.chave)?.protegido) && " Há dados ausentes na proposta aceita; confira a proposta antes de continuar."}</p>}
      <details><summary>Conferir prévia do texto</summary><pre>{previa}</pre></details>
    </>}
    <Button disabled={!modelo?.aprovadoEm} onClick={gerar}>Gerar contrato da opção aceita</Button>
  </section>;
}
