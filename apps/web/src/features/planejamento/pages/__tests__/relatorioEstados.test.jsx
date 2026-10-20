import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {PlanejamentoPage} from '../renderPlanejamentoPage';
import {baixarRelatorioPlanejamento} from '../../lib/pdfPlanejamento';
import {AnaliseEmpresa} from '../../components/AnaliseEmpresa';
jest.mock('../../lib/pdfPlanejamento',()=>({baixarRelatorioPlanejamento:jest.fn()}));
const campo=valor=>({valor,apurado:true,origem:'fixture'});
function montar(){const api={getDadosPlanejamento:async()=>({empresa:{id:'e',razao:'Empresa'},referencia:{competencia:'2026-09'},campos:{receitaAnual:campo(300000),rbt12:campo(300000),folhaAnual:campo(60000),regimeAtual:campo('SIMPLES_NACIONAL'),anexo:campo('III'),sujeitoFatorR:campo(false),aliquotaIss:campo(.05),atividadePresumido:campo('servicos')}}),salvarSimulacaoPlanejamento:jest.fn(),gerarDocumentoDaSimulacao:jest.fn()};render(<PlanejamentoPage api={api} empresa={{id:'e'}} empresaFixa/>);return api;}
beforeEach(()=>jest.clearAllMocks());
it('geração anuncia ocupado e evita chamada duplicada sem salvar cenário',async()=>{
 let concluir;baixarRelatorioPlanejamento.mockImplementation(()=>new Promise(resolve=>{concluir=resolve;}));const api=montar();const b=screen.getByRole('button',{name:'Imprimir relatório'});await waitFor(()=>expect(b).toBeEnabled());fireEvent.click(b);expect(b).toHaveAttribute('aria-busy','true');expect(b).toBeDisabled();fireEvent.click(b);expect(baixarRelatorioPlanejamento).toHaveBeenCalledTimes(1);expect(api.salvarSimulacaoPlanejamento).not.toHaveBeenCalled();await act(async()=>concluir());expect(b).toBeEnabled();
});
it('falha do PDF mantém premissas e permite tentar novamente',async()=>{
 baixarRelatorioPlanejamento.mockRejectedValue(Error('PDF indisponível'));const api=montar();const b=screen.getByRole('button',{name:'Imprimir relatório'});await waitFor(()=>expect(b).toBeEnabled());fireEvent.change(screen.getByLabelText('Nome do cenário (opcional)'),{target:{value:'Estudo revisado'}});fireEvent.click(b);expect(await screen.findByRole('alert')).toHaveTextContent('seus dados continuam na página');expect(screen.getByLabelText('Nome do cenário (opcional)')).toHaveValue('Estudo revisado');expect(b).toBeEnabled();expect(api.gerarDocumentoDaSimulacao).not.toHaveBeenCalled();
});

it.each([null, {}, {ok:true,atual:{},anterior:{}}])('análise incompleta mostra erro recuperável sem inventar indicadores: %p',async(resposta)=>{
 const api={getFechamentosRelatorio:jest.fn(async()=>({ok:true,competenciasFechadas:['2026-08']})),getAnalisePlanejamento:jest.fn(async()=>resposta)};
 render(<AnaliseEmpresa api={api} empresaId="sintetica"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inválida');
 expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:/Faturamento documental/})).not.toBeInTheDocument();
});
