// A LIGAÇÃO — "clicar numa nota já emitida para copiar dados", e o DANFSe finalmente com porta.
//
// As REGRAS estão em `notas/lib/__tests__/reaproveitarNota.test.js` e `.../danfseDaNota.test.js`.
// O que se mede aqui é o que só a tela pode errar:
//   • o detalhe da nota OFERECE as duas ações, e diz por que não oferece quando não dá;
//   • o assistente abre PREENCHIDO — e **sem número, sem chave, sem ID** em lugar nenhum do DOM;
//   • a tela diz que é NOTA NOVA (senão o contador acha que reemitiu a mesma);
//   • o DANFSe percorre os DOIS caminhos: o PDF e a recusa nomeada do 503 sem QR Code.
//
// ⚠ NENHUM TESTE AQUI TOCA A REDE. O `fetch` da consulta de CNPJ entra por `fetchCnpj` (dublê) e o
// download do DANFSe por `onBaixarDanfse`.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotaDetailModal } from "../NotaDetailModal";
import { EmitirNfseWizard } from "../EmitirNfseWizard";
import { modeloDeEmissaoDaNota } from "../../lib/reaproveitarNota";

const noop = () => {};

const CADASTRO_COMPLETO = {
  cnpj: "39254243000191",
  inscricaoMunicipal: "1.234.567-8",
  codigoServicoNacional: "171201",
  codigoServicoMunicipal: "001",
  rpsSerie: "00001",
};

const CHAVE = "33045572255387580000103000000013000260889699241";

function notaEmitida(patch = {}) {
  return {
    id: "nota-1",
    type: "NFSE",
    papel: "EMIT",
    numero: "13000",
    serie: "1",
    chaveAcesso: CHAVE,
    idNfse: "3304557202606000000013000",
    idDps: "DPS-13000",
    statusEfetivo: "autorizada",
    status: "EMITIDA",
    competencia: "2026-06-01T00:00:00.000Z",
    issueDate: "2026-06-10T00:00:00.000Z",
    total: "2300.00",
    emitenteNome: "EMPRESA EXEMPLO LTDA",
    emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR EXEMPLO LTDA",
    tomadorDoc: "11222333000191",
    ciclo: { situacao: "autorizada", eventoRegistrado: false, avisos: [] },
    eventos: [],
    itens: [{ id: "i1", descricao: "CONSULTORIA EM GESTAO", codigoServico: "140201", valor: "2300.00" }],
    xml: { disponivel: true, bytes: 5200, conteudo: "<NFSe/>", truncadoPorTamanho: false },
    ...patch,
  };
}

function abrirDetalhe(nota, props = {}) {
  return render(
    <NotaDetailModal
      nota={nota}
      loading={false}
      error={null}
      onClose={noop}
      onReaproveitar={jest.fn()}
      onBaixarDanfse={jest.fn()}
      {...props}
    />,
  );
}

// jsdom não implementa `createObjectURL`/`revokeObjectURL` — o download real é do browser.
let criados = [];
beforeEach(() => {
  criados = [];
  global.URL.createObjectURL = jest.fn(() => {
    criados.push("blob:danfse");
    return "blob:danfse";
  });
  global.URL.revokeObjectURL = jest.fn();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("o detalhe da nota deixou de ser só uma ficha", () => {
  it("oferece emitir outra a partir desta, e diz que a original não muda", () => {
    abrirDetalhe(notaEmitida());
    const botao = screen.getByRole("button", { name: /Emitir outra a partir desta/i });
    expect(botao).toBeEnabled();
    expect(screen.getByText(/nota nova/i)).toBeInTheDocument();
    expect(screen.getByText(/continua exatamente como est[áa]/i)).toBeInTheDocument();
  });

  it("clicar entrega a NOTA ao chamador — quem monta o modelo é a regra, não o modal", () => {
    const onReaproveitar = jest.fn();
    abrirDetalhe(notaEmitida(), { onReaproveitar });
    fireEvent.click(screen.getByRole("button", { name: /Emitir outra a partir desta/i }));
    expect(onReaproveitar).toHaveBeenCalledTimes(1);
    expect(onReaproveitar.mock.calls[0][0].id).toBe("nota-1");
  });

  // ⚠ Botão impossível NÃO some: fica desabilitado com o motivo em TEXTO (title não é descobrível).
  it("NF-e: botão desabilitado com o motivo visível na tela", () => {
    abrirDetalhe(notaEmitida({ type: "NFE", papel: "DEST", xml: { disponivel: false } }));
    expect(screen.getByRole("button", { name: /Emitir outra a partir desta/i })).toBeDisabled();
    expect(screen.getByText(/n[ãa]o emite NF-e/i)).toBeInTheDocument();
  });

  it("nota RECEBIDA: motivo próprio — a empresa seria tomadora dela mesma", () => {
    abrirDetalhe(notaEmitida({ papel: "DEST" }));
    expect(screen.getByRole("button", { name: /Emitir outra a partir desta/i })).toBeDisabled();
    expect(screen.getByText(/tomadora de si|tomadora dela mesma/i)).toBeInTheDocument();
  });

  // A decisão sobre nota cancelada: PODE servir de modelo — é o caso relatado pelo dono.
  it("nota CANCELADA continua oferecendo o reaproveitamento", () => {
    abrirDetalhe(notaEmitida({ statusEfetivo: "cancelada", ciclo: { situacao: "cancelada" } }));
    expect(screen.getByRole("button", { name: /Emitir outra a partir desta/i })).toBeEnabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("DANFSe — a feature que existia no backend e não tinha porta na tela", () => {
  it("baixa o PDF pelo chamador (fetch com Bearer → Blob), nunca por um <a href> cru", async () => {
    const onBaixarDanfse = jest.fn(async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    abrirDetalhe(notaEmitida(), { onBaixarDanfse });

    fireEvent.click(screen.getByRole("button", { name: /Baixar DANFSe/i }));
    await waitFor(() => expect(onBaixarDanfse).toHaveBeenCalledWith("nota-1"));
    await waitFor(() => expect(criados.length).toBe(1));
    expect(await screen.findByText(/DANFSe gerado e baixado/i)).toBeInTheDocument();
  });

  // ⚠⚠ O CAMINHO QUE NÃO PODE SER SILENCIOSO. O backend recusa com 503 de propósito.
  it("recusa sem QR Code: mostra o motivo E o porquê da recusa — não uma tela em branco", async () => {
    const err = new Error("Não foi possível gerar o QR Code obrigatório do DANFSe.");
    err.code = "danfse_sem_qrcode";
    err.status = 503;
    err.motivo = "a nota não tem chave de acesso no XML";
    const onBaixarDanfse = jest.fn(async () => { throw err; });

    abrirDetalhe(notaEmitida({ chaveAcesso: null }), { onBaixarDanfse });
    fireEvent.click(screen.getByRole("button", { name: /Baixar DANFSe/i }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/QR Code/i);
    expect(alerta).toHaveTextContent(/a nota não tem chave de acesso no XML/i);
    expect(alerta).toHaveTextContent(/documento inv[áa]lido/i);
    // Nada foi baixado: recusa não vira arquivo vazio.
    expect(criados.length).toBe(0);
  });

  it("nota sem XML: o botão fica desabilitado dizendo por que, em vez de sumir", () => {
    abrirDetalhe(notaEmitida({ xml: { disponivel: false, bytes: null, conteudo: null } }));
    expect(screen.getByRole("button", { name: /Baixar DANFSe/i })).toBeDisabled();
    // A frase aparece no bloco de ações e no bloco do XML — as duas dizem a mesma coisa.
    expect(screen.getAllByText(/gerado a partir dele|Recapture a nota/i).length).toBeGreaterThan(0);
  });

  // Nunca salvo: não há cache a limpar nem botão de "regerar" a oferecer.
  it("a tela diz que o PDF é gerado na hora e não fica guardado", () => {
    abrirDetalhe(notaEmitida());
    expect(screen.getByText(/gerado na hora a partir do XML/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("o assistente abre PREENCHIDO — e sem nenhum identificador da nota de origem", () => {
  function abrirAssistenteCom(nota) {
    return render(
      <EmitirNfseWizard
        companyId="c-1"
        regime="SIMPLES"
        codigoMunicipioIbge="3304557"
        cadastroEmissao={CADASTRO_COMPLETO}
        // Dublê: nenhum teste sai para a rede. Recusar mantém o campo como o reaproveitamento
        // o deixou, que é justamente o que se quer medir.
        fetchCnpj={jest.fn(async () => { throw new TypeError("Failed to fetch"); })}
        valoresIniciais={modeloDeEmissaoDaNota(nota)}
        onEmitir={jest.fn()}
        onClose={noop}
      />,
    );
  }

  it("tomador, descrição e valor chegam nos campos", () => {
    abrirAssistenteCom(notaEmitida());
    expect(screen.getByLabelText(/CNPJ ou CPF do tomador/i)).toHaveValue("11222333000191");
    expect(screen.getByLabelText(/Nome ou raz[ãa]o social/i)).toHaveValue("TOMADOR EXEMPLO LTDA");
    expect(screen.getByLabelText(/Descri[çc][ãa]o do servi[çc]o/i)).toHaveValue("CONSULTORIA EM GESTAO");
    // ⚠ Na forma canônica do campo mascarado (`lib/valorDaNota.js`), COM milhar. Era "2300,00"
    // enquanto o campo era texto livre lido por um `replace(",", ".")` — e nessa época "1.500"
    // valia 1,5. O campo e o pré-preenchimento têm de falar a mesma língua.
    expect(screen.getByLabelText(/Valor dos servi[çc]os/i)).toHaveValue("2.300,00");
  });

  // ⚠⚠ A INVARIANTE. Nenhum campo do formulário pode carregar identificador da nota de origem —
  // é o que produziria duplicidade (E0014) ou uma nota que se diz ser outra.
  it("nenhum input carrega número, chave, ID NFS-e ou ID DPS da nota de origem", () => {
    const { container } = abrirAssistenteCom(notaEmitida());
    const valores = Array.from(container.querySelectorAll("input, textarea")).map((el) => String(el.value));
    for (const proibido of [CHAVE, "3304557202606000000013000", "DPS-13000", "13000"]) {
      expect(valores.some((v) => v.includes(proibido))).toBe(false);
    }
  });

  it("a competência da nota de origem NÃO é carregada", () => {
    abrirAssistenteCom(notaEmitida());
    expect(screen.getByLabelText(/Compet[êe]ncia/i)).toHaveValue("");
  });

  it("alíquota e e-mail continuam vazios — a nota capturada não os guarda", () => {
    abrirAssistenteCom(notaEmitida());
    expect(screen.getByLabelText(/E-mail/i)).toHaveValue("");
    expect(screen.getByLabelText(/Al[íi]quota de ISS/i)).toHaveValue("");
  });

  it("a tela DIZ que é nota nova, com número novo, e que a origem não é substituída", () => {
    abrirAssistenteCom(notaEmitida());
    expect(screen.getByText(/Nota NOVA, a partir da nota n[ºo] 13000/i)).toBeInTheDocument();
    expect(screen.getByText(/n[ãa]o [ée] alterada, cancelada nem substitu/i)).toBeInTheDocument();
  });

  it("origem CANCELADA: o aviso de que ela continua cancelada aparece na tela de emissão", () => {
    abrirAssistenteCom(notaEmitida({ statusEfetivo: "cancelada", ciclo: { situacao: "cancelada" } }));
    expect(screen.getByText(/continua cancelada/i)).toBeInTheDocument();
  });

  it("origem SUBSTITUÍDA: a tela manda conferir se o modelo certo não é a substituta", () => {
    abrirAssistenteCom(notaEmitida({ statusEfetivo: "cancelada", ciclo: { situacao: "substituida" } }));
    expect(screen.getByText(/substituta/i)).toBeInTheDocument();
  });

  // ⚠ O nome copiado entra como escolha do contador (igual à sugestão de tomador): é o que impede a
  // consulta de CNPJ — que o próprio preenchimento dispara — de trocá-lo sozinho.
  it("o nome copiado aparece marcado como digitado, e não como vindo da Receita", () => {
    abrirAssistenteCom(notaEmitida());
    expect(screen.getByText(/\(digitado\)/i)).toBeInTheDocument();
  });

  // A emissão do zero não pode herdar nada — e o assistente sem `valoresIniciais` é o caminho de
  // sempre, que continua abrindo vazio.
  it("sem `valoresIniciais` o assistente abre vazio e sem o aviso de reaproveitamento", () => {
    render(
      <EmitirNfseWizard
        companyId="c-1"
        regime="SIMPLES"
        codigoMunicipioIbge="3304557"
        cadastroEmissao={CADASTRO_COMPLETO}
        onEmitir={jest.fn()}
        onClose={noop}
      />,
    );
    expect(screen.getByLabelText(/CNPJ ou CPF do tomador/i)).toHaveValue("");
    expect(screen.queryByText(/Nota NOVA, a partir da nota/i)).not.toBeInTheDocument();
  });
});
