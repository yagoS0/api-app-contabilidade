// A REGRA que decide entre renomear a conta e criar acesso próprio, sozinha, sem banco.
//
// Ela é a entrega inteira do conserto do defeito de 19/08/2026 (um login enxergando nove
// empresas), e é por isso que tem teste próprio: a ligação com o Prisma está coberta em
// `routes/firm/__tests__/donoCompartilhadoTrocaDeEmail.caracterizacao.test.js`, mas aquele teste
// exerce a rota inteira — se a decisão mudar de sentido, é aqui que se vê o que mudou.

import bcrypt from "bcryptjs";
import {
  DECISAO,
  decidirTrocaDeEmail,
  hashDeSenhaInutilizavel,
  STATUS_DA_CONTA_NOVA,
} from "../acessoDoResponsavel.js";

describe("decidirTrocaDeEmail", () => {
  test("conta de UMA empresa → RENOMEAR, com ou sem confirmação", () => {
    // O caso comum, e o que não pode mudar: 32 das 33 empresas medidas estão aqui.
    expect(decidirTrocaDeEmail({ vinculosDaConta: 1, confirmado: false })).toBe(DECISAO.RENOMEAR);
    // ⚠ Confirmar não muda nada: não há o que confirmar quando ninguém mais é afetado.
    expect(decidirTrocaDeEmail({ vinculosDaConta: 1, confirmado: true })).toBe(DECISAO.RENOMEAR);
  });

  test("conta de VÁRIAS empresas sem confirmação → PEDIR_CONFIRMACAO", () => {
    expect(decidirTrocaDeEmail({ vinculosDaConta: 2, confirmado: false })).toBe(DECISAO.PEDIR_CONFIRMACAO);
    expect(decidirTrocaDeEmail({ vinculosDaConta: 9, confirmado: false })).toBe(DECISAO.PEDIR_CONFIRMACAO);
  });

  test("conta de VÁRIAS empresas com confirmação → CRIAR_ACESSO_PROPRIO", () => {
    expect(decidirTrocaDeEmail({ vinculosDaConta: 2, confirmado: true })).toBe(DECISAO.CRIAR_ACESSO_PROPRIO);
    expect(decidirTrocaDeEmail({ vinculosDaConta: 9, confirmado: true })).toBe(DECISAO.CRIAR_ACESSO_PROPRIO);
  });

  test("SÓ `true` confirma — truthy solto não vale", () => {
    // ⚠ Mesma disciplina do `confirmado` da senha do portal. Um chamador que mande `"false"`
    // (string, que é truthy) estaria criando acesso novo sem ninguém ter visto o aviso.
    for (const valor of ["true", "false", 1, {}, [], "sim"]) {
      expect(decidirTrocaDeEmail({ vinculosDaConta: 3, confirmado: valor })).toBe(
        DECISAO.PEDIR_CONFIRMACAO
      );
    }
  });

  test("contagem degenerada (0) renomeia — não cria conta por causa de estado que ninguém entende", () => {
    expect(decidirTrocaDeEmail({ vinculosDaConta: 0, confirmado: true })).toBe(DECISAO.RENOMEAR);
  });
});

// ⚠⚠ O E-MAIL NÃO MUDOU — o defeito que travava o cadastro inteiro de 5 empresas (02/09/2026).
//
// A tela SEMPRE manda `ownerEmail` (ela semeia o campo com o valor gravado). Sem este ramo, salvar
// a inscrição municipal de uma empresa cujo dono atende 2+ empresas caía em `PEDIR_CONFIRMACAO`
// com `emailAtual === emailNovo` — medido em produção no KLAUS NIGRO — e o `throw` abortava a
// transação inteira. Confirmando era pior: `CRIAR_ACESSO_PROPRIO` com um e-mail que já existe.
describe("⚠⚠ e-mail IGUAL ao atual → MANTER_CONTA, antes de qualquer outra pergunta", () => {
  test("conta compartilhada, sem confirmação, e-mail igual → MANTER_CONTA (era PEDIR_CONFIRMACAO)", () => {
    expect(decidirTrocaDeEmail({ vinculosDaConta: 2, confirmado: false, contaDestinoExiste: false, emailMudou: false }))
      .toBe(DECISAO.MANTER_CONTA);
  });

  test("⚠ com confirmação também — confirmar uma troca que não existe não pode CRIAR conta", () => {
    expect(decidirTrocaDeEmail({ vinculosDaConta: 2, confirmado: true, contaDestinoExiste: false, emailMudou: false }))
      .toBe(DECISAO.MANTER_CONTA);
  });

  test("conta de uma empresa, e-mail igual → MANTER_CONTA (não RENOMEAR: não há o que renomear)", () => {
    expect(decidirTrocaDeEmail({ vinculosDaConta: 1, confirmado: false, contaDestinoExiste: false, emailMudou: false }))
      .toBe(DECISAO.MANTER_CONTA);
  });

  test("⚠ AUSENTE NÃO É 'não mudou' — chamador antigo continua decidindo a troca como sempre", () => {
    // `undefined` preserva o comportamento de quem já chega sabendo que houve troca. Fosse
    // `!emailMudou`, um chamador que esquecesse o parâmetro desligaria a proteção do arrasto.
    expect(decidirTrocaDeEmail({ vinculosDaConta: 2, confirmado: false, contaDestinoExiste: false }))
      .toBe(DECISAO.PEDIR_CONFIRMACAO);
    expect(decidirTrocaDeEmail({ vinculosDaConta: 2, confirmado: false, contaDestinoExiste: false, emailMudou: undefined }))
      .toBe(DECISAO.PEDIR_CONFIRMACAO);
  });

  test("e-mail que MUDOU segue as regras de sempre", () => {
    expect(decidirTrocaDeEmail({ vinculosDaConta: 2, confirmado: false, contaDestinoExiste: false, emailMudou: true }))
      .toBe(DECISAO.PEDIR_CONFIRMACAO);
    expect(decidirTrocaDeEmail({ vinculosDaConta: 1, confirmado: false, contaDestinoExiste: false, emailMudou: true }))
      .toBe(DECISAO.RENOMEAR);
    expect(decidirTrocaDeEmail({ vinculosDaConta: 1, confirmado: false, contaDestinoExiste: true, emailMudou: true }))
      .toBe(DECISAO.PEDIR_CONFIRMACAO_VINCULO);
  });
});

describe("a conta nova nasce sem senha utilizável", () => {
  test("o hash não corresponde a nada que se possa adivinhar, e nunca é o mesmo duas vezes", async () => {
    const a = await hashDeSenhaInutilizavel();
    const b = await hashDeSenhaInutilizavel();

    expect(a).toMatch(/^\$2[aby]\$/); // é bcrypt de verdade
    // ⚠ Dois hashes iguais denunciariam um segredo FIXO — bastaria descobrí-lo uma vez para entrar
    // em toda conta criada por este caminho.
    expect(a).not.toBe(b);

    // Nenhum dos textos que alguém tentaria primeiro abre a conta.
    for (const chute of ["", " ", "sem-senha", "!", "123456", "senha", "Senha@Forte1"]) {
      expect(await bcrypt.compare(chute, a)).toBe(false);
    }
  }, 20000);

  test("o status é `active` — quem impede a entrada é o hash, não o status", () => {
    // ⚠ MEDIDO: `definirSenhaPeloEscritorio` grava só `passwordHash` e não mexe em `status`, e
    // `routes/auth.js` recusa login com `user_not_active`. Nascer "pending" faria a senha definida
    // pelo contador não servir para nada.
    expect(STATUS_DA_CONTA_NOVA).toBe("active");
  });
});
