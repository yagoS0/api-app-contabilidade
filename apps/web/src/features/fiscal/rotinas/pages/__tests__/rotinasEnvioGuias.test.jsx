import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RotinasPage } from '../renderRotinasPage';
import { mockCarregarRotinas, mockSalvarRotinas } from '../../../../../api/mock/rotinasMock';
beforeAll(()=>{global.structuredClone??=value=>JSON.parse(JSON.stringify(value));});
test('agenda de envio nasce desligada e diária; salvar só agenda não envia',async()=>{
 const api={getRotinas:async()=>({rotinas:[{key:'simples_envio_guias',label:'Envio automático de guias'}],agenda:{},empresas:[]}),saveRotinas:jest.fn(async body=>body)};
 render(<MemoryRouter><RotinasPage api={api}/></MemoryRouter>);fireEvent.click(screen.getByRole('tab',{name:'Configuração'}));
 const enabled=await screen.findByLabelText('Ligar Envio automático de guias');expect(enabled).not.toBeChecked();expect(screen.getByText('Diariamente')).toBeVisible();
 fireEvent.click(enabled);fireEvent.click(screen.getByText('Salvar horários'));
 await waitFor(()=>expect(api.saveRotinas).toHaveBeenCalledWith({agenda:{simples_envio_guias:expect.objectContaining({enabled:true,frequency:'DAILY'})}}));
});
test('mock não herda agenda do SERPRO nem aceita periodicidade mensal',()=>{
 const before=mockCarregarRotinas([]).agenda.simples_envio_guias;expect(before).toMatchObject({enabled:false,frequency:'DAILY'});
 expect(()=>mockSalvarRotinas({agenda:{simples_envio_guias:{...before,frequency:'MONTHLY'}}})).toThrow();expect(mockCarregarRotinas([]).agenda.simples_envio_guias).toEqual(before);
});
