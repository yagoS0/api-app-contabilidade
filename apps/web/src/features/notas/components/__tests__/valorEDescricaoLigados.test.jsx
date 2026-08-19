// A LIGAÇÃO — o assistente do contador USA MESMO as duas libs novas, e o resultado CHEGA ao campo
// e ao payload.
//
// ⚠⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO. As regras já têm suíte própria
// (`lib/__tests__/valorDaNota.test.js` e `lib/__tests__/descricaoSugerida.test.js`); nada é
// reescrito aqui. O que se prova é a CADEIA: `cadastroEmissao` → sugestão → `<textarea>`, e
// teclado/colagem → máscara → `montarPayload`. Cada invariante negativa ("sem atividade, campo
// vazio") vem com a positiva ("com atividade, campo preenchido") — sem o par, uma tela que nunca
// sugere nada passaria nas duas.
//
// ⚠⚠ NADA É EMITIDO. `onEmitir` é um espião; o botão Emitir só existe no passo de conferência e o
// `window.confirm` é substituído por uma função que devolve `false` nos casos em que a nota seria
// transmitida — exceto no único caso que precisa ver o payload, onde `onEmitir` é um dublê local
// que não fala com rede nenhuma.
//
// ⚠ NENHUM TESTE TOCA A REDE: `fetchCnpj` é um dublê que nunca resolve (o assistente consulta o
// CNPJ ao completar 14 dígitos).

import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EmitirNfseWizard } from "../EmitirNfseWizard";

const noop = () => {};
const FETCH_QUE_NUNCA_RESPONDE = () => new Promise(() => {});

// Cadastro que deixa a empresa emitir — sem ele o assistente trava no passo 1 e os casos falariam
// pelo motivo errado. Os valores são os do exemplo real de `docs/nfse-preenchimento.md` §12.
const CADASTRO_BASE = {
  cnpj: "39254243000191",
  inscricaoMunicipal: "1.234.567-8",
  codigoServicoNacional: "171201",
  codigoServicoMunicipal: "001",
  rpsSerie: "00001",
};

// As atividades REAIS de produção (33 empresas medidas).
const KLAUS = ["73.19-0-03 - Marketing direto"];
const KAIZEN = ["71.12-0-00", "4120400", "4399101", "4399103"];
const DUAS = [
  "62.01-5-01 - Desenvolvimento de programas de computador sob encomenda",
  "62.04-0-00 - Consultoria em tecnologia da informação",
];

function abrir({ cadastroEmissao = CADASTRO_BASE, onEmitir = jest.fn(async () => ({ status: "issued", nfse: {} })) } = {}) {
  render(
    <EmitirNfseWizard
      companyId="c-1"
      regime="SIMPLES"
      codigoMunicipioIbge="3304557"
      cadastroEmissao={cadastroEmissao}
      fetchCnpj={FETCH_QUE_NUNCA_RESPONDE}
      onEmitir={onEmitir}
      onClose={noop}
    />
  );
  return { onEmitir };
}

const campoValor = () => screen.getByLabelText(/Valor dos servi[çc]os/i);
const campoDescricao = () => screen.getByLabelText(/Descri[çc][ãa]o do servi[çc]o/i);
const digitar = (el, valor) => fireEvent.change(el, { target: { value: valor } });
const colar = (el, texto) =>
  fireEvent.paste(el, { clipboardData: { getData: () => texto } });

describe("o VALOR chega mascarado ao campo e numérico ao payload", () => {
  it("o teclado só produz a forma canônica — o ponto não entra", () => {
    abrir();
    digitar(campoValor(), "150000");
    expect(campoValor()).toHaveValue("1.500,00");
    // ⚠ A prova de que não há duas grafias: tentar escrever com ponto desaba nos mesmos dígitos.
    digitar(campoValor(), "1500.00");
    expect(campoValor()).toHaveValue("1.500,00");
  });

  it("campo em branco continua em branco — a máscara não fabrica 0,00", () => {
    abrir();
    digitar(campoValor(), "150000");
    digitar(campoValor(), "");
    expect(campoValor()).toHaveValue("");
  });

  // ⚠⚠ O CASO QUE VALE A ENTREGA: o número que chega ao payload é o que o contador VIU.
  it("o payload leva NÚMERO, e é o mesmo valor que o campo mostra", async () => {
    const onEmitir = jest.fn(async () => ({ status: "issued", nfse: { numero: "1" } }));
    abrir({ onEmitir });
    digitar(screen.getByLabelText(/CNPJ ou CPF do tomador/i), "12345678000199");
    digitar(screen.getByLabelText(/Nome ou raz[ãa]o social/i), "ACME LTDA");
    digitar(campoDescricao(), "Consultoria");
    digitar(campoValor(), "150000");
    digitar(screen.getByLabelText(/Total de tributos do Simples Nacional/i), "6,84");

    expect(campoValor()).toHaveValue("1.500,00");
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
    const confirmar = jest.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /^Emitir/i }));
    confirmar.mockRestore();

    expect(onEmitir).toHaveBeenCalledTimes(1);
    const payload = onEmitir.mock.calls[0][0];
    expect(payload.servico.valorServicos).toBe(1500);
    expect(typeof payload.servico.valorServicos).toBe("number");
  });

  it("colagem inequívoca entra; a ambígua NÃO entra e a tela diz por quê", () => {
    abrir();
    colar(campoValor(), "R$ 1.500,00");
    expect(campoValor()).toHaveValue("1.500,00");

    // ⚠ "1.500" tem duas leituras. O campo fica COMO ESTAVA e a recusa aparece — nada de converter
    // em silêncio um valor que pode estar mil vezes errado.
    colar(campoValor(), "1.500");
    expect(campoValor()).toHaveValue("1.500,00");
    expect(screen.getByRole("status")).toHaveTextContent(/duas leituras/i);

    // Digitar limpa a recusa: ela era sobre a colagem, não sobre o campo.
    digitar(campoValor(), "20000");
    expect(campoValor()).toHaveValue("200,00");
    expect(screen.queryByText(/duas leituras/i)).not.toBeInTheDocument();
  });

  it("colar 1500 (planilha) vira mil e quinhentos, não quinze reais", () => {
    abrir();
    colar(campoValor(), "1500");
    expect(campoValor()).toHaveValue("1.500,00");
  });
});

describe("a DESCRIÇÃO chega sugerida ao campo", () => {
  it("com atividade cadastrada, o campo abre preenchido e com a origem à vista", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: KLAUS, cnaePrincipal: "7319003" } });
    expect(campoDescricao()).toHaveValue("Serviço prestado: Marketing direto");
    expect(screen.getByText(/Sugerido a partir da única atividade/i)).toBeInTheDocument();
  });

  it("a competência entra na frase quando é escolhida", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: KLAUS, cnaePrincipal: "7319003" } });
    digitar(screen.getByLabelText(/Compet[êe]ncia/i), "2026-07");
    expect(campoDescricao()).toHaveValue("Serviço prestado: Marketing direto — competência 07/2026");
  });

  // ⚠⚠ SUGESTÃO NÃO É TRAVA, E O DIGITADO VENCE — inclusive contra uma mudança de competência
  // posterior, que é onde um efeito mal escrito sobrescreveria o que a pessoa acabou de digitar.
  it("o digitado vence, e a mudança de competência não o reescreve", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: KLAUS, cnaePrincipal: "7319003" } });
    digitar(campoDescricao(), "Consultoria contábil de janeiro");
    digitar(screen.getByLabelText(/Compet[êe]ncia/i), "2026-07");
    expect(campoDescricao()).toHaveValue("Consultoria contábil de janeiro");
    expect(screen.queryByText(/Sugerido a partir/i)).not.toBeInTheDocument();
  });

  // ⚠⚠ SEM DADO, CAMPO VAZIO — e a tela diz por quê e onde se resolve. Meia frase num documento
  // fiscal é pior que campo em branco.
  it("só códigos nus: campo VAZIO, com o motivo na tela", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: KAIZEN, cnaePrincipal: "7112000" } });
    expect(campoDescricao()).toHaveValue("");
    expect(screen.getByText(/não deduzimos o texto a partir do número/i)).toBeInTheDocument();
    expect(screen.getByText(/Editar cadastro → Atividades/i)).toBeInTheDocument();
  });

  it("sem atividade nenhuma: campo VAZIO, com o motivo na tela", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: [], cnaePrincipal: "7112000" } });
    expect(campoDescricao()).toHaveValue("");
    expect(screen.getByText(/não tem atividade cadastrada/i)).toBeInTheDocument();
  });

  // ⚠ PROP AUSENTE ≠ CADASTRO VAZIO: sem o cadastro a tela não acusa nada sobre as atividades.
  // (Sem `cadastroEmissao` o passo 1 bloqueia por outro motivo, que é o comportamento de sempre.)
  it("sem cadastro, a tela não afirma que a empresa não tem atividade", () => {
    abrir({ cadastroEmissao: null });
    expect(screen.queryByText(/não tem atividade cadastrada/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sugerido a partir/i)).not.toBeInTheDocument();
  });

  // ⚠⚠ ENCONTRA, NUNCA ESCOLHE: com duas atividades e nenhuma que seja a do CNAE principal, o campo
  // fica vazio e as opções são OFERECIDAS, sem nenhuma pré-selecionada.
  it("duas atividades sem desempate: nada é escolhido, e as duas são oferecidas", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: DUAS, cnaePrincipal: "8599604" } });
    expect(campoDescricao()).toHaveValue("");
    expect(screen.getByText(/nenhuma delas é, sem dúvida, a do CNAE principal/i)).toBeInTheDocument();

    const escolher = screen.getByRole("button", { name: /Consultoria em tecnologia da informação/i });
    fireEvent.click(escolher);
    expect(campoDescricao()).toHaveValue("Serviço prestado: Consultoria em tecnologia da informação");
  });

  it("duas atividades COM desempate pelo CNAE principal: sugere a certa, dizendo que foi por isso", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: DUAS, cnaePrincipal: "6204000" } });
    expect(campoDescricao()).toHaveValue("Serviço prestado: Consultoria em tecnologia da informação");
    expect(screen.getByText(/corresponde ao CNAE principal/i)).toBeInTheDocument();
  });

  // ⚠ A sugestão TAMBÉM tem de chegar ao ESPELHO — ele é a conferência, e sai da mesma
  // `linhasDoEspelho` do `window.confirm`.
  it("a frase sugerida aparece no espelho ao vivo", () => {
    abrir({ cadastroEmissao: { ...CADASTRO_BASE, atividades: KLAUS, cnaePrincipal: "7319003" } });
    const painel = screen.getByRole("complementary", { name: /A nota como ela vai sair/i });
    expect(within(painel).getByText(/Serviço prestado: Marketing direto/)).toBeInTheDocument();
  });
});
