import {useCallback,useState} from 'react';
import {Modal} from '../../../../components/ui/Modal';
import {Button} from '../../../../components/ui/Button';
import {DividasCircular} from './DividasCircular';
import {resumoOrigensParcelamento} from '../../../../../../../packages/shared/src/accounting/composicaoParcelamento.js';
export function ComposicaoParcelamentoModal({acordo,listar,salvar,onClose}){
 const [selecionadas,setSelecionadas]=useState([]),[erro,setErro]=useState(''),[busy,setBusy]=useState(false);
 const existentes=acordo.debitosOrigem || [];
 const listarDoAcordo=useCallback(tipo=>listar(tipo,acordo.id),[listar,acordo.id]);
 async function gravar(){setBusy(true);setErro('');try{const r=await salvar(acordo.id,selecionadas);if(r?.ok===false)throw new Error(r.message || 'Não foi possível vincular.');onClose();}catch(e){setErro(e.message);}finally{setBusy(false);}}
 return <Modal tamanho="lg" fecharAoClicarFundo={false} titulo={'Dívidas incluídas — '+(acordo.numeroParcelamento || acordo.label)} aoFechar={onClose} ocupado={busy} rodape={<><Button variant="secondary" onClick={onClose} disabled={busy}>Fechar</Button>{!existentes.length&&<Button disabled={busy||!selecionadas.length||acordo.status!=='ATIVO'} onClick={gravar}>Confirmar composição</Button>}</>}>
 {existentes.length?<><p>{resumoOrigensParcelamento(existentes)}</p><table style={{width:'100%',minWidth:0}}><thead><tr><th>Imposto</th><th>Competência</th><th>Principal incluído</th></tr></thead><tbody>{existentes.map(o=><tr key={o.id}><td>{o.tributo}</td><td>{o.competencia}</td><td>{Number(o.principalIncluido).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</td></tr>)}</tbody></table><p>Origem: Contabilidade · {acordo.status==='ATIVO'?'Parcelado':acordo.status==='QUITADO'?'Quitado no acordo':'A conciliar'}</p></>:<><p>Confira o principal e as contas da abertura do acordo. A vinculação preserva os lançamentos originais e será recusada se a reclassificação não conferir.</p><DividasCircular disabled={busy || acordo.status!=='ATIVO'} listar={listarDoAcordo} tipo={acordo.tipo} selecionadas={selecionadas} onSelecionar={setSelecionadas}/></>}
 {erro&&<p role="alert">{erro}</p>}
 </Modal>;
}
