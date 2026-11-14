import { prisma } from '../../../infrastructure/db/prisma.js';
import { revisaoEntrega } from '../EntregaExternaGuiaService.js';
import { enviosPorGuia, foiEnviadaComLegado } from '../EnvioGuiaService.js';
import { getGuidePdfBuffer, hashPdf, PUBLICO, toGuideResponse } from '../GuideService.js';
import { GuideStorageService } from '../GuideStorageService.js';
import { leituraDoPagamento } from '../lib/procedenciaDoPagamento.js';
import { montarRelatorioVencimento } from '../loteVencimento.js';

jest.mock('../../../infrastructure/db/prisma.js', () => ({
  prisma: { guide: { findMany: jest.fn() }, envioGuia: { findMany: jest.fn() } },
}));
jest.mock('../GuideStorageService.js', () => ({ GuideStorageService: { create: jest.fn() } }));

const empresa = { id: 'empresa-teste', company: { regimeTributario: 'SIMPLES' } };
const pdf = Buffer.from('%PDF-1.4\n% fixture do leitor de bytes');
const guia = {
  id: 'guia-teste', portalClientId: empresa.id, tipo: 'SIMPLES', competencia: '2026-12',
  vencimento: '2027-01-20', valor: 100, status: 'PROCESSED', paymentStatus: 'OPEN',
  pdfBytes: pdf, hash: hashPdf(pdf), liberadaCliente: false,
};

async function projetarEntrega(guiaAtual, declaracao) {
  prisma.guide.findMany.mockResolvedValueOnce([guiaAtual]);
  prisma.envioGuia.findMany.mockResolvedValueOnce([{
    guideId: guiaAtual.id, canal: 'EXTERNO', status: 'declarado_externo',
    tentativaAtualId: 'tentativa', historicoTentativas: [{ id: 'tentativa', snapshot: declaracao }],
  }]);
  const envios = await enviosPorGuia([guiaAtual.id]);
  const lote = montarRelatorioVencimento({
    mesVencimento: '2027-01', companies: [empresa], guides: [guiaAtual],
    enviada: g => foiEnviadaComLegado(envios.get(g.id), g),
  });
  return lote.simples[0];
}

test.each([
  ['OPEN', false, [guia.id]],
  ['PAID', true, []],
])('entrega externa e substituição de PDF com pagamento %s no lote por vencimento', async (paymentStatus, paga, pendentesAposTroca) => {
  const atual = { ...guia, paymentStatus };
  const declaracao = {
    guideId: atual.id, companyId: empresa.id, revisaoDocumento: revisaoEntrega(atual),
    atorId: 'contador-teste', registradoEm: '2027-01-11T12:00:00Z',
    dataEntrega: '2027-01-10', meio: 'PESSOAL',
  };
  const documento = { guideId: atual.id, competencia: '2026-12', paga };
  expect(await projetarEntrega(atual, declaracao)).toMatchObject({
    documentos: [{ ...documento, enviada: true }], pendingGuideIds: [],
  });
  expect(toGuideResponse(atual).liberadaCliente).toBe(false);

  const novoPdf = Buffer.from('%PDF-1.4\n% fixture substituta');
  const substituta = { ...atual, pdfBytes: novoPdf, hash: hashPdf(novoPdf) };
  expect(await projetarEntrega(substituta, declaracao)).toMatchObject({
    documentos: [{ ...documento, enviada: false }], pendingGuideIds: pendentesAposTroca,
  });
});

test.each([['PENDENTE', false], ['CONCLUIDA', true]])(
  'declaração do cliente com baixa %s conserva a falha do canal e a origem do pagamento',
  (estadoBaixa, baixada) => {
    const resposta = toGuideResponse({
      ...guia, liberadaCliente: true, paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE',
      baixada, confirmacaoCliente: { estadoBaixa },
      envios: [{ canal: 'WHATSAPP', status: 'falhou', tentativas: 1 }],
    }, { publico: PUBLICO.ESCRITORIO });
    expect(resposta).toMatchObject({
      status: 'PROCESSED', liberadaCliente: true, paymentStatus: 'PAID', baixada,
      envio: { jaEnviada: false, chegouAoCliente: false, algumFalhou: true },
    });
    expect(leituraDoPagamento(resposta)).toMatchObject({
      procedencia: 'CLIENTE', ehProva: false, alcancaOContabil: baixada,
    });
  },
);

test('PDF persistido tem precedência sobre storage e a falha da única cópia externa chega ao chamador', async () => {
  const falha = new Error('armazenamento indisponível');
  const downloadBuffer = jest.fn().mockRejectedValue(falha);
  GuideStorageService.create.mockReturnValue({ downloadBuffer });
  const comChave = { ...guia, storageKey: 'empresa-teste/guia.pdf' };
  await expect(getGuidePdfBuffer(comChave)).resolves.toEqual(pdf);
  expect(GuideStorageService.create).not.toHaveBeenCalled();
  await expect(getGuidePdfBuffer({ ...comChave, pdfBytes: null })).rejects.toBe(falha);
  expect(downloadBuffer).toHaveBeenCalledTimes(1);
  expect(downloadBuffer).toHaveBeenCalledWith({ key: comChave.storageKey });
});
