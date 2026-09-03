// A GUIA CUJO ENVIO FALHOU PRECISA APARECER — COM O MOTIVO E COM UM CAMINHO DE AÇÃO.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// O worker grava `emailStatus:"ERROR"` + `emailLastError` + `emailNextRetryAt`, e **nada drena esse
// retry**: o laço automático saiu na Q55 ("nada roda sozinho"). A guia fica em ERROR até alguém, por
// acaso, clicar de novo.
//
// O que tornava isso invisível era ESTE chip: `ERROR` caía no mesmo `state: "gerada"` do PENDING e
// pintava âmbar "gerada, falta enviar" — o estado de quem nunca foi tentado. No dashboard, que é
// onde o contador olha todo dia, a falha e a rotina normal tinham exatamente a mesma cara.
//
// Aqui se testa a LIGAÇÃO: o estado tem visual próprio, o motivo aparece, e o botão de enviar
// continua ali (o envio manual alcança guia em ERROR — `whereGuiaPendenteDeEnvio()` sem janela de
// retry, no backend).
import { render, screen, fireEvent } from "@testing-library/react";
import { GuiaChip, todasConcluidas } from "../renderGuiaChip.jsx";

const EMPRESA = { companyId: "c1", razao: "ACME LTDA", guideNotificationEmail: "cliente@acme.com.br" };

function tagFalhou(over = {}) {
  return {
    key: "das",
    label: "DAS",
    state: "falhou",
    ok: true,
    guideId: "g-das",
    emailStatus: "ERROR",
    emailAttempts: 3,
    emailLastError: "550 5.1.1 mailbox unavailable",
    ...over,
  };
}

function renderChip(tag, acoes = {}) {
  return render(<GuiaChip tag={tag} empresa={EMPRESA} competencia="2026-07" acoes={acoes} />);
}

describe("chip de guia com envio falhado", () => {
  test("não se apresenta como 'gerada, falta enviar'", () => {
    renderChip(tagFalhou());
    const botao = screen.getByRole("button", { name: /DAS/ });
    expect(botao).toHaveAttribute("title", expect.stringMatching(/FALHOU/));
    expect(botao.getAttribute("title")).not.toMatch(/gerada, falta enviar/);
  });

  test("tem ÍCONE próprio — cor não pode ser o único sinal", () => {
    // Regra de aceite do projeto: um screenshot dessaturado precisa continuar legível. ✖ ≠ ⚠ ≠ ✈.
    renderChip(tagFalhou());
    expect(screen.getByRole("button", { name: /DAS/ }).textContent).toContain("✖");
  });

  test("o MOTIVO aparece ao abrir o chip", () => {
    renderChip(tagFalhou());
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByText(/550 5.1.1 mailbox unavailable/)).toBeInTheDocument();
  });

  test("avisa que NINGUÉM vai tentar de novo — é o ponto todo", () => {
    renderChip(tagFalhou());
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByText(/nada vai tentar de novo sozinho/i)).toBeInTheDocument();
  });

  test("oferece o caminho de ação: o MESMO envio, de novo", () => {
    const onEnviar = jest.fn().mockResolvedValue({ ok: true });
    renderChip(tagFalhou(), { onEnviar });
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tentar enviar de novo/ }));
    expect(onEnviar).toHaveBeenCalledWith("g-das", EMPRESA);
  });

  test("mostra o destinatário antes de disparar — ação externa nunca sai às cegas", () => {
    renderChip(tagFalhou(), { onEnviar: jest.fn() });
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByText("cliente@acme.com.br")).toBeInTheDocument();
  });

  test("⚠ NÃO é estado terminal: o card não pode condensar em '✓ Guias concluídas'", () => {
    // Condensar esconde o chip. Se `falhou` contasse como terminal, a empresa cuja guia não chegou
    // ao cliente exibiria o selo verde de tudo resolvido — o defeito de volta, agravado.
    expect(todasConcluidas([tagFalhou()])).toBe(false);
    expect(todasConcluidas([{ ...tagFalhou(), state: "enviada" }])).toBe(true);
  });

  test("sem `emailLastError` o chip ainda avisa da falha, sem inventar motivo", () => {
    // Motivo ausente é caso real (guia antiga, coluna nunca preenchida). Calar a falha por falta do
    // detalhe seria trocar uma informação incompleta por nenhuma.
    renderChip(tagFalhou({ emailLastError: null }));
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByText(/nada vai tentar de novo sozinho/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Motivo:/)).not.toBeInTheDocument();
  });
});

// ── A SEGUNDA FONTE DO `falhou` (02/09/2026): o WhatsApp que a Meta recusou ─────────────────────
describe("chip de guia com envio por WHATSAPP falhado", () => {
  function tagZap(over = {}) {
    return {
      key: "das", label: "DAS", state: "falhou", ok: true, guideId: "g-das",
      emailStatus: "PENDING", canalEnvio: "WHATSAPP", envioStatus: "falhou",
      envioErro: "O contato não tem opt-in registrado — a Meta não entrega template sem ele.",
      envioErroCodigo: "META_131047", envioPodeTentarDeNovo: null,
      ...over,
    };
  }

  test("o motivo TRADUZIDO aparece, e não o texto do e-mail", () => {
    renderChip(tagZap());
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByTestId("falha-whatsapp")).toHaveTextContent(/WhatsApp falhou/);
    expect(screen.getByText(/opt-in registrado/)).toBeInTheDocument();
    expect(screen.queryByText(/Tentar enviar de novo/)).toBeNull();
  });

  test("⚠ `null` (a Meta não diz): o botão fica HABILITADO e a frase diz que a decisão é do contador", () => {
    const onEnviarWhatsapp = jest.fn().mockResolvedValue({ ok: true });
    renderChip(tagZap({ envioPodeTentarDeNovo: null }), { onEnviarWhatsapp });
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByText(/A Meta não diz se reenviar resolve/)).toBeInTheDocument();
    const botao = screen.getByRole("button", { name: /Tentar de novo por WhatsApp/ });
    expect(botao).toBeEnabled();
    fireEvent.click(botao);
    expect(onEnviarWhatsapp).toHaveBeenCalledWith("g-das", EMPRESA);
  });

  test("`false` (definitivo): botão DESABILITADO, com o conserto em outro lugar", () => {
    renderChip(tagZap({ envioPodeTentarDeNovo: false }));
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByRole("button", { name: /Tentar de novo por WhatsApp/ })).toBeDisabled();
    expect(screen.getByText(/Reenviar igual falha igual/)).toBeInTheDocument();
  });

  test("`true` (retentável): botão habilitado, 'reenviar é o caminho'", () => {
    renderChip(tagZap({ envioPodeTentarDeNovo: true }));
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByRole("button", { name: /Tentar de novo por WhatsApp/ })).toBeEnabled();
    expect(screen.getByText(/passageiro/)).toBeInTheDocument();
  });

  test("o e-mail continua sendo oferecido ao lado — a guia ainda pode sair por lá", () => {
    renderChip(tagZap());
    fireEvent.click(screen.getByRole("button", { name: /DAS/ }));
    expect(screen.getByRole("button", { name: /Enviar e-mail/ })).toBeInTheDocument();
  });
});
