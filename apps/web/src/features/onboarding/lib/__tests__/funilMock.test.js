// O funil inteiro percorrido contra o MOCK REAL da aplicação (`createMockApi`), não contra um
// dublê escrito para o teste.
//
// É o que prova a exigência do plano: o modo mock precisa navegar o funil ponta a ponta SEM
// backend, e as duas regras difíceis — reset por troca de origem e materialização idempotente da
// checklist no "finalizar" — precisam estar implementadas de verdade lá. Se o mock só devolvesse
// `{ok:true}`, o único caminho que exercita essas duas regras ficaria offline.

import { podarInvisiveis, rascunhoVazio } from "../onboardingSpec";

/**
 * ⚠⚠ TETO DE TEMPO DESTE ARQUIVO — 20 s, e ele é DAQUI, nunca do `jest.config` (02/09/2026).
 *
 * ⚠⚠ **O PADRÃO DE 5 s NÃO SOBE NA CONFIGURAÇÃO**, e a razão é concreta: foi ele que expôs, em
 * 01/09/2026, uma rota que PENDURAVA (a varredura de notas consultando o banco sem dublê). Um teto
 * global maior teria transformado aquele defeito em *"a suíte está lenta hoje"* — que é exatamente
 * como esta flutuação vinha sendo lida.
 *
 * ⚠⚠ **A MEDIÇÃO QUE JUSTIFICA O NÚMERO** (`jest --json`, 3.350 casos deste app): **11 casos** levam
 * 3 s ou mais, concentrados em **5 arquivos** — este é um deles. O caso mais pesado marcou 18,5 s.
 * Quem estoura não é o teste errado: é o que estava rodando quando a máquina engasgou, e por isso
 * subir caso a caso seria correr atrás de um alvo que muda a cada execução.
 *
 * ⚠ O custo é jsdom montando tela de verdade (modal cheio, tabela, várias renderizações por caso).
 * Não há espera, relógio nem rede aqui. Os outros ~3.339 casos deste app continuam com 5 s.
 * ⚠ O precedente é da casa: `api: nfse/danfse/__tests__/danfse.test.js` já faz `jest.setTimeout(30000)`.
 */
jest.setTimeout(20000);

describe("funil no modo mock — ponta a ponta, sem backend", () => {
  let api;

  // ⚠ Os `Map` do mock são de MÓDULO, não da instância: `createMockApi()` chamado duas vezes
  // compartilha o mesmo estado. Isso é PROPOSITAL no app (o rascunho tem de sobreviver à navegação
  // entre telas), então quem se adapta é o teste — recarregar o módulo é o que dá isolamento sem
  // pedir ao mock que esqueça o que o app precisa que ele lembre.
  beforeEach(async () => {
    jest.resetModules();
    const { createMockApi } = await import("../../../../api/mock/mockApi");
    api = createMockApi();
  });

  test("criar → preencher → finalizar → concluir etapa → converter", async () => {
    const criada = await api.criarOnboarding("TRANSFERENCIA");
    expect(criada.onboarding.status).toBe("RASCUNHO");
    const id = criada.onboarding.id;

    const p1 = await api.salvarOnboarding(id, {
      dados: {
        razaoSocial: "EMPRESA QUE TROCA DE CONTADOR LTDA",
        cnpj: "11.222.333/0001-81",
      },
      ultimoPasso: "identificacao",
    });
    // As COLUNAS são promovidas a partir do JSON, como no servidor — é delas que a lista vive.
    expect(p1.onboarding.razaoSocial).toBe("EMPRESA QUE TROCA DE CONTADOR LTDA");
    expect(p1.onboarding.cnpj).toBe("11222333000181");

    await api.salvarOnboarding(id, {
      dados: {
        razaoSocial: "EMPRESA QUE TROCA DE CONTADOR LTDA",
        cnpj: "11.222.333/0001-81",
        responsavelNome: "Maria",
        responsavelEmail: "maria@empresa.com",
      },
      ultimoPasso: "responsavel",
    });

    const fim = await api.salvarOnboarding(id, { finalizar: true });
    expect(fim.onboarding.status).toBe("RECEBIDO");
    expect(fim.onboarding.enviadoEm).toBeTruthy();
    expect(fim.onboarding.etapas.length).toBeGreaterThan(0);

    const etapaId = fim.onboarding.etapas[0].id;
    const marcada = await api.salvarEtapaOnboarding(id, etapaId, { concluida: true });
    // A primeira etapa concluída promove sozinha — sem isso o quadro fica dizendo "recebido"
    // enquanto o trabalho já começou.
    expect(marcada.onboarding.status).toBe("EM_TRILHA");

    const convertida = await api.converterOnboarding(id, { company: { cnpj: "11222333000181" } });
    expect(convertida.onboarding.status).toBe("CONVERTIDO");
    expect(convertida.onboarding.portalClientId).toBeTruthy();

    // Convertido é somente leitura, e o mock repete a trava.
    await expect(api.salvarOnboarding(id, { dados: { razaoSocial: "OUTRA" } })).rejects.toMatchObject({
      code: "onboarding_convertido",
    });
  });

  // ⚠ A regra que o mock TEM de implementar de verdade: trocar de origem zera `dados`.
  test("trocar de origem zera o rascunho no mock, não só na tela", async () => {
    const { onboarding } = await api.criarOnboarding("ABERTURA");
    await api.salvarOnboarding(onboarding.id, {
      dados: { razaoSocial: "NOME PRETENDIDO", tipoEmpresa: "LTDA", socios: [{ nome: "Ana" }] },
    });

    const trocada = await api.salvarOnboarding(onboarding.id, { origem: "TRANSFERENCIA" });

    expect(trocada.onboarding.origem).toBe("TRANSFERENCIA");
    expect(trocada.onboarding.dados).toEqual({});
    expect(trocada.onboarding.razaoSocial).toBeNull();
    expect(trocada.onboarding.ultimoPasso).toBeNull();
  });

  // ⚠ A outra: finalizar duas vezes não duplica a checklist.
  test("finalizar duas vezes mantém a checklist e as marcações", async () => {
    const { onboarding } = await api.criarOnboarding("INATIVA");
    const primeira = await api.salvarOnboarding(onboarding.id, { finalizar: true });
    const quantidade = primeira.onboarding.etapas.length;
    expect(quantidade).toBeGreaterThan(0);

    await api.salvarEtapaOnboarding(onboarding.id, primeira.onboarding.etapas[0].id, { concluida: true });
    const segunda = await api.salvarOnboarding(onboarding.id, { finalizar: true });

    expect(segunda.onboarding.etapas).toHaveLength(quantidade);
    // e a marcação sobreviveu — uma segunda cópia viria com tudo desmarcado
    expect(segunda.onboarding.etapas.filter((e) => e.concluidaEm)).toHaveLength(1);
  });

  test("a lista esconde rascunho por padrão e o toggle o traz de volta", async () => {
    await api.criarOnboarding("ABERTURA");
    const { onboarding } = await api.criarOnboarding("INATIVA");
    await api.salvarOnboarding(onboarding.id, { finalizar: true });

    const padrao = await api.listarOnboardings({});
    expect(padrao.itens).toHaveLength(1);
    expect(padrao.itens[0].progresso.total).toBeGreaterThan(0);

    const comRascunhos = await api.listarOnboardings({ incluirRascunhos: true });
    expect(comRascunhos.itens).toHaveLength(2);
  });

  test("busca casa por nome, por CNPJ e por responsável", async () => {
    const { onboarding } = await api.criarOnboarding("TRANSFERENCIA");
    await api.salvarOnboarding(onboarding.id, {
      dados: { razaoSocial: "PADARIA DO ZE LTDA", cnpj: "11222333000181", responsavelNome: "Zé" },
      finalizar: true,
    });
    expect((await api.listarOnboardings({ q: "padaria" })).itens).toHaveLength(1);
    expect((await api.listarOnboardings({ q: "11222333" })).itens).toHaveLength(1);
    expect((await api.listarOnboardings({ q: "outra coisa" })).itens).toHaveLength(0);
  });

  test("descartar só vale para rascunho", async () => {
    const { onboarding } = await api.criarOnboarding("ABERTURA");
    await api.salvarOnboarding(onboarding.id, { finalizar: true });
    await expect(api.descartarOnboarding(onboarding.id)).rejects.toMatchObject({
      code: "somente_rascunho_pode_ser_descartado",
    });

    const rascunho = await api.criarOnboarding("ABERTURA");
    await expect(api.descartarOnboarding(rascunho.onboarding.id)).resolves.toEqual({ ok: true });
  });

  // A poda é do lado da tela (o hook a chama antes de salvar). Este teste amarra as duas pontas:
  // o que a poda remove é o que o mock passa a NÃO ter.
  test("o que a poda remove não chega ao mock", async () => {
    const { onboarding } = await api.criarOnboarding("ABERTURA");
    const rascunho = {
      ...rascunhoVazio("ABERTURA"),
      tipoEmpresa: "MEI",
      razaoSocial: "MEI DO JOAO",
      socios: [{ nome: "Joao" }],
    };
    await api.salvarOnboarding(onboarding.id, { dados: podarInvisiveis("ABERTURA", rascunho) });
    const lido = await api.getOnboarding(onboarding.id);
    expect(lido.onboarding.dados.socios).toBeUndefined();
    expect(lido.onboarding.dados.razaoSocial).toBe("MEI DO JOAO");
  });
});
