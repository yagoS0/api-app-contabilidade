// CONTATOS DE WHATSAPP DA EMPRESA — a regra da TELA, pura.
//
// Sem React, sem `api`, sem relógio escondido. A tela (`ContatosWhatsapp.jsx`) só liga; o que decide
// mora aqui, com teste próprio — mesma disciplina de `estadoCredencial.js` e dos `lib/` das outras
// features.
//
// ── ⚠ O TELEFONE É NORMALIZADO PELA MESMA REGRA DO SERVIDOR ─────────────────────────────────────
// `normalizarE164` e `formatarTelefone` são ESPELHO de
// `apps/api/src/application/whatsapp/telefone.js`, amarrados por teste que importa a função de lá e
// exige o mesmo veredito nos mesmos casos. Duas leituras do que é "um telefone válido" divergiriam
// na primeira correção — e aqui a divergência aparece como "a tela aceitou e o servidor recusou" no
// cadastro do número que vai receber guia.
//
// ── ⚠ O NÚMERO É O DO CADASTRO (decisão do dono, 14/08/2026) ────────────────────────────────────
// O envio casa dígito a dígito com o que está gravado; nada tolera o nono dígito. Por isso a tela
// AVISA quando um celular parece estar no formato antigo (8 dígitos): o conserto é corrigir o
// cadastro, nunca "case assim mesmo".

const DDI_BR = "55";
const digitos = (v) => String(v || "").replace(/\D+/g, "");

/** ESPELHO de `telefone.normalizarE164` (api). Devolve `null` quando não dá para afirmar que é telefone. */
export function normalizarE164(entrada) {
  const bruto = String(entrada || "").trim();
  const d = digitos(bruto);
  if (!d) return null;
  const temMaisExplicito = bruto.startsWith("+");
  if (temMaisExplicito) return d.length >= 8 && d.length <= 15 ? d : null;
  if (d.startsWith(DDI_BR) && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `${DDI_BR}${d}`;
  if (d.length >= 12 && d.length <= 15) return d;
  return null;
}

/** ESPELHO de `telefone.formatarTelefone` (api): `5521999998888` → `+55 (21) 99999-8888`. */
export function formatarTelefone(e164) {
  const d = digitos(e164);
  if (d.startsWith(DDI_BR) && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
    const fim = resto.length === 9 ? resto.slice(5) : resto.slice(4);
    return `+55 (${ddd}) ${meio}-${fim}`;
  }
  return d ? `+${d}` : "";
}

/**
 * Celular brasileiro que PARECE estar no formato antigo (8 dígitos, prefixo de celular 6–9).
 *
 * ⚠ É AVISO, NUNCA CORREÇÃO. Fixo começa em 2–5 e tem 8 dígitos legitimamente; um 8 dígitos em
 * 6–9 é, com alta chance, um celular sem o 9 — e o envio só casa dígito a dígito. A tela diz
 * "confira", e quem decide é quem cadastra.
 */
export function pareceFormatoAntigo(e164) {
  const d = digitos(e164);
  if (!d.startsWith(DDI_BR) || d.length !== 12) return false;
  return /^[6-9]/.test(d.slice(4));
}

/** As três opções de `PortalClient.canalPadraoEnvio` — ESPELHO de `ContatoWhatsappService.CANAL_PADRAO`. */
export const CANAIS_DE_ENVIO = Object.freeze([
  { valor: "EMAIL", rotulo: "E-mail", descricao: "as guias saem por e-mail; o WhatsApp fica para envio manual" },
  { valor: "WHATSAPP", rotulo: "WhatsApp", descricao: "as guias saem por WhatsApp e caem para e-mail quando não puderem" },
  { valor: "PERGUNTAR", rotulo: "Perguntar a cada envio", descricao: "a tela pergunta o canal na hora de enviar" },
]);

export function rotuloDoCanal(valor) {
  const v = String(valor || "").toUpperCase();
  return CANAIS_DE_ENVIO.find((c) => c.valor === v)?.rotulo || "E-mail";
}

/** A situação de UM contato — o que a linha diz dele. */
export const SITUACAO_CONTATO = Object.freeze({
  RECEBE: "RECEBE",
  SO_EMAIL: "SO_EMAIL",
  SEM_OPT_IN: "SEM_OPT_IN",
  INATIVO: "INATIVO",
});

/**
 * ⚠⚠ O OPT-IN VALE SÓ PARA O WHATSAPP (05/09/2026) — é exigência de política da Meta e é o que
 * protege o número contra denúncia. **E-mail nunca dependeu dele.**
 *
 * O defeito que isto conserta foi visto no navegador: o destinatário cadastrado só com e-mail saía
 * dizendo *"sem opt-in — não recebe até registrar a autorização"*, sobre alguém que RECEBE por
 * e-mail normalmente. A frase mandava o contador procurar uma autorização que não faz falta.
 */
export function situacaoDoContato(contato) {
  if (!contato) return SITUACAO_CONTATO.INATIVO;
  if (contato.ativo === false) return SITUACAO_CONTATO.INATIVO;
  if (contato.optInEm) return SITUACAO_CONTATO.RECEBE;
  // Sem opt-in: quem tem e-mail continua recebendo por ele; quem só tem telefone é que fica parado.
  if (String(contato.email || "").trim()) return SITUACAO_CONTATO.SO_EMAIL;
  return SITUACAO_CONTATO.SEM_OPT_IN;
}

export const FRASE_SITUACAO = Object.freeze({
  [SITUACAO_CONTATO.RECEBE]: "recebe guias",
  // ⚠ Diz o que ACONTECE (recebe por e-mail) e o que FALTA para o outro canal — nunca "não recebe".
  [SITUACAO_CONTATO.SO_EMAIL]: "recebe por e-mail · sem opt-in para WhatsApp",
  // ⚠ Opt-in é BLOQUEIO, não aviso (política da Meta): sem ele este contato não recebe template.
  [SITUACAO_CONTATO.SEM_OPT_IN]: "sem opt-in — não recebe até registrar a autorização",
  [SITUACAO_CONTATO.INATIVO]: "desativado",
});

/**
 * A situação da EMPRESA — ESPELHO do `situacao` que `GET /firm/contatos-whatsapp` calcula para a
 * carteira (`sem_contato` | `sem_optin` | `ok`). Os três consertos são diferentes: cadastrar,
 * registrar a autorização, nada.
 */
export function situacaoDaEmpresa(contatos) {
  const lista = Array.isArray(contatos) ? contatos : [];
  if (!lista.length) return "sem_contato";
  const recebe = lista.some((c) => c.ativo !== false && c.optInEm);
  return recebe ? "ok" : "sem_optin";
  // ⚠ A pergunta desta função é sobre o WHATSAPP (é o espelho do `situacao` da rota da carteira), e
  // por isso o e-mail NÃO a satisfaz: a frase de `sem_optin` já diz que as guias saem por e-mail.
}

export const FRASE_EMPRESA = Object.freeze({
  sem_contato: "Nenhum contato cadastrado: as guias desta empresa só saem por e-mail.",
  sem_optin: "Há contato, mas nenhum com opt-in: as guias desta empresa só saem por e-mail até registrar a autorização.",
  ok: null,
});

/**
 * O FORMULÁRIO. Confere o que o servidor conferiria (`salvarContato`): nome e telefone válido.
 * @returns {{ok:boolean, erros:{nome?:string, telefone?:string}, telefoneE164:string|null}}
 */
/** ESPELHO da forma de e-mail do servidor (`ContatoWhatsappService.normalizarEmail`). */
export function normalizarEmail(valor) {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/**
 * ⚠ UM DOS DOIS CANAIS BASTA (05/09/2026) — o destinatário pode receber só por e-mail, só por
 * WhatsApp, ou pelos dois. É o espelho de `salvarContato`: exigir telefone aqui faria a tela recusar
 * o financeiro que só recebe e-mail, que é a maioria da carteira.
 *
 * ⚠ O `+55` NÃO SE DIGITA. `normalizarE164` o prefixa sozinha — o texto do erro diz isso, para
 * ninguém "consertar" o número acrescentando o DDI à mão.
 */
export function validarFormulario({ nome, telefone, email } = {}) {
  const erros = {};
  if (!String(nome || "").trim()) erros.nome = "Informe o nome de quem recebe as mensagens.";
  const temTelefone = Boolean(String(telefone || "").trim());
  const e164 = temTelefone ? normalizarE164(telefone) : null;
  if (temTelefone && !e164) {
    erros.telefone = "Telefone inválido. Digite DDD + número (ex.: 21 99999-8888) — o +55 entra sozinho.";
  }
  const temEmail = Boolean(String(email || "").trim());
  const emailLimpo = temEmail ? normalizarEmail(email) : null;
  if (temEmail && !emailLimpo) erros.email = "E-mail inválido. Confira o endereço.";
  if (!e164 && !emailLimpo && !erros.telefone && !erros.email) {
    erros.canal = "Informe ao menos um canal: e-mail, telefone, ou os dois.";
  }
  return { ok: Object.keys(erros).length === 0, erros, telefoneE164: e164, email: emailLimpo };
}

/**
 * O QUE VAI PARA O SERVIDOR. Só o que a rota aceita — e `userId` viaja como `null` quando a pessoa
 * ESCOLHEU "nenhuma", e como `undefined` (ausente) quando o campo não foi tocado.
 * ⚠ `undefined` = não mexer · `null` = apagar — a regra do projeto para PATCH, aplicada aqui.
 */
export function montarPayload({ id, nome, papel, telefone, email, optIn, optInOrigem, userId, ativo } = {}) {
  const payload = {
    nome: String(nome || "").trim(),
    papel: String(papel || "").trim(),
    telefone: String(telefone || "").trim(),
    // ⚠ String vazia viaja de propósito: no servidor ela é "sem e-mail", e é assim que se APAGA o
    // endereço de um destinatário que passou a receber só por WhatsApp.
    email: String(email || "").trim(),
    optIn: optIn === true,
  };
  if (id) payload.id = id;
  if (optIn === true) payload.optInOrigem = String(optInOrigem || "").trim() || "cadastro_pelo_escritorio";
  if (userId === "") payload.userId = null;
  else if (userId != null) payload.userId = String(userId);
  if (ativo === false || ativo === true) payload.ativo = ativo;
  return payload;
}

/**
 * ⚠ REMOVER CONFIRMA REPETINDO NOME E TELEFONE — nunca "tem certeza?". Duas linhas da mesma
 * empresa (o sócio e o financeiro) só se distinguem pelo número, e quem confirma precisa saber qual
 * está apagando. Mesma disciplina da exclusão de credencial e de informação nesta aba.
 */
export function fraseDeConfirmacaoRemocao(contato) {
  const nome = String(contato?.nome || "").trim() || "(sem nome)";
  const fone = formatarTelefone(contato?.telefoneE164) || "(sem telefone)";
  // ⚠ O E-MAIL ENTRA NA FRASE desde 05/09/2026: há destinatário SEM telefone, e uma confirmação que
  // só diz "(sem telefone)" descreveria a linha errada quando há duas do mesmo nome.
  const email = String(contato?.email || "").trim() || "(sem e-mail)";
  return `Remover o destinatário "${nome}"?

Telefone: ${fone}
E-mail: ${email}

Ele deixa de receber guias por este cadastro. O histórico de conversas não é apagado.`;
}



/** Os três estados da lista — a mesma distinção de `estadoDaCarga`: vazio ≠ falhou ≠ carregando. */
export const CARGA = Object.freeze({ CARREGANDO: "carregando", FALHOU: "falhou", VAZIA: "vazia", OK: "ok" });

export function estadoDaLista({ carregando, erro, quantidade = 0 } = {}) {
  if (carregando && !quantidade) return { estado: CARGA.CARREGANDO };
  if (erro && !quantidade) {
    return {
      estado: CARGA.FALHOU,
      titulo: "Não foi possível ler os contatos de WhatsApp.",
      texto: erro?.mensagem ? `O servidor respondeu: ${erro.mensagem}` : "A lista pode existir e não ter sido carregada.",
    };
  }
  if (!quantidade) return { estado: CARGA.VAZIA };
  return { estado: CARGA.OK };
}

/** A pessoa do portal por trás do contato, para a linha dizer QUEM é (nunca adivinhado por nome). */
export function pessoaDoContato(contato, usuarios) {
  if (!contato?.userId) return null;
  const lista = Array.isArray(usuarios) ? usuarios : [];
  return lista.find((u) => String(u.userId) === String(contato.userId)) || { userId: contato.userId, nome: null, email: null };
}
