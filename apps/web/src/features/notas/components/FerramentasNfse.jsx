import { useEffect, useState } from 'react';
import { ListaRecorrencias } from '@contabilidade/shared/nfse-recorrencias';
import { VerificadorNfse } from '../../reforma/VerificadorNfse';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import './ferramentas-nfse.css';

function AcaoRecorrencia(props) {
  return <Button variant="secondary" size="sm" {...props} />;
}

export function FerramentasNfse(props) {
  return <Ferramentas key={`${props.companyId}:${props.competencia}`} {...props} />;
}

function Ferramentas({ api, companyId, competencia, revisao, revisaoNotas, onAbrirNota }) {
  const [modal, setModal] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [indicadores, setIndicadores] = useState({});
  useEffect(() => {
    if (modal || !companyId) return;
    let ativo = true;
    setIndicadores({});
    const gravar = (chave, valor) => { if (ativo) setIndicadores(atual => ({ ...atual, [chave]: valor })); };
    if (api?.listarRecorrenciasNfse) Promise.resolve().then(() => api.listarRecorrenciasNfse(companyId))
      .then(r => { if (!Array.isArray(r?.items)) throw new Error(); gravar('recorrencias', { quantidade: r.items.length }); })
      .catch(() => gravar('recorrencias', { aviso: 'Não foi possível carregar as recorrências. Abra para tentar novamente.' }));
    if (competencia && api?.getVerificacaoNfse) Promise.resolve().then(() => api.getVerificacaoNfse(companyId, competencia))
      .then(r => {
        if (!r?.ok || !Object.hasOwn(r, 'verificacao')) throw new Error();
        const quantidade = (r.verificacao?.itens || []).filter(i => ['ERRO', 'REVISAO', 'ALERTA'].includes(i.status)).length;
        gravar('conformidade', { quantidade, aviso: r.desatualizada ? 'Conferência desatualizada' : r.verificacao?.resumo?.parcial ? 'Conferência parcial' : null });
      }).catch(() => gravar('conformidade', { aviso: 'Não foi possível carregar a conferência. Abra para tentar novamente.' }));
    return () => { ativo = false; };
  }, [api, companyId, competencia, revisao, revisaoNotas, modal]);
  const marcador = (chave, descricao) => {
    const valor = indicadores[chave];
    return <>{valor?.quantidade > 0 && <span className="notas-ferramentas-contador" aria-label={`${valor.quantidade} ${descricao}`}>{valor.quantidade}</span>}
      {valor?.aviso && <span className="notas-ferramentas-alerta" aria-label={valor.aviso} title={valor.aviso}>!</span>}</>;
  };
  const fechar = () => { if (!ocupado) setModal(null); };
  return <>
    <section className="notas-ferramentas" aria-label="Ferramentas de NFS-e">
      <Button variant="secondary" aria-haspopup="dialog" onClick={() => setModal('recorrencias')}>Notas recorrentes{marcador('recorrencias', 'recorrências cadastradas')}</Button>
      <Button variant="secondary" aria-haspopup="dialog" onClick={() => setModal('conformidade')}>Verificar conformidade{marcador('conformidade', 'notas com apontamentos na conferência salva')}</Button>
    </section>
    {modal && <Modal titulo={modal === 'recorrencias' ? 'Notas recorrentes' : `Conformidade de NFS-e · ${competencia || 'sem competência'}`}
      tamanho={modal === 'recorrencias' ? 'md' : 'lg'} className="notas-ferramentas-modal" ocupado={ocupado} aoFechar={fechar}
      rodape={<Button variant="secondary" disabled={ocupado} onClick={fechar}>Concluir</Button>}>
      {modal === 'recorrencias'
        ? <ListaRecorrencias api={api} companyId={companyId} revisao={revisao} embutida
          className="notas-recorrencias-conteudo" style={{ margin: 0 }} ActionButton={AcaoRecorrencia} onOcupado={setOcupado} />
        : <VerificadorNfse api={api} companyId={companyId} competencia={competencia} embutido
          className="notas-conformidade-conteudo" onOcupado={setOcupado}
          onAbrirNota={onAbrirNota ? id => { setModal(null); onAbrirNota(id); } : undefined} />}
    </Modal>}
  </>;
}
