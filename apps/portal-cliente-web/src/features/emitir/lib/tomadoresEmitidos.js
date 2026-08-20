// OS TOMADORES PARA QUEM ESTA EMPRESA JÁ EMITIU — a regra da tela.
//
// > Dono (20/08/2026): *"na aba de emissão deve haver um seletor para selecionarmos tomadores já
// > emitidos."*
//
// ⚠⚠ **O CADASTRO NÃO NASCE AQUI, E NÃO PODE NASCER.** A memória é
// `apps/api/src/application/nfse/tomadorEmitido.js` (tabela `tomadores_emitidos`), alimentada por
// CADA emissão que o sistema nacional autorizou, escopada por empresa, com documento, nome, e-mail
// e endereço completo. Ela foi construída exatamente para isto (19/08/2026). Este módulo só LÊ o
// que a rota devolve e decide o que a tela faz com a escolha. **Nada aqui grava, edita ou apaga
// tomador** — não existe caminho para isso no portal do cliente.
//
// ─── AS QUATRO REGRAS, e por que cada uma existe ────────────────────────────────────────────────
//
// ⚠ 1. **ENCONTRA, NUNCA ESCOLHE.** É a mesma frase que governa o seletor de município
//    (`SeletorMunicipio.jsx`), o de código de serviço e o `CampoComBusca` do portal do escritório:
//    nada vem pré-selecionado, **resultado único NÃO se autosseleciona**, e `Enter` sem item
//    marcado não elege ninguém. Numa nota fiscal, "só sobrou um" não é o mesmo que "é este".
//
// ⚠ 2. **A ESCOLHA PREENCHE O TOMADOR INTEIRO** — documento, nome, e-mail e o endereço todo. Meio
//    endereço não serve: o validador do backend só aceita o bloco completo (`cMun`, `CEP`, `xLgr`,
//    `nro`, `xBairro`) e descarta o resto em silêncio. Mas aqui a completude vem do DADO, não de
//    preenchimento nosso: nota que saiu sem e-mail virou registro sem e-mail, e o que o registro
//    não tem continua vazio na tela.
//
// ⚠ 3. **O DIGITADO VENCE — e a escolha não apaga nada sem a pessoa ver.** É a MESMA regra do
//    `consultaTomador` (`aplicarNome`/`aplicarEndereco`): campo que já tem conteúdo é PRESERVADO, e
//    o que foi preservado volta NOMEADO para a tela poder dizer. Sem isso, escolher "para conferir
//    o endereço" apagaria em silêncio um valor que a pessoa acabou de corrigir à mão.
//    ⚠ **O DOCUMENTO É A EXCEÇÃO, e ela não é arbitrária:** o documento É a identidade do tomador
//    escolhido. Preservá-lo deixaria na tela o nome de um tomador com o CNPJ de outro — que é pior
//    do que qualquer sobrescrita, porque a nota sairia para a pessoa errada.
//
// ⚠ 4. **SEM TOMADORES, SEM SELETOR — E SEM FRASE.** Critério literal do dono: *"sem sugestão não
//    precisa ser falado, pois já está sem"*. Campo vazio numa empresa que nunca emitiu se explica
//    sozinho. (Não confundir com o `"Não preenchemos: …"` da alíquota, que FICA: aquele impede uma
//    ausência de ser lida como afirmação; este descreveria uma ausência já visível.)

/** A origem de um campo que veio da memória — separada de `ORIGEM` de propósito, ver o rodapé. */
export const ORIGEM_MEMORIA = "de uma nota já emitida";

/** Os campos do formulário que a escolha preenche, com o nome que a tela mostra. */
export const CAMPOS_DO_TOMADOR = Object.freeze([
  ["tomadorNome", "nome", "o nome"],
  ["tomadorEmail", "email", "o e-mail"],
  ["cep", "cep", "o CEP"],
  ["cMun", "cMun", "o município"],
  ["logradouro", "xLgr", "o logradouro"],
  ["numero", "nro", "o número"],
  ["complemento", "xCpl", "o complemento"],
  ["bairro", "xBairro", "o bairro"],
]);

/** Os campos do formulário que compõem o ENDEREÇO — os do grupo que tem rótulo próprio na tela. */
export const CAMPOS_DE_ENDERECO = Object.freeze([
  "cep",
  "cMun",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
]);

function texto(v) {
  return String(v ?? "").trim();
}

function soDigitos(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

/** Sem acento e em minúsculas — a busca por "jose" precisa achar "JOSÉ". */
function dobrar(v) {
  return texto(v)
    .toLowerCase()
    .normalize("NFD")
    // ⚠ ESCAPE, nunca os caracteres combinantes literais: eles são invisíveis no editor e a
    // primeira normalização de arquivo (ou um `git` com autocrlf) os come sem ninguém ver.
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * A resposta da rota vira a lista da tela.
 *
 * ⚠ **REGISTRO SEM DOCUMENTO OU SEM NOME É DESCARTADO.** A gravação já se recusa a criar um assim
 * (`dadosDoTomadorEmitido` devolve `null`), mas a tela não pode depender disso: uma linha em branco
 * clicável num seletor de nota fiscal é um clique que preenche nada e parece ter preenchido.
 *
 * ⚠ Aceita `{ data: [...] }` (a rota) e um array cru (o mock e os testes) — a mesma tolerância que
 * as outras leituras deste portal têm, e nenhuma inferência além disso.
 */
export function normalizarTomadores(resposta) {
  const bruta = Array.isArray(resposta) ? resposta : resposta?.data;
  if (!Array.isArray(bruta)) return [];
  return bruta
    .map((t) => ({
      documento: soDigitos(t?.documento),
      nome: texto(t?.nome),
      email: texto(t?.email),
      cMun: soDigitos(t?.cMun),
      cep: soDigitos(t?.cep),
      xLgr: texto(t?.xLgr),
      nro: texto(t?.nro),
      xCpl: texto(t?.xCpl),
      xBairro: texto(t?.xBairro),
      ultimaEmissaoEm: t?.ultimaEmissaoEm || null,
    }))
    .filter((t) => t.documento && t.nome);
}

/** `12345678000190` → `12.345.678/0001-90`; CPF idem. Fora dessas formas, devolve como veio. */
export function formatarDocumento(documento) {
  const d = soDigitos(documento);
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}

/**
 * A busca.
 *
 * ⚠ **A ORDEM É A DA ROTA** (`ultimaEmissaoEm` desc) e não é reordenada aqui: "para quem emiti mais
 * recentemente" é a pergunta de quem abre o seletor sem digitar nada.
 * ⚠ **TERMO VAZIO MOSTRA A LISTA**, e isso não é "escolher": mostrar não é eleger. É o que
 * diferencia deste caso o seletor de município, cuja tabela tem 5.571 linhas e nenhuma ordem útil.
 * ⚠ Casa por NOME (sem acento) **ou** por DOCUMENTO (só dígitos) — quem tem o CNPJ na mão o digita,
 * e uma busca só por nome faria o campo parecer quebrado.
 * ⚠ O RECORTE volta nomeado (`total`), porque lista parcial que se apresenta como inteira faz
 * escolher achando que o certo não existe.
 */
export function buscarTomadores(lista, termo, { limite = 30 } = {}) {
  const todos = Array.isArray(lista) ? lista : [];
  const alvo = dobrar(termo);
  const digitos = soDigitos(termo);
  const casam = !alvo
    ? todos
    : todos.filter(
        (t) => dobrar(t.nome).includes(alvo) || (digitos && t.documento.includes(digitos))
      );
  return { itens: casam.slice(0, limite), total: casam.length };
}

/** O que a linha da lista mostra à esquerda e à direita. Nome **e** documento, sempre. */
export function rotuloDoTomador(t) {
  return texto(t?.nome);
}

export function detalheDoTomador(t) {
  return formatarDocumento(t?.documento);
}

/**
 * Os campos do formulário que este registro preenche.
 *
 * ⚠ Só o que o registro TEM. `""` fica `""` — nada é completado por consulta nem deduzido, do mesmo
 * jeito que a gravação não completa (invariante 1 de `tomadorEmitido.js`).
 */
export function camposDoTomador(registro) {
  const campos = { tomadorDoc: soDigitos(registro?.documento) };
  for (const [noForm, noRegistro] of CAMPOS_DO_TOMADOR) {
    campos[noForm] = texto(registro?.[noRegistro]);
  }
  return campos;
}

/**
 * Aplica o tomador escolhido ao formulário.
 *
 * ⚠ Regra 3 do cabeçalho: **o que já está preenchido é PRESERVADO**, exceto o documento. E o que
 * foi preservado volta nomeado, para a tela poder oferecer a substituição em vez de decidir por
 * quem lê.
 *
 * @param {object} p
 * @param {object} p.form o formulário atual
 * @param {object} p.registro o tomador escolhido
 * @param {boolean} [p.forcar] a segunda decisão da pessoa ("usar os da nota"), já ciente do que
 *   seria trocado. Só então um campo com conteúdo é sobrescrito.
 * @returns {{form: object, aplicados: string[], preservados: string[], divergentes: object[]}}
 */
export function aplicarTomadorEmitido({ form = {}, registro = null, forcar = false } = {}) {
  if (!registro) return { form, aplicados: [], preservados: [], divergentes: [] };

  const doRegistro = camposDoTomador(registro);
  // ⚠ O DOCUMENTO É A IDENTIDADE DA ESCOLHA — sempre aplicado. Ver a regra 3.
  const novo = { ...form, tomadorDoc: doRegistro.tomadorDoc };
  const aplicados = ["tomadorDoc"];
  const preservados = [];
  const divergentes = [];

  for (const [noForm, , rotulo] of CAMPOS_DO_TOMADOR) {
    const valor = doRegistro[noForm];
    const atual = texto(form?.[noForm]);
    // ⚠ Registro sem o campo não apaga o que está na tela. "A emissão anterior não teve e-mail" não
    // é o mesmo que "este tomador não tem e-mail", e menos ainda que "apague o que você digitou".
    if (!valor) continue;
    if (!atual || forcar) {
      if (atual !== valor) {
        novo[noForm] = valor;
        aplicados.push(noForm);
      }
      continue;
    }
    if (atual === valor) continue;
    preservados.push(noForm);
    divergentes.push({ campo: noForm, rotulo, atual, daMemoria: valor });
  }

  return { form: novo, aplicados, preservados, divergentes };
}

/** A frase do que foi PRESERVADO — `null` quando não houve nada a preservar. */
export function textoDosPreservados(divergentes) {
  const lista = Array.isArray(divergentes) ? divergentes : [];
  if (!lista.length) return null;
  const rotulos = lista.map((d) => d.rotulo);
  const nomes =
    rotulos.length === 1
      ? rotulos[0]
      : `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;
  // ⚠ A frase diz o que ACONTECEU (não mexemos) e o que dá para fazer — não descreve mecânica
  // nossa. Ver o critério de legendas no cabeçalho de `EmitirNotaPage.jsx`.
  return `Mantivemos ${nomes} como você já tinha preenchido.`;
}

/** Algum campo do ENDEREÇO veio da memória nesta escolha? */
export function enderecoVeioDaMemoria(aplicados) {
  const lista = Array.isArray(aplicados) ? aplicados : [];
  return lista.some((campo) => CAMPOS_DE_ENDERECO.includes(campo));
}

// ─── POR QUE A ORIGEM NÃO ENTROU EM `ORIGEM`, de `consultaTomador.js` ───────────────────────────
//
// ⚠ `emitir/lib/consultaTomador.js` é ESPELHO de `apps/web/src/features/notas/lib/consultaTomador.js`
// ("mudou lá, muda aqui", em `CLAUDE.md`). Acrescentar um quarto valor a `ORIGEM` só deste lado
// faria as duas cópias divergirem no primeiro `rotuloOrigem` — e o portal do escritório não tem
// memória de tomador para exibir.
//
// ⚠⚠ E a PRECEDÊNCIA é outra coisa da ETIQUETA. Contra a consulta automática da Receita, o que veio
// da memória se comporta como DIGITADO (a pessoa clicou; foi um ato dela), e é assim que a tela o
// passa para `aplicarNome`/`aplicarEndereco` — senão a consulta do CNPJ, que o próprio
// preenchimento do documento dispara, sobrescreveria em silêncio o endereço que a nota anterior de
// fato teve. Mas o RÓTULO tem de dizer a verdade: "de uma nota já emitida", não "digitado".
