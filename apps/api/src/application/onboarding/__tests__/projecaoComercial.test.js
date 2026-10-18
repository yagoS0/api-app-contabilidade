import { projetarComercial, projetarComerciais, evidenciasDiagnostico, etapasComEvidencias } from '../ProjecaoComercialService.js';
import { montarJornadaComercial } from '../PoliticaJornadaComercial.js';

const ficha = { id: 'f1', origem: 'TRANSFERENCIA', cnpj: '11222333000181', status: 'EM_TRILHA', faseComercial: 'CONTRATADO', dados: {}, versao: 2 };
function banco(propostas = [], contratos = [], marcos = []) {
  return {
    onboardingAnalise: { findMany: jest.fn(async () => []) },
    onboardingEvento: { findMany: jest.fn(async ({ where }) => where.tipo?.in?.includes('PAGAMENTO_HONORARIOS_CONFERIDO') ? marcos : []) },
    propostaComercial: { findMany: jest.fn(async () => propostas) },
    contratoComercial: { findMany: jest.fn(async () => contratos) },
    atendimentoLead: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    mensagemWhatsapp: { findMany: jest.fn(async () => []) },
  };
}
test('fase manual e EM_TRILHA não inventam implantação ou aceite', async () => {
  const db = banco();
  const p = await projetarComercial(ficha, db);
  expect(p.atual).toBe('publica');
  expect(p.passos.find(x => x.id === 'proposta').concluido).toBe(false);
  expect(db.propostaComercial.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { onboardingId: ficha.id } }));
});

test('DTO da lista e ficha não expõe token, snapshot ou conteúdo do contrato', async () => {
  const db = banco([{ id: 'p', onboardingId: ficha.id, status: 'ACEITA', opcaoAceita: 'RECORRENTE', tokenHash: 'segredo-token', snapshot: { privado: 'precos-privados' } }], [{ id: 'c', onboardingId: ficha.id, propostaId: 'p', status: 'ASSINADO_CONFERIDO', texto: 'corpo-privado', dados: { opcao: { chave: 'RECORRENTE', recorrente: true } } }]);
  for (const p of [await projetarComercial(ficha, db), (await projetarComerciais([ficha], db)).get(ficha.id)]) {
    expect(p.contratacao).toMatchObject({ ganha: true, propostaId: 'p', contratoId: 'c' });
    expect(JSON.stringify(p)).not.toMatch(/segredo-token|precos-privados|corpo-privado|tokenHash|snapshot/);
  }
});
test('resumo usa a mesma política da conversa, inclusive proposta aceita entre versões', async () => {
  const propostas = [{ id: 'nova', status: 'RASCUNHO' }, { id: 'aceita', status: 'ACEITA', opcaoAceita: 'RECORRENTE' }];
  const contratos = [{ id: 'c1', propostaId: 'aceita', status: 'ASSINADO_CONFERIDO', dados: { opcao: { chave: 'RECORRENTE', recorrente: true } } }];
  const p = await projetarComercial(ficha, banco(propostas, contratos));
  const politica = montarJornadaComercial({ onboarding: ficha, propostas, contratos, jornada: {} });
  expect(p.atual).toBe(politica.atual);
  expect(p.atual).toBe('pagamento');
});
test('erro de leitura propaga, não vira qualificação vazia', async () => {
  const db = banco(); db.onboardingAnalise.findMany.mockRejectedValue(new Error('offline'));
  await expect(projetarComercial(ficha, db)).rejects.toThrow('offline');
});
test('relatório conferido satisfaz somente SITFIS; autorização conserva escopo e validade', () => {
  const j = { analises: [{ id: 'a', cnpj: ficha.cnpj, tipo: 'SITFIS', status: 'CONCLUIDA', resultado: { relatorioDisponivel: true }, createdAt: '2026-10-17' }], fiscalConferido: true };
  const atendimento = { id: 'l1', autorizacao: { cnpj: ficha.cnpj, estado: 'ATIVA', prova: { validUntil: '2026-12-01', checkedAt: '2026-10-17' } } };
  const evidencias = evidenciasDiagnostico(ficha, j, atendimento);
  expect(evidencias.find(e => e.chave === 'procuracao_ecac')).toMatchObject({ satisfaz: false, validade: '2026-12-01' });
  expect(etapasComEvidencias([{ id: 's', chave: 'sitfis' }], evidencias)[0].evidencias[0]).toMatchObject({ id: 'a', satisfaz: true });
  expect(evidenciasDiagnostico({ ...ficha, cnpj: 'outro' }, j, atendimento)).toEqual([]);
  expect(evidenciasDiagnostico(ficha, { ...j, fiscalConferido: false }, null)).toEqual([]);
});

test('execução pendente e estados terminais têm rótulos distintos', async () => {
  const propostas = [{ id: 'p', status: 'ACEITA', opcaoAceita: 'RECORRENTE' }];
  const contratos = [{ id: 'c', propostaId: 'p', status: 'ASSINADO_CONFERIDO', dados: { opcao: { chave: 'RECORRENTE', recorrente: true } } }];
  const marcos = [{ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'c' } }];
  expect(await projetarComercial(ficha, banco(propostas, contratos, marcos))).toMatchObject({ atual: 'conclusao', titulo: 'Ganha · entrada na carteira disponível', encerrado: false });
  for (const [status, titulo] of [['CONVERTIDO', 'Na carteira · implantação em acompanhamento'], ['DESISTIU', 'Atendimento encerrado por desistência'], ['CONCLUIDO_AVULSO', 'Serviço avulso concluído']]) {
    expect(await projetarComercial({ ...ficha, status }, banco())).toMatchObject({ titulo, encerrado: true });
  }
});

test('validade expirada é histórica e não concede acesso operacional', () => {
  const [prova] = evidenciasDiagnostico(ficha, {}, { id: 'caso', autorizacao: { cnpj: ficha.cnpj, estado: 'ATIVA', prova: { validUntil: '2026-01-01' } } }, new Date('2026-10-17'));
  expect(prova).toMatchObject({ estadoRegistrado: 'ATIVA', historica: true, satisfaz: false });
  expect(prova.estado).toContain('EXPIRADA');
});

test('lote preserva janelas individuais de 100 análises/conferências e preserva marcos antigos, inclusive outra ficha', async () => {
  const fichas = [ficha, { ...ficha, id: 'f2' }];
  const db = banco();
  const propostas = fichas.map(f => ({ onboardingId: f.id, id: `p-${f.id}`, status: 'ACEITA', opcaoAceita: 'RECORRENTE' }));
  const contratos = fichas.map(f => ({ onboardingId: f.id, id: `c-${f.id}`, propostaId: `p-${f.id}`, status: 'ASSINADO_CONFERIDO', dados: { opcao: { chave: 'RECORRENTE', recorrente: true } } }));
  const marcos = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `m-${i}`, onboardingId: 'f1', tipo: 'ANALISE_REVISADA' })),
    { onboardingId: 'f1', tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'c-f1' } },
    { onboardingId: 'f2', tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'c-f2' } },
  ];
  const analises = [
    ...Array.from({ length: 100 }, (_, i) => ({ id: `a-${i}`, onboardingId: 'f1', cnpj: ficha.cnpj, tipo: 'PUBLICA', status: 'CONCLUIDA' })),
    { id: 'antiga', onboardingId: 'f1', cnpj: ficha.cnpj, tipo: 'SITFIS', status: 'CONCLUIDA', resultado: { relatorioDisponivel: true } },
    { id: 'vigente', onboardingId: 'f2', cnpj: ficha.cnpj, tipo: 'SITFIS', status: 'CONCLUIDA', resultado: { relatorioDisponivel: true } },
  ];
  const conferencias = [{ onboardingId: 'f1', tipo: 'JORNADA_SITFIS_CONFERIDA', dados: { analiseId: 'antiga' } }, { onboardingId: 'f2', tipo: 'JORNADA_SITFIS_CONFERIDA', dados: { analiseId: 'vigente' } }];
  db.onboardingAnalise.findMany.mockResolvedValue(analises);
  db.propostaComercial.findMany.mockResolvedValue(propostas);
  db.contratoComercial.findMany.mockResolvedValue(contratos);
  db.onboardingEvento.findMany.mockImplementation(async ({ where }) => where.tipo?.in?.includes('PAGAMENTO_HONORARIOS_CONFERIDO') ? marcos : where.tipo?.in?.includes('JORNADA_SITFIS_CONFERIDA') ? conferencias : []);
  const lote = await projetarComerciais(fichas, db);
  expect(lote.get('f1')).toMatchObject({ atual: 'conclusao', evidencias: [] });
  expect(lote.get('f2')).toMatchObject({ atual: 'conclusao', evidencias: [expect.objectContaining({ id: 'vigente', satisfaz: true })] });
  expect(db.onboardingEvento.findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
});
