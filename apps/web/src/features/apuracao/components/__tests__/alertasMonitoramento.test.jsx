jest.mock("../relatorioMonitoramento", () => ({ baixarRelatorioMonitoramento: jest.fn() }));
import { baixarRelatorioMonitoramento } from "../relatorioMonitoramento";
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


test('exporta somente categoria exibida e competência atual sem abrir empresa',()=>{
 const abrir=jest.fn(); render(<AlertasMonitoramento items={items} competencia="2026-09" onOpenCompany={abrir}/>);
 fireEvent.click(screen.getByText('Alertas do monitoramento · 2'));
 fireEvent.change(screen.getByLabelText('Mostrar alertas'),{target:{value:'procuracao'}});
 fireEvent.click(screen.getByRole('button',{name:'Baixar pendências (CSV)'}));
 expect(baixarRelatorioMonitoramento).toHaveBeenLastCalledWith([expect.objectContaining({portalClientId:'b'})],'2026-09');
 expect(abrir).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Mostrar alertas'),{target:{value:'documentos'}});
 expect(screen.getByRole('button',{name:'Baixar pendências (CSV)'})).toBeDisabled();
});

test('falha de download é visível e mantém pendências',()=>{
 baixarRelatorioMonitoramento.mockImplementationOnce(()=>{throw Error('download');});
 render(<AlertasMonitoramento items={items} competencia="2026-09"/>);
 fireEvent.click(screen.getByText('Alertas do monitoramento · 2'));
 fireEvent.click(screen.getByRole('button',{name:'Baixar pendências (CSV)'}));
 expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível baixar');
 expect(screen.getByText('Entrega pendente de comprovação')).toBeInTheDocument();
});
