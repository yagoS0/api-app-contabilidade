import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FluxoLeitura } from '../FluxoLeitura';
import { linhaDoMes, linhasDosDias } from '../../lib/tabelaFluxoLeitura';
import { linhaDoMes as doCliente, linhasDosDias as diasDoCliente } from '../../../../../../portal-cliente-web/src/features/painel/lib/tabelaDoFluxo';
const mes={competencia:'2026-08',saldo:{inicial:500,final:570,projetado:true},linhas:[{dia:1,direcao:'ENTRADA',fonte:'NOTA_EMITIDA',procedencia:'FATO',valor:100},{dia:5,direcao:'SAIDA',fonte:'GUIA',procedencia:'COMPROMISSO',valor:20},{dia:null,direcao:'SAIDA',fonte:'FOLHA',procedencia:'PREVISAO',valor:10}]};
test('agregação mantém paridade com cliente, inclusive acumulado e sem dia',()=>{expect(linhaDoMes(mes)).toEqual(doCliente(mes));expect(linhasDosDias(mes,31)).toEqual(diasDoCliente(mes,31));});
test('cards mensais e detalhe conciliam impostos, folha e resultado sem mutações',async()=>{
const api={getFluxoCaixa:jest.fn(async()=>({ok:true,demonstracao:false,meses:[mes],folha:{disponivel:true}}))};
render(<FluxoLeitura api={api} companyId="a" competenciaReferencia="2026-08"/>);
fireEvent.click(await screen.findByRole('button',{name:/Ver saídas/}));
expect(screen.getByRole('dialog')).toHaveTextContent('20,00');
expect(screen.getByRole('dialog')).toHaveTextContent('A pagar');
fireEvent.keyDown(document,{key:'Escape'});
fireEvent.click(screen.getByRole('button',{name:/Ver resultado/}));
expect(screen.getByRole('dialog')).toHaveTextContent('70,00');
expect(screen.getAllByRole('row')).toHaveLength(4);
expect(api.getFluxoCaixa).toHaveBeenCalledTimes(1);
});
test('trocar empresa descarta detalhes e dados anteriores quando consulta falha',async()=>{
const api={getFluxoCaixa:jest.fn().mockResolvedValueOnce({ok:true,demonstracao:false,meses:[mes]}).mockRejectedValueOnce(new Error('Sem acesso'))};
const {rerender}=render(<FluxoLeitura api={api} companyId="a" competenciaReferencia="2026-08"/>);
fireEvent.click(await screen.findByRole('button',{name:/Ver entradas/}));
rerender(<FluxoLeitura api={api} companyId="b" competenciaReferencia="2026-08"/>);
await screen.findByRole('alert');await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
expect(screen.queryByRole('button',{name:/Ver entradas/})).not.toBeInTheDocument();
});

test('saldo mensal e último dia coincidem sem criar ação de escrita',()=>{expect(linhaDoMes(mes).saldo.valor).toBe(570);expect(linhasDosDias(mes,31).dias.at(-1).saldo.valor).toBe(570);});

test('navega até o último mês futuro e abre seus movimentos sem nova consulta',async()=>{
 const futuro={competencia:'2026-10',linhas:[{dia:null,rotulo:'Receita futura',direcao:'ENTRADA',fonte:'NOTA_EMITIDA',procedencia:'PREVISAO',valor:300}]};
 const api={getFluxoCaixa:jest.fn(async()=>({ok:true,demonstracao:false,cicloAtual:'2026-08',meses:[mes,futuro]}))};
 render(<FluxoLeitura api={api} companyId="a"/>);
 await screen.findByRole('combobox',{name:'Mês da projeção'});
 expect(screen.getByRole('button',{name:'Mês anterior'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Mês seguinte'}));
 expect(screen.getByRole('combobox')).toHaveValue('2026-10');
 expect(screen.getByRole('button',{name:'Mês seguinte'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:/Ver entradas/}));
 expect(screen.getByRole('dialog')).toHaveTextContent('Receita futura');
 expect(screen.getByRole('dialog')).toHaveTextContent('Previsto');
 fireEvent.keyDown(document,{key:'Escape'});
 fireEvent.click(screen.getByRole('button',{name:'Mês atual'}));
 expect(screen.getByRole('combobox')).toHaveValue('2026-08');
 expect(api.getFluxoCaixa).toHaveBeenCalledTimes(1);
});
