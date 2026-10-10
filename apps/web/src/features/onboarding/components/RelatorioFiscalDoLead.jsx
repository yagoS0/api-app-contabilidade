import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

export function RelatorioFiscalDoLead({ api, onboarding, conversaId, onAtualizar }) {
  const contexto = JSON.stringify([onboarding.id, onboarding.cnpj, onboarding.versao, conversaId]);
  const atual = useRef(contexto), trava = useRef(false), vivo = useRef(true), leitura = useRef(0);
  atual.current = contexto;
  const [base, setBase] = useState(null), [aberto, setAberto] = useState(null), [envioLocal, setEnvioLocal] = useState(null);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const valido = chave => vivo.current && atual.current === chave;
  async function carregar(chave = contexto) {
    const versao = ++leitura.current;
    const dados = await api.comercial(`/onboardings/${onboarding.id}/fiscal`);
    if (valido(chave) && versao === leitura.current) setBase({ contexto: chave, dados });
    return dados;
  }
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    setErro("");
    carregar().catch(e => { if (valido(contexto)) setErro(e.message); });
  }, [api, contexto, onboarding]);
  const dados = base?.contexto === contexto ? base.dados : null;
  const ultimo = (dados?.relatorios || []).filter(r => r.cnpj === onboarding.cnpj).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const relatorio = ultimo?.status === 'CONCLUIDA' && ultimo.tabelaDisponivel ? ultimo : null;
  const chave = relatorio ? `${contexto}:${relatorio.id}:${relatorio.conteudoHash}` : null;
  const envio = envioLocal?.chave === chave ? envioLocal : relatorio?.envio;
  const bloqueado = ['ENVIADO','INCERTO','ENVIANDO'].includes(envio?.estado);
  async function executar(fn) {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try { await fn(contexto); } catch (e) { if (valido(contexto)) setErro(e.message); }
    finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  return <section className="lead-fiscal-report" aria-label="Revisão e envio do relatório fiscal">
    {erro && <p role="alert">{erro}</p>}
    {dados?.bloqueio?.mensagem && <p role="status">{dados.bloqueio.mensagem}</p>}
    {relatorio && <>
      <h4>Relatório para o cliente</h4>
      <p>Confira a tabela, confirme a revisão e envie pelo atendimento.</p>
      <div className="lead-report-actions">
      <Button variant="secondary" disabled={ocupado || !api.baixarTabelaFiscalLead || !relatorio.conteudoHash} onClick={() => executar(async captura => {
        const blob = await api.baixarTabelaFiscalLead(onboarding.id, relatorio.id, relatorio.conteudoHash);
        if (!valido(captura)) return;
        const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
        setAberto(chave);
      })}>Abrir PDF em tabela</Button>
      {!relatorio.revisadoEm && <Button disabled={ocupado || aberto !== chave || bloqueado} onClick={() => executar(async captura => {
        await api.comercial(`/onboardings/${onboarding.id}/fiscal/${relatorio.id}/revisao`, { versao: onboarding.versao, conteudoHash: relatorio.conteudoHash });
        if (valido(captura)) { await carregar(captura); await onAtualizar?.({ manterFiscal: true }); }
      })}>Confirmar revisão do relatório</Button>}
      <Button disabled={ocupado || !relatorio.revisadoEm || !conversaId || bloqueado} onClick={() => executar(async captura => {
        try {
          const resposta = await api.comercial(`/onboardings/${onboarding.id}/fiscal/${relatorio.id}/enviar`, { conversaId });
          if (!valido(captura)) return;
          const estado = resposta.envio?.estado || resposta.estado || (resposta.jaEnviado ? 'ENVIADO' : 'INCERTO');
          setEnvioLocal({ chave, estado });
        } catch (e) {
          if (valido(captura) && (!e.status || e.status >= 500)) setEnvioLocal({ chave, estado:'INCERTO' });
          throw e;
        }
        if (valido(captura)) { await carregar(captura); await onAtualizar?.(); }
      })}>Enviar relatório revisado</Button>
      </div>
      {relatorio.revisadoEm && <p role="status">Relatório revisado.</p>}
      {!conversaId && <p>Abra a conversa comercial para enviar o relatório.</p>}
      {envio?.estado === 'ENVIADO' && <p role="status">Relatório enviado. Continue com a proposta e os valores.</p>}
      {['INCERTO','ENVIANDO'].includes(envio?.estado) && <p role="status">Confira o histórico antes de qualquer novo envio.</p>}
    </>}
    <ConsumoDoAtendimento consumo={dados?.consumo} />
  </section>;
}

function ConsumoDoAtendimento({ consumo }) {
  if (!consumo) return null;
  const usd = v => v > 0 && v < 0.00000001 ? 'menos de US$0.00000001' : `US${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:8}).format(v)}`;
  const gpt = consumo.gpt, serpro = consumo.serpro;
  return <details><summary>Consumo deste atendimento</summary>
    <p>{gpt?.disponivel && typeof gpt.custoUsd === 'number' ? `GPT: ${usd(gpt.custoUsd)} (estimado pelos tokens).` : 'Consumo GPT indisponível.'}</p>
    {gpt?.reservaUsd > 0 && <p>Reserva de consumo incerto: {usd(gpt.reservaUsd)}.</p>}
    {serpro && <><p>Consultas fiscais: {serpro.concluidas || 0} concluídas · {serpro.pendentes || 0} pendentes · {serpro.erros || 0} com erro.</p><p>Valor SERPRO a conciliar.</p></>}
  </details>;
}
