import { pathToPageName } from '../useManageAuthSession';
import { SEGMENT_TO_TAB, TAB_TO_SEGMENT, companyTabPath } from '../../../features/companies/detail/lib/rotasDaEmpresa';

const rotas = {
  '/login': 'login', '/companies': 'companies', '/companies/new': 'createCompany',
  '/guides/upload': 'guideUpload', '/guides/pending': 'pendingReport', '/guides/batch-email': 'batchEmail',
  '/firm-settings/guides': 'guideSettings', '/firm-settings/chart': 'chartOfAccountsGlobal',
  '/apuracao': 'apuracao', '/rotinas': 'rotinas', '/laboratorio': 'laboratorio', '/planejamento': 'planejamento',
  '/obrigacoes': 'obrigacoes', '/suporte': 'whatsapp', '/whatsapp': 'whatsapp',
  '/comercial': 'comercial', '/comercial/oportunidades': 'comercial', '/comercial/conversas': 'comercial',
  '/onboardings': 'onboardings', '/onboardings/new': 'onboardings', '/onboardings/id': 'onboardingDetail',
  '/onboardings/id/editar': 'onboardingWizard', '/biblioteca': 'bibliotecaComercial',
  '/whatsapp/comunicados': 'comunicadosWhatsapp', '/configuracoes': 'configuracoesGerais',
  '/configuracoes/atendimento': 'configuracoesGerais', '/configuracoes/cbs-ibs': 'credenciaisConsumo',
  '/funcoes-serpro': 'serproFuncoes', '/download-notas': 'serproFuncoes',
};
test.each(Object.entries(rotas))('%s resolve corretamente com e sem barra final', (rota, pagina) => {
  expect(pathToPageName(rota)).toBe(pagina);
  expect(pathToPageName(rota + '/')).toBe(pagina);
});
test.each(Object.entries(TAB_TO_SEGMENT))('link de %s conserva empresa e aba', (aba, segmento) => {
  const url = companyTabPath('empresa-b', aba);
  expect(url).toBe(`/companies/empresa-b/${segmento}`);
  expect(pathToPageName(url)).toBe('companyDetail');
  expect(SEGMENT_TO_TAB[segmento]).toBe(aba);
});
