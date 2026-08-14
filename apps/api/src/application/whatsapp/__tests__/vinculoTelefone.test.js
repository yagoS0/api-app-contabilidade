// O VÍNCULO NÚMERO → EMPRESA (→ PESSOA), exercido sem uma única credencial da Meta.
//
// Metade destes testes exige que o vínculo RECUSE — desconhecido não vira empresa, ambíguo não
// escolhe, e papel não vira permissão. É a metade que importa: um vínculo que sempre responde
// "achei" é o que faz a nota sair no CNPJ errado.

import {
  resolverVinculoTelefone,
  SITUACOES,
  TOLERANCIAS,
  AMBIGUIDADES,
  MOTIVOS_SEM_PAPEL,
  MOTIVOS_DESCARTE,
} from "../vinculoTelefone.js";

const contato = (over = {}) => ({
  id: "c1",
  portalClientId: "p1",
  nome: "Maria",
  papel: "financeiro",
  telefoneE164: "5521999998888",
  waId: null,
  optInEm: new Date(),
  ativo: true,
  userId: null,
  vinculoRbac: null,
  portalClient: { id: "p1", razao: "ALFA LTDA", cnpj: "11111111000111" },
  ...over,
});

describe("o número identifica a empresa", () => {
  it("um contato, uma empresa: VINCULADO", () => {
    const r = resolverVinculoTelefone("(21) 99999-8888", [contato()]);
    expect(r.situacao).toBe(SITUACOES.VINCULADO);
    expect(r.e164).toBe("5521999998888");
    expect(r.empresas).toHaveLength(1);
    expect(r.empresas[0].portalClientId).toBe("p1");
    expect(r.empresas[0].cnpj).toBe("11111111000111");
    expect(r.ambiguidades).toEqual([]);
  });

  it("casa também pelo `waId` — que é o número que a PRÓPRIA Meta devolveu", () => {
    const r = resolverVinculoTelefone("5521777776666", [contato({ waId: "5521777776666" })]);
    expect(r.situacao).toBe(SITUACOES.VINCULADO);
    expect(r.empresas[0].contatos[0].casouPor).toBe("WA_ID");
  });
});

describe("⚠ DESCONHECIDO é resposta de primeira classe — não vira empresa nenhuma", () => {
  it("número válido sem cadastro: DESCONHECIDO, e nenhuma empresa", () => {
    const r = resolverVinculoTelefone("5511988887777", [contato()]);
    expect(r.situacao).toBe(SITUACOES.DESCONHECIDO);
    expect(r.empresas).toEqual([]);
  });

  it("lista vazia: DESCONHECIDO", () => {
    expect(resolverVinculoTelefone("5521999998888", []).situacao).toBe(SITUACOES.DESCONHECIDO);
  });

  it("NÃO casa por semelhança de número — DDD igual não é a mesma pessoa", () => {
    // "só tem uma empresa com esse DDD" é exatamente o palpite que este módulo existe para recusar.
    const r = resolverVinculoTelefone("5521912345678", [contato()]);
    expect(r.situacao).toBe(SITUACOES.DESCONHECIDO);
  });

  it("telefone inválido NÃO é o mesmo que desconhecido", () => {
    // Ali o número existe e ninguém o cadastrou; aqui não há número. Colapsá-los faria lixo digitado
    // parecer cliente novo.
    const r = resolverVinculoTelefone("abc", [contato()]);
    expect(r.situacao).toBe(SITUACOES.TELEFONE_INVALIDO);
    expect(r.e164).toBeNull();
    expect(r.empresas).toEqual([]);
  });
});

describe("⚠ AMBIGUO — o sócio com três CNPJs, e o vínculo que NÃO escolhe por ele", () => {
  it("mesmo número em duas empresas: AMBIGUO, com as duas na lista", () => {
    const r = resolverVinculoTelefone("5521999998888", [
      contato(),
      contato({ id: "c2", portalClientId: "p2", portalClient: { id: "p2", razao: "BETA ME", cnpj: "22222222000122" } }),
    ]);
    expect(r.situacao).toBe(SITUACOES.AMBIGUO);
    expect(r.ambiguidades).toContain(AMBIGUIDADES.EMPRESA);
    expect(r.empresas.map((e) => e.portalClientId).sort()).toEqual(["p1", "p2"]);
  });

  it("ambiguidade de PESSOA dentro da MESMA empresa é acusada, e não vira ambiguidade de empresa", () => {
    // A unique é `(portalClientId, telefoneE164)`: duas linhas da mesma empresa só coexistem com
    // números diferentes — que é o que a leitura tolerante junta.
    const r = resolverVinculoTelefone(
      "5521999998888",
      [contato(), contato({ id: "c2", nome: "João", telefoneE164: "552199998888" })],
      { tolerancia: TOLERANCIAS.NONO_DIGITO },
    );
    expect(r.situacao).toBe(SITUACOES.VINCULADO);
    expect(r.ambiguidades).toEqual([AMBIGUIDADES.PESSOA]);
    expect(r.empresas[0].pessoaAmbigua).toBe(true);
    expect(r.empresas[0].contatos).toHaveLength(2);
  });
});

describe("⚠ VÍNCULO NÃO É AUTORIZAÇÃO — o papel é LIDO do RBAC e para aí", () => {
  it("devolve o papel do CompanyClientUser, sem peso e sem decisão", () => {
    const r = resolverVinculoTelefone("5521999998888", [
      contato({ userId: "u1", vinculoRbac: { role: "FINANCEIRO", status: "ACTIVE" } }),
    ]);
    const p = r.empresas[0].contatos[0];
    expect(p.papelRbac).toBe("FINANCEIRO");
    expect(p.motivoSemPapel).toBeNull();
    // O módulo não responde "pode emitir?" — quem responde é `requireClientCompanyAccess`.
    expect(p).not.toHaveProperty("podeEmitir");
    expect(p).not.toHaveProperty("peso");
  });

  it("contato sem usuário: sem papel, COM MOTIVO — não se casa por nome", () => {
    const r = resolverVinculoTelefone("5521999998888", [contato()]);
    const p = r.empresas[0].contatos[0];
    expect(p.papelRbac).toBeNull();
    expect(p.motivoSemPapel).toBe(MOTIVOS_SEM_PAPEL.SEM_USUARIO);
  });

  it("usuário que não é membro desta empresa: sem papel, e o motivo é OUTRO", () => {
    const r = resolverVinculoTelefone("5521999998888", [contato({ userId: "u1", vinculoRbac: null })]);
    expect(r.empresas[0].contatos[0].motivoSemPapel).toBe(MOTIVOS_SEM_PAPEL.SEM_VINCULO);
  });

  it("vínculo REMOVED não devolve papel — mas a empresa continua identificada", () => {
    const r = resolverVinculoTelefone("5521999998888", [
      contato({ userId: "u1", vinculoRbac: { role: "OWNER", status: "REMOVED" } }),
    ]);
    expect(r.situacao).toBe(SITUACOES.VINCULADO);
    expect(r.empresas[0].contatos[0].papelRbac).toBeNull();
    expect(r.empresas[0].contatos[0].motivoSemPapel).toBe(MOTIVOS_SEM_PAPEL.VINCULO_INATIVO);
  });

  it("o `papel` do cadastro NÃO se disfarça de papel do RBAC", () => {
    // Texto livre de tela ("financeiro", "sócio") viajando como `rotulo`; se ele chegasse como
    // `papelRbac`, um rótulo digitado viraria permissão.
    const r = resolverVinculoTelefone("5521999998888", [contato({ papel: "OWNER" })]);
    expect(r.empresas[0].contatos[0].rotulo).toBe("OWNER");
    expect(r.empresas[0].contatos[0].papelRbac).toBeNull();
  });
});

describe("⚠ O NONO DÍGITO — as duas leituras, nomeadas, e a discordância acesa", () => {
  it("ESTRITA é o padrão: a outra forma NÃO casa sozinha", () => {
    const r = resolverVinculoTelefone("552199998888", [contato({ telefoneE164: "5521999998888" })]);
    expect(r.tolerancia).toBe(TOLERANCIAS.ESTRITA);
    expect(r.situacao).toBe(SITUACOES.DESCONHECIDO);
  });

  it("NONO_DIGITO casa a outra forma — nos dois sentidos", () => {
    const semNove = resolverVinculoTelefone("552199998888", [contato({ telefoneE164: "5521999998888" })], {
      tolerancia: TOLERANCIAS.NONO_DIGITO,
    });
    const comNove = resolverVinculoTelefone("5521999998888", [contato({ telefoneE164: "552199998888" })], {
      tolerancia: TOLERANCIAS.NONO_DIGITO,
    });
    expect(semNove.situacao).toBe(SITUACOES.VINCULADO);
    expect(comNove.situacao).toBe(SITUACOES.VINCULADO);
  });

  it("quando as leituras discordam, a discordância APARECE — nas duas tolerâncias", () => {
    const candidatos = [contato({ telefoneE164: "5521999998888" })];
    const estrita = resolverVinculoTelefone("552199998888", candidatos);
    const tolerante = resolverVinculoTelefone("552199998888", candidatos, { tolerancia: TOLERANCIAS.NONO_DIGITO });
    expect(estrita.divergemPeloNonoDigito).toBe(true);
    expect(tolerante.divergemPeloNonoDigito).toBe(true);
    expect(estrita.leituras[TOLERANCIAS.ESTRITA].situacao).toBe(SITUACOES.DESCONHECIDO);
    expect(estrita.leituras[TOLERANCIAS.NONO_DIGITO].situacao).toBe(SITUACOES.VINCULADO);
  });

  it("quando as leituras concordam, nada acende", () => {
    const r = resolverVinculoTelefone("5521999998888", [contato()]);
    expect(r.divergemPeloNonoDigito).toBe(false);
  });

  it("⚠ A LEITURA TOLERANTE PODE COLAR UM FIXO A UM CELULAR DE OUTRA EMPRESA", () => {
    // `variantesE164` acrescenta o 9 a QUALQUER número de 8 dígitos, inclusive a um fixo:
    // `552133334444` gera `5521933334444`. Este teste não afirma que isso está certo — ele FIXA o
    // comportamento e mostra que a leitura estrita não o produz. A escolha é do dono.
    const candidatos = [
      contato({ id: "fixo", portalClientId: "p1", telefoneE164: "552133334444" }),
      contato({
        id: "cel",
        portalClientId: "p2",
        telefoneE164: "5521933334444",
        portalClient: { id: "p2", razao: "BETA ME", cnpj: "22222222000122" },
      }),
    ];
    expect(resolverVinculoTelefone("552133334444", candidatos).situacao).toBe(SITUACOES.VINCULADO);
    const tolerante = resolverVinculoTelefone("552133334444", candidatos, { tolerancia: TOLERANCIAS.NONO_DIGITO });
    expect(tolerante.situacao).toBe(SITUACOES.AMBIGUO);
    expect(tolerante.divergemPeloNonoDigito).toBe(true);
  });

  it("número estrangeiro não ganha variante — o `+` é o único desambiguador", () => {
    const r = resolverVinculoTelefone("+1 415 555 2671", [contato({ telefoneE164: "14155552671" })], {
      tolerancia: TOLERANCIAS.NONO_DIGITO,
    });
    expect(r.situacao).toBe(SITUACOES.VINCULADO);
    expect(r.divergemPeloNonoDigito).toBe(false);
  });
});

describe("nada some em silêncio", () => {
  it("contato INATIVO deixa de identificar — e o descarte vem nomeado", () => {
    const r = resolverVinculoTelefone("5521999998888", [contato({ ativo: false })]);
    expect(r.situacao).toBe(SITUACOES.DESCONHECIDO);
    expect(r.descartados).toEqual([
      { contatoId: "c1", portalClientId: "p1", motivo: MOTIVOS_DESCARTE.CONTATO_INATIVO },
    ]);
  });

  it("SEM opt-in o número CONTINUA identificando — opt-in é para MANDAR, não para reconhecer", () => {
    // Filtrar por opt-in aqui faria uma mensagem recebida de contato conhecido virar "desconhecida",
    // e ela cairia na fila de não vinculados sem motivo aparente.
    const r = resolverVinculoTelefone("5521999998888", [contato({ optInEm: null })]);
    expect(r.situacao).toBe(SITUACOES.VINCULADO);
    expect(r.empresas[0].contatos[0].optIn).toBe(false);
  });

  it("contato sem empresa é ignorado — vínculo sem tenant não é vínculo", () => {
    const r = resolverVinculoTelefone("5521999998888", [contato({ portalClientId: null })]);
    expect(r.situacao).toBe(SITUACOES.DESCONHECIDO);
  });
});
