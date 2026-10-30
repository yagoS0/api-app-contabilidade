import crypto from "node:crypto";
import { prepararArquivoConversao, conferirFontesDoArquivo } from "../ArquivoConversaoService.js";
import { validateAndNormalizeCompanyProfile } from "../../company/companyProfile.js";
import { contextoContrato } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';
jest.mock('../PropostaComercialPdf.js', () => ({ propostaParaCliente: p => p, gerarPropostaPdf: async () => Buffer.from('%PDF-proposta-sintetica') }));
jest.mock('../ContratoComercialPdf.js', () => ({ gerarContratoPdf: async () => Buffer.from('%PDF-contrato-sintetico') }));
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
const buffer = Buffer.from("%PDF-1.4\nSINTÉTICO\n%%EOF"), sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
const fonte = { id: "doc-teste", nome: "teste.pdf", mime: "application/pdf", sha256, conteudoCifrado: "cifra" };

test('R35 pago arquiva minuta sem inventar assinatura; assinatura declarada exige original', async () => {
  const proposta = { id: 'p', versao: 1, status: 'ACEITA', opcaoAceita: 'mensal', snapshot: {} };
  const contrato = { id: 'c', propostaId: 'p', status: 'AGUARDANDO_ASSINATURA', dados: { politicaContratacao: 'R35', opcao: { chave: 'mensal' } } };
  const marcos = [{ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', atorId: 'contador', dados: { contratoId: 'c', politica: 'R35', confirmadoEm: '2026-10-21', contextoContrato: contextoContrato(proposta, contrato) } }];
  const db = { documentoOnboarding: { findMany: async () => [] }, onboardingEvento: { findMany: async () => marcos } };
  const storage = { upload: jest.fn(async () => {}) };
  expect((await prepararArquivoConversao({ db, onboardingId: 'o', proposta, contrato, storage })).documentos).toHaveLength(2);
  contrato.status = 'ASSINADO_CONFERIDO';
  await expect(prepararArquivoConversao({ db, onboardingId: 'o', proposta, contrato, storage })).rejects.toMatchObject({ code: 'arquivo_conversao_indisponivel' });
});
test("storage indisponível não produz um arquivo de conversão utilizável", async () => {
  const db = { documentoOnboarding: { findMany: jest.fn().mockResolvedValue([fonte]) } };
  const storage = { upload: jest.fn().mockRejectedValue(Error("Sem storage")) };
  await expect(prepararArquivoConversao({ db, onboardingId: "onb", storage, decifrar: async () => buffer.toString("base64") })).rejects.toMatchObject({ code: "arquivo_conversao_indisponivel" });
});
test("anexo que chega durante a preparação invalida o fechamento, sem perda silenciosa", async () => {
  const db = { documentoOnboarding: { findMany: jest.fn().mockResolvedValue([fonte]) } };
  const storage = { upload: jest.fn().mockResolvedValue({}) };
  const arquivo = await prepararArquivoConversao({ db, onboardingId: "onb", storage, decifrar: async () => buffer.toString("base64") });
  db.documentoOnboarding.findMany.mockResolvedValue([fonte, { ...fonte, id: "novo" }]);
  await expect(conferirFontesDoArquivo(db, "onb", arquivo)).rejects.toMatchObject({ code: "documentos_alterados" });
});
test("capital e participação numéricos conservam centavos e casas decimais", () => {
  const perfil = validateAndNormalizeCompanyProfile({ razaoSocial: "Exemplo", cnpj: "11222333000181", regimeTributario: "SIMPLES", cnaePrincipal: "7020400", endereco: { rua: "Rua", numero: "1", bairro: "Centro", cidade: "São Paulo", uf: "SP", cep: "01001000" }, capitalSocial: 25000.5, socios: [{ nome: "Ana", participacao: 60.5 }] });
  expect(perfil.ok).toBe(true); expect(perfil.data.capitalSocial).toBe(25000.5); expect(perfil.data.socios[0].participacao).toBe(60.5);
});

import { prepararConversao, payloadConversao } from '../../../../../../apps/web/src/features/onboarding/lib/conversaoEmpresa.js';

test('abertura com titular chega ao contrato de provisionamento com IPTU e legado separados', () => {
  const endereco = { rua: 'Rua Sintética', semNumero: true, bairro: 'Centro', cidade: 'Recife', uf: 'PE', cep: '50000000', inscricaoImobiliaria: '000AB-012' };
  const ficha = { origem: 'ABERTURA', razaoSocial: 'Empresa Sintética', cnpj: '11222333000181', responsavelEmail: 'ana@example.invalid', dados: { tipoEmpresa: 'EI', titular: [{ nome: 'Ana Teste', cpf: '52998224725' }], enderecoAbertura: endereco, enderecoPretendido: 'Texto antigo preservado' } };
  const form = { ...prepararConversao(ficha), regimeTributario: 'SIMPLES', cnaePrincipal: '7020400', hasProlabore: false, temFolha: false };
  const payload = payloadConversao(form, { senhaExigida: false });
  const perfil = validateAndNormalizeCompanyProfile(payload.company);
  expect(perfil.ok).toBe(true);
  expect(perfil.data.titular).toEqual(ficha.dados.titular[0]);
  expect(perfil.data.socios).toEqual([]);
  expect(perfil.data.endereco).toMatchObject({ ...endereco, numero: 'S/N', legado: 'Texto antigo preservado' });
  expect(perfil.data.inscricaoMunicipal).toBeNull();
  expect(ficha.dados.enderecoAbertura).toEqual(endereco);
});

test('C1: arquiva contrato futuro conferido sem pagamento; versão divergente mantém bloqueio', async () => {
  const onboarding = { politicaComercial: 'COMERCIAL_2026_10_V1' };
  const proposta = { id: 'p', versao: 1, status: 'ACEITA', opcaoAceita: 'mensal' };
  const contrato = { id: 'c', propostaId: 'p', status: 'AGUARDANDO_ASSINATURA', aprovadoPor: 'contador', aprovadoEm: '2026-10-25', texto: 'Pagamento previsto em data futura.',
    dados: { politicaContratacao: 'R35', opcao: { chave: 'mensal' }, condicaoPagamento: {
      versao: 1, tipo: 'PAGAMENTO_FUTURO', carteiraAntesDoPagamento: true, vencimento: '2099-01-01',
      clausula: 'Pagamento previsto em data futura.', propostaId: 'p', propostaVersao: 1 } } };
  const db = { documentoOnboarding: { findMany: async () => [] }, onboardingEvento: { findMany: async () => [] } };
  const storage = { upload: jest.fn(async () => {}) };
  expect((await prepararArquivoConversao({ db, onboardingId: 'o', onboarding, proposta, contrato, storage })).documentos).toHaveLength(2);
  contrato.dados.condicaoPagamento.propostaVersao = 0;
  await expect(prepararArquivoConversao({ db, onboardingId: 'o', onboarding, proposta, contrato, storage })).rejects.toMatchObject({ code: 'arquivo_conversao_indisponivel' });
});
