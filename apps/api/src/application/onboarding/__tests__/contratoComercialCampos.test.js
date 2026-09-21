import { prepararCamposContrato, validarPadroesContrato } from "../ContratoComercialCampos.js";
import { valorPorExtenso } from "../../../../../../packages/shared/src/onboarding/contratoComercialCampos.js";

const contexto = () => ({
  onboarding: { cnpj: "11222333000181", responsavelNome: "Nome cadastrado", dados: { endereco: { logradouro: "Rua Sintética", numero: "12", cidade: "Cidade", uf: "SP" }, qtdFuncionarios: 2 } },
  proposta: { status: "ACEITA", opcaoAceita: "RECORRENTE", snapshot: { condicoes: "Condições aceitas.", limitesPlano: { funcionarios: 3, documentosEntradaMes: 30 }, opcoes: [{ chave: "RECORRENTE", recorrente: true, mensalCentavos: 13711, unicoCentavos: 0, escopo: "Serviços aceitos." }] } },
  modelo: { texto: "{{nome}} {{cnpj}} {{endereco}} {{honorariosMensais}} {{honorariosMensaisExtenso}} {{servico}} {{condicoes}} {{limiteFuncionarios}} {{limiteDocumentos}} {{diaVencimento}}", dados: { camposPadrao: { diaVencimento: 12 } } },
});
test("contrato usa a opção aceita, não valores ou escopo enviados pelo navegador", () => {
  const c = contexto();
  const dados = prepararCamposContrato({ ...c, variaveis: { nome: "Representante conferido", cnpj: "99999999999999", honorariosMensais: "R$ 1", honorariosMensaisExtenso: "um real", servico: "Tudo", condicoes: "Sem limites", limiteFuncionarios: 999, limiteDocumentos: 999 } });
  expect(dados).toMatchObject({ nome: "Representante conferido", cnpj: c.onboarding.cnpj, servico: "Serviços aceitos.", condicoes: "Condições aceitas.", limiteFuncionarios: 3, limiteDocumentos: 30, diaVencimento: 12 });
  expect(dados.honorariosMensais).toMatch(/137,11/);
  expect(dados.honorariosMensaisExtenso).toBe("cento e trinta e sete reais e onze centavos");
  expect(dados.endereco).toBe("Rua Sintética, 12, Cidade, SP");
});
test("os limites de uma proposta antiga exigem preenchimento; não viram a contagem declarada", () => {
  const c = contexto(); delete c.proposta.snapshot.limitesPlano;
  expect(() => prepararCamposContrato(c)).toThrow(/funcionários incluídos/);
  expect(prepararCamposContrato({ ...c, variaveis: { limiteFuncionarios: 4, limiteDocumentos: 25 } })).toMatchObject({ limiteFuncionarios: 4, limiteDocumentos: 25 });
});
test("campos institucionais aprovados preenchem o formulário e são editáveis para conferência", () => {
  const c = contexto(); c.modelo.texto = "{{contadorNome}} {{contadorCrc}} {{contratadaRazaoSocial}}";
  expect(prepararCamposContrato({ ...c, institucional: { dados: { contadorNome: "Contadora", contadorCrc: "SP-000", contratadaRazaoSocial: "Escritório Sintético" } }, variaveis: { contadorCrc: "SP-001" } })).toMatchObject({ contadorNome: "Contadora", contadorCrc: "SP-001", contratadaRazaoSocial: "Escritório Sintético" });
});
test.each([
  ["diaVencimento", "32", /1 a 31/], ["cpf", "123", /11 dígitos/], ["email", "inválido", /e-mail/],
  ["inicioVigencia", "2026-02-30", /vigência/], ["nome", "", /representante/],
])("valida campo %s antes de persistir", (chave, valor, mensagem) => {
  const c = contexto(); c.modelo.texto = "{{" + chave + "}}";
  expect(() => prepararCamposContrato({ ...c, variaveis: { [chave]: valor } })).toThrow(mensagem);
});
test("datas civis não mudam de dia e campos desconhecidos são recusados", () => {
  const c = contexto(); c.modelo.texto = "{{inicioVigencia}}";
  expect(prepararCamposContrato({ ...c, variaveis: { inicioVigencia: "2026-09-21" } }).inicioVigencia).toBe("21/09/2026");
  c.modelo.texto = "{{senha}}";
  expect(() => prepararCamposContrato(c)).toThrow(/desconhecidos/);
  c.proposta.status = "RASCUNHO";
  expect(() => prepararCamposContrato(c)).toThrow(/aceita/);
});
test("aprovação do modelo recusa defaults que alterem valores ou sejam inválidos", () => {
  expect(validarPadroesContrato({ dados: { camposPadrao: { honorarios: "R$ 1" } } })).toBe(false);
  expect(validarPadroesContrato({ dados: { camposPadrao: { diaVencimento: 40 } } })).toBe(false);
  expect(validarPadroesContrato({ dados: { camposPadrao: { diaVencimento: "", contadorNome: "" } } })).toBe(true);
});
test.each([[0, "zero reais"], [100, "um real"], [101, "um real e um centavo"], [10000, "cem reais"], [100000, "mil reais"], [100000000, "um milhão de reais"], [11, "onze centavos"]])("valor por extenso deriva dos centavos %s", (valor, esperado) => expect(valorPorExtenso(valor)).toBe(esperado));
