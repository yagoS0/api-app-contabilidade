// A LIGAÇÃO do controle do portão — a regra é de `lib/nfse/__tests__/liberacaoEmissaoCliente.test.js`.
//
// O que este arquivo tranca:
//   1. o bloco aparece DENTRO de "Emissão de NFS-e" e só quando a tela recebeu o estado;
//   2. ligar CONFIRMA repetindo o que vai acontecer — nada é enviado no primeiro clique;
//   3. "quem liberou e quando" está na tela quando está liberada;
//   4. ⚠ o botão de LIGAR não é verde (verde é CONCLUÍDO neste app).

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CamposEmissaoNfse } from "../CamposEmissaoNfse";

const LIBERADA = {
  liberada: true,
  liberadaEm: "2026-08-17T13:40:00.000Z",
  liberadaPor: "user-1",
  liberadaPorNome: "Contador Fulano",
};
const FECHADA = { liberada: false, liberadaEm: null, liberadaPor: null, liberadaPorNome: null };

function abrir(props = {}) {
  const onSetEmissaoCliente = jest.fn(async () => ({ ok: true }));
  render(
    <CamposEmissaoNfse
      codigoServicoNacional=""
      codigosServicoNacional={[]}
      codigoServicoMunicipal=""
      rpsSerie=""
      onChange={jest.fn()}
      razaoSocial="EMPRESA TESTE LTDA"
      onSetEmissaoCliente={onSetEmissaoCliente}
      {...props}
    />
  );
  return { onSetEmissaoCliente };
}

describe("quando o bloco aparece", () => {
  it("não aparece sem o estado — prop ausente é 'não recebi', não 'não liberada'", () => {
    abrir({ emissaoCliente: undefined });
    expect(screen.queryByTestId("estado-emissao-cliente")).not.toBeInTheDocument();
  });

  it("não aparece sem handler (cadastro de empresa NOVA: não há empresa a liberar)", () => {
    abrir({ emissaoCliente: FECHADA, onSetEmissaoCliente: null });
    expect(screen.queryByTestId("estado-emissao-cliente")).not.toBeInTheDocument();
  });

  it("aparece com o estado, dentro do bloco Emissão de NFS-e", () => {
    abrir({ emissaoCliente: FECHADA });
    expect(screen.getByText("Emissão de NFS-e")).toBeInTheDocument();
    expect(screen.getByTestId("estado-emissao-cliente")).toHaveTextContent("Não liberada");
  });
});

describe("o estado é dito em PALAVRA, não só em cor", () => {
  it("fechada", () => {
    abrir({ emissaoCliente: FECHADA });
    expect(screen.getByTestId("estado-emissao-cliente")).toHaveTextContent("Não liberada");
    expect(screen.getByRole("button", { name: /liberar a emissão/i })).toBeInTheDocument();
  });

  it("liberada, com quem liberou e quando", () => {
    abrir({ emissaoCliente: LIBERADA });
    expect(screen.getByTestId("estado-emissao-cliente")).toHaveTextContent("Liberada");
    expect(screen.getByTestId("autoria-emissao-cliente")).toHaveTextContent("Contador Fulano");
    expect(screen.getByRole("button", { name: /revogar/i })).toBeInTheDocument();
  });
});

describe("⚠ ligar é ato de consequência — confirma repetindo o que vai acontecer", () => {
  it("o primeiro clique NÃO envia nada; abre a confirmação com a frase inteira", async () => {
    const { onSetEmissaoCliente } = abrir({ emissaoCliente: FECHADA });
    fireEvent.click(screen.getByRole("button", { name: /liberar a emissão/i }));

    expect(onSetEmissaoCliente).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo).toHaveTextContent("CLIENT_ADMIN");
    expect(dialogo).toHaveTextContent("OWNER");
    expect(dialogo).toHaveTextContent(/produção/i);
    expect(dialogo).toHaveTextContent("EMPRESA TESTE LTDA");
    // O papel que continua sem emitir é nomeado — é a surpresa que se quer evitar.
    expect(dialogo).toHaveTextContent("FINANCEIRO");
  });

  it("confirmar chama o handler com `true`", async () => {
    const { onSetEmissaoCliente } = abrir({ emissaoCliente: FECHADA });
    fireEvent.click(screen.getByRole("button", { name: /liberar a emissão/i }));
    fireEvent.click(screen.getByRole("button", { name: /sim, liberar/i }));
    await waitFor(() => expect(onSetEmissaoCliente).toHaveBeenCalledWith(true));
  });

  it("cancelar fecha a confirmação sem enviar nada", () => {
    const { onSetEmissaoCliente } = abrir({ emissaoCliente: FECHADA });
    fireEvent.click(screen.getByRole("button", { name: /liberar a emissão/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));
    expect(onSetEmissaoCliente).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("revogar também confirma, e diz que o escritório continua emitindo", async () => {
    const { onSetEmissaoCliente } = abrir({ emissaoCliente: LIBERADA });
    fireEvent.click(screen.getByRole("button", { name: /revogar/i }));
    expect(onSetEmissaoCliente).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/escritório continua emitindo/i);
    fireEvent.click(screen.getByRole("button", { name: /sim, revogar/i }));
    await waitFor(() => expect(onSetEmissaoCliente).toHaveBeenCalledWith(false));
  });
});

describe("⚠ verde é CONCLUÍDO — não entra em botão de ação", () => {
  it("nem o botão de liberar nem o de confirmar usam os tokens de sucesso", () => {
    abrir({ emissaoCliente: FECHADA });
    const botao = screen.getByRole("button", { name: /liberar a emissão/i });
    const estilo = `${botao.getAttribute("style")}`;
    expect(estilo).not.toMatch(/--state-ok|--success/);
    expect(estilo).toMatch(/--accent-purple/);

    fireEvent.click(botao);
    const confirmar = screen.getByRole("button", { name: /sim, liberar/i });
    expect(`${confirmar.getAttribute("style")}`).not.toMatch(/--state-ok|--success/);
  });

  it("nenhuma cor é hex literal — tudo sai de `var(--…)`", () => {
    abrir({ emissaoCliente: LIBERADA });
    const botao = screen.getByRole("button", { name: /revogar/i });
    expect(`${botao.getAttribute("style")}`).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("salvando", () => {
  it("o botão fica desabilitado enquanto salva — clique duplo não vira dois atos", () => {
    abrir({ emissaoCliente: FECHADA, emissaoClienteSaving: true });
    expect(screen.getByRole("button", { name: /liberar a emissão/i })).toBeDisabled();
  });
});
