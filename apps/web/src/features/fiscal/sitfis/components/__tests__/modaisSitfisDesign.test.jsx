import { fireEvent, render, screen } from '@testing-library/react';
import { ExportarPendenciasModal } from '../ExportarPendenciasModal';
import { PendenciaManualModal } from '../PendenciaManualModal';

test('origem do PDF indica seleção parcial e conserva inclusão de origem vazia', () => {
  const exportar=jest.fn();
  render(<ExportarPendenciasModal fontes={[{id:'RFB',nome:'Receita',linhas:[{id:'a',tributo:'IRPJ'},{id:'b',tributo:'PIS'}]},{id:'ESTADUAL',nome:'Estadual',linhas:[]}]} aoExportar={exportar} aoFechar={()=>{}} />);
  fireEvent.click(screen.getByRole('checkbox',{name:'Incluir IRPJ de Receita'}));
  expect(screen.getByRole('checkbox',{name:'Incluir tabela Receita'}).indeterminate).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:'Incluir tabela Estadual'}));
  fireEvent.click(screen.getByRole('button',{name:'Gerar PDF'}));
  expect(exportar.mock.calls[0][0].map(f=>[f.id,f.linhas.map(l=>l.id)])).toEqual([['RFB',['b']],['ESTADUAL',[]]]);
});

test('formulário começa pela identificação do imposto e preserva estados editados', () => {
  const item={id:'m',versao:2,dados:{fonte:'MUNICIPAL',tipo:'DEBITO',estado:'ABERTO',tributo:'ISS',competencia:'09/2026',total:123400,dataReferencia:'2026-10-14'}};
  render(<PendenciaManualModal item={item} salvar={jest.fn()} aoFechar={()=>{}} />);
  expect([...document.querySelectorAll('form input, form textarea')].map(e=>e.name)).toEqual(['tributo','competencia','total','vencimento','observacoes']);
  expect(screen.getByLabelText('Valor (R$)')).toHaveValue('1234,00');
});


import { mensagemDaPendencia } from '../mensagemDaPendencia';
test.each(['forbidden', 'insufficient_role', 'scope_required', 'unauthorized'])('traduz código real de acesso %s na apresentação', code => {
  const resultado = mensagemDaPendencia(Object.assign(new Error(code), { code, status:403, payload:{error:code} }));
  expect(resultado).not.toBe(code);
  expect(resultado).toMatch(/acesso|perfil|sessão/);
});
test('preserva motivo humano de conflito e mensagem humana quando reason é código', () => {
  expect(mensagemDaPendencia({reason:'O registro mudou. Recarregue a lista antes de salvar.',code:'manual_debt_conflict'})).toBe('O registro mudou. Recarregue a lista antes de salvar.');
  expect(mensagemDaPendencia({reason:'forbidden',message:'Acesso revogado pelo escritório.'})).toBe('Acesso revogado pelo escritório.');
});
