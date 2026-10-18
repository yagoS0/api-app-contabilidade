import { projetarContratacao, validarContratacaoExterna } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';

const ficha = () => ({ onboarding: { id: 'o', origem: 'TRANSFERENCIA', status: 'EM_TRILHA', faseComercial: 'CONTRATADO' }, propostas: [{ id: 'p', status: 'ACEITA', opcaoAceita: 'RECORRENTE' }], contratos: [{ id: 'c', propostaId: 'p', status: 'ASSINADO_CONFERIDO', dados: { opcao: { chave: 'RECORRENTE', recorrente: true } } }], marcos: [] });
test('T31: fase manual e checklist não comprovam contratação', () => {
  const e = ficha(); e.propostas = []; e.contratos = [];
  expect(projetarContratacao(e)).toMatchObject({ ganha: false, carteiraPermitida: false, excecaoAplicavel: true });
});
test('T32/T33: assinatura libera implantação; pagamento do contrato libera carteira', () => {
  const e = ficha();
  expect(projetarContratacao(e)).toMatchObject({ ganha: true, implantacaoPermitida: true, carteiraPermitida: false });
  e.marcos.push({ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'outro' } });
  expect(projetarContratacao(e).carteiraPermitida).toBe(false);
  e.marcos.push({ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'c' } });
  expect(projetarContratacao(e).carteiraPermitida).toBe(true);
});
test.each(['opcao', 'revogada', 'minuta'])('T37: %s não comprova assinatura da contratação atual', caso => {
  const e = ficha();
  if (caso === 'opcao') e.propostas[0].opcaoAceita = 'AVULSO';
  if (caso === 'revogada') e.propostas[0].revogadaEm = '2026-10-18';
  if (caso === 'minuta') e.contratos[0].status = 'MINUTA';
  expect(projetarContratacao(e)).toMatchObject({ ganha: false, carteiraPermitida: false, excecaoAplicavel: false });
});
test('T34: origem externa não fabrica marcos internos e mantém histórico', () => {
  const e = ficha(); e.onboarding.status = 'CONVERTIDO'; e.propostas = []; e.contratos = [];
  e.marcos = [{ tipo: 'CONVERTIDO', dados: { contratacao: { origem: 'EXTERNA', evidencia: 'Contrato sintético externo' } } }];
  const antes = JSON.stringify(e);
  expect(projetarContratacao(e)).toMatchObject({ ganha: false, naCarteira: true, externa: { origem: 'EXTERNA' } });
  expect(JSON.stringify(e)).toBe(antes);
});
test('T35: exceção exige confirmação, versão, justificativa e evidência', () => {
  const e = { confirmada: true, versao: 2, justificativa: 'Cliente contratado externamente', evidencia: 'Contrato externo de teste 001' };
  expect(validarContratacaoExterna(e, 2)).toBeNull();
  for (const patch of [{ confirmada: false }, { versao: 1 }, { justificativa: '   ' }, { evidencia: '' }, { evidencia: 'a'.repeat(2001) }]) expect(validarContratacaoExterna({ ...e, ...patch }, 2)).toBeTruthy();
});
test('T38: PF e avulso podem ser ganhos sem entrada na carteira', () => {
  const e = ficha(); e.onboarding.origem = 'PESSOA_FISICA';
  e.marcos = [{ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'c' } }];
  expect(projetarContratacao(e)).toMatchObject({ ganha: true, carteiraPermitida: false, excecaoAplicavel: false });
  e.onboarding.origem = 'ABERTURA'; e.contratos[0].dados.opcao.recorrente = false;
  expect(projetarContratacao(e)).toMatchObject({ ganha: true, carteiraPermitida: false });
});
