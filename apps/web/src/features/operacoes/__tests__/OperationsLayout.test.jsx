import {render,screen,fireEvent,within} from '@testing-library/react';
import {OperationsPage} from '../OperationsPage';
import fs from 'node:fs';
import path from 'node:path';
jest.mock('../OperationsRoutineCompanies',()=>({OperationsRoutineCompanies:()=> <aside aria-label="Rotinas"/>}));
jest.mock('../OperationsAlerts',()=>({OperationsAlerts:()=> <button>Avisos de apuração</button>}));
test('estrutura do protótipo preserva quatro pizzas, cinco controles e remove filas/calendário',()=>{
 const {container}=render(<OperationsPage companies={[]} competencia="2026-10"/>);
 expect(container.querySelector('.operacoes-progresso-total')).toBeNull();expect(container.querySelectorAll('.operacoes-etapa')).toHaveLength(3);expect(container.querySelectorAll('.operacoes-quatro-pizzas > div')).toHaveLength(4);expect(container.querySelectorAll('.operacoes-contabilizacao .operacoes-progress')).toHaveLength(5);
 expect(screen.getByRole('group',{name:'Pagamentos 0/0 empresas'})).toBeInTheDocument();for(const text of ['Centro de Operações','Conferir e liberar apurações','Em acompanhamento','Filas de trabalho e notas para revisão']) expect(screen.queryByText(text)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Contabilização'}));expect(within(screen.getByRole('dialog')).getByText('Nenhuma empresa neste conjunto.')).toBeInTheDocument();
});
test('contrato de layout usa colunas flexíveis e reordena no celular sem esconder overflow',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../operacoes.css'),'utf8');expect(css).toMatch(/\.operacoes-contabilizacao\s*\{[^}]*grid-row:1;/);expect(css).toMatch(/@media\(max-width:580px\)/);expect(css).toMatch(/grid-template-columns:minmax\(0,1fr\)/);expect(css).not.toMatch(/overflow-x:\s*hidden/);
});

import {WorkspaceNavigation} from '../../../app/navigation/WorkspaceNavigation.shared';
test('filtro da URL conserva competência e deep link; fechar remove somente filtro operacional',()=>{
 const navigate=jest.fn();const value={navigate,location:{pathname:'/companies',search:'?visao=operacoes&competencia=2026-10&operacoesEtapa=disponivel&operacoesLista=missing&operacoesCompetencia=2026-10'}};
 render(<WorkspaceNavigation.Provider value={value}><OperationsPage companies={[]} competencia="2026-10"/></WorkspaceNavigation.Provider>);
 expect(screen.getByRole('dialog')).toHaveTextContent('Disponível');fireEvent.keyDown(document,{key:'Escape'});expect(navigate).toHaveBeenCalledWith('/companies?visao=operacoes&competencia=2026-10',{replace:true});
});
