import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {EstornoBaixaModal} from '../EstornoBaixaModal';
const preview={modo:'DELECAO',lancamentos:[{id:'e',historico:'Baixa',valor:150,competencia:'2026-09'}],totalEstornado:150,competenciaOriginal:'2026-09',bloqueios:[]};
test('dialog nomeado permite Escape e protege confirmação enquanto salva',async()=>{
 const close=jest.fn(),confirm=jest.fn(()=>new Promise(()=>{}));
 render(<EstornoBaixaModal entryId="e" onLoadPreview={async()=>preview} onConfirm={confirm} onClose={close}/>);
 const field=await screen.findByRole('textbox');expect(screen.getByRole('dialog',{name:'Desfazer baixa'})).toBeInTheDocument();
 fireEvent.change(field,{target:{value:'  guia incorreta  '}});fireEvent.click(screen.getByRole('button',{name:'Desfazer baixa'}));
 await waitFor(()=>expect(confirm).toHaveBeenCalledWith({entryId:'e',motivo:'guia incorreta',totalConferido:150}));
 expect(field).toBeDisabled();expect(screen.getByRole('button',{name:'Cancelar'})).toBeDisabled();
 fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();
});
test.each(['insufficient_role','forbidden','scope_required','unauthorized'])('recusa %s na prévia é apresentada sem permitir confirmar',async(code)=>{
 render(<EstornoBaixaModal entryId="e" onLoadPreview={async()=>{throw Object.assign(new Error(code),{code});}} onClose={()=>{}}/>);
 const alert=await screen.findByRole('alert');expect(alert).not.toHaveTextContent(code);expect(screen.getByRole('button',{name:'Desfazer baixa'})).toBeDisabled();expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
test('preserva orientação humana junto ao código de recusa',async()=>{
 render(<EstornoBaixaModal entryId="e" onLoadPreview={async()=>{throw Object.assign(new Error('Peça acesso à empresa selecionada.'),{code:'forbidden'});}} onClose={()=>{}}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Peça acesso à empresa selecionada.');
});
