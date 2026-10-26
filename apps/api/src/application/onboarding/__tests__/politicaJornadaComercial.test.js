jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { montarJornadaComercial, exigirContratoAvulsoConcluivel } from "../PoliticaJornadaComercial.js";
import { criarFichaEmpresaAvulsa } from "../FichaEmpresaAvulsaService.js";
const user = { id: "contador", role: "contador" };
const abertura = { id: "o", origem: "ABERTURA", status: "RASCUNHO", versao: 1 };
const dadosDiagnostico = { devolutiva: { certo: "Cadastro sintético conferido.", atencao: "Pendências ainda delimitadas.", corrigir: "Serviços restritos ao escopo." }, regularizacao: { necessaria: false, justificativa: "Nenhuma regularização no escopo conferido." } };
test("abertura permite rascunho sem diagnóstico, mas final depende de provas, sem SITFIS", () => {
  let p = montarJornadaComercial({ onboarding: abertura, jornada: { dadosPendentes: [] } });
  expect(p.comandosPermitidos.gerarRascunho).toBe(true); expect(p.comandosPermitidos.aprovarProposta).toBe(false);
  p = montarJornadaComercial({ onboarding: abertura, jornada: { dadosPendentes: [], diagnostico: { id: "d", dados: dadosDiagnostico }, devolutiva: { concluida: true } } });
  expect(p.comandosPermitidos.aprovarProposta).toBe(true); expect(p.passos.some(e => e.id === "fiscal")).toBe(false);
});
test("transferência exige conferências e escopo limitado não inventa análise", () => {
  const onboarding = { ...abertura, origem: "TRANSFERENCIA", cnpj: "11222333000181" };
  const jornada = { analises: [{ id: "publica", cnpj: onboarding.cnpj, tipo: "PUBLICA", status: "CONCLUIDA" }], publicaConferida: true, diagnostico: { dados: { ...dadosDiagnostico } }, devolutiva: { concluida: true } };
  expect(montarJornadaComercial({ onboarding, jornada }).comandosPermitidos.aprovarProposta).toBe(false);
  jornada.diagnostico.dados.dispensaConsultaPrivada = "Serviço restrito ao cadastro público, sem diagnóstico fiscal.";
  const p = montarJornadaComercial({ onboarding, jornada });
  expect(p.comandosPermitidos.aprovarProposta).toBe(true); expect(p.fiscal).toBeUndefined();
});
test("pagamento precisa ser do contrato exato para concluir avulso", async () => {
  const contrato = { id: "ct", propostaId: 'p', status: 'ASSINADO_CONFERIDO', dados: { opcao: { chave: "AVULSO", recorrente: false } }, proposta: { id: 'p', status: 'ACEITA', opcaoAceita: "AVULSO" } };
  const db = { contratoComercial: { findFirst: async () => contrato }, onboardingEvento: { findFirst: jest.fn(async () => null) } };
  await expect(exigirContratoAvulsoConcluivel(db, "o")).rejects.toMatchObject({ code: "pagamento_pendente" });
  expect(db.onboardingEvento.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dados: { path: ["contratoId"], equals: "ct" } }) }));
  db.onboardingEvento.findFirst.mockResolvedValue({ id: "pago", tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'ct' } }); expect(await exigirContratoAvulsoConcluivel(db, "o")).toBe(contrato);
});
test("aceite preservado permite retomar assinatura sem fabricar provas históricas", () => {
  const p = montarJornadaComercial({ onboarding: abertura, propostas: [{ id: "p", status: "ACEITA" }], jornada: {} });
  expect(p.atual).toBe("contrato"); expect(p.passos.find(p => p.id === "diagnostico")).toMatchObject({ concluido: false, anterior: true });
});
test("diagnóstico legado fica preservado, mas exige revisão antes de nova proposta", () => {
  const jornada = { dadosPendentes: [], diagnostico: { id: "legado", dados: { achados: "Texto antigo preservado.", servicos: "Escopo antigo preservado." } }, devolutiva: { concluida: true } };
  const p = montarJornadaComercial({ onboarding: abertura, jornada });
  expect(p.atual).toBe("diagnostico"); expect(p.comandosPermitidos.aprovarProposta).toBe(false);
  const aceita = montarJornadaComercial({ onboarding: abertura, jornada, propostas: [{ id: "p", status: "ACEITA" }] });
  expect(aceita.atual).toBe("contrato"); expect(jornada.diagnostico.id).toBe("legado");
});
test("cadastro avulso rejeita perfil incompleto antes de criar arquivo ou empresa", async () => {
  const preparar = jest.fn(); const db = { onboarding: { findUnique: async () => abertura } };
  await expect(criarFichaEmpresaAvulsa({ db, preparar }).salvar("o", user, { versao: 1, dados: { cnpj: "11222333000181" } })).rejects.toMatchObject({ code: "cadastro_avulso_incompleto" });
  expect(preparar).not.toHaveBeenCalled();
});
test("erro no arquivo avulso impede gravação cadastral", async () => {
  const db = { onboarding: { findUnique: async () => abertura }, contratoComercial: { findFirst: async () => ({ id: "ct", propostaId: 'p', status: 'ASSINADO_CONFERIDO', dados: { opcao: { chave: "AVULSO", recorrente: false } }, proposta: { id: 'p', status: 'ACEITA', opcaoAceita: "AVULSO" } }) }, onboardingEvento: { findFirst: async () => ({ id: "pago", tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', dados: { contratoId: 'ct' } }) }, $transaction: jest.fn() };
  const preparar = jest.fn(async () => { throw Error("storage indisponível"); });
  const dados = { cnpj: "11222333000181", razaoSocial: "Empresa sintética", regimeTributario: "SIMPLES", cnaePrincipal: "7020400", endereco: { rua: "Rua", numero: "1", bairro: "Centro", cidade: "Rio de Janeiro", uf: "RJ", cep: "20000000" } };
  await expect(criarFichaEmpresaAvulsa({ db, preparar }).salvar("o", user, { versao: 1, dados })).rejects.toThrow("storage indisponível"); expect(db.$transaction).not.toHaveBeenCalled();
});

test('C1: projeção permite só recebimento do contrato vinculado depois da carteira', () => {
  const onboarding = { id: 'o', status: 'CONVERTIDO', origem: 'TRANSFERENCIA', politicaComercial: 'COMERCIAL_2026_10_V1', portalClientId: 'empresa' };
  const proposta = { id: 'p', versao: 1, status: 'ACEITA', opcaoAceita: 'mensal', snapshot: {} };
  const contrato = { id: 'c', propostaId: 'p', status: 'AGUARDANDO_ASSINATURA', aprovadoEm: '2026-10-25', aprovadoPor: 'contador',
    texto: 'Pagamento contratado para data futura.', dados: { opcao: { chave: 'mensal', recorrente: true }, politicaContratacao: 'R35',
      condicaoPagamento: { versao: 1, tipo: 'PAGAMENTO_FUTURO', carteiraAntesDoPagamento: true, vencimento: '2099-01-01',
        clausula: 'Pagamento contratado para data futura.', propostaId: 'p', propostaVersao: 1 } } };
  const contexto = contextoContratoC1(proposta, contrato);
  const args = { onboarding, propostas: [proposta], contratos: [contrato], marcos: [{ tipo: 'CONVERTIDO', dados: { contratacao: { contratoId: 'c', propostaId: 'p', contextoContrato: contexto } } }] };
  const p = montarJornadaComercial(args);
  expect(p.contratacao).toMatchObject({ ganha: false, naCarteira: true });
  expect(p.comandosPermitidos).toMatchObject({ conferirPagamento: true, gerarRascunho: false, enviarProposta: false });
  args.marcos[0].dados.contratacao.contratoId = 'outro';
  expect(montarJornadaComercial(args).comandosPermitidos.conferirPagamento).toBe(false);
});
import { contextoContrato as contextoContratoC1 } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';
