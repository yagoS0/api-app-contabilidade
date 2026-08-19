// A CONSULTA DO TOMADOR NA RECEITA — a REGRA, sem tela e SEM REDE.
//
// ⚠ ORIGEM: espelha `apps/web/src/features/notas/lib/__tests__/consultaTomador.test.js` (25 casos),
// do portal do escritório. O comportamento foi REPLICADO, não reinventado — as regras vieram de
// defeito real e não podem divergir entre os dois lados do MESMO ato fiscal. Aqui elas valem mais:
// deste lado quem emite é o cliente, em nome dele.
//
// O que estes casos travam:
//   1. ⚠⚠ CPF NÃO SE CONSULTA — 11 dígitos ⇒ NENHUMA chamada, nenhum "não encontrado", nenhum
//      botão. Provado nos dois pontos em que a chamada poderia nascer: a decisão (`decidirConsulta`)
//      e a porta da rede (`consultarCnpjNaBrasilApi`, com um `fetch` falso que NÃO é invocado);
//   2. FALHA NÃO BLOQUEIA — nenhuma função daqui devolve impedimento, em nenhum caminho;
//   3. O DIGITADO VENCE o da Receita, inclusive numa consulta posterior, e os dois lados ficam à
//      vista;
//   4. O ENDEREÇO É TUDO-OU-NADA — parcial não escreve nada (o validador só aceita o bloco
//      completo, e meio endereço travaria o passo);
//   5. `cMun` SÓ POR PROVA TRIPLA — 7 dígitos, existe na lista do IBGE, e município/UF batem com os
//      da MESMA resposta. Nada de nome→código: homônimo emite a nota no município errado.

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
  soDigitosDoc,
} from "../consultaTomador";
// ⚠ A ÚNICA porta de rede deste fluxo, importada aqui de propósito: é nela que se prova que o
// `fetch` NÃO é chamado. Ela recebe `fetchImpl` justamente para nunca precisar de rede em teste.
import { consultarCnpjNaBrasilApi } from "../../../../api/real/brasilApi";

// Linhas no formato de `municipiosIbge.data.js`: `[codigo, nome, uf]`.
// ⚠ Os dois "Bom Jesus" estão aqui de propósito — são o homônimo que proíbe derivar código de nome.
const MUNICIPIOS = [
  ["3304557", "Rio de Janeiro", "RJ"],
  ["3550308", "São Paulo", "SP"],
  ["4302105", "Bom Jesus", "RS"],
  ["2202174", "Bom Jesus", "PI"],
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

// ⚠ REDE ZERO NESTA SUÍTE, e não por convenção: um `fetch` global que EXPLODE transforma qualquer
// chamada acidental em falha de teste, em vez de numa requisição de verdade saindo da máquina.
let fetchGlobalOriginal;
beforeAll(() => {
  fetchGlobalOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
});
afterAll(() => {
  global.fetch = fetchGlobalOriginal;
});

describe("⚠⚠ CPF NÃO SE CONSULTA — a asserção é sobre a AUSÊNCIA da chamada", () => {
  // ⚠ O CASO QUE MAIS IMPORTA. Consultar CPF numa base de CNPJ é buscar o que não existe: a
  // resposta seria "não encontrado" para TODO tomador pessoa física, na tela de quem não errou nada.
  test("11 dígitos: a decisão é não consultar, com motivo próprio", () => {
    const d = decidirConsulta("123.456.789-09");
    expect(d.consultar).toBe(false);
    expect(d.motivo).toBe(NAO_CONSULTA.CPF);
    expect(d.digitos).toBe("12345678909");
  });

  // ⚠ A PROVA PELA PORTA DA REDE: mesmo que alguém, algum dia, mande o CPF adiante, o `fetch`
  // injetado não é invocado. A asserção é `not.toHaveBeenCalled()` — não é sobre texto de tela.
  test("nem a porta da rede chega a chamar o `fetch` com um CPF", async () => {
    const fetchFalso = jest.fn();
    const r = await consultarCnpjNaBrasilApi("123.456.789-09", { fetchImpl: fetchFalso });
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("cnpj_incompleto");
  });

  test("documento incompleto ou fora de forma também não consulta (e não é o motivo do CPF)", () => {
    expect(decidirConsulta("112223330001").motivo).toBe(NAO_CONSULTA.FORA_DE_FORMA);
    expect(decidirConsulta("").motivo).toBe(NAO_CONSULTA.FORA_DE_FORMA);
    expect(decidirConsulta(null).motivo).toBe(NAO_CONSULTA.FORA_DE_FORMA);
    expect(decidirConsulta("1234567890").motivo).not.toBe(NAO_CONSULTA.CPF);
  });

  test("CNPJ completo consulta — senão o caso do CPF passaria por nunca consultar nada", () => {
    expect(decidirConsulta("11.222.333/0001-81")).toMatchObject({
      consultar: true,
      motivo: null,
      digitos: "11222333000181",
    });
  });

  // ⚠ A BrasilAPI é pública e tem throttle; um re-render não pode virar uma segunda chamada.
  test("o MESMO CNPJ não é consultado duas vezes", () => {
    const d = decidirConsulta("11222333000181", { ultimoConsultado: "11.222.333/0001-81" });
    expect(d.consultar).toBe(false);
    expect(d.motivo).toBe(NAO_CONSULTA.REPETIDA);
  });

  test("um CNPJ DIFERENTE do último consultado consulta de novo", () => {
    expect(decidirConsulta("11222333000181", { ultimoConsultado: "99999999000199" }).consultar).toBe(true);
  });

  test("`soDigitosDoc` não decide nada — só descasca a máscara", () => {
    expect(soDigitosDoc("11.222.333/0001-81")).toBe("11222333000181");
    expect(soDigitosDoc(null)).toBe("");
  });
});

describe("FALHA NÃO BLOQUEIA — nenhuma função devolve impedimento", () => {
  // ⚠ A consulta é AJUDA. Rede fora, CNPJ inexistente, resposta ilegível: nada disso pode parar a
  // emissão. Se um dia alguém acrescentar um `bloqueia`/`podeEmitir` aqui, este caso acende.
  const CHAVES_DE_BLOQUEIO = ["bloqueia", "impede", "podeEmitir", "bloqueado", "erroFatal"];

  test("nenhum retorno de nenhum caminho carrega chave de bloqueio", () => {
    const retornos = [
      decidirConsulta("123.456.789-09"),
      decidirConsulta("11222333000181"),
      aplicarNome({ nome: "" }),
      aplicarNome({ nome: "X" }),
      aplicarEndereco({ endereco: null }),
      enderecoDaReceita({}, { municipios: MUNICIPIOS }),
      enderecoDaReceita(RESPOSTA, { municipios: MUNICIPIOS }),
      codigoMunicipioVerificado({}, MUNICIPIOS),
    ];
    for (const r of retornos) {
      for (const chave of CHAVES_DE_BLOQUEIO) expect(r).not.toHaveProperty(chave);
    }
  });

  // ⚠ A recusa da porta de rede NUNCA é um `throw`: um erro lançado daqui entraria no
  // `real_with_mock_fallback` de `api/index.js` e a queda da BrasilAPI viraria DADO DO MOCK numa
  // tela que emite nota fiscal de verdade.
  test("rede caída vira `{ok:false}` com mensagem — nunca um erro lançado", async () => {
    const fetchFalso = jest.fn(() => {
      throw new Error("ECONNREFUSED");
    });
    const r = await consultarCnpjNaBrasilApi("11222333000181", { fetchImpl: fetchFalso });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, motivo: "rede" });
    // ⚠ A ASSERÇÃO MUDOU DE METADE EM 19/08/2026, E FICOU MAIS ESTRITA. Ela prendia o *"preencha à
    // mão"* desta mensagem — e essa instrução era a MESMA que a `EmitirNotaPage` renderiza logo
    // abaixo dela, o mesmo recado duas vezes. Hoje a divisão é: aqui o FATO, na tela a SAÍDA. O
    // `not.toMatch` é o que impede a duplicação de voltar sem ninguém perceber.
    expect(r.mensagem).toMatch(/não conseguimos consultar a receita/i);
    expect(r.mensagem).not.toMatch(/preencha/i);
  });

  test("CNPJ não encontrado (404) também é recusa, não exceção", async () => {
    const fetchFalso = jest.fn(async () => ({ ok: false, status: 404 }));
    const r = await consultarCnpjNaBrasilApi("11222333000181", { fetchImpl: fetchFalso });
    expect(r).toMatchObject({ ok: false, motivo: "nao_encontrado" });
  });

  test("o endereço que não veio devolve INSTRUÇÃO, não impedimento", () => {
    const leitura = enderecoDaReceita({ ...RESPOSTA, bairro: "" }, { municipios: MUNICIPIOS });
    const msg = mensagemEndereco(leitura);
    expect(msg).toMatch(/Preencha à mão/);
    expect(msg).not.toMatch(/não é possível emitir|bloquead/i);
  });
});

describe("o DIGITADO VENCE o da Receita, e os dois lados ficam à vista", () => {
  test("campo vazio recebe o nome da consulta e a origem passa a ser `da Receita`", () => {
    const passo = aplicarNome({ nomeAtual: "", origemAtual: ORIGEM.AUSENTE, nome: "ACME LTDA" });
    expect(passo).toEqual({ nome: "ACME LTDA", origem: ORIGEM.DA_RECEITA, aplicou: true, motivo: null });
  });

  // ⚠ O nome que vai na nota é ATO FISCAL. Quem digitou manda, inclusive numa consulta posterior.
  test("nome digitado NÃO é sobrescrito por uma consulta posterior", () => {
    const passo = aplicarNome({
      nomeAtual: "Padaria do João ME",
      origemAtual: ORIGEM.DIGITADO,
      nome: "JOAO DA SILVA PADARIA LTDA",
    });
    expect(passo.nome).toBe("Padaria do João ME");
    expect(passo.aplicou).toBe(false);
    expect(passo.motivo).toBe("o nome digitado vence a consulta");
  });

  // ⚠ Sobrescrever o que veio da Receita é o caminho normal — o que não se sobrescreve é o digitado.
  test("o que veio da Receita PODE ser trocado por uma consulta nova", () => {
    const passo = aplicarNome({
      nomeAtual: "NOME ANTIGO SA",
      origemAtual: ORIGEM.DA_RECEITA,
      nome: "NOME NOVO SA",
    });
    expect(passo).toMatchObject({ nome: "NOME NOVO SA", origem: ORIGEM.DA_RECEITA, aplicou: true });
  });

  // ⚠ Campo que a API não deu fica VAZIO — nunca com string vazia disfarçada de valor.
  test("resposta sem `razao_social` não escreve nada e diz por quê", () => {
    expect(nomeDaReceita({})).toBe("");
    expect(nomeDaReceita({ razao_social: "  ACME  " })).toBe("ACME");
    const passo = aplicarNome({ nomeAtual: "Digitado", origemAtual: ORIGEM.DIGITADO, nome: "" });
    expect(passo).toMatchObject({ nome: "Digitado", aplicou: false, motivo: "a consulta não trouxe a razão social" });
  });

  test("endereço digitado não é sobrescrito pela consulta", () => {
    const atual = { cMun: "3550308", CEP: "01001000", xLgr: "Rua Minha", nro: "9", xBairro: "Meu" };
    const passo = aplicarEndereco({
      enderecoAtual: atual,
      origemAtual: ORIGEM.DIGITADO,
      endereco: { cMun: "3304557", CEP: "20010000", xLgr: "Rua Deles", nro: "1", xBairro: "Centro" },
    });
    expect(passo.endereco).toEqual(atual);
    expect(passo.aplicou).toBe(false);
    expect(passo.origem).toBe(ORIGEM.DIGITADO);
  });

  // ⚠ `DIGITADO` com todos os campos vazios não é "digitado": não há nada de ninguém a preservar.
  test("origem digitada com o endereço todo vazio ainda aceita o da consulta", () => {
    const passo = aplicarEndereco({
      enderecoAtual: { cMun: "", CEP: "", xLgr: "", nro: "", xBairro: "" },
      origemAtual: ORIGEM.DIGITADO,
      endereco: { cMun: "3550308", CEP: "01001000", xLgr: "Rua X", nro: "1", xBairro: "Centro" },
    });
    expect(passo.aplicou).toBe(true);
    expect(passo.origem).toBe(ORIGEM.DA_RECEITA);
  });

  test("sem endereço aceitável, nada é aplicado e a origem não muda", () => {
    const atual = { cMun: "", CEP: "", xLgr: "", nro: "", xBairro: "" };
    expect(aplicarEndereco({ enderecoAtual: atual, origemAtual: ORIGEM.AUSENTE, endereco: null })).toEqual({
      endereco: atual,
      origem: ORIGEM.AUSENTE,
      aplicou: false,
    });
  });

  // ⚠ É este rótulo que responde "por que o nome mudou sozinho?" na tela.
  test("a origem tem rótulo, e a ausência não inventa um", () => {
    expect(rotuloOrigem(ORIGEM.DA_RECEITA)).toBe("da Receita");
    expect(rotuloOrigem(ORIGEM.DIGITADO)).toBe("digitado");
    expect(rotuloOrigem(ORIGEM.AUSENTE)).toBe("");
    expect(rotuloOrigem(undefined)).toBe("");
  });
});

describe("⚠ o ENDEREÇO É TUDO-OU-NADA", () => {
  test("resposta completa vira o bloco completo, com o complemento junto", () => {
    const leitura = enderecoDaReceita(RESPOSTA, { municipios: MUNICIPIOS });
    expect(leitura.endereco).toEqual({
      cMun: "3550308",
      CEP: "01001000",
      xLgr: "RUA DAS FLORES",
      nro: "100",
      xCpl: "SALA 2",
      xBairro: "CENTRO",
    });
    expect(leitura.faltantes).toEqual([]);
  });

  // ⚠ Meio endereço é PIOR que nenhum: o validador do backend só aceita o bloco completo e o
  // formulário marca os cinco como obrigatórios — quatro de cinco transformaria uma consulta
  // BEM-SUCEDIDA em bloqueio da emissão. Um campo faltando derruba o bloco inteiro.
  test.each(CAMPOS_ENDERECO_EXIGIDOS.map(([campo, rotulo]) => [campo, rotulo]))(
    "faltando %s, NADA é escrito — e o motivo nomeia o que faltou",
    (campo, rotulo) => {
      const bruto = { ...RESPOSTA };
      if (campo === "cMun") delete bruto.codigo_municipio_ibge;
      if (campo === "CEP") bruto.cep = "";
      if (campo === "xLgr") {
        bruto.logradouro = "";
        bruto.descricao_tipo_de_logradouro = "";
      }
      if (campo === "nro") bruto.numero = "";
      if (campo === "xBairro") bruto.bairro = "";

      const leitura = enderecoDaReceita(bruto, { municipios: MUNICIPIOS });
      expect(leitura.endereco).toBeNull();
      expect(leitura.faltantes).toContain(rotulo);
      expect(mensagemEndereco(leitura)).toMatch(/NÃO foi preenchido/);
    }
  );

  // ⚠ O complemento é o ÚNICO opcional — ele faltando, o bloco continua completo.
  test("sem complemento o endereço continua sendo escrito", () => {
    const leitura = enderecoDaReceita({ ...RESPOSTA, complemento: "" }, { municipios: MUNICIPIOS });
    expect(leitura.endereco).not.toBeNull();
    expect(leitura.endereco.xCpl).toBe("");
  });

  test("resposta vazia não escreve nada e lista os cinco campos", () => {
    const leitura = enderecoDaReceita({}, { municipios: MUNICIPIOS });
    expect(leitura.endereco).toBeNull();
    expect(leitura.faltantes).toHaveLength(CAMPOS_ENDERECO_EXIGIDOS.length);
  });

  test("a mensagem de sucesso manda CONFERIR — a consulta não assina a nota por ninguém", () => {
    const leitura = enderecoDaReceita(RESPOSTA, { municipios: MUNICIPIOS });
    expect(mensagemEndereco(leitura)).toMatch(/confira antes de emitir/i);
  });
});

describe("⚠⚠ `cMun` SÓ POR PROVA TRIPLA — e nunca derivado do NOME", () => {
  test("as três provas juntas: 7 dígitos, existe na lista, e município/UF batem", () => {
    expect(codigoMunicipioVerificado(RESPOSTA, MUNICIPIOS)).toMatchObject({
      codigo: "3550308",
      nome: "São Paulo",
      uf: "SP",
      motivo: null,
    });
  });

  test("prova 1 — código fora dos 7 dígitos é recusado", () => {
    for (const codigo of ["355030", "35503088", "", "abc"]) {
      const r = codigoMunicipioVerificado({ ...RESPOSTA, codigo_municipio_ibge: codigo }, MUNICIPIOS);
      expect(r.codigo).toBeNull();
      expect(r.motivo).toMatch(/não trouxe o código IBGE/);
    }
  });

  test("prova 2 — código com 7 dígitos que NÃO existe na lista é recusado", () => {
    const r = codigoMunicipioVerificado({ ...RESPOSTA, codigo_municipio_ibge: "9999999" }, MUNICIPIOS);
    expect(r.codigo).toBeNull();
    expect(r.motivo).toMatch(/não existe na lista oficial do IBGE/);
  });

  // ⚠⚠ O HOMÔNIMO. Há cinco "Bom Jesus" no país. Um código do RS com uma resposta que diz PI é
  // exatamente o erro que emitiria a nota no município errado — e ele é silencioso em todo o resto
  // do sistema.
  test("prova 3 — código de um município e resposta dizendo OUTRO é recusado, com os dois lados no motivo", () => {
    const r = codigoMunicipioVerificado(
      { municipio: "Bom Jesus", uf: "PI", codigo_municipio_ibge: "4302105" },
      MUNICIPIOS
    );
    expect(r.codigo).toBeNull();
    expect(r.motivo).toMatch(/4302105 é de Bom Jesus\/RS/);
    expect(r.motivo).toMatch(/a consulta diz Bom Jesus\/PI/);
  });

  test("prova 3 — a UF sozinha discordando já derruba o código", () => {
    const r = codigoMunicipioVerificado({ ...RESPOSTA, uf: "RJ" }, MUNICIPIOS);
    expect(r.codigo).toBeNull();
  });

  // ⚠ ESTE É O CASO QUE PROÍBE nome→código: o nome está na lista, sem ambiguidade de grafia, e
  // MESMO ASSIM nada é produzido. Derivar aqui seria escolher entre dois "Bom Jesus".
  test("nome de município presente na lista, SEM código, não produz código nenhum", () => {
    const r = codigoMunicipioVerificado({ municipio: "São Paulo", uf: "SP" }, MUNICIPIOS);
    expect(r.codigo).toBeNull();
    expect(r.motivo).toMatch(/não trouxe o código IBGE/);
  });

  test("acento e caixa não são o critério — 'SAO PAULO' e 'sp' batem com 'São Paulo'/'SP'", () => {
    const r = codigoMunicipioVerificado(
      { ...RESPOSTA, municipio: "sao  paulo".replace("  ", " "), uf: "sp" },
      MUNICIPIOS
    );
    expect(r.codigo).toBe("3550308");
  });

  // ⚠ Sem a lista carregada, o código NÃO passa por confiança — e o endereço inteiro cai junto.
  test("lista do IBGE ausente recusa o código (e derruba o endereço inteiro)", () => {
    for (const lista of [null, undefined, []]) {
      const r = codigoMunicipioVerificado(RESPOSTA, lista);
      expect(r.codigo).toBeNull();
      expect(r.motivo).toMatch(/lista oficial do IBGE não foi carregada/);
    }
    const leitura = enderecoDaReceita(RESPOSTA, { municipios: null });
    expect(leitura.endereco).toBeNull();
    expect(mensagemEndereco(leitura)).toMatch(/lista oficial do IBGE não foi carregada/);
  });

  test("o campo alternativo `codigo_municipio` também passa pelas mesmas três provas", () => {
    const semIbge = { ...RESPOSTA };
    delete semIbge.codigo_municipio_ibge;
    expect(codigoMunicipioVerificado({ ...semIbge, codigo_municipio: "3550308" }, MUNICIPIOS).codigo).toBe("3550308");
    expect(codigoMunicipioVerificado({ ...semIbge, codigo_municipio: "9999999" }, MUNICIPIOS).codigo).toBeNull();
  });
});

describe("a situação cadastral é AVISO, nunca bloqueio", () => {
  test("tomador ATIVO não gera aviso", () => {
    expect(avisoSituacao({ texto: "ATIVA", ativa: true })).toBeNull();
  });

  test("BAIXADA vira aviso com o motivo — e nada mais", () => {
    const aviso = avisoSituacao({ texto: "BAIXADA", ativa: false, motivo: "EXTINCAO POR ENCERRAMENTO" });
    expect(aviso).toBe("Situação cadastral do tomador na Receita: BAIXADA (EXTINCAO POR ENCERRAMENTO).");
  });

  test("situação ausente não inventa aviso", () => {
    expect(avisoSituacao(null)).toBeNull();
    expect(avisoSituacao({ texto: null, ativa: false })).toBeNull();
  });
});

// ── O TIPO DE LOGRADOURO SOZINHO NÃO É UM LOGRADOURO ────────────────────────────────────────────
//
// Achado pelo agente que escreveu o harness do portal do cliente, e REPRODUZIDO nos dois apps antes
// do conserto. `xLgr` era `[tipo, logradouro].filter(Boolean).join(" ")`: com
// `descricao_tipo_de_logradouro: "RUA"` e `logradouro` vazio, o resultado era a string **"RUA"** —
// não-vazia, portanto APROVADA pela checagem de tudo-ou-nada. Meio campo passando por inteiro, na
// exata regra que existe para impedir isso, e o endereço ia inteiro para o formulário (e para o XML
// da nota) com a palavra "Rua" no lugar da rua.
describe("logradouro vazio derruba o endereço, mesmo com tipo presente", () => {
  const semRua = { ...RESPOSTA, descricao_tipo_de_logradouro: "RUA", logradouro: "" };

  it("⚠ \"RUA\" sozinho não vira logradouro — o bloco INTEIRO é recusado", () => {
    const r = enderecoDaReceita(semRua, { municipios: MUNICIPIOS });
    expect(r.endereco).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/"xLgr":\s*"RUA"/);
  });

  it("e o que faltou é NOMEADO, como nos outros campos", () => {
    const r = enderecoDaReceita(semRua, { municipios: MUNICIPIOS });
    expect((r.faltantes || []).join(" ")).toMatch(/logradouro/i);
  });

  it("logradouro só com espaços também não passa", () => {
    const r = enderecoDaReceita(
      { ...RESPOSTA, descricao_tipo_de_logradouro: "AVENIDA", logradouro: "   " },
      { municipios: MUNICIPIOS },
    );
    expect(r.endereco).toBeNull();
  });

  it("com logradouro de verdade, o tipo continua sendo prefixado", () => {
    const r = enderecoDaReceita(
      { ...RESPOSTA, descricao_tipo_de_logradouro: "RUA", logradouro: "DAS FLORES" },
      { municipios: MUNICIPIOS },
    );
    expect(r.endereco.xLgr).toBe("RUA DAS FLORES");
  });

  it("sem TIPO, o logradouro sozinho basta — a guarda não é ampla demais", () => {
    const r = enderecoDaReceita(
      { ...RESPOSTA, descricao_tipo_de_logradouro: "", logradouro: "DAS FLORES" },
      { municipios: MUNICIPIOS },
    );
    expect(r.endereco.xLgr).toBe("DAS FLORES");
  });
});
