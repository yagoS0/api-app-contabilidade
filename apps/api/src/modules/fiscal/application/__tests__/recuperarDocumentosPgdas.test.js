import { recuperarDocumentosPgdas, consultarDocumentosPgdas } from '../recuperarDocumentosPgdas.js';
const entrada = { portalClientId: 'p1', competencia: '2026-10', confirmCompetencia: '2026-10' };
function fixture() {
  const estado = { company: { cnpj: '12345678000199' } };
  const portas = { autorizar: jest.fn(async () => {}), ler: jest.fn(async () => estado),
    registrarConsulta: jest.fn(async dados => { estado.consulta = dados; }),
    consultarIndice: jest.fn(async () => ({ status: 200, dados: JSON.stringify([{ numeroDeclaracao: 'oficial' }]) })),
    recuperarExtrato: jest.fn(async () => { estado.circular = { pgdasNumeroDeclaracao: 'oficial', pgdasDeclaracaoFileId: 'd', pgdasReciboFileId: 'r', dasTotal: 100 }; }),
    recuperarGuia: jest.fn(async () => { estado.guide = { id: 'g', extracted: { pgdasNumeroDeclaracao: 'oficial' }, pdfBytes: Buffer.from('%PDF'), valor: 100 }; }) };
  return { estado, portas };
}
test('consulta não recebe nem executa efeitos', async () => { const { portas } = fixture(); await consultarDocumentosPgdas(entrada, portas); expect(portas.consultarIndice).not.toHaveBeenCalled(); expect(portas.recuperarGuia).not.toHaveBeenCalled(); });
test('negação ocorre antes de ler ou consultar', async () => {
  const { portas } = fixture(); portas.autorizar.mockRejectedValue(Object.assign(new Error('negado'), { code: 'ACESSO_NEGADO' }));
  await expect(recuperarDocumentosPgdas(entrada, portas)).rejects.toThrow(); expect(portas.ler).not.toHaveBeenCalled();
});
test('recupera documentos depois da prova oficial sem calcular ou transmitir', async () => {
  const { portas } = fixture(); const out = await recuperarDocumentosPgdas(entrada, portas);
  expect(out.completos).toBe(true); expect(out.origem).toBe('EXTERNA'); expect(out.numeroDeclaracao).toBe('oficial');
});
test('falha documental preserva confirmação oficial e impede outro despacho', async () => {
  const { portas } = fixture(); portas.recuperarExtrato.mockRejectedValue(new Error('falha'));
  const out = await recuperarDocumentosPgdas(entrada, portas); expect(out.partial).toBe(true); expect(out.transmissao.confirmada).toBe(true); expect(portas.recuperarGuia).not.toHaveBeenCalled();
});
test('índice ambíguo não despacha nem persiste documentos', async () => {
  const { portas } = fixture(); portas.consultarIndice.mockResolvedValue({ dados: '[{"numeroDeclaracao":"1"},{"numeroDeclaracao":"2"}]' });
  await expect(recuperarDocumentosPgdas(entrada, portas)).rejects.toThrow(); expect(portas.recuperarExtrato).not.toHaveBeenCalled();
});
test('repetição com documentos completos só lê', async () => {
  const { portas } = fixture(); await recuperarDocumentosPgdas(entrada, portas); portas.consultarIndice.mockClear();
  expect((await recuperarDocumentosPgdas(entrada, portas)).completos).toBe(true); expect(portas.consultarIndice).not.toHaveBeenCalled();
});
test('revogação durante consulta interrompe antes da persistência', async () => {
  const { portas } = fixture(); portas.autorizar.mockResolvedValueOnce().mockRejectedValue(Object.assign(new Error('revogado'), { code: 'ACESSO_NEGADO' }));
  await expect(recuperarDocumentosPgdas(entrada, portas)).rejects.toThrow(); expect(portas.recuperarExtrato).not.toHaveBeenCalled();
});

test('prova persistida precede documentos e sobrevive à reabertura após falha', async () => {
  const { estado, portas } = fixture(); portas.recuperarExtrato.mockRejectedValue(new Error('storage'));
  await recuperarDocumentosPgdas(entrada, portas);
  expect(portas.registrarConsulta).toHaveBeenCalledWith(expect.objectContaining({ numeroDeclaracao: 'oficial', cnpj: estado.company.cnpj }));
  const reaberto = await consultarDocumentosPgdas(entrada, portas);
  expect(reaberto.transmissao.confirmada).toBe(true); expect(reaberto.origem).toBe('EXTERNA'); expect(reaberto.partial).toBe(true);
});
test('falha ao persistir evidência impede próximo despacho', async () => {
  const { portas } = fixture(); portas.registrarConsulta.mockRejectedValue(new Error('db'));
  await expect(recuperarDocumentosPgdas(entrada, portas)).rejects.toThrow('db'); expect(portas.recuperarExtrato).not.toHaveBeenCalled();
});
