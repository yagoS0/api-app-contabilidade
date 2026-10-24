jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { interpretarColetaComercial } from '../interpretacaoComercialWhatsapp.js';
import { prepararPreatendimento, resumoComFicha } from '../preatendimentoComercial.js';
import { aplicarCampos, proximaPergunta } from '../LeadService.js';
import { dadosAnaliseDaFicha, normalizarRoteiroAnalise } from '../../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js';

test('volumes distintos chegam à mesma ficha e ao diagnóstico sem duplicação', () => {
 const leitura = interpretarColetaComercial({ origem: 'TRANSFERENCIA', texto: 'Tenho 2 funcionários, emito 40 notas por mês e recebo 12 notas por mês. Faturo 20.000,50 por mês.' });
 const dados = aplicarCampos('TRANSFERENCIA', {}, leitura.operacoes);
 expect(dados).toMatchObject({ qtdFuncionarios: 2, notasEmitidasMes: 40, notasRecebidasMes: 12, faturamentoMensal: 20000.5 });
 const roteiro = normalizarRoteiroAnalise({ dados: dadosAnaliseDaFicha({ dados }) }, 'TRANSFERENCIA');
 expect(roteiro.dados).toMatchObject({ funcionariosClt: 2, notasEmitidasMes: 40, documentosEntradaMes: 12, faturamentoMensal: 20000.5 });
});
test.each(['Tenho 40 notas', 'Não emito 40 notas por mês', 'Emito 40 notas por dia'])('não inventa volume mensal: %s', texto => {
 const dados = interpretarColetaComercial({ origem: 'TRANSFERENCIA', texto }).operacoes;
 expect(dados.some(o => /notas/.test(o.campo))).toBe(false);
});
test('pré-atendimento com IA aproveita volume espontâneo e mantém coleta curta', () => {
 const texto = 'Emito 40 notas por mês';
 const r = prepararPreatendimento({ texto, intencao: 'TRANSFERENCIA', mensagemId: 'm', dadosFicha: { responsavelNome: 'Ana', motivoTroca: 'Melhorar atendimento' }, interpretacaoIa: {
  intencao: null, evidenciaIntencao: null, comportamento: 'DADOS', dados: [{ campo: 'notasEmitidasMes', valor: '40', evidencia: texto }],
 } });
 expect(r.operacoes).toContainEqual({ campo: 'notasEmitidasMes', acao: 'set', valor: 40 });
 expect(r.encaminhar).toBe(true);
});
test('não sei permanece explícito e não volta como pergunta nem como zero', () => {
 const dados = aplicarCampos('TRANSFERENCIA', { cnpj: '11222333000181', responsavelNome: 'Ana', modalidadeServico: 'RECORRENTE' }, [{ campo: 'qtdFuncionarios', acao: 'set', valor: 'NAO_SEI' }]);
 expect(proximaPergunta({ origem: 'TRANSFERENCIA', dados }).campo).toBe('notasEmitidasMes');
 expect(normalizarRoteiroAnalise({ dados: dadosAnaliseDaFicha({ dados }) }, 'TRANSFERENCIA').dados).not.toHaveProperty('funcionariosClt');
});

 test('respostas atuais do formulário alimentam o contexto da IA sem repetir faturamento', () => {
  const resumo = resumoComFicha({ faturamento: 'antigo' }, { responsavelNome: 'Ana', faturamentoMensal: 12500, qtdFuncionarios: 0 });
  expect(resumo).toMatchObject({ nome: 'Ana', faturamento: '12500', faturamentoMensal: '12500', qtdFuncionarios: '0' });
  expect(resumoComFicha(resumo, { faturamentoMensal: 'NAO_SEI' })).toMatchObject({ dispensados: ['faturamento'] });
  expect(resumoComFicha(resumo, { faturamentoMensal: 'NAO_SEI' }).faturamento).toBeUndefined();
 });
