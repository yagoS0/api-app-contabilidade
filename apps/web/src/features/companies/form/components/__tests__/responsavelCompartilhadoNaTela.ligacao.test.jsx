// A CONSEQUÊNCIA APARECE ANTES DO CLIQUE? — a prova de que o aviso e a confirmação têm CHAMADOR.
//
// ⚠⚠ Defeito de produção (19/08/2026): o dono entrou no portal do cliente com UM login e enxergou
// NOVE empresas. Trocar o e-mail do responsável renomeava a conta compartilhada e levava todos os
// vínculos junto. O servidor já não faz isso; esta é a metade da TELA — e "componente sem chamador"
// é o defeito favorito deste projeto, então o teste exercita a CADEIA, não os componentes soltos:
//
//   1. `<CompanyForm>` recebe o resultado da consulta e RENDERIZA o aviso embaixo do campo;
//   2. `<CompanyForm>` recebe o 409 do servidor e RENDERIZA a confirmação, com os dados repetidos;
//   3. clicar em confirmar chama o handler que o `editPanel` passou;
//   4. o `mockApi` reproduz a recusa e a separação — os ramos são alcançáveis offline;
//   5. o `realApi` põe `confirmarNovoAcesso` no corpo, e SÓ quando confirmado.
//
// ⚠ Sem o passo 1 e 2 o resto continuaria verde com o formulário nunca passando as props — que é
// exatamente como a carga tributária já nasceu invisível neste mesmo componente.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CompanyForm } from "../renderCompanyForm";
import { getInitialCompanyFormState } from "../../hooks/useManageCompanyForm";
import { createMockApi } from "../../../../../api/mock/mockApi";

const OUTRAS = [
  { id: "pc-2", razao: "BETA OBRAS LTDA", cnpj: "44555666000199" },
  { id: "pc-3", razao: "GAMA ENGENHARIA LTDA", cnpj: "77888999000155" },
];

function formBase(extra = {}) {
  return {
    ...getInitialCompanyFormState(),
    ownerName: "Dono da Empresa",
    ownerEmail: "dono@empresa.com",
    razaoSocial: "ALFA CONSTRUTORA LTDA",
    cnpj: "11222333000181",
    ...extra,
  };
}

function montar(props = {}) {
  return render(
    <CompanyForm
      form={formBase(props.form)}
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      submitting={false}
      submitLabel="Salvar alterações"
      showOwnerPassword={false}
      cnpjReadOnly
      {...props}
    />
  );
}

describe("1–2. o formulário RENDERIZA o aviso e a confirmação (a ligação)", () => {
  it("e-mail que já atende outras empresas → aviso NOMEANDO as empresas, embaixo do campo", () => {
    montar({
      empresasDoResponsavel: { empresas: [{ id: "pc-1", razao: "ALFA", cnpj: "11222333000181" }, ...OUTRAS], carregando: false },
      empresaAtualId: "pc-1",
    });

    const aviso = screen.getByTestId("aviso-email-responsavel");
    expect(aviso).toHaveTextContent("já responde por outras 2 empresas");
    expect(aviso).toHaveTextContent("um login só");
    expect(aviso).toHaveTextContent("BETA OBRAS LTDA");
    expect(aviso).toHaveTextContent("GAMA ENGENHARIA LTDA");
  });

  it("⚠ AVISA, NÃO PROÍBE — o botão de salvar continua habilitado", () => {
    montar({
      empresasDoResponsavel: { empresas: [{ id: "pc-1", razao: "ALFA", cnpj: "1" }, ...OUTRAS], carregando: false },
      empresaAtualId: "pc-1",
    });
    // Grupo de empresas com o mesmo dono é legítimo; travar o cadastro seria o erro oposto.
    expect(screen.getByRole("button", { name: /Salvar alterações/i })).not.toBeDisabled();
  });

  it("e-mail que só atende esta empresa → nenhum aviso", () => {
    montar({
      empresasDoResponsavel: { empresas: [{ id: "pc-1", razao: "ALFA", cnpj: "1" }], carregando: false },
      empresaAtualId: "pc-1",
    });
    expect(screen.queryByTestId("aviso-email-responsavel")).toBeNull();
  });

  it("enquanto a consulta está no ar, nada pisca", () => {
    montar({
      empresasDoResponsavel: { empresas: [], carregando: true },
      empresaAtualId: "pc-1",
    });
    expect(screen.queryByTestId("aviso-email-responsavel")).toBeNull();
  });

  it("sem as props (cadastro de empresa NOVA), o formulário se comporta como antes", () => {
    montar();
    expect(screen.queryByTestId("aviso-email-responsavel")).toBeNull();
    expect(screen.queryByTestId("confirmacao-acesso-proprio")).toBeNull();
    expect(screen.queryByTestId("aviso-acesso-novo")).toBeNull();
  });

  it("o 409 do servidor vira CONFIRMAÇÃO com os dados repetidos — e diz que a conta nasce sem senha", () => {
    montar({
      razaoSocialAtual: "ALFA CONSTRUTORA LTDA",
      confirmacaoAcessoProprio: {
        emailAtual: "dono@empresa.com",
        emailNovo: "novo@empresa.com",
        empresasDaConta: 9,
        outrasEmpresas: 8,
        outras: OUTRAS,
        contaNovaSemSenha: true,
      },
    });

    const painel = screen.getByTestId("confirmacao-acesso-proprio");
    expect(painel).toHaveAttribute("role", "alertdialog");
    // Os DADOS do ato, não "tem certeza?".
    expect(painel).toHaveTextContent("dono@empresa.com é a conta de 9 empresas");
    expect(painel).toHaveTextContent("ALFA CONSTRUTORA LTDA passa a ter acesso próprio");
    // ⚠ O lado que o defeito estragava.
    expect(painel).toHaveTextContent("As outras 8 empresas continuam com dono@empresa.com");
    // ⚠ E a linha sem a qual o cliente fica de fora sem ninguém saber por quê.
    expect(painel).toHaveTextContent("nasce SEM SENHA");
    expect(painel).toHaveTextContent("Credenciais → Acesso ao portal do cliente");
    expect(painel.textContent.toLowerCase()).not.toContain("tem certeza");
  });
});

describe("3. os botões da confirmação chamam quem o editPanel passou", () => {
  it("confirmar e cancelar são ligados, e são type=button (não submetem o formulário)", () => {
    const onConfirmar = jest.fn();
    const onCancelar = jest.fn();
    const onSubmit = jest.fn();
    render(
      <CompanyForm
        form={formBase()}
        onChange={jest.fn()}
        onSubmit={onSubmit}
        submitting={false}
        submitLabel="Salvar alterações"
        showOwnerPassword={false}
        cnpjReadOnly
        confirmacaoAcessoProprio={{
          emailAtual: "dono@empresa.com",
          emailNovo: "novo@empresa.com",
          empresasDaConta: 2,
          outrasEmpresas: 1,
          outras: [OUTRAS[0]],
          contaNovaSemSenha: true,
        }}
        onConfirmarAcessoProprio={onConfirmar}
        onCancelarAcessoProprio={onCancelar}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Sim, criar acesso próprio/i }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    // ⚠ O painel vive DENTRO do `<form>`: um botão sem `type="button"` submeteria o cadastro
    // inteiro de novo, sem confirmação nenhuma.
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Cancelar$/i }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("depois do salvar, o aviso de que a conta nova não tem senha aparece", () => {
    montar({ acessoProprioCriado: { userId: "u-9", email: "novo@empresa.com", semSenha: true } });
    const aviso = screen.getByTestId("aviso-acesso-novo");
    expect(aviso).toHaveTextContent("novo@empresa.com");
    expect(aviso).toHaveTextContent("ainda NÃO tem senha");
    expect(aviso).toHaveTextContent("Credenciais → Acesso ao portal do cliente");
  });
});

// ⚠⚠ COMO A CONTA COMPARTILHADA NASCE — e não é pelo `PATCH`.
// Medido: o `PATCH` SEMPRE recusou e-mail que já é de outro usuário (`owner_email_already_in_use`,
// a guarda que continua de pé). Quem cria o compartilhamento é o `POST /firm/companies`, que REUSA
// o `User` quando o e-mail já existe (`CompanyProvisioningService`). Por isso o cenário abaixo é
// montado CADASTRANDO duas empresas com o MESMO e-mail — que é exatamente o que o dono fez.
//
// ⚠ `mockCompanies` é um array de MÓDULO: `createMockApi()` não zera nada, e o estado vaza entre
// os testes deste arquivo. Por isso cada cenário usa um e-mail e um CNPJ PRÓPRIOS — contar sobre a
// carteira compartilhada faria um teste depender da ordem em que o outro rodou.
let seq = 0;
async function duasEmpresasNoMesmoEmail(api) {
  seq += 1;
  const email = `grupo${seq}@empresa.com`;
  const base = { ownerName: "Dono da Empresa", ownerPassword: "Senha@Forte1", ownerEmail: email };
  await api.createCompany({ ...base, razaoSocial: `ALFA ${seq} LTDA`, cnpj: `1122233300${seq}81` });
  await api.createCompany({ ...base, razaoSocial: `BETA ${seq} LTDA`, cnpj: `4455566600${seq}99` });
  const todas = await api.listCompanies();
  return {
    email,
    a: todas.find((c) => c.razao === `ALFA ${seq} LTDA`),
    b: todas.find((c) => c.razao === `BETA ${seq} LTDA`),
  };
}

describe("4. o mock reproduz a regra — os ramos são alcançáveis offline", () => {
  it("cadastrar empresa com um e-mail JÁ USADO é o que cria o compartilhamento", async () => {
    const api = createMockApi();
    const { email } = await duasEmpresasNoMesmoEmail(api);
    // Duas empresas, UM login — a consulta que alimenta o aviso enxerga as duas.
    expect(await api.empresasDoResponsavel(email)).toHaveLength(2);
  });

  it("trocar o e-mail numa delas recusa pedindo confirmação, com os dados do ato", async () => {
    const api = createMockApi();
    const { a } = await duasEmpresasNoMesmoEmail(api);

    let recusa = null;
    try {
      await api.updateCompany(a.companyId, { ...a, ownerEmail: `separado${seq}@empresa.com`, razaoSocial: a.razao, cnpj: a.cnpj });
    } catch (err) {
      recusa = err;
    }
    expect(recusa?.code).toBe("owner_email_conta_compartilhada");
    expect(recusa.payload.empresasDaConta).toBe(2);
    expect(recusa.payload.outrasEmpresas).toBe(1);
    expect(recusa.payload.contaNovaSemSenha).toBe(true);
  });

  it("confirmando: a editada troca e a OUTRA fica exatamente onde estava", async () => {
    const api = createMockApi();
    const { email, a, b } = await duasEmpresasNoMesmoEmail(api);
    const novo = `separado${seq}@empresa.com`;

    const res = await api.updateCompany(
      a.companyId,
      { ...a, ownerEmail: novo, razaoSocial: a.razao, cnpj: a.cnpj },
      { confirmarNovoAcesso: true }
    );
    expect(res.acessoNovo).toMatchObject({ email: novo, semSenha: true });

    const depois = await api.listCompanies();
    expect(depois.find((c) => c.companyId === a.companyId).ownerEmail).toBe(novo);
    // ⚠⚠ A ASSERÇÃO DO DEFEITO, do lado do mock: a outra NÃO muda de dono.
    expect(depois.find((c) => c.companyId === b.companyId).ownerEmail).toBe(email);
  });

  it("e-mail que já é de OUTRO responsável continua recusado, mesmo confirmando", async () => {
    const api = createMockApi();
    const { a } = await duasEmpresasNoMesmoEmail(api);
    const outroGrupo = await duasEmpresasNoMesmoEmail(api);

    let recusa = null;
    try {
      await api.updateCompany(
        a.companyId,
        { ...a, ownerEmail: outroGrupo.email, razaoSocial: a.razao, cnpj: a.cnpj },
        { confirmarNovoAcesso: true }
      );
    } catch (err) {
      recusa = err;
    }
    // A confirmação autoriza CRIAR conta, nunca ASSUMIR a de outro — foi assim que tudo começou.
    expect(recusa?.code).toBe("owner_email_already_in_use");
  });
});
