import { api } from '../../api';
import { AnaliseEmpresa } from '../../../../web/src/features/planejamento/components/AnaliseEmpresa';
import './relatorios-cliente.css';

export function PainelPage({ empresa, aoEnviarExtrato }) {
  return <div className="painel-page portal-relatorios">
    <header className="page-header"><h1>Início</h1>{aoEnviarExtrato&&<button type="button" className="btn" onClick={aoEnviarExtrato}>Enviar extrato</button>}</header>
    <AnaliseEmpresa key={empresa.companyId} api={api} empresaId={empresa.companyId} empresaNome={empresa.razao} empresaCnpj={empresa.cnpj} portalCliente />
  </div>;
}