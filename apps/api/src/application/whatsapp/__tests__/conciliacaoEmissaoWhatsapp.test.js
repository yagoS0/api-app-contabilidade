import { listarEmissoesInterrompidas, conferirEmissaoInterrompida } from '../ConciliacaoEmissaoWhatsappService.js';
import { comControleEmissao, conferirControleEmissao, persistirDesfechoControlado } from '../ControleEmissaoWhatsapp.js';

function ambiente() {
  const acao = { id: 'a', conversaId: 'c', portalClientId: 'p', tipo: 'EMITIR_NFSE', status: 'confirmada', updatedAt: new Date(), resultado: { nfseId: 'n', indeterminado: true } };
  const nota = { id: 'n', companyId: 'l', status: 'pending', updatedAt: new Date(), configuracaoFiscal: {}, idDps: 'dps' };
  let ocupado = false;
  const client = {
    $transaction: async fn => {
      let adquiriu = false;
      try { return await fn({ $queryRaw: async strings => {
        if (strings.join('').includes('pg_try')) { adquiriu = !ocupado; if (adquiriu) ocupado = true; return [{ acquired: adquiriu }]; }
        return [{ alive: 1 }];
      } }); } finally { if (adquiriu) ocupado = false; }
    },
    acaoPendenteWhatsapp: {
      findMany: async () => [{ ...acao }],
      findFirst: async ({ where }) => where.id === acao.id && where.conversaId === acao.conversaId && where.portalClientId === acao.portalClientId ? { ...acao } : null,
      findUnique: async () => ({ ...acao }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.status !== acao.status || JSON.stringify(where.resultado.equals) !== JSON.stringify(acao.resultado)) return { count: 0 };
        Object.assign(acao, data); return { count: 1 };
      }),
    },
    portalClient: { findUnique: async () => ({ id: 'p', companyId: 'l', razao: 'SINTETICA' }) },
    serviceInvoice: {
      findFirst: async ({ where }) => where.id === nota.id && where.companyId === nota.companyId ? { ...nota } : null,
      findUnique: async () => ({ ...nota }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (JSON.stringify(where.configuracaoFiscal.equals) !== JSON.stringify(nota.configuracaoFiscal)) return { count: 0 };
        Object.assign(nota, data); return { count: 1 };
      }),
    },
  };
  const conferirEscopo = jest.fn(async () => ({ id: 'c', portalClientId: 'p' }));
  const args = { habilitada: true, conversaId: 'c', acaoId: 'a', autorId: 'contador', motivo: 'Conferência supervisionada', client, conferirEscopo };
  const versao = async () => (await listarEmissoesInterrompidas(args)).itens[0].versao;
  return { client, acao, nota, args, versao };
}

test('MESMA resolve ação, conserva histórico e replay da versão não consulta novamente', async () => {
  const a = ambiente();
  const consultar = jest.fn(async ({ supervisao }) => { await conferirControleEmissao(supervisao); return { estado: 'MESMA', recuperada: true, nfse: { ...a.nota, status: 'issued', chaveAcesso: '3'.repeat(50), numeroNfse: '18' } }; });
  const args = { ...a.args, versao: await a.versao(), consultar };
  const r = await conferirEmissaoInterrompida(args);
  expect(r).toMatchObject({ recuperada: true, item: { situacao: 'RECUPERADA', podeConferir: false } });
  expect(a.acao.resultado).toMatchObject({ indeterminado: false, supervisoes: [expect.objectContaining({ autorId: 'contador', estado: 'MESMA' })] });
  await expect(conferirEmissaoInterrompida(args)).rejects.toMatchObject({ code: 'NFSE_CONCILIACAO_ESTADO_ALTERADO' });
  expect(consultar).toHaveBeenCalledTimes(1);
});
test.each(['OUTRA', 'INCONCLUSIVA'])('%s nunca resolve nem libera nova emissão', async estado => {
  const a = ambiente();
  const r = await conferirEmissaoInterrompida({ ...a.args, versao: await a.versao(), consultar: async () => ({ estado, recuperada: false }) });
  expect(r.recuperada).toBe(false); expect(a.acao.resultado.indeterminado).toBe(true); expect(a.acao.status).toBe('confirmada');
});
test('timeout preserva auditoria e bloqueio', async () => {
  const a = ambiente();
  const r = await conferirEmissaoInterrompida({ ...a.args, versao: await a.versao(), consultar: async () => { throw Error('timeout'); } });
  expect(r.estado).toBe('INCONCLUSIVA'); expect(a.acao.resultado.supervisoes).toHaveLength(1);
});
test('legado sem vínculo registra encaminhamento sem consultar', async () => {
  const a = ambiente(); delete a.acao.resultado.nfseId;
  const consultar = jest.fn();
  expect((await conferirEmissaoInterrompida({ ...a.args, versao: await a.versao(), consultar })).estado).toBe('LEGADO_SEM_TENTATIVA');
  expect(consultar).not.toHaveBeenCalled(); expect(a.acao.encaminharHumano).toBe(true);
});
test('executor vivo bloqueia supervisão independentemente de timestamps', async () => {
  const a = ambiente(); const v = await a.versao();
  await comControleEmissao({ acaoId: 'a', client: a.client, executar: async () => {
    expect((await listarEmissoesInterrompidas(a.args)).itens[0].situacao).toBe('PROCESSANDO');
    await expect(conferirEmissaoInterrompida({ ...a.args, versao: v })).rejects.toMatchObject({ code: 'NFSE_EXECUCAO_ATIVA' });
  } });
});
test('ação de outra empresa é recusada antes de consultar', async () => {
  const a = ambiente(); a.acao.portalClientId = 'outra'; const consultar = jest.fn();
  await expect(conferirEmissaoInterrompida({ ...a.args, versao: 'x', consultar })).rejects.toMatchObject({ status: 404 });
  expect(consultar).not.toHaveBeenCalled();
});
test('falha ao auditar impede consulta', async () => {
  const a = ambiente(); const v = await a.versao(); const consultar = jest.fn();
  a.client.acaoPendenteWhatsapp.updateMany.mockRejectedValue(Error('banco'));
  await expect(conferirEmissaoInterrompida({ ...a.args, versao: v, consultar })).rejects.toThrow('banco'); expect(consultar).not.toHaveBeenCalled();
});
test('capability expirada não autoriza POST e resposta tardia preserva emissão recuperada', async () => {
  const a = ambiente(); let controle;
  await comControleEmissao({ acaoId: 'a', client: a.client, executar: async c => { controle = c; } });
  await expect(conferirControleEmissao(controle)).rejects.toMatchObject({ code: 'NFSE_SUPERVISAO_INVALIDA' });
  const versao = { ...a.nota };
  Object.assign(a.nota, { status: 'issued', chaveAcesso: '3'.repeat(50), numeroNfse: '18', configuracaoFiscal: { prova: 'supervisao' } });
  const r = await persistirDesfechoControlado({ client: a.client, controle, invoiceId: 'n', versao, data: { status: 'falha_envio', falhaCodigo: 'TIMEOUT' } });
  expect(r.status).toBe('issued'); expect(r.configuracaoFiscal.prova).toBe('supervisao'); expect(r.configuracaoFiscal.historicoDesfechos[0].tardio).toBe(true);
});

test('flag desligada bloqueia comando antes de lock e auditoria', async () => {
  const a = ambiente(); const consultar = jest.fn(); a.client.$transaction = jest.fn();
  await expect(conferirEmissaoInterrompida({ ...a.args, habilitada: false, versao: 'v', consultar })).rejects.toMatchObject({ status: 503 });
  expect(a.client.$transaction).not.toHaveBeenCalled(); expect(consultar).not.toHaveBeenCalled();
  expect(a.client.acaoPendenteWhatsapp.updateMany).not.toHaveBeenCalled();
});

test.each([false, true])('token alheio cerca executor mesmo com snapshot relido: %s', async relido => {
  const a = ambiente();
  await comControleEmissao({ acaoId: 'a', client: a.client, executar: async controle => {
    a.nota.configuracaoFiscal = { controleEmissaoToken: controle.token };
    const versao = { ...a.nota };
    const novo = { controleEmissaoToken: 'supervisor-novo', historicoConciliacoes: [{ estado: 'EM_CONFERENCIA' }] };
    if (relido) { a.nota.configuracaoFiscal = novo; versao.configuracaoFiscal = novo; }
    else {
      const update = a.client.serviceInvoice.updateMany.getMockImplementation(); let primeira = true;
      a.client.serviceInvoice.updateMany.mockImplementation(async args => { if (primeira) { primeira = false; a.nota.configuracaoFiscal = novo; } return update(args); });
    }
    const r = await persistirDesfechoControlado({ client: a.client, controle, invoiceId: 'n', versao, data: { status: 'falha_envio' } });
    expect(r.status).toBe('pending'); expect(r._controleAplicado).toBe(false);
    expect(r.configuracaoFiscal.controleEmissaoToken).toBe('supervisor-novo');
    expect(r.configuracaoFiscal.historicoConciliacoes).toEqual(novo.historicoConciliacoes);
    expect(r.configuracaoFiscal.historicoDesfechos.at(-1).tardio).toBe(true);
  } });
});
test('claim da supervisão relê emissão que venceu antes dele sem rebaixar', async () => {
  const a = ambiente(); const update = a.client.serviceInvoice.updateMany.getMockImplementation(); let primeira = true;
  a.client.serviceInvoice.updateMany.mockImplementation(async args => {
    if (primeira) { primeira = false; Object.assign(a.nota, { status: 'issued', configuracaoFiscal: { prova: 'resposta anterior' }, numeroNfse: '10', chaveAcesso: '3'.repeat(50) }); }
    return update(args);
  });
  const consultar = jest.fn(async () => ({ estado: 'MESMA', recuperada: true, nfse: { ...a.nota } }));
  const r = await conferirEmissaoInterrompida({ ...a.args, versao: await a.versao(), consultar });
  expect(r.recuperada).toBe(true); expect(a.nota.status).toBe('issued'); expect(a.nota.configuracaoFiscal.prova).toBe('resposta anterior');
});
