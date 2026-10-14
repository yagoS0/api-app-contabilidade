import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {AlertasMonitoramento} from '../AlertasMonitoramento';
const alerta={id:'a:2026-09:pendente',codigo:'PGDAS_COMPROVACAO_PENDENTE',categoria:'declaracao',titulo:'Entrega pendente de comprovação',detalhe:'Não comprova falta de entrega.'};
const items=[{portalClientId:'a',razao:'Empresa A',alertasFiscais:[alerta]},{portalClientId:'b',razao:'Empresa B',alertasFiscais:[{id:'b:proc',categoria:'procuracao',titulo:'Procuração vencida',detalhe:'Regularize.'}]}];
test('abrir e filtrar apenas lê alertas; abrir empresa não executa lote',()=>{
 const onOpenCompany=jest.fn();render(<AlertasMonitoramento items={items} competencia="2026-09" onOpenCompany={onOpenCompany}/>);
 fireEvent.click(screen.getByText('Alertas do monitoramento · 2'));
 fireEvent.change(screen.getByLabelText('Mostrar alertas'),{target:{value:'procuracao'}});
 expect(screen.queryByText('Entrega pendente de comprovação')).not.toBeInTheDocument();
 expect(onOpenCompany).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Empresa B'}));expect(onOpenCompany).toHaveBeenCalledWith('b');
});
test('atualização remove alertas resolvidos sem duplicar',()=>{
 const {rerender}=render(<AlertasMonitoramento items={items} competencia="2026-09"/>);
 rerender(<AlertasMonitoramento items={items} competencia="2026-09"/>);expect(screen.getAllByText('Entrega pendente de comprovação')).toHaveLength(1);
 rerender(<AlertasMonitoramento items={[{...items[0],alertasFiscais:[]}]} competencia="2026-09"/>);
 expect(screen.queryByText('Entrega pendente de comprovação')).not.toBeInTheDocument();expect(screen.getByText('Alertas do monitoramento · 0')).toBeInTheDocument();
});
test('falha não vira lista vazia e contrato antigo não inventa alerta',()=>{
 const {rerender}=render(<AlertasMonitoramento items={[{monitoramentoErro:true}]} competencia="2026-09"/>);
 expect(screen.getByRole('alert')).toHaveTextContent('A apuração continua disponível');
 rerender(<AlertasMonitoramento items={[{portalClientId:'a'}]} competencia="2026-09"/>);expect(screen.queryByText(/Alertas do monitoramento/)).not.toBeInTheDocument();
});
