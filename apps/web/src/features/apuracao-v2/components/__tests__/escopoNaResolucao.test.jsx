// A LIGAÇÃO do escopo da resolução — a regra já é medida em `lib/__tests__/escopoDaResolucao.test.js`
// (16 testes) e NÃO é remedida aqui. O que este arquivo prende é o que só a tela pode errar: a
// opção aparecer, o bloqueio ficar visível em vez de sumir, o aviso não virar permanente, e — o
// mais importante — **o que chega ao payload**.

import { render, screen, fireEvent } from "@testing-library/react";
import { ResolverPendenciaModal } from "../ResolverPendenciaModal";

const PENDENCIA = {
  id: "p1",
  tipo: "ITEM_SEM_REGRA",
  competencia: "2026-07",
  detalhes: { codigo: "171201", tipoCodigo: "LC116", ocorrencias: 4 },
  esperandoAMesmaDecisao: 3,
};

const texto = () => document.body.textContent.replace(/\s+/g, " ");

function abrir(props = {}) {
  const onResolver = jest.fn(async () => {});
  render(
    <ResolverPendenciaModal
      pendencia={props.pendencia || PENDENCIA}
      myRole={props.myRole}
      onResolver={onResolver}
      onClose={() => {}}
      saving={false}
    />,
  );
  return onResolver;
}

/** Escolhe um tipo de receita — sem ele o formulário não envia. */
function escolherTipo() {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "SERVICO_ANEXO_IV" } });
}

describe("⚠ A OPÇÃO APARECE, E O BLOQUEIO FICA VISÍVEL", () => {
  it("FIRM_ADMIN vê as duas opções, com EMPRESA marcada", () => {
    abrir({ myRole: "FIRM_ADMIN" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);   // EMPRESA
    expect(radios[1].checked).toBe(false);  // GLOBAL
  });

  it("⚠⚠ ACCOUNTANT vê a opção DESABILITADA, não ausente — e com o motivo no corpo", () => {
    // Opção que some esconde que a ação existe, e aí ninguém sabe a quem pedir. O motivo vai no
    // texto, não só no `title`: `title` não aparece no teclado nem no toque.
    abrir({ myRole: "ACCOUNTANT" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[1].disabled).toBe(true);
    expect(texto()).toMatch(/administrador do escritório/i);
    expect(texto()).toMatch(/Peça a quem tem esse perfil/i);
  });

  it("⚠ sem `myRole` (contrato antigo) o alcance maior NÃO é oferecido", () => {
    abrir({ myRole: undefined });
    expect(screen.getAllByRole("radio")[1].disabled).toBe(true);
  });
});

describe("⚠⚠ O AVISO SÓ APARECE COM GLOBAL ESCOLHIDO", () => {
  it("em EMPRESA (o estado inicial) não há aviso de alcance", () => {
    abrir({ myRole: "FIRM_ADMIN" });
    expect(texto()).not.toMatch(/Esta decisão sai desta empresa/i);
  });

  it("ao escolher GLOBAL ele aparece e diz que outras fecham SEM revisão", () => {
    abrir({ myRole: "FIRM_ADMIN" });
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(texto()).toMatch(/Esta decisão sai desta empresa/i);
    expect(texto()).toMatch(/sem que elas sejam revisadas/i);
  });

  it("⚠ e o GANHO é dito com número, para a escolha não ser às cegas", () => {
    abrir({ myRole: "FIRM_ADMIN" });
    expect(texto()).toMatch(/3 outras empresas estão paradas/i);
  });

  it("⚠⚠ sem o campo `esperandoAMesmaDecisao`, a tela NÃO afirma quantas esperam", () => {
    // `Number(undefined)` é NaN, mas `Number(null)` é 0 — colapsar ausência em zero faria a tela
    // dizer "nenhuma outra empresa" a partir de um campo que não veio.
    abrir({ myRole: "FIRM_ADMIN", pendencia: { ...PENDENCIA, esperandoAMesmaDecisao: undefined } });
    expect(texto()).not.toMatch(/outras empresas estão paradas/i);
    expect(texto()).not.toMatch(/Nenhuma outra empresa está parada/i);
    // ⚠ mas a CONSEQUÊNCIA do alcance continua dita — ela não depende do número.
    expect(texto()).toMatch(/todas as empresas/i);
  });
});

describe("⚠⚠ O QUE CHEGA AO PAYLOAD", () => {
  it("EMPRESA (o padrão) NÃO manda o campo — a requisição antiga fica intacta", async () => {
    const onResolver = abrir({ myRole: "FIRM_ADMIN" });
    escolherTipo();
    fireEvent.click(screen.getByRole("button", { name: /Resolver pendência/i }));
    expect(onResolver).toHaveBeenCalled();
    expect(onResolver.mock.calls[0][0]).not.toHaveProperty("escopo");
  });

  it("GLOBAL manda `escopo: \"GLOBAL\"`", async () => {
    const onResolver = abrir({ myRole: "FIRM_ADMIN" });
    escolherTipo();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: /Resolver pendência/i }));
    expect(onResolver.mock.calls[0][0]).toMatchObject({ escopo: "GLOBAL" });
  });
});

describe("⚠ O ALCANCE SÓ É PERGUNTADO SE HOUVER REGRA", () => {
  it("desmarcando 'Salvar como regra', o bloco some", () => {
    // Sem `criarRegra` não existe regra — perguntar "para quem ela vale" seria perguntar sobre algo
    // que não vai existir.
    abrir({ myRole: "FIRM_ADMIN" });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});
