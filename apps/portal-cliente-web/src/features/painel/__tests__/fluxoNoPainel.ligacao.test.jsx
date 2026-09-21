// Visão mensal substitui a grade diária por decisão de produto (20/09/2026).
import {act,render,screen,within,fireEvent} from '@testing-library/react';
import {api} from '../../../api';
import {BlocoDeDemonstracao} from '../BlocoDeDemonstracao';
import {fluxoDeCaixaDoMock} from '../../../api/mock/fluxoDeCaixaDoMock';
import {resumoMensal,linhasDoCard} from '../../../../../../packages/shared/src/fluxoMensal';
import {linhaDoMes} from '../lib/tabelaDoFluxo';
const cheio=()=>fluxoDeCaixaDoMock('pc-001','2026-08');
const magro=()=>fluxoDeCaixaDoMock('pc-006','2026-08');
async function abrir(payload,props={}) {jest.spyOn(api,'getFluxoCaixa').mockResolvedValue(payload);render(<BlocoDeDemonstracao companyId="pc-001" competencia="2026-08" {...props}/>);await act(async()=>{});}
const clicar=async nome=>{await act(async()=>screen.getByRole('button',{name:nome}).click());};
afterEach(()=>jest.restoreAllMocks());
const mes={competencia:'2026-08',linhas:[
 {dia:1,direcao:'ENTRADA',fonte:'NOTA_EMITIDA',procedencia:'FATO',valor:100,rotulo:'Recebimento'},
 {dia:5,direcao:'SAIDA',fonte:'DESPESA_LANCADA',procedencia:'FATO',valor:30,rotulo:'Aluguel'},
 {dia:null,direcao:'SAIDA',fonte:'GUIA',procedencia:'COMPROMISSO',valor:20,rotulo:'DAS'},
 {dia:null,direcao:'SAIDA',fonte:'FOLHA',procedencia:'PREVISAO',valor:10,rotulo:'Folha'}]};
const payload=()=>({demonstracao:false,cicloAtual:'2026-08',meses:[mes,{competencia:'2026-09',linhas:[]}],folha:{disponivel:true}});
test('saídas incluem impostos sem duplicar folha e detalhes conciliam cada card',()=>{const r=resumoMensal(mes,linhaDoMes);expect(r.saidas.valor).toBe(50);expect(r.folha.valor).toBe(10);expect(r.resultado).toEqual({valor:40,status:'forecast'});for(const k of ['entrada','saidas','folha','resultado']){const linhas=linhasDoCard(mes,k,linhaDoMes);const v=linhas.reduce((s,l)=>s+(k==='resultado'&&l.direcao==='SAIDA'?-l.valor:l.valor),0);expect(v).toBe(r[k].valor);}expect(resumoMensal({linhas:[]},linhaDoMes).saidas).toBeNull();});
test('abre quatro cards do mês e saídas de todos os dias, incluindo imposto sem dia',async()=>{await abrir(payload());expect(screen.getAllByRole('button',{name:/^Ver .* de agosto/})).toHaveLength(4);expect(screen.queryByRole('region',{name:/Fluxo diário/})).not.toBeInTheDocument();await clicar(/Ver saídas/);const d=screen.getByRole('dialog');expect(d).toHaveTextContent('Aluguel');expect(d).toHaveTextContent('DAS');expect(d).toHaveTextContent('50,00');expect(d).not.toHaveTextContent('Recebimento');expect(api.getFluxoCaixa).toHaveBeenCalledTimes(1);});
test('resultado detalha composição e folha sem dia permanece acessível',async()=>{await abrir(payload());await clicar(/Ver resultado/);expect(screen.getByRole('dialog')).toHaveTextContent('40,00');expect(screen.getByRole('dialog')).toHaveTextContent('Folha');expect(screen.queryByRole('button',{name:'Acrescentar'})).not.toBeInTheDocument();});
test('visita somente leitura não oferece declaração de saída',async()=>{await abrir(payload(),{somenteLeitura:true});await clicar(/Ver saídas/);expect(screen.queryByRole('button',{name:'Acrescentar'})).not.toBeInTheDocument();});
test('navega mês com dados já carregados sem nova consulta',async()=>{await abrir(payload());await clicar('Mês seguinte');expect(screen.getByRole('button',{name:/Ver entradas de setembro/})).toHaveTextContent('—');expect(api.getFluxoCaixa).toHaveBeenCalledTimes(1);});
test('horizonte mantém acesso ao resumo mensal',async()=>{await abrir(payload());await clicar('Horizonte');expect(screen.getByRole('button',{name:'Horizonte'})).toHaveAttribute('aria-pressed','true');await clicar('Horizonte');expect(screen.getByRole('button',{name:/Ver entradas de agosto/})).toBeInTheDocument();});
describe("⚠⚠ o pop-up de guias", () => {
  it("ele abre com guia pendente, e lista o que está pegando fogo", async () => {
    await abrir(cheio());
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByText(/INSS/)).toBeInTheDocument();
    // ⚠ SÃO DUAS vencidas no mock, e o plural é o ponto: o pop-up lista TODAS, não a pior.
    expect(within(dialogo).getAllByText(/venceu em/).length).toBeGreaterThan(1);
  });

  it("⚠⚠ sem `ackPending`, ele NÃO existe — e não há card fixo no lugar", async () => {
    const p = cheio();
    await abrir({ ...p, alertaDeGuias: { ...p.alertaDeGuias, ackPending: false } });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⚠ sem guia nenhuma nessas condições, também não", async () => {
    await abrir(magro());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⚠⚠ 'Estou ciente' grava CIÊNCIA — jamais pagamento", async () => {
    // Lei 5: *"Ciência nunca significa pagamento."* Um clique dado para dispensar um modal não pode
    // tirar do contador a cobrança nem do cliente a dívida.
    const registrar = jest.spyOn(api, "registrarCienciaDeGuias").mockResolvedValue({ ok: true });
    await abrir(cheio());
    await act(async () => {
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /Estou ciente/ }).click();
    });
    expect(registrar).toHaveBeenCalled();
    const [, corpo] = registrar.mock.calls[0];
    expect(JSON.stringify(corpo)).not.toMatch(/pag|paid|confirmou/i);
  });

  it("⚠⚠ falhou ⇒ o pop-up FICA — fechá-lo faria a pessoa achar que registrou", async () => {
    jest.spyOn(api, "registrarCienciaDeGuias").mockRejectedValue(new Error("sem tabela"));
    await abrir(cheio());
    await act(async () => {
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /Estou ciente/ }).click();
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("⚠⚠ 'Ver todas as guias' NAVEGA e não grava ciência — a pessoa foi olhar, não disse que viu", async () => {
    const registrar = jest.spyOn(api, "registrarCienciaDeGuias").mockResolvedValue({ ok: true });
    const aoVerGuias = jest.fn();
    await abrir(cheio(), { aoVerGuias });
    await act(async () => {
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /Ver todas as guias/ }).click();
    });
    expect(aoVerGuias).toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});
