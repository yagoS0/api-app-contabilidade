import { configuracaoModeloContratoValida, motivoIncompatibilidadeContrato } from '../../../../../../packages/shared/src/onboarding/modeloContrato.js';
import { prepararCamposContrato } from '../ContratoComercialCampos.js';

const pf = { tipo: 'CONTRATO', texto: '{{nome}} {{cpf}} {{enderecoRepresentante}}', dados: { recorrente: false, permitePreCnpj: true, identificacaoContratante: 'PESSOA_FISICA', origens: ['ABERTURA'] } };
test('modelo PF da abertura não é utilizado na transferência nem com CNPJ já constituído', () => {
  const opcao = { recorrente: false };
  expect(motivoIncompatibilidadeContrato({ modelo: pf, onboarding: { origem: 'ABERTURA' }, opcao })).toBeNull();
  expect(motivoIncompatibilidadeContrato({ modelo: pf, onboarding: { origem: 'TRANSFERENCIA' }, opcao })).toMatch(/motivo/);
  expect(motivoIncompatibilidadeContrato({ modelo: pf, onboarding: { origem: 'ABERTURA', cnpj: '11222333000181' }, opcao })).toMatch(/pessoa jurídica/);
  expect(motivoIncompatibilidadeContrato({ modelo: pf, onboarding: { origem: 'ABERTURA' }, opcao: { recorrente: true } })).toMatch(/opção aceita/);
});
test('configurações incompatíveis não podem ser aprovadas', () => {
  expect(configuracaoModeloContratoValida(pf.dados)).toBe(true);
  expect(configuracaoModeloContratoValida({ ...pf.dados, origens: ['TRANSFERENCIA'] })).toBe(false);
  expect(configuracaoModeloContratoValida({ ...pf.dados, identificacaoContratante: 'PESSOA_JURIDICA' })).toBe(false);
  expect(configuracaoModeloContratoValida({ recorrente: true, origens: [] })).toBe(false);
  expect(configuracaoModeloContratoValida({ recorrente: true })).toBe(true);
});
test('endereço da empresa pretendida não vira endereço residencial da pessoa contratante', () => {
  const c = { modelo: pf, onboarding: { origem: 'ABERTURA', responsavelNome: 'Pessoa Exemplo', dados: { responsavelCpf: '52998224725', enderecoPretendido: 'Endereço futuro da empresa' } }, proposta: { status: 'ACEITA', opcaoAceita: 'AVULSO', snapshot: { opcoes: [{ chave: 'AVULSO', recorrente: false, unicoCentavos: 32100, mensalCentavos: 0 }] } } };
  expect(() => prepararCamposContrato(c)).toThrow(/endereço completo da pessoa/);
  expect(prepararCamposContrato({ ...c, variaveis: { enderecoRepresentante: 'Residência conferida da pessoa' } })).toMatchObject({ enderecoRepresentante: 'Residência conferida da pessoa', cpf: '52998224725' });
});
test.each([false, true])('regularização aceita entra uma única vez no total inicial (incluída: %s)', incluida => {
  const opcao = { chave: 'AVULSO', recorrente: false, unicoCentavos: 25000, mensalCentavos: 0, regularizacaoIncluida: incluida };
  const c = { modelo: { texto: '{{totalInicialHonorarios}} {{honorariosRegularizacao}} {{condicaoInicioMensal}} {{taxasPublicas}}' }, onboarding: {}, proposta: { status: 'ACEITA', opcaoAceita: 'AVULSO', snapshot: { opcoes: [opcao], regularizacaoCentavos: 25000, decisaoRegularizacao: { necessaria: true, condicaoInicioMensal: 'Somente após execução conferida da regularização.' }, taxasCentavos: 10000, taxasConfirmadas: false } }, variaveis: { totalInicialHonorarios: '0', honorariosRegularizacao: '0', condicaoInicioMensal: 'Imediato', taxasPublicas: '0' } };
  const d = prepararCamposContrato(c);
  expect(d.totalInicialHonorarios).toContain(incluida ? '250,00' : '500,00');
  expect(d.honorariosRegularizacao).toContain(incluida ? 'Incluída' : '250,00');
  expect(d.condicaoInicioMensal).toBe('Não há acompanhamento mensal nesta contratação.');
  expect(d.taxasPublicas).toMatch(/A confirmar/);
});
test.each(['APOS_REGULARIZACAO', 'SEM_REGULARIZACAO'])('condição mensal %s aparece em linguagem de contrato', condicaoInicioMensal => {
  const dados = prepararCamposContrato({ modelo: { texto: '{{condicaoInicioMensal}}' }, proposta: { status: 'ACEITA', opcaoAceita: 'RECORRENTE', snapshot: { opcoes: [{ chave: 'RECORRENTE', recorrente: true, unicoCentavos: 0, mensalCentavos: 12300 }], decisaoRegularizacao: { condicaoInicioMensal } } } });
  expect(dados.condicaoInicioMensal).not.toContain('_');
  expect(dados.condicaoInicioMensal).toMatch(condicaoInicioMensal === 'APOS_REGULARIZACAO' ? /Após a execução e conferência/ : /não há regularização prévia/);
});
