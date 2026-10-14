import { identificarGuiaWhatsapp, ordenarGuiasWhatsapp, sequenciasGuiasWhatsapp } from '../IdentificacaoGuiaWhatsapp.js';
import { nomeArquivoDaGuia } from '../WhatsappCloudClient.js';

test('seleção intercalada mantém blocos por empresa e reinicia a numeração', () => {
  const guias = [
    { id: 'b1', portalClientId: 'b', tipo: 'DAS' },
    { id: 'a2', portalClientId: 'a', tipo: 'INSS' },
    { id: 'a1', portalClientId: 'a', tipo: 'DAS' },
  ];
  expect(ordenarGuiasWhatsapp(guias).map(g => g.id)).toEqual(['a1', 'a2', 'b1']);
  const sequencias = sequenciasGuiasWhatsapp(guias);
  expect(sequencias.get('a2')).toEqual({ indice: 2, total: 2 });
  expect(sequencias.get('b1')).toEqual({ indice: 1, total: 1 });
  expect(identificarGuiaWhatsapp({ empresa: 'EMPRESA A', tipoGuia: 'INSS', sequencia: sequencias.get('a2') })).toBe('EMPRESA A — Guia 2 de 2 — INSS');
});

test('não envia identificação sem empresa e não inventa numeração em envio avulso', () => {
  expect(() => identificarGuiaWhatsapp({ empresa: ' ', tipoGuia: 'DAS' })).toThrow('nome da empresa');
  expect(identificarGuiaWhatsapp({ empresa: 'EMPRESA B', tipoGuia: 'DAS' })).toBe('EMPRESA B — DAS');
});

test('nome do PDF distingue empresa, parcela e posição no lote, sem caracteres de caminho', () => {
  expect(nomeArquivoDaGuia({ empresa: 'EMPRESA A/B', tipoGuia: 'Parcela 2', competencia: '2026-09', sequencia: { indice: 2, total: 3 } })).toBe('PDF-EMPRESA_A-B-Parcela_2-2026-09-2de3.pdf');
});
