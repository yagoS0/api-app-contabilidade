// A REGRA da consulta do tomador — sem tela e SEM REDE (nenhuma função daqui chama nada).
//
// O que estes casos travam:
//   1. CPF não se consulta, e o silêncio é a resposta certa;
//   2. o que a resposta não trouxer fica VAZIO — nada é fabricado, nem endereço pela metade;
//   3. o digitado vence a consulta, inclusive uma consulta posterior;
//   4. o código IBGE do município só é aceito depois de se PROVAR contra a lista oficial.

import {
  CAMPOS_ENDERECO_EXIGIDOS,
  NAO_CONSULTA,
  ORIGEM,
  aplicarEndereco,
  aplicarNome,
  avisoSituacao,
  codigoMunicipioVerificado,
  decidirConsulta,
  enderecoDaReceita,
  mensagemEndereco,
  nomeDaReceita,
  rotuloOrigem,
} from "../consultaTomador";

// Duas linhas no formato de `municipiosIbge.data.js`: `[codigo, nome, uf]`.
const MUNICIPIOS = [
  ["3304557", "Rio de Janeiro", "RJ"],
  ["3550308", "São Paulo", "SP"],
];

const RESPOSTA = {
  razao_social: "EMPRESA EXEMPLO LTDA",
  municipio: "SAO PAULO",
  uf: "sp",
  codigo_municipio_ibge: "3550308",
  descricao_tipo_de_logradouro: "RUA",
  logradouro: "DAS FLORES",
  numero: "100",
  complemento: "SALA 2",
  bairro: "CENTRO",
  cep: "01001-000",
};

describe("quando consultar — e quando calar", () => {
  // ⚠ O CASO QUE MAIS IMPORTA. Consultar CPF numa base de CNPJ é buscar o que não existe: a
  // resposta seria "não encontrado" para todo tomador pessoa física.
  test("CPF (11 dígitos) NÃO consulta, e o motivo é próprio", () => {
    const d = decidirConsulta("123.456.789-09");
    expect(d.consultar).toBe(false);
    expect(d.motivo).toBe(NAO_CONSULTA.CPF);
  });

  test("CNPJ completo consulta", () => {
    expect(decidirConsulta("11.222.333/0001-81")).toMatchObject({
      consultar: true,
      digitos: "11222333000181",
    });
  });

  test("documento incompleto ou fora de forma não consulta", () => {
    expect(decidirConsulta("112223330001").motivo).toBe(NAO_CONSULTA.FORA_DE_FORMA);
    expect(decidirConsulta("").motivo).toBe(NAO_CONSULTA.FORA_DE_FORMA);
  });

  // ⚠ A BrasilAPI é pública e tem throttle; e um re-render não pode virar uma segunda chamada.
  test("o MESMO CNPJ não é consultado duas vezes", () => {
    const d = decidirConsulta("11222333000181", { ultimoConsultado: "11.222.333/0001-81" });
    expect(d.consultar).toBe(false);
    expect(d.motivo).toBe(NAO_CONSULTA.REPETIDA);
  });

  test("CNPJ diferente do último volta a consultar", () => {
    expect(decidirConsulta("11222333000181", { ultimoConsultado: "39254243000191" }).consultar).toBe(true);
  });
});

describe("o nome — sugestão, com o contador mandando", () => {
  test("campo vazio recebe a razão social da consulta, marcada como da Receita", () => {
    const r = aplicarNome({ nomeAtual: "", origemAtual: ORIGEM.AUSENTE, nome: nomeDaReceita(RESPOSTA) });
    expect(r).toMatchObject({ nome: "EMPRESA EXEMPLO LTDA", origem: ORIGEM.DA_RECEITA, aplicou: true });
  });

  // ⚠ O NOME QUE VAI NA NOTA É ATO FISCAL. O que o contador escreveu sobrevive à consulta.
  test("o digitado VENCE uma consulta nova", () => {
    const r = aplicarNome({
      nomeAtual: "NOME QUE O CONTADOR ESCREVEU",
      origemAtual: ORIGEM.DIGITADO,
      nome: "EMPRESA EXEMPLO LTDA",
    });
    expect(r.nome).toBe("NOME QUE O CONTADOR ESCREVEU");
    expect(r.origem).toBe(ORIGEM.DIGITADO);
    expect(r.aplicou).toBe(false);
  });

  // ⚠ Campo que a resposta não trouxe fica VAZIO — nunca com string vazia disfarçada de valor.
  test("resposta sem razão social não apaga nada nem escreve vazio", () => {
    expect(nomeDaReceita({})).toBe("");
    const r = aplicarNome({ nomeAtual: "ACME", origemAtual: ORIGEM.DA_RECEITA, nome: "" });
    expect(r).toMatchObject({ nome: "ACME", aplicou: false });
  });

  test("a origem tem rótulo para a tela, e a ausência não inventa um", () => {
    expect(rotuloOrigem(ORIGEM.DA_RECEITA)).toBe("da Receita");
    expect(rotuloOrigem(ORIGEM.DIGITADO)).toBe("digitado");
    expect(rotuloOrigem(ORIGEM.AUSENTE)).toBe("");
  });
});

describe("o código IBGE do município — aceito só quando se PROVA", () => {
  test("código conferido contra a lista oficial, com nome e UF batendo, é aceito", () => {
    expect(codigoMunicipioVerificado(RESPOSTA, MUNICIPIOS)).toMatchObject({ codigo: "3550308" });
  });

  test("resposta sem código não vira código nenhum", () => {
    const r = codigoMunicipioVerificado({ ...RESPOSTA, codigo_municipio_ibge: undefined }, MUNICIPIOS);
    expect(r.codigo).toBeNull();
    expect(r.motivo).toMatch(/não trouxe o código IBGE/);
  });

  test("código que não existe na lista oficial é recusado", () => {
    const r = codigoMunicipioVerificado({ ...RESPOSTA, codigo_municipio_ibge: "9999999" }, MUNICIPIOS);
    expect(r.codigo).toBeNull();
    expect(r.motivo).toMatch(/não existe na lista oficial/);
  });

  // ⚠ É esta prova que separa "aceitar um código verificado" de "deduzir o código pelo nome" — o
  // que o projeto proíbe (homônimo ⇒ nota emitida no município errado).
  test("código que aponta para OUTRO município que o da resposta é recusado", () => {
    const r = codigoMunicipioVerificado({ ...RESPOSTA, codigo_municipio_ibge: "3304557" }, MUNICIPIOS);
    expect(r.codigo).toBeNull();
    expect(r.motivo).toMatch(/Rio de Janeiro\/RJ/);
  });

  test("sem a lista carregada não se aceita código nenhum", () => {
    expect(codigoMunicipioVerificado(RESPOSTA, null).codigo).toBeNull();
  });
});

describe("o endereço — tudo ou nada", () => {
  test("com os cinco campos exigidos, devolve o endereço no formato do backend", () => {
    const r = enderecoDaReceita(RESPOSTA, { municipios: MUNICIPIOS });
    expect(r.faltantes).toEqual([]);
    expect(r.endereco).toEqual({
      cMun: "3550308",
      CEP: "01001000",
      xLgr: "RUA DAS FLORES",
      nro: "100",
      xCpl: "SALA 2",
      xBairro: "CENTRO",
    });
  });

  // ⚠ ISTO É O CORAÇÃO DA DECISÃO SOBRE ENDEREÇO PARCIAL. O validador do backend descarta o bloco
  // inteiro quando falta um pedaço, e o assistente trata endereço parcial como problema que trava
  // o passo 1 — ou seja, preencher 4 de 5 transformaria uma consulta BEM-SUCEDIDA em bloqueio.
  test("faltando um campo, NADA é preenchido — e a tela diz o que faltou", () => {
    const r = enderecoDaReceita({ ...RESPOSTA, numero: "" }, { municipios: MUNICIPIOS });
    expect(r.endereco).toBeNull();
    expect(r.faltantes).toEqual(["o número"]);
    expect(mensagemEndereco(r)).toMatch(/NÃO foi preenchido/);
    expect(mensagemEndereco(r)).toMatch(/só aceita o endereço do tomador COMPLETO/);
  });

  test("sem o código IBGE verificável o endereço não sai — com o motivo do município junto", () => {
    const r = enderecoDaReceita({ ...RESPOSTA, codigo_municipio_ibge: null }, { municipios: MUNICIPIOS });
    expect(r.endereco).toBeNull();
    expect(r.faltantes).toContain("o código IBGE do município");
    expect(mensagemEndereco(r)).toMatch(/não trouxe o código IBGE/);
  });

  // O complemento não entra na exigência: o backend não o pede.
  test("sem complemento o endereço continua completo", () => {
    const r = enderecoDaReceita({ ...RESPOSTA, complemento: "" }, { municipios: MUNICIPIOS });
    expect(r.endereco).toMatchObject({ xCpl: "" });
    expect(r.faltantes).toEqual([]);
    expect(CAMPOS_ENDERECO_EXIGIDOS.map(([c]) => c)).not.toContain("xCpl");
  });

  test("os cinco exigidos são os do `hasEnderecoTomador` do backend", () => {
    expect(CAMPOS_ENDERECO_EXIGIDOS.map(([c]) => c)).toEqual(["cMun", "CEP", "xLgr", "nro", "xBairro"]);
  });
});

describe("aplicar o endereço", () => {
  test("endereço vazio recebe o da consulta", () => {
    const atual = { cMun: "", CEP: "", xLgr: "", nro: "", xCpl: "", xBairro: "" };
    const { endereco } = enderecoDaReceita(RESPOSTA, { municipios: MUNICIPIOS });
    const r = aplicarEndereco({ enderecoAtual: atual, origemAtual: ORIGEM.AUSENTE, endereco });
    expect(r.aplicou).toBe(true);
    expect(r.endereco.cMun).toBe("3550308");
  });

  test("endereço digitado pelo contador NÃO é sobrescrito", () => {
    const atual = { cMun: "3304557", CEP: "", xLgr: "", nro: "", xCpl: "", xBairro: "" };
    const { endereco } = enderecoDaReceita(RESPOSTA, { municipios: MUNICIPIOS });
    const r = aplicarEndereco({ enderecoAtual: atual, origemAtual: ORIGEM.DIGITADO, endereco });
    expect(r.aplicou).toBe(false);
    expect(r.endereco.cMun).toBe("3304557");
  });

  test("sem endereço para aplicar, nada muda", () => {
    const atual = { cMun: "3304557" };
    expect(aplicarEndereco({ enderecoAtual: atual, endereco: null })).toMatchObject({ aplicou: false });
  });
});

describe("situação cadastral — aviso, nunca bloqueio", () => {
  test("ATIVA não vira aviso", () => {
    expect(avisoSituacao({ texto: "ATIVA", ativa: true })).toBeNull();
  });

  test("BAIXADA vira aviso com o motivo", () => {
    expect(avisoSituacao({ texto: "BAIXADA", ativa: false, motivo: "EXTINCAO" }))
      .toBe("Situação cadastral do tomador na Receita: BAIXADA (EXTINCAO).");
  });

  test("sem situação na resposta, nada é afirmado", () => {
    expect(avisoSituacao(null)).toBeNull();
  });
});
