import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CampoOnboarding } from "./CampoOnboarding";
import { camposDaOrigem } from "../lib/onboardingSpec";

export function ProgressoDoLead({ jornada, selecionado, onSelecionar, ocupado }) {
  const nomes = { cadastro: "Dados iniciais", publica: "CNPJ", autorizacao: "Procuração", fiscal: "Situação fiscal", diagnostico: "Diagnóstico", devolutiva: "Apresentação", proposta: "Proposta", contrato: "Contrato", pagamento: "Pagamento", conclusao: "Ficha e documentos" };
  return <nav className="lead-steps" aria-label="Passo a passo do lead"><ol>{jornada.passos.map((p, i) => <li key={p.id} data-status={p.concluido ? "concluido" : p.id === jornada.atual ? "atual" : "pendente"}>
    <button type="button" title={p.titulo} aria-label={`${i + 1}. ${p.titulo}`} disabled={ocupado || !p.acessivel} aria-current={p.id === jornada.atual ? "step" : undefined} aria-pressed={p.id === selecionado} onClick={() => onSelecionar(p.id)}>
      <span className="lead-step-number" aria-hidden="true">{p.concluido ? "✓" : i + 1}</span><span>{nomes[p.id] || p.titulo}<small>{p.concluido ? "Concluído" : p.anterior ? "Registro anterior" : p.id === jornada.atual ? "Você está aqui" : "A seguir"}</small></span>
    </button></li>)}</ol></nav>;
}

export function CamposDaEtapa({ onboarding, campos, onSalvar, ocupado, sempreAberto = false }) {
  const [aberto, setAberto] = useState(sempreAberto), [iniciado, setIniciado] = useState(sempreAberto);
  const [rascunho, setRascunho] = useState({}), versaoEdicao = useRef(null);
  const descritores = camposDaOrigem(onboarding.origem).filter(d => campos.includes(d.campo)).sort((a,b) => campos.indexOf(a.campo) - campos.indexOf(b.campo));
  const dados = { ...onboarding.dados, ...rascunho };
  return <>
    {!aberto && <Button variant="secondary" disabled={ocupado} aria-expanded={false} onClick={() => { setIniciado(true); setAberto(true); }}>Conferir ou preencher dados deste passo</Button>}
    {iniciado && <fieldset hidden={!aberto} disabled={ocupado} className="lead-step-fields"><legend>Dados deste passo</legend>{descritores.map(d => <CampoOnboarding key={d.campo} idPrefix="jornada" descritor={d} dados={dados} valor={dados[d.campo] ?? ""} onChange={v => {
    if (versaoEdicao.current === null) versaoEdicao.current = onboarding.versao;
    setRascunho(atual => ({ ...atual, [d.campo]: v }));
  }} />)}
    {versaoEdicao.current !== null && versaoEdicao.current !== onboarding.versao && <p role="alert">A ficha foi atualizada enquanto você preenchia. Seus campos estão preservados; confira a versão atual antes de salvar.</p>}
    <Button disabled={!Object.keys(rascunho).length} onClick={async () => {
      const operacoes = Object.entries(rascunho).map(([campo, valor]) => { const d = descritores.find(x => x.campo === campo); return { campo, acao: valor === "" || valor == null ? "unset" : "set", valor: ["inteiro", "moeda"].includes(d.tipo) && valor !== "" ? Number(String(valor).replace(",", ".")) : valor }; });
      if (await onSalvar({ versao: versaoEdicao.current, operacoes })) { setRascunho({}); versaoEdicao.current = null; setAberto(sempreAberto); }
    }}>Salvar dados deste passo</Button>
    {!sempreAberto && <Button variant="secondary" onClick={() => setAberto(false)}>Recolher dados</Button>}
    {versaoEdicao.current !== null && versaoEdicao.current !== onboarding.versao && <Button variant="secondary" onClick={() => { setRascunho({}); versaoEdicao.current = null; }}>Descartar rascunho e carregar dados atuais</Button>}
  </fieldset>}</>;
}

export function DiagnosticoDoLead({ jornada, onboarding, onSalvar, ocupado, limitado = false, sempreAberto = false }) {
  const [aberto, setAberto] = useState(sempreAberto), [iniciado, setIniciado] = useState(sempreAberto);
  const anteriorDesatualizado = !jornada?.diagnostico && Boolean(jornada?.diagnosticoAnterior);
  const anterior = jornada?.diagnostico?.dados || jornada?.diagnosticoAnterior;
  const [dispensaConsultaPrivada, setDispensaConsultaPrivada] = useState(anterior?.dispensaConsultaPrivada || "");
  const [achados, setAchados] = useState(anterior?.achados || ""), [servicos, setServicos] = useState(anterior?.servicos || "");
  const fiscal = jornada?.analises?.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
  const contexto = JSON.stringify([onboarding.id, onboarding.versao, onboarding.cnpj, fiscal?.id]);
  const [base, setBase] = useState(anteriorDesatualizado ? null : contexto);
  const temTexto = Boolean(achados.trim() || servicos.trim() || dispensaConsultaPrivada.trim());
  useEffect(() => { if (!temTexto) setBase(contexto); }, [contexto, temTexto]);
  const mudou = temTexto && base !== contexto;
  return <>
    {!aberto && <Button disabled={ocupado} aria-expanded={false} onClick={() => { setIniciado(true); setAberto(true); }}>Preparar diagnóstico e escopo</Button>}
    {iniciado && <fieldset hidden={!aberto} disabled={ocupado} className="lead-step-fields"><legend>Conferência do contador</legend>
    <label>{onboarding.origem === "ABERTURA" ? "Análise da atividade, endereço e condições de viabilidade" : "Pendências e situação encontradas"}<textarea maxLength={1200} rows={4} value={achados} onChange={e => setAchados(e.target.value)} /></label>
    <label>Serviços necessários e escopo<textarea maxLength={1200} rows={4} value={servicos} onChange={e => setServicos(e.target.value)} placeholder="Descreva os serviços avulsos e o acompanhamento mensal, quando houver." /></label>
    {limitado && <label>Limitação do serviço e motivo para dispensar a consulta privada<textarea rows={3} maxLength={1200} value={dispensaConsultaPrivada} onChange={e => setDispensaConsultaPrivada(e.target.value)} /><small>A limitação aparecerá na proposta. Esta opção não registra procuração nem consulta fiscal realizada.</small></label>}
    <p>Esses textos serão apresentados ao lead na próxima etapa. Registre apenas o que foi conferido e deixe claras as condições pendentes.</p>
    {mudou && <><p role="alert">{anteriorDesatualizado ? "O diagnóstico anterior foi recuperado como rascunho. Confira os dados atuais antes de confirmar." : "A ficha ou o relatório mudou. O texto foi preservado; confira os dados atuais antes de confirmar."}</p><Button variant="secondary" onClick={() => setBase(contexto)}>Conferi os dados atualizados: manter meu texto</Button></>}
    <Button disabled={mudou || achados.trim().length < 10 || servicos.trim().length < 10 || (limitado && dispensaConsultaPrivada.trim().length < 20)} onClick={() => onSalvar({ versao: onboarding.versao, analiseId: limitado ? null : fiscal?.id || null, achados, servicos, ...(limitado ? { dispensaConsultaPrivada } : {}) })}>Confirmar diagnóstico e continuar</Button>
    {!sempreAberto && <Button variant="secondary" onClick={() => setAberto(false)}>Recolher diagnóstico</Button>}
  </fieldset>}</>;
}

// Prévia local antes de qualquer mensagem. Erro de rede não provoca reenvio automático.
export function MensagemDoPasso({ api, conversaId, preparar, rotulo, onEnviado, disabled, enviado = false }) {
  const [enviada, setEnviada] = useState(enviado);
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [incerto, setIncerto] = useState(false);
  const destinoMudou = Boolean(previa && previa.conversaId !== conversaId);
  const trava = useRef(false);
  async function executar(fn) { if (trava.current) return; trava.current = true; setOcupado(true); setErro(""); try { await fn(); } catch (e) { setErro(e.message); } finally { trava.current = false; setOcupado(false); } }
  if (enviada) return <div className="lead-step-sent"><p role="status">Mensagem enviada.</p><Button variant="secondary" disabled={disabled || ocupado} onClick={() => setEnviada(false)}>Preparar novamente</Button></div>;
  return <div className="lead-step-message">{!previa && <Button variant="secondary" disabled={disabled || ocupado || !conversaId || incerto} onClick={() => executar(async () => setPrevia({ ...await preparar(), conversaId }))}>{rotulo}</Button>}
    {!conversaId && <p>Abra o atendimento na conversa do WhatsApp para enviar esta mensagem.</p>}
    {destinoMudou && <p role="alert">O canal de envio mudou. Cancele esta prévia e prepare a mensagem novamente para o destino atual.</p>}
    {previa && <><p className="lead-preview-caption">Confira a mensagem antes de enviar</p><p className="lead-message-preview">{previa.texto}</p><Button disabled={disabled || ocupado || incerto || destinoMudou} onClick={() => executar(async () => {
      if (destinoMudou) return;
      try { await api.enviarOrientacaoWhatsapp(conversaId, previa.orientacaoId ? { orientacaoId: previa.orientacaoId, variaveis: previa.variaveis, assumir: true } : { texto: previa.texto, assumir: true }); }
      catch (e) { if (!e.status || e.status >= 500 || e.payload?.podeTentarDeNovo === false) setIncerto(true); throw e; }
      setPrevia(null); setEnviada(true); await onEnviado?.();
    })}>Conferi: enviar mensagem</Button><Button variant="secondary" disabled={ocupado || incerto} onClick={() => setPrevia(null)}>Cancelar prévia</Button></>}
    {erro && <p role="alert">{erro}</p>}{incerto && <p>Confira o histórico: não foi possível confirmar o resultado do envio.</p>}
  </div>;
}

export function OrientacaoDoPasso({ api, recursos, chaves, onboarding, conversaId, onEnviado, disabled, enviado }) {
  const r = recursos.filter(r => r.tipo === "ORIENTACAO" && r.aprovadoEm && chaves.includes(r.chave)).sort((a,b) => chaves.indexOf(a.chave) - chaves.indexOf(b.chave) || b.versao - a.versao)[0];
  if (!r) return <p role="status">A orientação desta etapa ainda não foi aprovada. Abra Biblioteca e dados de apoio, carregue os modelos e confira os dados institucionais antes de aprovar.</p>;
  return <MensagemDoPasso key={`${r.id}:${onboarding.cnpj || ""}`} api={api} conversaId={conversaId} enviado={enviado} disabled={disabled} onEnviado={onEnviado} rotulo={`Preparar orientação: ${r.titulo}`} preparar={async () => {
    const variaveis = { nome: onboarding.responsavelNome || onboarding.dados?.responsavelNome || "", cnpj: onboarding.cnpj || "", servico: "atendimento contábil" };
    const p = await api.comercial(`/recursos/${r.id}/previa`, { variaveis }); return { texto: p.previa.texto, orientacaoId: r.id, variaveis };
  }} />;
}
