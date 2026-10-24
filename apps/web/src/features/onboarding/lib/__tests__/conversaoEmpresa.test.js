import { prepararConversao, aplicarConsultaNaConversao, payloadConversao } from "../conversaoEmpresa";
import { mapearParaFormularioEmpresa } from "../brasilApi";

test("coleta da abertura chega ao payload sem converter intenção tributária em fato", () => {
  const inicio = prepararConversao({ razaoSocial: "Exemplo", responsavelNome: "Ana", responsavelEmail: "ana@example.invalid", dados: { regimePretendido: "SIMPLES", capitalSocialPretendido: 25000.5, responsavelTelefone: "11900000001", socios: [{ nome: "Ana", cpf: "52998224725", participacao: 60.5 }, { nome: "Bia", cpf: "11144477735", participacao: 39.5 }], qtdFuncionarios: 2 } });
  expect(inicio.regimeTributario).toBe(""); expect(inicio.capitalSocial).toBe("25000,5"); expect(inicio.whatsappAutorizado).toBe(false);
  const consultado = aplicarConsultaNaConversao(inicio, mapearParaFormularioEmpresa({ razao_social: "EXEMPLO LTDA", cnae_fiscal: 7020400, cnaes_secundarios: [{ codigo: 8599604 }], capital_social: 45000.75, codigo_natureza_juridica: 2062, descricao_porte: "MICRO EMPRESA", data_inicio_atividade: "2026-09-16" }));
  const payload = payloadConversao({ ...consultado, cnpj: "11.222.333/0001-81", regimeTributario: "SIMPLES" }, { senhaExigida: false });
  expect(payload.company).toMatchObject({ cnpj: "11222333000181", razaoSocial: "EXEMPLO LTDA", capitalSocial: "45000,75", cnaesSecundarios: ["8599604"], naturezaJuridica: "2062", dataAbertura: "2026-09-16", socios: [{ nome: "Ana", cpf: "52998224725", participacao: "60,5" }, { nome: "Bia", cpf: "11144477735", participacao: "39,5" }] });
  expect(payload.ownerPassword).toBeUndefined(); expect(payload.temFolha).toBe(true); expect(payload.contato.telefone).toBe("11900000001");
});

test("nova consulta invalida revisão e preserva sócios e consentimento explícito", () => {
  const atual = { ...prepararConversao({ dados: { socios: [{ nome: "Ana", cpf: "52998224725" }] } }), cadastroConferido: true, whatsappAutorizado: true, capitalSocial: "12,50", cnaesSecundarios: "1234567" };
  const proximo = aplicarConsultaNaConversao(atual, { capitalSocial: 0, cnaesSecundarios: [] });
  expect(proximo.cadastroConferido).toBe(false); expect(proximo.capitalSocial).toBe("0"); expect(proximo.cnaesSecundarios).toBe(""); expect(proximo.socios).toEqual(atual.socios); expect(proximo.whatsappAutorizado).toBe(true);
});

test("desconhecimento de folha e pró-labore não vira declaração negativa", () => {
  const form = prepararConversao({ dados: { qtdFuncionarios: "NAO_SEI", temProLabore: "NAO_SEI" } });
  expect(form.temFolha).toBeNull(); expect(form.hasProlabore).toBeNull();
});

test.each(['MEI', 'EI'])('conversão %s distingue titular e conserva IPTU e legado', tipoEmpresa => {
  const enderecoAbertura = { rua: 'Rua A', semNumero: true, cidade: 'Recife', uf: 'PE', inscricaoImobiliaria: '000AB-12', iptuDesconhecido: false };
  const form = prepararConversao({ responsavelEmail: 'teste@example.invalid', dados: { tipoEmpresa, titular: [{ nome: 'Ana', cpf: '52998224725' }], enderecoAbertura, enderecoPretendido: 'Texto original' } });
  const payload = payloadConversao(form, { senhaExigida: false });
  expect(payload.company.socios).toEqual([]);
  expect(payload.company.titular).toEqual({ nome: 'Ana', cpf: '52998224725' });
  expect(payload.company.endereco).toMatchObject({ ...enderecoAbertura, legado: 'Texto original' });
  expect(payload.company.inscricaoMunicipal).toBeNull();
  expect(aplicarConsultaNaConversao(form, { socios: [{ nome: 'Outra pessoa' }] }).socios).toEqual([]);
});
