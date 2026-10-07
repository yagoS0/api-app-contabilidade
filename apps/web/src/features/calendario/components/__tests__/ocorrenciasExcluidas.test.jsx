import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {OcorrenciasExcluidas} from '../OcorrenciasExcluidas';

test('recupera somente o grupo selecionado e informa falha sem esconder o registro',async()=>{
  const itens=['a','b'].map(id=>({id,regraId:'apurar',titulo:'Apurar',empresa:id,dataInicio:'2026-10-01',dataFim:'2026-10-10',canceladaEm:`2026-10-07T10:00:00.00${id==='a'?1:2}Z`,restauravel:true}));
  itens.push({id:'c',regraId:'outro',titulo:'Outro',empresa:'c',dataInicio:'2026-10-01',dataFim:'2026-10-10',restauravel:false});
  const api={getOcorrenciasExcluidas:jest.fn(async()=>({itens})),restaurarOcorrenciasAgenda:jest.fn(async()=>({ok:false,message:'A série mudou'}))},onChanged=jest.fn();
  render(<OcorrenciasExcluidas api={api} inicio="2026-10-01" fim="2026-10-31" busca="" onChanged={onChanged}/>);
  const botoes=await screen.findAllByRole('button',{name:'Restaurar ocorrência'});
  expect(botoes[1]).toBeDisabled();fireEvent.click(botoes[0]);
  await waitFor(()=>expect(api.restaurarOcorrenciasAgenda).toHaveBeenCalledWith(['a','b']));
  expect(await screen.findByRole('alert')).toHaveTextContent('A série mudou');expect(onChanged).not.toHaveBeenCalled();
});
