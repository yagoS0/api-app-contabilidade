import { useRef, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { CAMPOS_VALOR, FONTES_MANUAIS, validarPendenciaManual } from '@contabilidade/shared/pendencias-manuais';

export function PendenciaManualModal({ item, fonte = 'MUNICIPAL', salvar, aoFechar }) {
  const [dados, setDados] = useState(() => {
    const hoje = new Date();
    const data = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
    const d = item?.dados || { fonte, tipo: 'DEBITO', estado: 'ABERTO', tributo: fonte === 'MUNICIPAL' ? 'ISS' : '', dataReferencia: data, competencia: '', vencimento: '', observacoes: '' };
    return { ...d, ...Object.fromEntries(Object.keys(CAMPOS_VALOR).map(k => [k, d[k] == null ? '' : (d[k] / 100).toFixed(2).replace('.', ',')])) };
  });
  const id = useRef(item?.id || crypto.randomUUID());
  const lock = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const mudar = e => setDados(d => ({ ...d, [e.target.name]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    if (lock.current) return;
    setErro('');
    try {
      validarPendenciaManual(dados);
      lock.current = true; setOcupado(true);
      await salvar({ id: id.current, ...(item ? { versao: item.versao } : {}), dados });
      aoFechar();
    } catch (err) { setErro(err.reason || err.message || 'Não foi possível salvar.'); }
    finally { lock.current = false; setOcupado(false); }
  }
  return <Modal titulo={`${item ? 'Editar pendência' : 'Nova pendência'} · ${FONTES_MANUAIS[dados.fonte]}`} aoFechar={aoFechar} ocupado={ocupado} fecharAoClicarFundo={false}
    rodape={<><Button variant="secondary" disabled={ocupado} onClick={aoFechar}>Cancelar</Button><Button type="submit" form="pendencia-manual" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar pendência'}</Button></>}>
    <form id="pendencia-manual" onSubmit={submit} className="pf-form"><fieldset disabled={ocupado}>
      <label>Valor (R$)<input name="total" value={dados.total} onChange={mudar} inputMode="decimal" placeholder="0,00" /></label>
      <label>Competência<input name="competencia" value={dados.competencia || ''} onChange={mudar} maxLength={7} placeholder="MM/AAAA" /></label>
      <label>Imposto<input name="tributo" value={dados.tributo || ''} onChange={mudar} required maxLength={120} placeholder="Ex.: ISS" /></label>
      <label>Vencimento<input name="vencimento" value={dados.vencimento || ''} onChange={mudar} onInput={mudar} type="date" /></label>
      <label className="pf-form-wide">Descrição<textarea name="observacoes" value={dados.observacoes || ''} onChange={mudar} maxLength={2000} rows={3} /></label>
    </fieldset>{erro && <p role="alert" className="feedback error">{erro}</p>}</form>
  </Modal>;
}
