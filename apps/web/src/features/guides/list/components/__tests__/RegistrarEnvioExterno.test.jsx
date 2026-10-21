import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { RegistrarEnvioExterno } from '../RegistrarEnvioExterno';
import { lerEnvioDaGuia } from '../../../lib/envioNaTela';
const guia = { id: 'g', tipo: 'SIMPLES', competencia: '2026-10' };
const prova = { guideId: 'g', companyId: 'c', atorId: 'contador', dataEntrega: '2026-10-21', registradoEm: '2026-10-21T15:00:00Z', meio: 'PESSOAL' };
test('consulta não registra; confirmação leva data/meio/revisão e atualiza depois de salvar', async () => {
  const api = { preverEnvioExternoGuia: jest.fn().mockResolvedValue({ guideId: 'g', companyId: 'c', revisaoDocumento: 'hash' }), registrarEnvioExternoGuia: jest.fn().mockResolvedValue({ ok: true, entregaExterna: prova }) };
  const aoSalvar = jest.fn();
  render(<RegistrarEnvioExterno api={api} companyId="c" guia={guia} aoFechar={jest.fn()} aoSalvar={aoSalvar} />);
  await waitFor(() => expect(screen.queryByText('Conferindo a revisão da guia…')).not.toBeInTheDocument());
  expect(api.registrarEnvioExternoGuia).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Data da entrega'), { target: { value: '2026-10-21' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar envio externo' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Envio externo registrado');
  expect(api.registrarEnvioExternoGuia).toHaveBeenCalledWith('c', 'g', expect.objectContaining({ revisaoDocumento: 'hash', dataEntrega: '2026-10-21', meio: 'PESSOAL', confirmado: true }));
  expect(aoSalvar).toHaveBeenCalledTimes(1);
});
test('erro de persistência preserva formulário e não anuncia sucesso', async () => {
  const api = { preverEnvioExternoGuia: jest.fn().mockResolvedValue({ guideId: 'g', companyId: 'c', revisaoDocumento: 'hash' }), registrarEnvioExternoGuia: jest.fn().mockRejectedValue(new Error('Documento alterado')) };
  render(<RegistrarEnvioExterno api={api} companyId="c" guia={guia} aoFechar={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Data da entrega'), { target: { value: '2026-10-21' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar envio externo' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar envio externo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Documento alterado');
  expect(screen.getByLabelText('Data da entrega')).toHaveValue('2026-10-21');
});
test('selo distingue declaração externa e não esconde resultado oficial incerto', () => {
  const e = { canal: 'EXTERNO', status: 'declarado_externo', entregaExterna: prova };
  const envio = { jaEnviada: true, entregaExterna: prova, canais: [e] };
  expect(lerEnvioDaGuia({ envio })).toMatchObject({ situacao: 'EXTERNA', chegou: false, aguardando: false });
  expect(lerEnvioDaGuia({ envio: { ...envio, canais: [e, { canal: 'WHATSAPP', status: 'indeterminado' }] } })).toMatchObject({ situacao: 'INDETERMINADA' });
});

test('troca de guia limpa rascunho e ignora resposta antiga',async()=>{
 let antiga;const api={preverEnvioExternoGuia:jest.fn().mockImplementationOnce(()=>new Promise(r=>{antiga=r;})).mockResolvedValue({companyId:'c2',guideId:'g2',revisaoDocumento:'nova'}),registrarEnvioExternoGuia:jest.fn()};
 const {rerender}=render(<RegistrarEnvioExterno api={api} companyId="c" guia={guia} aoFechar={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Data da entrega'),{target:{value:'2026-10-21'}});
 rerender(<RegistrarEnvioExterno api={api} companyId="c2" guia={{...guia,id:'g2'}} aoFechar={()=>{}}/>);
 await act(async()=>antiga({companyId:'c',guideId:'g',revisaoDocumento:'antiga',entregaExterna:prova}));
 expect(screen.getByLabelText('Data da entrega')).toHaveValue('');
 expect(screen.queryByText(/Envio externo registrado/)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Confirmar envio externo'})).toBeDisabled();
 expect(api.registrarEnvioExternoGuia).not.toHaveBeenCalled();
});
