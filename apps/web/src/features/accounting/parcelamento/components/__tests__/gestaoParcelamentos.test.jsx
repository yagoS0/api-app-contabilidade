import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GestaoParcelamentos, BaixaEditavel, CorrecaoCadastro } from '../GestaoParcelamentos';
import { quadroGestaoParcelamento } from '../../../../../../../../packages/shared/src/accounting/gestaoParcelamento.js';

const parcela={id:'p',numeroParcela:11,competencia:'2026-10',vencimento:'2026-10-30',valorPrevisto:100};
const acordo={id:'a',label:'Contrato teste',status:'ATIVO',numParcelas:41,parcelasContratadas:[parcela],debitosOrigem:[],configPagamento:[{tipoLinha:'PARC',conta:'200'},{tipoLinha:'CAIXA',conta:'100'}]};
const detalhe={acordo,lancamentos:[],eventos:[],quadro:quadroGestaoParcelamento(acordo,'2026-10')};

test('abre contrato e navega entre parcelas, composição e cadastro',async()=>{
 const api={gestaoParcelamento:jest.fn().mockResolvedValue(detalhe)},composicao=jest.fn();
 render(<GestaoParcelamentos companyId="c" contratos={[acordo]} api={api} onComposicao={composicao}/>);
 fireEvent.click(screen.getByRole('button',{name:'Contrato teste'}));
 expect(await screen.findByRole('button',{name:'Dar baixa'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Dívidas incluídas'}));
 fireEvent.click(screen.getByRole('button',{name:'Conferir dívidas da Circular'}));
 expect(composicao).toHaveBeenCalledWith(acordo);
 fireEvent.click(screen.getByRole('button',{name:'Cadastro e histórico'}));
 expect(screen.getByRole('button',{name:'Corrigir cadastro'})).toBeInTheDocument();
});
test('resposta antiga não substitui contrato selecionado depois',async()=>{
 let resolver;
 const api={gestaoParcelamento:jest.fn().mockImplementationOnce(()=>new Promise(r=>{resolver=r;})).mockResolvedValue({...detalhe,acordo:{...acordo,id:'b',label:'Segundo'}})};
 render(<GestaoParcelamentos companyId="c" contratos={[acordo,{...acordo,id:'b',label:'Segundo'}]} api={api}/>);
 fireEvent.click(screen.getByRole('button',{name:'Contrato teste'}));fireEvent.click(screen.getByRole('button',{name:'Segundo'}));
 await screen.findByRole('button',{name:'Dar baixa'});resolver(detalhe);
 await waitFor(()=>expect(screen.getAllByText('Segundo')).toHaveLength(2));
 expect(screen.getAllByText('Contrato teste')).toHaveLength(1);
});
test('baixa edita contas e gera lançamentos somente após a prévia',async()=>{
 const api={gestaoParcelamento:jest.fn().mockResolvedValueOnce({confirmacao:'v1',total:100,linhas:[{},{}],competencia:'2026-10'}).mockResolvedValueOnce({ok:true})};
 const saved=jest.fn(),close=jest.fn();
 render(<BaixaEditavel parcela={parcela} acordo={acordo} companyId="c" api={api} onSaved={saved} onClose={close}/>);
 expect(screen.getByLabelText('Conta PARC')).toHaveValue('200');
 fireEvent.change(screen.getByLabelText('Conta CAIXA'),{target:{value:'101'}});
 fireEvent.click(screen.getByRole('button',{name:'Conferir lançamentos'}));
 await screen.findByRole('button',{name:'Confirmar e gerar lançamentos'});
 expect(saved).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar e gerar lançamentos'}));
 await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));
 expect(api.gestaoParcelamento.mock.calls[1][3].baixa.linhas[1].conta).toBe('101');
 expect(api.gestaoParcelamento.mock.calls[1][3].confirmacao).toBe('v1');
 expect(close).toHaveBeenCalled();
});
test('editar depois de conferir exige nova prévia',async()=>{
 const preview={confirmacao:'v1',alteracoes:[],cadastro:{label:'Novo'},cadastroAnterior:{label:'Contrato teste'}};
 const api={gestaoParcelamento:jest.fn().mockResolvedValue(preview)};
 render(<CorrecaoCadastro detalhe={detalhe} companyId="c" api={api}/>);
 fireEvent.change(screen.getByLabelText('Motivo da correção'),{target:{value:'Correção do cadastro'}});
 fireEvent.click(screen.getByRole('button',{name:'Conferir alterações'}));
 await screen.findByRole('button',{name:'Confirmar correção'});
 fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Outro nome'}});
 expect(screen.queryByRole('button',{name:'Confirmar correção'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Conferir alterações'})).toBeInTheDocument();
});
