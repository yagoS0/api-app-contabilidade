// O RASCUNHO CHEGA AO CAMPO DE ANOTAÇÃO — a última ponta de "virar anotação" (F3, 06/09/2026).
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE. A regra compõe o texto e o chat chama o callback — as duas coisas
// já têm teste. Nenhuma delas prova que o texto CHEGA ao `<textarea>` ao lado, que é a única parte
// que o contador vê. Componente certo sem chamador é o defeito favorito desta base.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CompanyNotesTab } from "../renderCompanyNotesTab";

const notes = {
  fixada: null,
  demais: [],
  ordenarPor: "data",
  setOrdenarPor: jest.fn(),
  carregando: false,
  criar: jest.fn(async () => true),
  atualizar: jest.fn(),
  excluir: jest.fn(),
};

const campo = () => screen.getByLabelText("Nova anotação sobre esta empresa");

describe("⚠⚠ virar anotação NÃO grava — o texto cai no campo para o contador editar", () => {
  it("o rascunho chega ao campo, e nada é salvo por conta própria", () => {
    render(<CompanyNotesTab notes={notes} rascunho={'06/09, 11:00 · Maria no WhatsApp: "quero parcelar"'} />);
    expect(campo()).toHaveValue('06/09, 11:00 · Maria no WhatsApp: "quero parcelar"');
    // ⚠ A anotação só existe quando ELE clica em Adicionar — anotação é juízo, não cópia.
    expect(notes.criar).not.toHaveBeenCalled();
  });

  it("⚠⚠ o rascunho SOMA ao que já estava escrito — nunca apaga o parágrafo de quem estava digitando", () => {
    const { rerender } = render(<CompanyNotesTab notes={notes} rascunho={null} />);
    fireEvent.change(campo(), { target: { value: "Conversar com o sócio sobre isso." } });
    rerender(<CompanyNotesTab notes={notes} rascunho={'Maria no WhatsApp: "quero parcelar"'} />);
    expect(campo().value).toMatch(/^Conversar com o sócio sobre isso\./);
    expect(campo().value).toMatch(/quero parcelar/);
  });

  it("rascunho vazio ou ausente não mexe no campo", () => {
    render(<CompanyNotesTab notes={notes} rascunho="   " />);
    expect(campo()).toHaveValue("");
  });

  it("⚠ o consumo é AVISADO, para o mesmo texto não voltar sozinho a cada render", () => {
    const aoUsarRascunho = jest.fn();
    render(<CompanyNotesTab notes={notes} rascunho="algo" aoUsarRascunho={aoUsarRascunho} />);
    expect(aoUsarRascunho).toHaveBeenCalledTimes(1);
  });
});
