// ⚠⚠ O RELATÓRIO É UMA FOTO — E O BLOQUEIO DENTRO DELE NÃO PODE SE PASSAR POR DIAGNÓSTICO DE AGORA.
//
// Relatado pelo dono em 25/08/2026, com as duas telas abertas: a aba Apuração da LENTE dizia
// "A empresa não tem Cadastro Fiscal preenchido (regime + CNAE)" enquanto Empresa → Perfil fiscal,
// da MESMA empresa, mostrava "Simples Nacional" e duas atividades ativas.
//
// Medido contra produção: a foto era de 12:26:57 e o `CadastroFiscal` foi criado às 12:55:24 —
// 28 minutos DEPOIS. A frase não estava errada quando foi escrita; ela envelheceu na tela.
//
// ⚠ A REGRA é do backend (`conferirBloqueiosDaFoto`, 9 testes). Aqui se prova a LIGAÇÃO: que a
// tela mostra o aviso ANTES do motivo, que ela NÃO o mostra quando o bloqueio continua valendo, e
// que ela nunca o mostra a partir de um bloqueio que ninguém conferiu.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { diagnosticoDaFoto } from "../../lib/relatorioFaturamento";

const bloq = (tipo, aindaVale) => ({ tipo, mensagem: "x", aindaVale });

describe("diagnosticoDaFoto — a leitura", () => {
  it("bloqueio que caiu vira aviso, com a frase do contador e não o nome do código", () => {
    const d = diagnosticoDaFoto({ diagnostico: { algumDeixouDeValer: true, bloqueios: [bloq("CADASTRO_FALTANDO", false)] } });
    expect(d.detalhe).toMatch(/Cadastro Fiscal foi preenchido depois/i);
    expect(d.detalhe).not.toMatch(/CADASTRO_FALTANDO/);
    // ⚠ E ele diz o que continua valendo: os NÚMEROS são os da data da foto.
    expect(d.detalhe).toMatch(/números do faturamento continuam sendo os da data da foto/i);
    expect(d.detalhe).toMatch(/Regerar/);
  });

  it("bloqueio que CONTINUA valendo não produz aviso nenhum", () => {
    expect(diagnosticoDaFoto({ diagnostico: { algumDeixouDeValer: false, bloqueios: [bloq("CADASTRO_FALTANDO", true)] } })).toBeNull();
  });

  it("⚠⚠ bloqueio NÃO CONFERIDO (`null`) nunca vira \"já resolvido\"", () => {
    // Dizer que um bloqueio caiu porque não olhamos para ele seria trocar um diagnóstico velho por
    // um INVENTADO. `RECEITA_NAO_CLASSIFICADA` exige varrer as notas do mês e não é reconferida na
    // leitura — por isso ela sai `null`, e `null` fica fora da frase.
    expect(diagnosticoDaFoto({
      diagnostico: { algumDeixouDeValer: false, bloqueios: [bloq("RECEITA_NAO_CLASSIFICADA", null)] },
    })).toBeNull();
  });

  it("com um caído e um não conferido, só o caído é nomeado", () => {
    const d = diagnosticoDaFoto({
      diagnostico: {
        algumDeixouDeValer: true,
        bloqueios: [bloq("CADASTRO_FALTANDO", false), bloq("RECEITA_NAO_CLASSIFICADA", null)],
      },
    });
    expect(d.caidos).toEqual(["CADASTRO_FALTANDO"]);
  });

  it.each([null, undefined, { diagnostico: null }, { diagnostico: { bloqueios: [] } }])(
    "relatório sem diagnóstico (%p) não inventa aviso",
    (r) => expect(diagnosticoDaFoto(r)).toBeNull(),
  );
});

describe("⚠ na tela, o aviso vem ANTES do motivo", () => {
  // Se ele viesse depois, o contador leria "não tem Cadastro Fiscal", sairia da tela para
  // preencher o cadastro, e só então descobriria que já estava preenchido.
  it("os dois blocos aparecem, nessa ordem", () => {
    const d = diagnosticoDaFoto({ diagnostico: { algumDeixouDeValer: true, bloqueios: [bloq("CADASTRO_FALTANDO", false)] } });
    render(
      <div>
        <div>{d.titulo}</div>
        <div>O portal não calculou o DAS desta competência</div>
      </div>,
    );
    const texto = document.body.textContent;
    expect(texto.indexOf("Este relatório é uma foto")).toBeLessThan(
      texto.indexOf("O portal não calculou o DAS"),
    );
    expect(screen.getByText(/Este relatório é uma foto/)).toBeInTheDocument();
  });
});
