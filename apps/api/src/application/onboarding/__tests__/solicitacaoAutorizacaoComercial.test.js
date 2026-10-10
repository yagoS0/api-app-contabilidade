import { prepararSolicitacaoAutorizacao, necessitaAutorizacaoFiscal } from '../SolicitacaoAutorizacaoComercial.js';
import { prepararPreatendimento } from '../preatendimentoComercial.js';

const pre = { qualificacaoVersao:2, intencao:'INATIVA', cnpj:'11222333000181', necessidade:'Não pago impostos', investigacaoPendencias:true,
  periodoPendencias:'desde 2022', tipoPendencias:'impostos', situacaoOperacional:'operando', atividade:'médico', cidade:'Recife', estrutura:'sozinho', urgencia:'novembro', faturamento:'20 mil',
  dadosInformados:{cnpj:'11222333000181'} };
function fixture() {
  const guia={id:'guia',versao:3,tipo:'ORIENTACAO',chave:'autorizacao-acesso',aprovadoEm:new Date(),texto:'Autorize {{escritorio}} para analisar {{cnpj}}. CNPJ {{procuradorCnpj}}. Guia {{linkAutorizacao}}.'};
  const institucional={id:'inst',versao:2,tipo:'INSTITUCIONAL',chave:'escritorio',aprovadoEm:new Date(),dados:{escritorio:'Escritório Teste',procuradorCnpj:'04252011000110',linkAutorizacao:'https://www.gov.br/exemplo'}};
  const db={recursoComercial:{findFirst:jest.fn(async({where})=>where.tipo==='ORIENTACAO'?guia:institucional)}};
  return {db,guia,institucional};
}
const preparar=(f,extra={})=>prepararSolicitacaoAutorizacao({pre,db:f.db,mensagemId:'m',agora:new Date('2026-10-10T12:00:00Z'),...extra});

test('usa somente guia e dados institucionais aprovados, sem marcar autorização ativa',async()=>{
  const f=fixture();const r=await preparar(f);
  expect(r.texto).toContain('04.252.011/0001-10');
  expect(r.texto).toContain('11.222.333/0001-81');
  expect(r.texto).toContain('confirmará o recebimento');
  expect(r.solicitacao).toMatchObject({estado:'AGUARDANDO_AUTORIZACAO',cnpj:pre.cnpj,procuradorCnpj:'04252011000110',recursoId:'guia',recursoVersao:3});
  expect(r.solicitacao.prova).toBeUndefined();
  expect(f.db.recursoComercial.findFirst.mock.calls.every(([q])=>q.where.aprovadoEm.not===null)).toBe(true);
});

test.each(['guia','institucional'])('rascunho %s nunca vira orientação enviada',async qual=>{
  const f=fixture();f[qual].aprovadoEm=null;
  expect(await preparar(f)).toMatchObject({texto:null,solicitacao:{estado:'REVISAO_NECESSARIA'}});
});
test('CNPJ ausente ou inválido não usa valor padrão',async()=>{
  const f=fixture();f.institucional.dados.procuradorCnpj='';
  expect((await preparar(f)).texto).toBeNull();
});
test('guia com CNPJ literal divergente vai à equipe sem expor destino errado',async()=>{
  const f=fixture();f.guia.texto='Autorize o CNPJ 33.000.167/0001-01';
  expect((await preparar(f)).solicitacao.motivo).toBe('CNPJ_DIVERGENTE_NO_GUIA');
});
test('falha do recurso preserva encaminhamento para revisão humana',async()=>{
  const f=fixture();f.db.recursoComercial.findFirst.mockRejectedValue(new Error('banco indisponível'));
  expect((await preparar(f)).solicitacao.estado).toBe('REVISAO_NECESSARIA');
});
test('guia já solicitado ou autorização verificada não é duplicado',async()=>{
  const f=fixture();
  expect(await preparar(f,{pre:{...pre,autorizacaoFiscal:{estado:'AGUARDANDO_AUTORIZACAO',cnpj:pre.cnpj}}})).toBeNull();
  expect(await preparar(f,{autorizacaoAtual:{estado:'ATIVA',cnpj:pre.cnpj}})).toBeNull();
  expect(f.db.recursoComercial.findFirst).not.toHaveBeenCalled();
});
test('cliente dizer já autorizei não vira autorização ativa',async()=>{
  const f=fixture();
  expect((await preparar(f,{pre:{...pre,ultimoRelato:'Já autorizei'}})).solicitacao.estado).toBe('AGUARDANDO_AUTORIZACAO');
});
test.each([{...pre,cnpj:null},{...pre,intencao:'ABERTURA'},{...pre,intencao:'GESTAO'}])('não solicita fora de escopo: %j',p=>expect(necessitaAutorizacaoFiscal(p)).toBe(false));
test.each(['INATIVA','TRANSFERENCIA'])('intenção %s não exige dívida previamente declarada para analisar',intencao=>{
  expect(necessitaAutorizacaoFiscal({...pre,intencao,necessidade:'Quero ativar minha empresa',investigacaoPendencias:false,tipoPendencias:null})).toBe(true);
});
test('preparo solicita só depois da qualificação, sem sobrepor humano/pausa/falha',()=>{
  const args={texto:'20 mil',intencao:'INATIVA',anterior:pre,interpretacaoIa:{intencao:null,evidenciaIntencao:null,comportamento:'DADOS',dados:[{campo:'faturamento',valor:'20 mil',evidencia:'20 mil'}],resposta:null}};
  expect(prepararPreatendimento(args).solicitarAutorizacaoFiscal).toBe(true);
  expect(prepararPreatendimento({...args,anterior:{...pre,urgencia:null}}).solicitarAutorizacaoFiscal).toBe(false);
  expect(prepararPreatendimento({...args,falhaIa:true}).solicitarAutorizacaoFiscal).toBe(false);
  expect(prepararPreatendimento({...args,texto:'Quero uma pessoa',interpretacaoIa:{...args.interpretacaoIa,dados:[],comportamento:'HUMANO'}}).solicitarAutorizacaoFiscal).toBe(false);
  expect(prepararPreatendimento({...args,texto:'Aguarde',interpretacaoIa:{...args.interpretacaoIa,dados:[],comportamento:'PAUSAR'}}).solicitarAutorizacaoFiscal).toBe(false);
});
