import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { ChatDaEmpresa } from '../whatsapp/components/ChatDaEmpresa';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

export function OperationsProcuracao({ api, company, onClose }) {
  const name = company.razao || company.razaoSocial || company.nome || company.cnpj;
  return <Modal titulo={`Pedir procuração · ${name}`} tamanho="lg" className="operacoes-dialogo" aoFechar={onClose}>
    <p>Escolha o contato da empresa e confira o canal. Preparar o texto não envia mensagem nem altera o atendimento.</p>
    <ChatDaEmpresa api={api} companyId={company.companyId} selecionarContato sugestao={`Olá! Precisamos da procuração da empresa ${name} para dar continuidade às rotinas. Poderia providenciá-la, por favor?`} />
    <InternalLink className="btn btn-secondary btn-sm" href={companyTabPath(company.companyId, 'comunicacao')}>Conferir cadastro dos contatos</InternalLink>
  </Modal>;
}
