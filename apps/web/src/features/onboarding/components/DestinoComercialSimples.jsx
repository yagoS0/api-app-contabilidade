import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { CanalDoAtendimento } from '../../whatsapp/components/CanalDoAtendimento';
import { canalComercialDaConversa } from '../../whatsapp/lib/identidadeAtendimento';

export function DestinoComercialSimples({ api, conversaId, contexto, disabled, onPreparado }) {
  const [conversa, setConversa] = useState(null), [erro, setErro] = useState(''), [confirmado, setConfirmado] = useState(false);
  const [revisao, setRevisao] = useState(0);
  useEffect(() => {
    let atual = true;
    setConversa(null); setErro(''); setConfirmado(false); onPreparado(null);
    if (!conversaId || !api.getMensagensWhatsapp) return () => { atual = false; };
    api.getMensagensWhatsapp(conversaId, { limite: 1, area: 'comercial' }).then(r => {
      if (!atual) return;
      if (!r?.conversa?.id) throw new Error('Não foi possível conferir o destinatário.');
      const canal = canalComercialDaConversa(r.conversa);
      if (!canal?.conversaId || canal.conversaId !== conversaId) throw new Error('O vínculo do atendimento mudou. Confira o contato antes de enviar.');
      setConversa(r.conversa);
    }).catch(e => { if (atual) setErro(e.message); });
    return () => { atual = false; };
  }, [api, conversaId, contexto, onPreparado, revisao]);
  const canal = conversa ? canalComercialDaConversa(conversa) : null;
  return <section aria-label="Destinatário dos documentos">
    {erro && <p role="alert">{erro}</p>}
    {!conversaId && <p role="status">Vincule um contato no acompanhamento para enviar documentos.</p>}
    {conversa && <><p>{conversa.contato?.nome || conversa.nomePerfilProvedor || 'Contato vinculado'}{conversa.telefone ? ` · ${conversa.telefone}` : ''}</p><CanalDoAtendimento conversa={conversa} canalId={canal?.id} disabled={disabled} />
      <Button variant="secondary" disabled={disabled || !canal || canal.podeResponder === false || canal.janela?.situacao !== 'ABERTA'} onClick={() => { setConfirmado(true); onPreparado({ contexto, conversaId: canal.conversaId, janela: canal.janela, podeResponder: canal.podeResponder }); }}>{confirmado ? 'Destinatário confirmado' : 'Usar este destinatário'}</Button></>}
    {conversaId && <Button variant="secondary" disabled={disabled} onClick={() => setRevisao(v => v + 1)}>Conferir canal atual</Button>}
  </section>;
}
