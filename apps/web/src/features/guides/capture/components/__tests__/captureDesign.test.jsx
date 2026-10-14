import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuideCaptureModal } from '../renderGuideCaptureModal';
import { ProcuracaoCreateModal } from '../../../../notas/components/ProcuracaoCreateModal';

test('captura identifica campos, mantém payload e anuncia falha sem fechar', async () => {
  const salvar = jest.fn().mockRejectedValue(Error('Falha simulada'));
  const fechar = jest.fn();
  render(<GuideCaptureModal mode="complete" initialMetadata={{tipo:'SIMPLES'}} onSave={salvar} onClose={fechar} />);
  expect(screen.getByLabelText('Competência * (AAAA-MM)')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Competência * (AAAA-MM)'), {target:{value:'2026-09'}});
  fireEvent.change(screen.getByLabelText('Valor (R$)'), {target:{value:'1200'}});
  fireEvent.change(screen.getByLabelText('Vencimento'), {target:{value:'2026-10-20'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar guia'}));
  await waitFor(()=>expect(salvar).toHaveBeenCalledWith({tipo:'SIMPLES',competencia:'2026-09',valor:1200,vencimento:'2026-10-20'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha simulada');
  expect(fechar).not.toHaveBeenCalled();
});

for(const tipo of ['captura','procuracao']) test(`${tipo}: foco entra, Escape bloqueia enquanto salva e retorna ao gatilho`, ()=>{
  const gatilho=document.createElement('button');document.body.appendChild(gatilho);gatilho.focus();
  const fechar=jest.fn();
  const criar=(saving)=>tipo==='captura'?<GuideCaptureModal mode="upload" saving={saving} onSave={jest.fn()} onClose={fechar}/>:<ProcuracaoCreateModal saving={saving} onCreate={jest.fn()} onClose={fechar}/>;
  const tela=render(criar(false));
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement);
  tela.rerender(criar(true));fireEvent.keyDown(document,{key:'Escape'});expect(fechar).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Fechar'})).not.toBeInTheDocument();
  fireEvent.keyDown(document,{key:'Tab'});expect(screen.getByRole('dialog')).toContainElement(document.activeElement);
  tela.rerender(criar(false));fireEvent.keyDown(document,{key:'Escape'});expect(fechar).toHaveBeenCalledTimes(1);
  tela.unmount();expect(gatilho).toHaveFocus();gatilho.remove();
});

test('procuração mantém contrato e apresenta recusa',async()=>{
  const criar=jest.fn().mockRejectedValue(Error('Procuração recusada'));render(<ProcuracaoCreateModal onCreate={criar} onClose={jest.fn()}/>);
  fireEvent.change(screen.getByLabelText('Serviço'),{target:{value:'SN'}});
  fireEvent.change(screen.getByLabelText('Validade (opcional)'),{target:{value:'2027-01-31'}});
  fireEvent.change(screen.getByLabelText('Observações'),{target:{value:'Conferida pelo escritório'}});
  fireEvent.click(screen.getByRole('button',{name:'Cadastrar'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Procuração recusada');
  expect(criar).toHaveBeenCalledWith({servico:'SN',validade:'2027-01-31',observacoes:'Conferida pelo escritório'});
});
