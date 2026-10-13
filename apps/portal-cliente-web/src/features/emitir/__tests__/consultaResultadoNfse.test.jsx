import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConsultaResultadoNfse } from '@contabilidade/shared/nfse-conciliacao';
it('consulta uma vez e recupera sem emitir; ignora resposta de outro contexto', async()=>{
 let resolver; const consultar=jest.fn(()=>new Promise(r=>{resolver=r;})); const recuperar=jest.fn();
 const {rerender}=render(<ConsultaResultadoNfse companyId="a" invoiceId="1" consultar={consultar} aoRecuperar={recuperar}/>);
 fireEvent.click(screen.getByRole('button')); fireEvent.click(screen.getByRole('button')); expect(consultar).toHaveBeenCalledTimes(1); expect(consultar).toHaveBeenCalledWith('a','1');
 rerender(<ConsultaResultadoNfse companyId="b" invoiceId="2" consultar={consultar} aoRecuperar={recuperar}/>);
 await act(async()=>resolver({estado:'MESMA',nfse:{numeroNfse:'99'}})); expect(recuperar).not.toHaveBeenCalled(); expect(screen.queryByText(/99/)).toBeNull();
 fireEvent.click(screen.getByRole('button')); await act(async()=>resolver({estado:'MESMA',nfse:{numeroNfse:'100'}})); expect(recuperar).toHaveBeenCalledTimes(1); expect(screen.getByText(/Nenhuma nova nota/)).toBeTruthy(); expect(screen.queryByRole('button')).toBeNull();
});
it.each(['OUTRA','INCONCLUSIVA'])('mantém conferência para %s',async estado=>{
 const consultar=jest.fn(async()=>({estado,message:'Confira esta operação'})); const recuperar=jest.fn(); render(<ConsultaResultadoNfse companyId="a" invoiceId="1" consultar={consultar} aoRecuperar={recuperar}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button'))); expect(screen.getByText('Confira esta operação')).toBeTruthy();expect(recuperar).not.toHaveBeenCalled();expect(screen.getByText(/Não reenvie/)).toBeTruthy();
});
it('falha mantém consulta manual e erro legível',async()=>{render(<ConsultaResultadoNfse companyId="a" invoiceId="1" consultar={async()=>{throw Error('SSL stack');}}/>);await act(async()=>fireEvent.click(screen.getByRole('button')));expect(screen.getByRole('alert').textContent).not.toMatch(/SSL/);expect(screen.getByRole('button').disabled).toBe(false);});
