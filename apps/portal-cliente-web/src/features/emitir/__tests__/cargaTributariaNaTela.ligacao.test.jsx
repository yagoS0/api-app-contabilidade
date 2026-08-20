// A LIGAÇÃO DA CARGA TRIBUTÁRIA APROXIMADA — do `GET /client/companies` até a frase e a prévia.
//
// ⚠⚠ **É ESTA SUÍTE QUE PROVA QUE O `select` DO BACKEND FOI AMPLIADO.** O teste de regra ao lado
// (`lib/__tests__/cargaTributaria.test.js`) ficaria VERDE para sempre com o `legacyCompanySelect` de
// `apps/api/src/routes/client/index.js` intocado: ele chama a função com um objeto escrito à mão.
// Aqui a empresa entra na tela com a MESMA FORMA que a rota devolve — `legacyCompany` com as três
// chaves, os valores como STRING (`Decimal` do Prisma serializa em texto) — e o que se mede é a
// frase que o cliente lê. Componente sem chamador é o defeito favorito deste projeto.
//
// ⚠ **DENTRO DE `<StrictMode>`**, como o teste de ligação do reaproveitamento: o React 19 roda cada
// efeito duas vezes ali, e um defeito desta tela já apareceu SÓ nessa segunda passada.
//
// ⚠⚠ **NADA É EMITIDO, CANCELADO OU TRANSMITIDO.** `api.emitirNfse` é um espião local que RECOLHE o
// corpo e devolve um desfecho falso — ele existe porque um dos fatos a provar é justamente o que o
// corpo NÃO contém. Nenhuma linha aqui fala com o sistema nacional, com o backend ou com a rede: o
// `fetch` global explode se alguém tentar.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { EmitirNotaPage } from "../EmitirNotaPage";

/**
 * A empresa como `GET /client/companies` a devolve.
 *
 * ⚠ Os campos de `legacyCompany` são os do `legacyCompanySelect` REAL, e os percentuais chegam como
 * STRING de propósito: é assim que o `Decimal(5,2)` do Prisma sai no JSON. Um fixture com números
 * esconderia a conversão que a tela precisa fazer.
 */
function empresaDoPortal({ regime, carga }) {
  return {
    companyId: "pc-005",
    razao: "MERIDIANO ENGENHARIA LTDA",
    cnpj: "10203040000150",
    myRole: "OWNER",
    emissaoNfseLiberada: true,
    legacyCompany: {
      regimeTributario: regime,
      inscricaoMunicipal: "551200",
      codigoServicoNacional: "070201",
      codigoServicoMunicipal: "0702",
      rpsSerie: "1",
      ...carga,
    },
  };
}

// Os três valores da NFS-e real versionada no repositório — não são invenção deste teste.
const CARGA_COMPLETA = { pTotTribFed: "11.33", pTotTribEst: "0.00", pTotTribMun: "0.00" };
// A forma exata do defeito de `11187501`: só o municipal configurado.
const CARGA_SO_MUNICIPAL = { pTotTribFed: null, pTotTribEst: null, pTotTribMun: "2.50" };
// ⚠ SEM AS CHAVES — o portal falando com uma API anterior a 19/08/2026.
const CARGA_NAO_RECEBIDA = {};

let fetchOriginal;
let corposEnviados;

beforeEach(() => {
  window.localStorage.clear();
  corposEnviados = [];
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest
    .spyOn(api, "consultarCnpj")
    .mockResolvedValue({ ok: false, motivo: "nao_encontrado", mensagem: "não encontrado" });
  // ⚠ RECOLHE, não emite: nenhuma chamada sai daqui. Ver o cabeçalho.
  jest.spyOn(api, "emitirNfse").mockImplementation(async (companyId, payload) => {
    corposEnviados.push(payload);
    return { status: "issued", nfse: { id: "nf-fake", numero: "1" } };
  });
});

afterEach(() => {
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

async function renderizar(empresa) {
  const utils = render(
    <StrictMode>
      <EmitirNotaPage empresa={empresa} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} />
    </StrictMode>
  );
  await act(async () => {});
  return utils;
}

const textoDaTela = () => document.body.textContent;

describe("PRESUMIDO com o cadastro COMPLETO — a tela não insinua recusa", () => {
  const empresa = empresaDoPortal({ regime: "LUCRO_PRESUMIDO", carga: CARGA_COMPLETA });

  it("⚠⚠ NÃO diz mais que a nota 'provavelmente será recusada' nem descreve as duas saídas", async () => {
    await renderizar(empresa);
    // As duas frases do aviso antigo, que era falso para esta empresa.
    expect(textoDaTela()).not.toMatch(/se ele estiver completo/i);
    expect(textoDaTela()).not.toMatch(/ela é recusada/i);
    expect(textoDaTela()).not.toMatch(/Esta tela não recebeu esse cadastro/i);
  });

  it("diz o que a nota declara ao tomador, e que o número sai impresso", async () => {
    await renderizar(empresa);
    expect(textoDaTela()).toMatch(/Lei 12\.741\/2012/);
    expect(textoDaTela()).toMatch(/saem impressos na nota/i);
  });

  it("⚠ OS TRÊS PERCENTUAIS CHEGAM DA ROTA ATÉ A TELA, com rótulo e valor", async () => {
    await renderizar(empresa);
    const texto = textoDaTela();
    expect(texto).toContain("Federal");
    expect(texto).toContain("11,33%");
    expect(texto).toContain("Estadual");
    expect(texto).toContain("Municipal (ISS)");
    // ⚠ ZERO DECLARADO APARECE COMO 0,00% — ele é uma afirmação legítima, não um campo em branco.
    expect(texto).toContain("0,00%");
  });

  it("diz de quem é a caneta: quem configura é o CONTADOR", async () => {
    await renderizar(empresa);
    expect(textoDaTela()).toMatch(/Quem configura estes percentuais é o seu contador/i);
  });

  it("⚠ O ESPELHO DA NOTA mostra a carga que vai declarada", async () => {
    await renderizar(empresa);
    const previa = document.querySelector(".nfse-preview");
    expect(previa).not.toBeNull();
    expect(previa.textContent).toMatch(/Tributos aproximados · Federal/);
    expect(previa.textContent).toMatch(/Tributos aproximados · Estadual/);
    expect(previa.textContent).toMatch(/Tributos aproximados · Municipal \(ISS\)/);
    expect(previa.textContent).toContain("11,33%");
  });
});

describe("PRESUMIDO com o cadastro INCOMPLETO — a tela diz QUAIS faltam", () => {
  const empresa = empresaDoPortal({ regime: "LUCRO_PRESUMIDO", carga: CARGA_SO_MUNICIPAL });

  it("⚠ NOMEIA as parcelas que faltam — nunca 'falta a carga tributária'", async () => {
    await renderizar(empresa);
    expect(textoDaTela()).toMatch(/Falta configurar as parcelas federal e estadual/i);
  });

  it("diz que nada sai e nenhum número se perde", async () => {
    await renderizar(empresa);
    expect(textoDaTela()).toMatch(/sem consumir numeração/i);
  });

  it("diz que quem configura é o contador — o cliente não procura o campo aqui", async () => {
    await renderizar(empresa);
    expect(textoDaTela()).toMatch(/Quem configura estes percentuais é o seu contador/i);
  });

  it("⚠ AVISO, NÃO BLOQUEIO: o formulário continua de pé e o botão Emitir continua lá", async () => {
    await renderizar(empresa);
    // O regime que chega é a SEGUNDA leitura do servidor; bloquear por ela pararia uma emissão
    // legítima. A recusa, se vier, é da nossa camada — antes da numeração.
    expect(screen.getByRole("button", { name: /emitir/i })).toBeInTheDocument();
  });

  it("o que ESTÁ configurado aparece; o que falta é TRAÇO, nunca 0,00%", async () => {
    await renderizar(empresa);
    const previa = document.querySelector(".nfse-preview");
    const linhas = [...previa.querySelectorAll("tr")].map((tr) => tr.textContent);
    const federal = linhas.find((l) => l.includes("Tributos aproximados · Federal"));
    const municipal = linhas.find((l) => l.includes("Tributos aproximados · Municipal"));
    expect(municipal).toContain("2,50%");
    // ⚠ Zero aqui AFIRMARIA carga federal zero ao tomador — que é o defeito de `11187501`.
    expect(federal).not.toContain("0,00%");
    expect(federal).toMatch(/—|–|-/);
  });
});

describe("⚠ O GUARDA VALE NOS DOIS SENTIDOS — o mesmo do portal do escritório (`0905d58e`)", () => {
  it("SIMPLES não vê nada disto: ela declara `pTotTribSN`, que é outra coisa", async () => {
    // ⚠ O cadastro tem os três gravados de propósito: mesmo assim eles não aparecem, porque a nota
    // desta empresa não os leva. O guarda é o REGIME, não a presença do dado.
    await renderizar(empresaDoPortal({ regime: "SIMPLES_NACIONAL", carga: CARGA_COMPLETA }));
    expect(textoDaTela()).not.toMatch(/Tributos aproximados/i);
    expect(textoDaTela()).not.toMatch(/Lei 12\.741\/2012/);
    expect(textoDaTela()).not.toContain("11,33%");
  });

  it("⚠ o que a empresa do Simples continua vendo é a alíquota efetiva dela — o par positivo", async () => {
    await renderizar(empresaDoPortal({ regime: "SIMPLES_NACIONAL", carga: CARGA_COMPLETA }));
    expect(screen.getByLabelText(/Alíquota efetiva do Simples/i)).toBeInTheDocument();
    expect(document.querySelector(".nfse-preview").textContent).toMatch(/Tributos do Simples/i);
  });

  it("⚠⚠ REGIME INDEFINIDO também não vê — 'não optante' seria um default silencioso", async () => {
    await renderizar(empresaDoPortal({ regime: "", carga: CARGA_COMPLETA }));
    expect(textoDaTela()).not.toMatch(/Tributos aproximados/i);
    expect(textoDaTela()).not.toMatch(/Lei 12\.741\/2012/);
  });

  it("regime não reconhecido (nome novo, API mais nova) também não vê", async () => {
    await renderizar(empresaDoPortal({ regime: "MEI", carga: CARGA_COMPLETA }));
    expect(textoDaTela()).not.toMatch(/Tributos aproximados/i);
  });

  it("⚠ e no indefinido nada SOME do formulário: o ISS continua lá", async () => {
    // Esconder por desconhecimento é o oposto do que se faz aqui — o que não aparece é uma
    // AFIRMAÇÃO sobre o cadastro, não um campo.
    await renderizar(empresaDoPortal({ regime: "", carga: CARGA_COMPLETA }));
    expect(document.getElementById("emitir-iss-retido")).toBeInTheDocument();

    // ⚠⚠ ATUALIZADO EM 20/08/2026 — pedido do dono: *"a alíquota de ISS é apenas se for retido"*. A
    // alíquota deixou de estar sempre na tela e passou a depender da CAIXA. O caso não foi
    // relaxado: ele continua provando que o bloco de ISS não some no regime indefinido, e agora
    // também que a alíquota é alcançável ali — marcando a retenção, como em qualquer outro regime
    // não optante.
    expect(screen.queryByLabelText(/Alíquota do ISS/i)).not.toBeInTheDocument();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    expect(screen.getByLabelText(/Alíquota do ISS/i)).toBeInTheDocument();
  });
});

describe("⚠ O TERCEIRO ESTADO: a resposta não trouxe as chaves", () => {
  const empresa = empresaDoPortal({ regime: "LUCRO_PRESUMIDO", carga: CARGA_NAO_RECEBIDA });

  it("volta a descrever as DUAS saídas — é o único caso em que isso continua verdade", async () => {
    await renderizar(empresa);
    expect(textoDaTela()).toMatch(/Esta tela não recebeu esse cadastro/i);
    expect(textoDaTela()).toMatch(/se ele estiver completo/i);
  });

  it("⚠ NÃO diz que falta configurar nada — isso mandaria o cliente ligar para o escritório à toa", async () => {
    await renderizar(empresa);
    expect(textoDaTela()).not.toMatch(/Falta configurar/i);
  });

  it("⚠ e a prévia NÃO desenha linha nenhuma de carga: traço ali diria 'vai sair em branco'", async () => {
    await renderizar(empresa);
    expect(document.querySelector(".nfse-preview").textContent).not.toMatch(/Tributos aproximados/i);
  });
});

describe("⚠⚠ SOMENTE LEITURA — o cliente vê e confere; quem edita é o contador", () => {
  const empresa = empresaDoPortal({ regime: "LUCRO_PRESUMIDO", carga: CARGA_COMPLETA });

  it("não existe campo editável para nenhum dos três", async () => {
    await renderizar(empresa);
    for (const campo of ["pTotTribFed", "pTotTribEst", "pTotTribMun"]) {
      expect(document.querySelector(`[name="${campo}"]`)).toBeNull();
      expect(document.getElementById(`emitir-${campo.toLowerCase()}`)).toBeNull();
    }
  });

  it("⚠ nenhum input do formulário carrega um dos percentuais como valor", async () => {
    await renderizar(empresa);
    const form = document.querySelector("form");
    const valores = [...form.querySelectorAll("input")].map((i) => i.value);
    expect(valores).not.toContain("11.33");
    expect(valores).not.toContain("11,33");
  });

  it("⚠⚠ O PAYLOAD DA EMISSÃO NÃO LEVA OS TRÊS — se levasse, ele venceria o cadastro", async () => {
    // `NfseService` resolve por campo, payload → cadastro: um valor velho preso neste formulário
    // sobrescreveria em silêncio a correção que o contador acabou de fazer. O backend tem de cair
    // no cadastro, que é a única fonte.
    await renderizar(empresa);
    await act(async () => {
      fireEvent.submit(document.querySelector("form"));
    });
    await waitFor(() => expect(corposEnviados).toHaveLength(1));

    const corpo = corposEnviados[0];
    expect(corpo.totTrib?.pTotTribFed).toBeUndefined();
    expect(corpo.totTrib?.pTotTribEst).toBeUndefined();
    expect(corpo.totTrib?.pTotTribMun).toBeUndefined();
    // ⚠ Nem por outro caminho dentro do corpo: a prova é sobre o JSON inteiro.
    const serializado = JSON.stringify(corpo);
    expect(serializado).not.toContain("pTotTribFed");
    expect(serializado).not.toContain("pTotTribEst");
    expect(serializado).not.toContain("pTotTribMun");
    expect(serializado).not.toContain("11.33");
  });
});
