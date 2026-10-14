import { render, screen, fireEvent } from '@testing-library/react';
import { BatchProgressModal } from '../BatchProgressModal';
import { FechamentoModal } from '../FechamentoModal';
it('acompanhamento tem progresso acessível e saída sem nova transmissão',async()=>{const onClose=jest.fn();const api={getApuracaoBatch:jest.fn(async()=>({job:{status:'processing',totalEmpresas:2,okCount:1},items:[]}))};render(<BatchProgressModal api={api} jobId="1" onClose={onClose}/>);await screen.findByText('1/2 processadas');expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');fireEvent.click(screen.getByRole('button',{name:'Continuar em segundo plano'}));expect(onClose).toHaveBeenCalledTimes(1);expect(api.getApuracaoBatch).toHaveBeenCalledTimes(1);});
it('fechamento tem nome de diálogo, labels e saída por Escape',async()=>{const onClose=jest.fn();const api={getFechamento:async()=>({ok:true,dados:{cadastroCompleto:true,atividades:[{idAtividade:1,descricao:'Serviço',valorInterno:100,valorExterno:0}],faturamento:{total:100}}}),listAtividadesPgdasd:async()=>({atividades:[]})};render(<FechamentoModal api={api} portalClientId="1" competencia="2026-09" razao="Teste" onClose={onClose}/>);await screen.findByLabelText('Receita interna da atividade 1');expect(screen.getByRole('dialog',{name:'Fechamento — Teste · 2026-09'})).toBeInTheDocument();fireEvent.keyDown(window,{key:'Escape'});expect(onClose).toHaveBeenCalledTimes(1);});
it('recuar da confirmação preserva o cálculo e não transmite', async () => {
  const api = {
    getFechamento: async () => ({ ok: true, dados: { cadastroCompleto: true, atividades: [{ idAtividade: 1, descricao: 'Serviço', valorInterno: 100, valorExterno: 0 }], faturamento: { total: 100 } } }),
    listAtividadesPgdasd: async () => ({ atividades: [] }),
    calcularFechamento: jest.fn(async () => ({ ok: true, result: { calculoId: 'calculo-1', dasValor: 6 } })),
    transmitirFechamento: jest.fn(),
  };
  render(<FechamentoModal api={api} portalClientId="1" competencia="2026-09" razao="Teste" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Calcular/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Apurar\/Transmitir/ }));
  fireEvent.change(await screen.findByLabelText('Competência para confirmar'), { target: { value: '2026-09' } });
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conferência' }));
  expect(screen.queryByLabelText('Competência para confirmar')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salvar \(fechar\)/ })).toBeEnabled();
  expect(screen.getByLabelText('Receita interna da atividade 1')).toHaveValue(100);
  expect(api.transmitirFechamento).not.toHaveBeenCalled();
});
it('falha de leitura do lote é anunciada sem afirmar conclusão nem transmitir',async()=>{
 const api={getApuracaoBatch:jest.fn(async()=>{throw Error('Você não tem acesso a este lote.');})};render(<BatchProgressModal api={api} jobId="1" onClose={()=>{}}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem acesso a este lote.');expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();expect(screen.queryByText('✓ concluído')).not.toBeInTheDocument();expect(api.getApuracaoBatch).toHaveBeenCalledTimes(1);
});
it('carregamento inicial não afirma zero processado',()=>{
 render(<BatchProgressModal api={{getApuracaoBatch:()=>new Promise(()=>{})}} jobId="1" onClose={()=>{}}/>);expect(screen.getByRole('status')).toHaveTextContent('Carregando acompanhamento');expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
it('traduz recusa técnica preservando mensagem humana',async()=>{
 render(<BatchProgressModal api={{getApuracaoBatch:async()=>{throw Error('forbidden');}}} jobId="1" onClose={()=>{}}/>);expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem acesso ativo a esta empresa.');expect(screen.getByRole('alert')).not.toHaveTextContent('forbidden');
});
