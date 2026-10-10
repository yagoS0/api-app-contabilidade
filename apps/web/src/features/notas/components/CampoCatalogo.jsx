import { CampoComBusca } from './CampoComBusca';
import { buscarCatalogo, itemDoCatalogo } from '../../../lib/nfse/buscaCatalogo';

// O texto da busca nunca é interpretado como decisão fiscal. O consumidor valida
// o código antes de salvar; a escolha na lista mantém o identificador canônico.
export function CampoCatalogo({ id, rotulo, valor, itens = [], onChange, required, disabled, ajuda, compacto = false }) {
  const escolhido = itemDoCatalogo(itens, valor);
  return <CampoComBusca id={id} rotulo={rotulo} valor={String(valor ?? '')}
    required={required} disabled={disabled}
    onChangeTexto={onChange} buscar={termo => buscarCatalogo(itens, termo)}
    chaveDoItem={item => item.codigo} rotuloDoItem={item => `${item.codigo} — ${item.descricao || 'Sem descrição na fonte'}`}
    detalheDoItem={item => item.detalhe || ''} onEscolher={item => onChange(item.codigo)}
    placeholder="Buscar por código ou descrição"
    textoVazio={itens.length ? 'Nenhum resultado. Tente outro código ou parte da descrição.' : 'Catálogo indisponível. Recarregue os dados para consultar.'}
    ajuda={escolhido ? `${compacto ? '' : `${escolhido.codigo} — `}${escolhido.descricao || 'Sem descrição na fonte'}` : ajuda || (compacto ? null : 'Digite com ou sem acentos e selecione uma sugestão.')}
  />;
}
