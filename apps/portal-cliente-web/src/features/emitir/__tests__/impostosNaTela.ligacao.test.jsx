// OS CAMPOS DE IMPOSTO NA TELA — a LIGAÇÃO, e a prova de que o que sai da tela sai do CORPO.
//
// ⚠⚠ **DUAS ENTREGAS DE 20/08/2026, as duas relatadas pelo dono:**
//
//   1. *"empresa presumida aparecendo isso na nota: Alíquota efetiva do Simples (%). Não pode."*
//      O campo era renderizado **sem nenhuma condição de regime**.
//   2. *"a alíquota de ISS é apenas se for retido, correto? então só deve aparecer campo de
//      alíquota se clicar na caixa de retenção de ISS."*
//
// ⚠⚠ **ESCONDER NÃO BASTA — E É ISTO QUE ESTA SUÍTE MEDE.** A regra pura já tem a sua suíte
// (`lib/__tests__/impostosDaNota.test.js`). O que se prova aqui é que o **corpo enviado** não
// carrega o campo que a tela não mostra: campo escondido que continua viajando é o defeito pior,
// porque a tela mente e o servidor recebe.
//
// ⚠⚠ **NADA É EMITIDO, CANCELADO OU TRANSMITIDO.** `api.emitirNfse` é substituído por um espião —
// a função de verdade não roda, nenhum byte sai da máquina — e o `fetch` global é uma armadilha que
// explode se alguém encostar nele. O que se observa é o ARGUMENTO que o espião recebeu.
//
// ⚠ Os TRÊS regimes são exercidos: Simples, Lucro Presumido e **INDEFINIDO** — o terceiro é o que
// mais custa se for esquecido, porque nele a tela não pode afirmar nem uma coisa nem outra.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { EmitirNotaPage } from "../EmitirNotaPage";

function empresa(regimeTributario, extras = {}) {
  const legacy = {
    inscricaoMunicipal: "1234567",
    codigoServicoNacional: "010101",
    codigoServicoMunicipal: "1.01",
    rpsSerie: "1",
    // ⚠ O Presumido precisa da carga tributária COMPLETA no cadastro, senão o desfecho da tela é
    // outro (o cadastro incompleto) e não é dele que estes casos falam.
    pTotTribFed: "11.33",
    pTotTribEst: "0.00",
    pTotTribMun: "0.00",
    ...extras,
  };
  // ⚠ AUSÊNCIA DA CHAVE é o que produz o regime INDEFINIDO — não `null`, não `"INDEFINIDO"`.
  if (regimeTributario !== undefined) legacy.regimeTributario = regimeTributario;
  return {
    companyId: "pc-001",
    razao: "ACME SERVICOS LTDA",
    cnpj: "11222333000181",
    myRole: "OWNER",
    emissaoNfseLiberada: true,
    legacyCompany: legacy,
  };
}

const SIMPLES = empresa("SIMPLES_NACIONAL");
const PRESUMIDO = empresa("LUCRO_PRESUMIDO");
const INDEFINIDO = empresa(undefined);

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "getTomadoresEmitidos").mockResolvedValue([]);
  jest
    .spyOn(api, "consultarCnpj")
    .mockResolvedValue({ ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado." });
  // ⚠ O ESPIÃO SUBSTITUI A FUNÇÃO: a emissão de verdade não roda, e o desfecho é uma resposta
  // montada aqui só para a tela ter o que renderizar depois do submit.
  jest.spyOn(api, "emitirNfse").mockResolvedValue({
    status: "issued",
    message: "NFS-e emitida (espião do teste).",
    nfse: { id: "x", rpsSerie: "1", rpsNumero: "1", numeroNfse: "1000001", status: "issued" },
  });
});

afterEach(() => {
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

async function renderizar(emp) {
  const utils = render(
    <EmitirNotaPage empresa={emp} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} />
  );
  await act(async () => {});
  return utils;
}

function preencherOMinimo() {
  const set = (id, valor) => fireEvent.change(document.getElementById(id), { target: { value: valor } });
  set("emitir-doc", "11222333000181");
  set("emitir-nome", "TOMADOR EXEMPLO LTDA");
  set("emitir-cep", "01001000");
  set("emitir-logradouro", "RUA DAS FLORES");
  set("emitir-numero", "100");
  set("emitir-bairro", "CENTRO");
  set("emitir-descricao", "Servico prestado");
  set("emitir-valor", "150000");
}

/** Submete o formulário e devolve o CORPO que o espião recebeu. */
async function submeterEPegarOCorpo() {
  await act(async () => {
    fireEvent.submit(document.querySelector("form.pane-form"));
  });
  await waitFor(() => expect(api.emitirNfse).toHaveBeenCalled());
  return api.emitirNfse.mock.calls[0][1];
}

describe("⚠⚠ A ALÍQUOTA EFETIVA DO SIMPLES — o defeito de produção, nos DOIS lados", () => {
  test("no SIMPLES o campo existe (o par positivo — sem ele, um teste que some com tudo passaria)", async () => {
    await renderizar(SIMPLES);
    expect(screen.getByLabelText(/Alíquota efetiva do Simples/i)).toBeInTheDocument();
  });

  test("⚠⚠ no LUCRO PRESUMIDO o campo NÃO existe — palavras do dono: 'Não pode'", async () => {
    await renderizar(PRESUMIDO);
    expect(screen.queryByLabelText(/Alíquota efetiva do Simples/i)).not.toBeInTheDocument();
    expect(document.getElementById("emitir-ptottribsn")).not.toBeInTheDocument();
    // ⚠ E nada sobre "alíquota efetiva do Simples" sobra em texto na tela.
    expect(document.body.textContent).not.toMatch(/Alíquota efetiva do Simples/i);
  });

  test("⚠⚠ no regime INDEFINIDO também NÃO existe — afirmar 'é do Simples' é o default silencioso proibido aqui", async () => {
    await renderizar(INDEFINIDO);
    expect(document.getElementById("emitir-ptottribsn")).not.toBeInTheDocument();
    // ⚠ E o par: o que o indefinido NÃO perde é o bloco de ISS. Esconder por desconhecimento é o
    // oposto do que se faz — o que não aparece é uma AFIRMAÇÃO, não um campo.
    expect(document.getElementById("emitir-iss-retido")).toBeInTheDocument();
  });

  test("⚠ a PRÉVIA acompanha: a linha 'Tributos do Simples' só existe no Simples", async () => {
    const { unmount } = await renderizar(SIMPLES);
    expect(document.querySelector(".nfse-preview").textContent).toMatch(/Tributos do Simples/i);
    unmount();

    await renderizar(PRESUMIDO);
    // ⚠ O traço não salvaria: a LINHA já afirma que esta nota declara o grupo, e ela não declara.
    expect(document.querySelector(".nfse-preview").textContent).not.toMatch(/Tributos do Simples/i);
  });

  test("⚠ fora do Simples a alíquota efetiva nem é PEDIDA à API — dado que não se usa não se busca", async () => {
    await renderizar(PRESUMIDO);
    expect(api.getAliquotas).not.toHaveBeenCalled();

    await renderizar(SIMPLES);
    await waitFor(() => expect(api.getAliquotas).toHaveBeenCalled());
  });
});

describe("⚠⚠ A PROVA DO CORPO: `pTotTribSN` NÃO VIAJA fora do Simples", () => {
  test("no Lucro Presumido o corpo não tem `totTrib` — a chave nem é criada", async () => {
    await renderizar(PRESUMIDO);
    preencherOMinimo();
    const corpo = await submeterEPegarOCorpo();

    expect(corpo.totTrib).toBeUndefined();
    expect(Object.keys(corpo)).not.toContain("totTrib");
    // ⚠ VARREDURA DO OBJETO INTEIRO, não campo a campo: um teste que só olhasse `corpo.totTrib`
    // deixaria passar alguém pendurando `pTotTribSN` em outro lugar "só para o servidor ver".
    expect(JSON.stringify(corpo)).not.toMatch(/pTotTribSN/);
  });

  test("no regime INDEFINIDO idem", async () => {
    await renderizar(INDEFINIDO);
    preencherOMinimo();
    const corpo = await submeterEPegarOCorpo();
    expect(JSON.stringify(corpo)).not.toMatch(/pTotTribSN/);
  });

  test("⚠⚠ E NEM QUANDO O VALOR JÁ ESTAVA PRESO NO ESTADO — o caso que 'esconder' não resolveria", async () => {
    // O cenário real: a empresa abre como Simples, o efeito da alíquota efetiva preenche o campo, e
    // só DEPOIS o cadastro é corrigido para Lucro Presumido (`aoRecarregarEmpresas` traz a empresa
    // com o regime novo, **sem trocar de empresa**, então o formulário NÃO é zerado).
    // Se a guarda vivesse só no JSX, o campo sumiria e o número continuaria no corpo.
    api.getAliquotas.mockResolvedValue([
      {
        competencia: new Date().toISOString().slice(0, 7),
        faturamento: 100000,
        dasExtrato: 6000,
        impostosPagos: 7260,
        deReceita: 6,
        efetiva: 7.26,
      },
    ]);
    const { rerender } = await renderizar(SIMPLES);
    await waitFor(() => expect(document.getElementById("emitir-ptottribsn").value).toBe("6"));

    await act(async () => {
      rerender(
        <EmitirNotaPage empresa={PRESUMIDO} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} />
      );
    });
    expect(document.getElementById("emitir-ptottribsn")).not.toBeInTheDocument();

    preencherOMinimo();
    const corpo = await submeterEPegarOCorpo();
    expect(JSON.stringify(corpo)).not.toMatch(/pTotTribSN/);
    expect(JSON.stringify(corpo)).not.toMatch(/"6"/);
  });

  test("no SIMPLES ele VIAJA — o par positivo, senão bastaria nunca mandar nada", async () => {
    api.getAliquotas.mockResolvedValue([
      {
        competencia: new Date().toISOString().slice(0, 7),
        faturamento: 100000,
        dasExtrato: 6000,
        impostosPagos: 7260,
        deReceita: 6,
        efetiva: 7.26,
      },
    ]);
    await renderizar(SIMPLES);
    await waitFor(() => expect(document.getElementById("emitir-ptottribsn").value).toBe("6"));
    preencherOMinimo();
    const corpo = await submeterEPegarOCorpo();

    expect(corpo.totTrib).toEqual({ pTotTribSN: 6 });
  });
});

describe("⚠⚠ A ALÍQUOTA DE ISS SÓ APARECE COM A RETENÇÃO MARCADA", () => {
  test("caixa desmarcada: sem campo; marcada: com campo", async () => {
    await renderizar(PRESUMIDO);
    expect(document.getElementById("emitir-aliquota")).not.toBeInTheDocument();

    fireEvent.click(document.getElementById("emitir-iss-retido"));
    expect(document.getElementById("emitir-aliquota")).toBeInTheDocument();

    fireEvent.click(document.getElementById("emitir-iss-retido"));
    expect(document.getElementById("emitir-aliquota")).not.toBeInTheDocument();
  });

  test("⚠⚠ no SIMPLES a CAIXA aparece e a ALÍQUOTA não — mudou em 02/09/2026", async () => {
    // ⚠⚠ ESTE CASO EXIGIA QUE NENHUM DOS DOIS APARECESSE. A decisão de 18/08/2026 escondia o
    // bloco inteiro no Simples (*"o ISS está dentro do DAS"*); o dono reverteu METADE dela em
    // 01/09/2026: *"o contador declara a alíquota de ISS para reter, mas o cliente na tela dele
    // deve poder selecionar se é retido ou não"*.
    //
    // ⚠ As duas metades têm donos diferentes, e é isso que o caso trava agora:
    //   a CAIXA depende do TOMADOR daquela nota  → cliente marca;
    //   a ALÍQUOTA depende da EMPRESA            → contador declara, no perfil de emissão.
    // Ter os dois na tela do cliente seriam duas fontes para o mesmo campo do XML.
    //
    // ⚠⚠ E é o que destrava a **E0621**, que exige a alíquota quando há retenção para prestador
    // ME/EPP: enquanto a caixa não existia no Simples, aquele cenário era inalcançável pela tela.
    await renderizar(SIMPLES);
    expect(document.getElementById("emitir-iss-retido")).toBeInTheDocument();
    expect(document.getElementById("emitir-aliquota")).not.toBeInTheDocument();
  });

  test("⚠⚠ marcar a caixa no Simples FAZ a alíquota aparecer (02/09/2026)", async () => {
    // ⚠⚠ ESTE CASO GUARDAVA O CONTRÁRIO — e era ele que selava a armadilha: sem o campo, marcar a
    // retenção no Simples levava a uma recusa GARANTIDA do servidor. A alíquota segue a CAIXA, não
    // o regime: E0621/E0628 a exigem COM retenção e E0625/E0631 a proíbem SEM — que é exatamente o
    // que `pAliqDaDps` já implementava do lado de lá.
    await renderizar(SIMPLES);
    expect(document.getElementById("emitir-aliquota")).not.toBeInTheDocument();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    expect(document.getElementById("emitir-aliquota")).toBeInTheDocument();
  });

  test("⚠ marcada, a tela DIZ que a alíquota é obrigatória — antes do clique em Emitir", async () => {
    await renderizar(PRESUMIDO);
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    expect(screen.getByText(/Com o ISS retido, informe a alíquota de ISS/i)).toBeInTheDocument();
  });

  test("⚠⚠ ZERO também é recusado, e com frase própria — `required` do HTML o aceita e o servidor não", async () => {
    await renderizar(PRESUMIDO);
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    fireEvent.change(document.getElementById("emitir-aliquota"), { target: { value: "0" } });
    expect(screen.getByText(/maior que zero/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ A PROVA DO CORPO: a alíquota de ISS não viaja sem retenção", () => {
  test("com retenção e alíquota válida, ela viaja", async () => {
    await renderizar(PRESUMIDO);
    preencherOMinimo();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    fireEvent.change(document.getElementById("emitir-aliquota"), { target: { value: "5" } });

    const corpo = await submeterEPegarOCorpo();
    expect(corpo.servico.issRetido).toBe(true);
    expect(corpo.servico.aliquota).toBe(5);
  });

  test("⚠⚠ marcou, digitou e DESMARCOU: o valor não vai no corpo", async () => {
    await renderizar(PRESUMIDO);
    preencherOMinimo();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    fireEvent.change(document.getElementById("emitir-aliquota"), { target: { value: "5" } });
    fireEvent.click(document.getElementById("emitir-iss-retido"));

    const corpo = await submeterEPegarOCorpo();
    expect(corpo.servico.issRetido).toBe(false);
    expect(corpo.servico.aliquota).toBeUndefined();
    expect(JSON.stringify(corpo)).not.toMatch(/aliquota/);
  });

  test("⚠⚠ COM RETENÇÃO E SEM ALÍQUOTA, NADA SAI DAQUI — a recusa é da tela, antes do servidor", async () => {
    await renderizar(PRESUMIDO);
    preencherOMinimo();
    fireEvent.click(document.getElementById("emitir-iss-retido"));

    await act(async () => {
      fireEvent.submit(document.querySelector("form.pane-form"));
    });
    // ⚠ O ato fiscal NÃO aconteceu: o espião não foi chamado uma única vez.
    expect(api.emitirNfse).not.toHaveBeenCalled();
    expect(screen.getByText(/Com o ISS retido, informe a alíquota de ISS/i)).toBeInTheDocument();
  });

  test("⚠ e com ZERO também não sai", async () => {
    await renderizar(PRESUMIDO);
    preencherOMinimo();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    fireEvent.change(document.getElementById("emitir-aliquota"), { target: { value: "0" } });

    await act(async () => {
      fireEvent.submit(document.querySelector("form.pane-form"));
    });
    expect(api.emitirNfse).not.toHaveBeenCalled();
  });
});

// ⚠⚠ A GUARDA QUE FALTAVA NO `pTotTribSN` — achada em teste de usabilidade (31/08/2026).
//
// A alíquota de ISS tinha conferência local desde 20/08 e esta NÃO tinha, na MESMA tela e no campo
// vizinho. No Simples o servidor EXIGE o campo (`MISSING_P_TOT_TRIB_SN`), então a empresa cuja
// alíquota o portal não conseguiu preencher — e são as que abrem o campo vazio — preenchia a nota
// inteira e descobria a recusa **no clique de emitir**, que é um ato fiscal.
//
// ⚠ Os casos medem por NÃO-CHAMADA de `api.emitirNfse`: é a única forma de provar que o ato não
// aconteceu. Medir a frase na tela provaria só que a tela fala.
describe("⚠⚠ NO SIMPLES, SEM A ALÍQUOTA EFETIVA, NADA SAI DAQUI", () => {
  test("submeter com o campo vazio NÃO emite, e a tela diz o que falta", async () => {
    // `getAliquotas` é `[]` (o padrão desta suíte): é exatamente a empresa sem extrato apurado.
    await renderizar(SIMPLES);
    preencherOMinimo();

    await act(async () => {
      fireEvent.submit(document.querySelector("form.pane-form"));
    });

    expect(api.emitirNfse).not.toHaveBeenCalled();
    expect(screen.getByText(/Informe a alíquota efetiva do Simples desta nota/i)).toBeInTheDocument();
  });

  test("⚠⚠ preenchida, a MESMA nota emite — a guarda não trava quem está em ordem", async () => {
    await renderizar(SIMPLES);
    preencherOMinimo();
    fireEvent.change(document.getElementById("emitir-ptottribsn"), { target: { value: "6.24" } });

    const corpo = await submeterEPegarOCorpo();
    expect(corpo.totTrib.pTotTribSN).toBe(6.24);
  });

  test("⚠⚠ ZERO EMITE — o critério é o do servidor, que aceita zero e recusa negativo", async () => {
    // `NfseService.js:626` recusa ausente/NaN/`< 0`. Endurecer para `> 0` (como a alíquota de ISS,
    // que é outra regra, `:766`) faria a tela recusar nota que o sistema nacional aceita.
    await renderizar(SIMPLES);
    preencherOMinimo();
    fireEvent.change(document.getElementById("emitir-ptottribsn"), { target: { value: "0" } });

    const corpo = await submeterEPegarOCorpo();
    expect(corpo.totTrib.pTotTribSN).toBe(0);
  });

  test("⚠⚠ O PRESUMIDO NÃO É AFETADO — o campo não existe lá, e a guarda não o inventa", async () => {
    // Se a guarda olhasse o valor fora do Simples, ela bloquearia a emissão do Presumido por um
    // número que aquela nota nunca declara. O erro simétrico, e igualmente caro.
    await renderizar(PRESUMIDO);
    preencherOMinimo();

    const corpo = await submeterEPegarOCorpo();
    expect(corpo.totTrib).toBeUndefined();
    expect(document.getElementById("emitir-ptottribsn")).toBeNull();
  });
});

// ⚠⚠ RECUSA BARATA NÃO CUSTA A TELA INTEIRA — achado em teste de usabilidade (31/08/2026).
//
// **Qualquer** desfecho substituía o formulário pelo painel, inclusive a recusa que nem saiu da
// máquina (CPF com dígito errado, valor zero). Quem digitou um dígito a mais perdia a tela de
// edição e tinha de clicar para reencontrar o próprio texto — o erro mais comum de uma sessão de
// digitação, cobrado ao preço do mais raro.
//
// ⚠⚠ A LINHA DE CORTE É "A DPS SAIU DAQUI?", e é ela que estes casos travam nos DOIS sentidos.
describe("⚠⚠ o formulário SOBREVIVE à recusa em que nada saiu da máquina", () => {
  /** Faz o espião recusar naquela camada, com a forma que `lerErroEmissao` lê. */
  function recusarCom(camada, codigo, status) {
    api.emitirNfse.mockRejectedValue(
      Object.assign(new Error("recusa simulada"), {
        status,
        code: codigo,
        corpo: { camada, codigo, message: "Documento do tomador inválido.", correcao: "Confira o CPF." },
      })
    );
  }

  test("camada NOSSA: o motivo aparece E o formulário continua na tela, preenchido", async () => {
    recusarCom("NOSSA", "tomador_cpf_digito_invalido", 400);
    await renderizar(SIMPLES);
    preencherOMinimo();
    fireEvent.change(document.getElementById("emitir-ptottribsn"), { target: { value: "6.24" } });

    await act(async () => {
      fireEvent.submit(document.querySelector("form.pane-form"));
    });

    // O motivo está à vista…
    expect(screen.getByText(/A nota não chegou a ser enviada/i)).toBeInTheDocument();
    // …e o formulário NÃO sumiu — com o que a pessoa digitou ainda lá.
    expect(document.querySelector("form.pane-form")).not.toBeNull();
    expect(document.getElementById("emitir-nome").value).toBe("TOMADOR EXEMPLO LTDA");
    expect(document.getElementById("emitir-descricao").value).toBe("Servico prestado");
  });

  test("⚠⚠ camada TRANSPORTE: o formulário SAI — e isso NÃO se afrouxa", async () => {
    // Ali o desfecho é DESCONHECIDO: a nota pode existir. Tirar o formulário é o que impede o
    // "enviar de novo" de um clique só sobre uma nota que talvez já tenha sido emitida.
    recusarCom("TRANSPORTE", "nfse_transporte", 502);
    await renderizar(SIMPLES);
    preencherOMinimo();
    fireEvent.change(document.getElementById("emitir-ptottribsn"), { target: { value: "6.24" } });

    await act(async () => {
      fireEvent.submit(document.querySelector("form.pane-form"));
    });

    expect(document.querySelector("form.pane-form")).toBeNull();
  });

  test("⚠ e o SUCESSO também toma a tela, como sempre tomou", async () => {
    await renderizar(SIMPLES);
    preencherOMinimo();
    fireEvent.change(document.getElementById("emitir-ptottribsn"), { target: { value: "6.24" } });

    await act(async () => {
      fireEvent.submit(document.querySelector("form.pane-form"));
    });

    expect(document.querySelector("form.pane-form")).toBeNull();
  });
});

describe("⚠⚠ A PROVA DO CORPO: no Simples a marcação de ISS retido AGORA VIAJA", () => {
  // ⚠ A empresa destas provas é do Simples, e desde 31/08/2026 a tela CONFERE o `pTotTribSN`
  // antes de enviar. Sem preencher, o submit nem chega à API — e as asserções sobre o CORPO
  // passariam a medir um corpo que nunca existiu.
  const preencherComAliquotaEfetiva = () => {
    preencherOMinimo();
    fireEvent.change(document.getElementById("emitir-ptottribsn"), { target: { value: "6" } });
  };

  // ⚠⚠ ATÉ 02/09/2026 O SIMPLES FORÇAVA `issRetido: false` NO CORPO — e estava certo enquanto a
  // caixa não existia na tela dele: campo que não se pode responder não pode viajar respondido.
  // Com a caixa na tela (decisão do dono, 01/09/2026), forçar `false` seria o defeito ESPELHADO
  // daquele que a disciplina evita: a pessoa marca, a tela mostra marcado, e a nota sai dizendo
  // que não há retenção. O ISS retido na fonte não é abrangido pelo DAS (LC 123, art. 13, §1º),
  // então o recolhimento iria para o lado errado — que é exatamente o defeito que
  // `resolverTpRetIssqn` já tinha consertado no XML.

  test("marcada, `issRetido: true` chega ao corpo", async () => {
    await renderizar(SIMPLES);
    preencherComAliquotaEfetiva();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    // ⚠ Desde 02/09/2026 a alíquota aparece junto com a caixa e a tela BLOQUEIA sem ela — por
    // isso este caso precisa preenchê-la para chegar ao envio.
    fireEvent.change(document.getElementById("emitir-aliquota"), { target: { value: "5" } });
    const corpo = await submeterEPegarOCorpo();
    expect(corpo.servico.issRetido).toBe(true);
  });

  test("desmarcada, `false` — e é a resposta, não a ausência", async () => {
    await renderizar(SIMPLES);
    preencherComAliquotaEfetiva();
    const corpo = await submeterEPegarOCorpo();
    expect(corpo.servico.issRetido).toBe(false);
  });

  test("⚠⚠ e a ALÍQUOTA VIAJA no Simples quando a caixa está marcada (02/09/2026)", async () => {
    // ⚠⚠ ESTE CASO AFIRMAVA O CONTRÁRIO. Ela viaja porque, COM retenção, a DPS a EXIGE
    // (E0621/E0628) — e enquanto o perfil de emissão está desligado não existe outra fonte.
    // ⚠ Não são duas fontes para o mesmo campo: ligado o perfil, ele VENCE
    // (`buildDpsXml`: `doPerfil("pAliq") ?? aliquota`).
    await renderizar(SIMPLES);
    preencherComAliquotaEfetiva();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    fireEvent.change(document.getElementById("emitir-aliquota"), { target: { value: "5" } });
    const corpo = await submeterEPegarOCorpo();
    expect(corpo.servico.aliquota).toBe(5);
  });

  test("⚠ DESMARCADA, a alíquota não viaja no Simples — nem presa no estado do formulário", async () => {
    // O princípio do cabeçalho: campo escondido que continua viajando é o defeito pior. E aqui ele
    // não é só sujeira — sem retenção a alíquota é PROIBIDA na DPS (E0625/E0631).
    await renderizar(SIMPLES);
    preencherComAliquotaEfetiva();
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    fireEvent.change(document.getElementById("emitir-aliquota"), { target: { value: "5" } });
    fireEvent.click(document.getElementById("emitir-iss-retido"));
    const corpo = await submeterEPegarOCorpo();
    // ⚠ Varredura do JSON inteiro, não só de `servico.aliquota`.
    expect(JSON.stringify(corpo)).not.toMatch(/"aliquota":\s*[0-9]/);
  });
});
