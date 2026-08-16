// A REGRA do código de tributação nacional (`cTribNac`). O DADO (a lista oficial) mora ao lado, em
// `servicosNacionais.data.js`, e é carregado por `import()` dinâmico — regra e dado separados pelo
// mesmo motivo da lista de municípios: são 335 códigos com descrições longas, e a tabela não pode
// entrar no bundle inicial só para que a regra seja testável.
//
// ⚠ O QUE MUDOU, E POR QUÊ. Até 15/08/2026 o `cTribNac` era um campo DIGITADO, e a razão escrita em
// `cadastroEmissaoNfse.js` era literal: *"a lista de serviços da LC 116 não está neste
// repositório"*. Agora está — a fonte OFICIAL (Anexo B do portal `gov.br/nfse`) está versionada em
// `docs/lista-servico-nacional/`, com hash. Some a razão, some o campo digitado: o contador ESCOLHE,
// como já escolhe o município.
//
// ⚠ O cTribNac NÃO É O ITEM DA LC 116. Ele é `item(2) + subitem(2) + desdobro nacional(2)`. O item
// LC 116 `31.01` é o guarda-chuva ("serviços técnicos em edificações, eletrônica, … e congêneres");
// o código nacional `310104` é o desdobramento "Serviços técnicos em telecomunicações e
// congêneres", e é ESSE que a nota carrega. Uma lista com a granularidade do item faria o contador
// escolher um código que não existe.
//
// ⚠ ESTE MÓDULO NÃO ESCOLHE POR NINGUÉM, e a regra é a mesma do município: a busca ENCONTRA. Um
// único resultado não se autosseleciona, não há de-para CNAE → serviço, não há sugestão e não há
// default. O erro de escolher o serviço errado sai como nota emitida com o serviço errado — que é
// silencioso, e é exatamente o que a regra 1 do projeto existe para impedir.
//
// ⚠ Sem crase nem markdown nas strings: elas vão para a TELA, que não renderiza markdown.

export const TAMANHO_CTRIB_NAC = 6;

export const MOTIVO_CODIGOS_SERVICO_NACIONAL =
  "São os códigos de tributação nacional (o campo “cTribNac” da nota) que esta empresa está "
  + "autorizada a usar. Cadastre um por atividade que ela presta — na hora de emitir, quem emite "
  + "escolhe entre estes.";

export const PORQUE_LISTA_OFICIAL =
  "A lista é o Anexo B publicado pelo portal nacional da NFS-e, versionada neste sistema com a "
  + "data da extração. Busque pelo TEXTO do serviço; o código aparece junto. Nada vem "
  + "pré-selecionado e o sistema não deduz o serviço a partir do CNAE.";

export const PROBLEMA_FORA_DA_LISTA =
  "este código não existe na lista oficial de tributação nacional";

export const PROBLEMA_FORMATO =
  `o código de tributação nacional tem exatamente ${TAMANHO_CTRIB_NAC} dígitos`;

/**
 * Normaliza para as 6 posições do `cTribNac`.
 *
 * ⚠ O PADDING É O PONTO, e ele tem história: a planilha oficial guarda o código como NÚMERO, e
 * `010101` sai dela como `10101`. Qualquer leitura crua perde o zero à esquerda. Aqui a entrada é
 * completada à ESQUERDA — nunca truncada à direita —, porque é o item (as duas primeiras posições)
 * que o zero pertence.
 *
 * Devolve `null` quando não dá para chegar a 6 dígitos, em vez de fabricar um código plausível.
 */
export function normalizarCodigoServicoNacional(entrada) {
  const digitos = String(entrada ?? "").replace(/\D+/g, "");
  if (!digitos || digitos.length > TAMANHO_CTRIB_NAC) return null;
  return digitos.padStart(TAMANHO_CTRIB_NAC, "0");
}

/**
 * `310104` → `31.01.04`.
 *
 * ⚠ Esta máscara não foi inventada: é a que a **NT 008 §2.4.5** escreve para o campo do DANFSe
 * (`nn.nn.nn / nnn`, com o `cTribMun` do outro lado da barra) — ver `danfseLeiaute.js`. Mostrar o
 * código na mesma forma em que ele sai impresso é o que deixa o contador conferir a nota contra a
 * tela sem traduzir nada de cabeça.
 */
export function formatarCodigoServicoNacional(codigo) {
  const c = normalizarCodigoServicoNacional(codigo);
  if (!c) return String(codigo ?? "");
  return `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}`;
}

/** As três partes que compõem o código — o item e o subitem da LC 116, e o desdobro nacional. */
export function partesDoCodigo(codigo) {
  const c = normalizarCodigoServicoNacional(codigo);
  if (!c) return null;
  return { item: c.slice(0, 2), subitem: c.slice(2, 4), desdobro: c.slice(4, 6) };
}

export function servicoPorCodigo(lista, codigo) {
  const alvo = normalizarCodigoServicoNacional(codigo);
  if (!alvo) return null;
  return (lista || []).find((s) => s[0] === alvo) || null;
}

/**
 * O rótulo de uma linha: **código E texto**, sempre os dois.
 *
 * O dono pediu o texto justamente porque o número não diz nada a ninguém ("devemos mostrar o texto
 * para que facilite a escolha"). Mas o número também não pode sumir: é ele que vai na nota, e é por
 * ele que se confere um DANFSe já emitido.
 */
export function rotuloServico(servico) {
  if (!servico) return "";
  const [codigo, descricao] = servico;
  return `${formatarCodigoServicoNacional(codigo)} — ${descricao}`;
}

/** Acentos fora: o contador digita "veiculos", a planilha escreve "veículos". */
export function normalizarParaBusca(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * O nome do grupo a que um código pertence — o SUBITEM quando existe, senão o ITEM.
 *
 * ⚠ A chave do grupo é o PREFIXO DO PRÓPRIO CÓDIGO (`310104` → `3101` → `31`), e isso é fato da
 * planilha, não semelhança de texto: o gerador confere linha a linha que o código é exatamente
 * `item + subitem + desdobro`. Agrupar por parecença de descrição seria inventar taxonomia.
 */
export function grupoDoServico(grupos, codigo) {
  const c = normalizarCodigoServicoNacional(codigo);
  if (!c) return null;
  const base = Array.isArray(grupos) ? grupos : [];
  const porSubitem = base.find((g) => g[0] === c.slice(0, 4));
  if (porSubitem) return porSubitem;
  return base.find((g) => g[0] === c.slice(0, 2)) || null;
}

/**
 * Busca para ENCONTRAR, nunca para escolher.
 *
 * Devolve `{ itens, total }`: `itens` é a página desenhada e `total` é quantos casaram — a tela
 * precisa poder dizer "mostrando 40 de 132", senão o contador escolhe dentro de um recorte sem
 * saber que é um recorte, e o serviço dele pode estar fora.
 *
 * Casa por termo, em qualquer ordem, contra **a descrição do serviço + a descrição do grupo**. O
 * grupo entra de propósito: o texto que o contador tem na cabeça costuma ser o do subitem
 * ("serviços de informática"), enquanto o desdobramento é mais específico ("análise e
 * desenvolvimento de sistemas"). Sem o grupo, buscar pelo que ele sabe não acharia nada.
 *
 * Também casa por PREFIXO do código, para quem já tem o número (de um DANFSe, do contrato) e só
 * quer conferir de quem ele é antes de gravar.
 */
export function buscarServicos(lista, termo, { limite = 40, grupos = [] } = {}) {
  const base = Array.isArray(lista) ? lista : [];
  const bruto = String(termo ?? "").trim();
  if (!bruto) return { itens: [], total: 0 };

  // Só dígitos (com separadores de máscara) ⇒ busca por código.
  const soDigitos = bruto.replace(/\D+/g, "");
  if (soDigitos && soDigitos.length === bruto.replace(/[\s.\-/]/g, "").length) {
    const casam = base.filter((s) => s[0].startsWith(soDigitos));
    return { itens: casam.slice(0, limite), total: casam.length };
  }

  const tokens = normalizarParaBusca(bruto).split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return { itens: [], total: 0 };

  const casam = [];
  for (const s of base) {
    const grupo = grupoDoServico(grupos, s[0]);
    const alvo = normalizarParaBusca(`${s[1]} ${grupo ? grupo[1] : ""}`);
    if (tokens.every((t) => alvo.includes(t))) casam.push(s);
  }

  // Quem casa na PRÓPRIA descrição vem antes de quem só casou pelo texto do grupo — senão uma busca
  // por "programação" traz 11 códigos de informática antes do que se chama exatamente assim.
  const primeiro = tokens[0];
  casam.sort((a, b) => {
    const da = normalizarParaBusca(a[1]);
    const db = normalizarParaBusca(b[1]);
    const pa = da.startsWith(primeiro) ? 0 : da.includes(primeiro) ? 1 : 2;
    const pb = db.startsWith(primeiro) ? 0 : db.includes(primeiro) ? 1 : 2;
    if (pa !== pb) return pa - pb;
    return a[0].localeCompare(b[0]);
  });

  return { itens: casam.slice(0, limite), total: casam.length };
}

/**
 * Lê a lista de códigos gravada na empresa como o servidor a lê.
 *
 * Devolve `{ codigos, invalidos }`. Um código fora da forma **não é descartado em silêncio**: ele
 * volta em `invalidos` para a tela poder dizer que existe algo gravado que ela não reconhece —
 * sumir com ele faria o contador achar que a empresa tem menos códigos do que tem.
 */
export function lerCodigosServicoNacional(entrada) {
  const bruto = Array.isArray(entrada) ? entrada : entrada == null ? [] : [entrada];
  const codigos = [];
  const invalidos = [];
  for (const item of bruto) {
    const texto = String(item ?? "").trim();
    if (!texto) continue;
    const normal = normalizarCodigoServicoNacional(texto);
    if (!normal) {
      invalidos.push(texto);
      continue;
    }
    if (!codigos.includes(normal)) codigos.push(normal);
  }
  return { codigos, invalidos };
}

/**
 * Carrega a lista oficial sob demanda e guarda a promessa — o `import()` é o que mantém as ~90 KB
 * da tabela fora do bundle inicial. Duas telas abrindo ao mesmo tempo compartilham a mesma carga.
 *
 * ⚠ Isto NÃO é chamada de rede a terceiro: é um chunk do próprio build. A lista é versionada no
 * repositório de propósito (ver o cabeçalho de `servicosNacionais.data.js` e
 * `docs/lista-servico-nacional/README.md`).
 */
let promessaDaLista = null;
export function carregarServicosNacionais() {
  if (!promessaDaLista) {
    promessaDaLista = import("./servicosNacionais.data.js")
      .then((m) => ({
        servicos: m.SERVICOS_NACIONAIS || [],
        grupos: m.GRUPOS_SERVICO_NACIONAL || [],
      }))
      .catch((err) => {
        // Falha de carga não pode virar "lista vazia" permanente: sem zerar a promessa, a próxima
        // abertura da tela repetiria o erro sem nunca tentar de novo.
        promessaDaLista = null;
        throw err;
      });
  }
  return promessaDaLista;
}
