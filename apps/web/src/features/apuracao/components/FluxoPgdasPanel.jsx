import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { PANEL } from '../../notas/components/notasStyles.shared.js';
import { entregaPgdasDoFechamento, CORES_TOM } from '../lib/entregaPgdas';

export function rotuloDocumentoPgdas(documento) {
  if (documento?.estado === 'DISPONIVEL') return 'disponível';
  if (documento?.estado === 'NAO_DEVIDO') return 'sem valor a recolher comprovado';
  if (documento?.estado === 'ERRO') return 'consulta falhou';
  return 'obtenção pendente';
}

// Somente apresenta fatos do servidor. A afirmação manual não é evidência oficial.
export function FluxoPgdasPanel({ api, dados, companyId, competencia, razao, onChanged, ocupado = false }) {
  const [confirmando, setConfirmando] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const operacao = useRef(false);
  const contexto = `${companyId}:${competencia}`;
  const atual = useRef(contexto);
  const geracao = useRef(0);
  atual.current = contexto;
  useEffect(() => {
    atual.current = contexto;
    operacao.current = false;
    setSalvando(false);
    setConfirmando(false);
    return () => { geracao.current++; atual.current = null; };
  }, [contexto, api]);
  const entrega = entregaPgdasDoFechamento(dados);
  const cores = CORES_TOM[entrega.tom];
  const fluxo = dados?.fluxoPgdas;
  const guia = fluxo?.documentos?.guia;
  const extrato = fluxo?.documentos?.extrato;
  const incerto = ['transmitindo', 'erro_transmissao'].includes(dados?.estado)
    || fluxo?.transmissao?.tentativaLocalIncerta === true
    || ['RESULTADO_INCERTO', 'INCERTA', 'EM_PROCESSAMENTO'].includes(fluxo?.transmissao?.estado);
  async function registrar() {
    if (operacao.current || ocupado || incerto) return;
    operacao.current = true; setSalvando(true); setErro(null);
    const versao = geracao.current;
    const vigente = () => atual.current === contexto && geracao.current === versao;
    try {
      const r = await api.registrarEntregaPgdasExterna(companyId, competencia, {
        entregue: true, confirmCompetencia: competencia, observacao,
      });
      if (!vigente()) return;
      if (r?.ok !== true) throw new Error(r?.message || 'Não foi possível confirmar o registro. Recarregue antes de tentar novamente.');
      setConfirmando(false); setObservacao('');
      await onChanged?.();
    } catch (e) { if (vigente()) setErro(e.message || 'Registro indisponível.'); }
    finally { if (vigente()) { operacao.current = false; setSalvando(false); } }
  }
  async function abrirDas() {
    if (operacao.current || !guia?.guideId) return;
    operacao.current = true; setSalvando(true); setErro(null);
    const versao = geracao.current;
    const vigente = () => atual.current === contexto && geracao.current === versao;
    try {
      const blob = await api.fetchGuidePdfBlob(companyId, guia.guideId);
      if (!vigente()) return;
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (vigente()) setErro(e.message || 'DAS indisponível no armazenamento.'); }
    finally { if (vigente()) { operacao.current = false; setSalvando(false); } }
  }
  return <section aria-label="Situação fiscal e documentos" style={{ display: 'grid', gap: 10, minWidth: 0, overflowWrap: 'anywhere' }}>
    <div style={{ padding: 12, background: cores.fundo, border: `1px solid ${cores.cor}`, borderRadius: 8 }}>
      <strong style={{ color: cores.cor }}>{entrega.rotulo}</strong>
      <p style={{ margin: '6px 0 0', color: PANEL.muted }}>{entrega.detalhe}</p>
    </div>
    {incerto && entrega.provada && <p role="alert" style={{ color: 'var(--state-warn)', margin: 0 }}>Há uma tentativa local com resultado incerto. A declaração localizada não comprova o resultado dessa tentativa nem autoriza retransmissão. Confira o recibo e a revisão antes de prosseguir.</p>}
    {fluxo && <div role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <span>DAS: {rotuloDocumentoPgdas(guia)}</span>
      <span>Extrato: {rotuloDocumentoPgdas(extrato)}</span>
      <span>Pagamento: {fluxo.pagamento?.estado === 'PAGO_REGISTRADO' ? 'pago registrado' : 'não confirmado'}</span>
    </div>}
    {erro && <p role="alert" style={{ color: 'var(--state-danger)', margin: 0 }}>{erro}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {guia?.estado === 'DISPONIVEL' && guia.guideId && <Button variant="secondary" onClick={abrirDas} disabled={salvando || ocupado}>DAS (PDF)</Button>}
      {!entrega.provada && !dados?.entregaPgdas?.declaradaForaEm && <Button variant="secondary" disabled={ocupado || salvando || incerto || !api?.registrarEntregaPgdasExterna} onClick={() => { setErro(null); setConfirmando(true); }}>Registrar apuração realizada fora da Altan</Button>}
    </div>
    {confirmando && <Modal titulo="Registrar apuração externa" tamanho="sm" ocupado={salvando} aoFechar={() => setConfirmando(false)} rodape={<><Button variant="secondary" disabled={salvando} onClick={() => setConfirmando(false)}>Cancelar</Button><Button disabled={salvando || ocupado || incerto} onClick={registrar}>{salvando ? 'Registrando…' : 'Confirmar registro externo'}</Button></>}>
      <p><strong>{razao || 'Empresa'}</strong> · {competencia}</p>
      <p>Você informa que esta apuração foi realizada fora da Altan. O registro não comprova a entrega, não transmite, não modifica os valores calculados e não confirma pagamento.</p>
      <p>Depois, consulte a Receita explicitamente para obter a comprovação e os documentos.</p>
      <label style={{ display: 'grid', gap: 6 }}>Observação (opcional)<textarea style={{ width: '100%', boxSizing: 'border-box', background: PANEL.field, color: PANEL.text, border: `1px solid ${PANEL.border}`, borderRadius: 6, padding: 8 }} rows={3} maxLength={2000} disabled={salvando} value={observacao} onChange={e => setObservacao(e.target.value)} /></label>
      {erro && <p role="alert">{erro}</p>}
    </Modal>}
  </section>;
}
