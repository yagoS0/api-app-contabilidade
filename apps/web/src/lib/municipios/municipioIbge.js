// A REGRA do código IBGE do município. O DADO (a lista oficial) mora ao lado, em
// `municipiosIbge.data.js`, e é carregado por `import()` dinâmico — regra e dado separados porque
// a lista tem 5.571 linhas e não pode entrar no bundle inicial só para que a regra seja testável.
//
// ⚠ O QUE ESTE MÓDULO DELIBERADAMENTE NÃO FAZ: converter nome de município em código.
// O sistema guarda o município da empresa apenas como TEXTO (`PortalClient.municipio`). Derivar o
// código a partir dele erraria em homônimo — há CINCO "Bom Jesus" e cinco "São Domingos" no Brasil
// —, e o erro só apareceria como NOTA EMITIDA NO MUNICÍPIO ERRADO, que é silencioso e caro. Por
// isso `buscarMunicipios` existe para o contador ENCONTRAR a linha e escolher; nenhuma função aqui
// escolhe por ele, nem quando a busca devolve um resultado só.
//
// ⚠ POR QUE O CÓDIGO IMPORTA (e não é um campo cadastral qualquer): ele é o `cLocEmi` da DPS, que
// entra no `Id` do documento. Sem ele a emissão é RECUSADA no servidor
// (`NFSE_MUNICIPIO_NAO_CONFIGURADO`) — e antes dessa guarda o `padStart` fabricava `"0000000"`,
// que a Receita rejeita com E0037 ("município emissor inexistente no cadastro de convênio").
// Fonte de que `cLocEmi` é o código do IBGE: `docs/nfse-preenchimento.md` §2 ("cLocEmi: IBGE do
// município emissor, ex.: 3304557 (Rio de Janeiro)"), escrito a partir de emissão bem-sucedida em
// homologação.

export const TAMANHO_CODIGO_IBGE = 7;

// ⚠ Sem crase nem markdown: estas strings vão para a TELA, e `cLocEmi` sairia impresso com as
// crases (a tela não renderiza markdown). Nome de campo técnico entre aspas resolve.
export const MOTIVO_CODIGO_MUNICIPIO =
  "É o município emissor da nota de serviço (o campo “cLocEmi” da DPS, que entra no identificador "
  + "do documento). Sem ele o servidor recusa a emissão.";

// Por que a tela pede uma ESCOLHA em vez de deduzir do endereço que já está no cadastro. Fica junto
// do campo: quem preenche precisa saber que ninguém vai conferir isso depois por ele.
export const PORQUE_ESCOLHA_E_NAO_DEDUCAO =
  "O sistema guarda o município da empresa só como texto, e nome de município se repete entre "
  + "estados (há cinco “Bom Jesus” no Brasil). Escolher na lista oficial do IBGE é o que "
  + "garante o código certo — por isso nada vem pré-selecionado.";

export const PROBLEMA_FORMATO =
  "o código IBGE do município tem exatamente 7 dígitos — escolha o município na lista em vez de "
  + "digitar o código";

/**
 * Lê o código como o servidor o lê.
 *
 * ⚠ MESMA NORMALIZAÇÃO DO BACKEND (`resolverCLocEmi`, em `NfseService`): tira o que não é dígito e
 * exige exatamente 7. Duas leituras diferentes fariam a tela aceitar o que o servidor recusa.
 * Vazio NÃO é problema aqui — é ausência, e quem responde por ela é `impedimentoDeEmissao`.
 */
export function lerCodigoMunicipioIbge(entrada) {
  const texto = String(entrada ?? "").trim();
  if (!texto) return { preenchido: false, valor: null, problema: null };
  const digitos = texto.replace(/\D+/g, "");
  if (digitos.length !== TAMANHO_CODIGO_IBGE) {
    return { preenchido: true, valor: null, problema: PROBLEMA_FORMATO };
  }
  return { preenchido: true, valor: digitos, problema: null };
}

/**
 * O que a AUSÊNCIA do código impede — em duas versões do mesmo motivo, de propósito: a longa
 * explica no bloco do cadastro; a curta cabe na lista de pendências do assistente de emissão, que
 * fica a um palmo dela. Repetir o parágrafo inteiro nos dois lugares faz o olho pular os dois.
 *
 * ⚠ Espelha a recusa do servidor (`NFSE_MUNICIPIO_NAO_CONFIGURADO`). Mudou lá, muda aqui — senão a
 * tela promete um desfecho e o servidor entrega outro.
 */
export function impedimentoDeEmissao(codigo) {
  const leitura = lerCodigoMunicipioIbge(codigo);
  if (leitura.valor) return { bloqueia: false, motivo: null, motivoCurto: null };
  return {
    bloqueia: true,
    motivo:
      "Esta empresa não tem o município emissor cadastrado. Ele é o “cLocEmi” da nota e entra no "
      + "identificador do documento — sem ele o servidor recusa a emissão inteira. Escolha o "
      + "município em Editar cadastro → Inscrições.",
    motivoCurto:
      "cadastre o município emissor da empresa (Editar cadastro → Inscrições): sem ele o servidor "
      + "recusa a emissão",
  };
}

// "São Gonçalo" e "sao goncalo" precisam casar: o contador digita sem acento.
export function normalizarParaBusca(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Sempre município E UF — é a UF que desambigua o homônimo. Nunca só o nome. */
export function rotuloMunicipio(municipio) {
  if (!municipio) return "";
  const [, nome, uf] = municipio;
  return `${nome} / ${uf}`;
}

export function municipioPorCodigo(lista, codigo) {
  const alvo = String(codigo ?? "").replace(/\D+/g, "");
  if (alvo.length !== TAMANHO_CODIGO_IBGE) return null;
  return (lista || []).find((m) => m[0] === alvo) || null;
}

/**
 * Busca para ENCONTRAR, nunca para escolher.
 *
 * Devolve `{ itens, total }`: `itens` é a página que a tela desenha e `total` é quantos casaram —
 * a tela precisa poder dizer "mostrando 40 de 132", senão o contador escolhe dentro de um recorte
 * sem saber que é um recorte, e o município dele pode estar fora.
 *
 * Casa por termo, em qualquer ordem, contra "nome + UF" (então "bom jesus rs" e "rs bom jesus"
 * funcionam) e também por prefixo do CÓDIGO, para quem já tem o número em mãos e só quer conferir
 * de quem ele é antes de gravar.
 */
export function buscarMunicipios(lista, termo, { limite = 40 } = {}) {
  const base = Array.isArray(lista) ? lista : [];
  const bruto = String(termo ?? "").trim();
  if (!bruto) return { itens: [], total: 0 };

  const soDigitos = bruto.replace(/\D+/g, "");
  if (soDigitos.length >= 2 && soDigitos.length === bruto.replace(/[\s.-]/g, "").length) {
    const casam = base.filter((m) => m[0].startsWith(soDigitos));
    return { itens: casam.slice(0, limite), total: casam.length };
  }

  const tokens = normalizarParaBusca(bruto).split(/[\s/,-]+/).filter(Boolean);
  if (!tokens.length) return { itens: [], total: 0 };

  const casam = [];
  for (const m of base) {
    const alvo = normalizarParaBusca(`${m[1]} ${m[2]}`);
    if (tokens.every((t) => alvo.includes(t))) casam.push(m);
  }

  // Ordem: quem começa com o que foi digitado vem antes de quem só contém. Sem isso "Bom Jesus"
  // (o município) aparece depois de "Bom Jesus da Lapa" e companhia, e quem procura o exato rola.
  const primeiro = tokens[0];
  casam.sort((a, b) => {
    const na = normalizarParaBusca(a[1]);
    const nb = normalizarParaBusca(b[1]);
    const pa = na === primeiro ? 0 : na.startsWith(primeiro) ? 1 : 2;
    const pb = nb === primeiro ? 0 : nb.startsWith(primeiro) ? 1 : 2;
    if (pa !== pb) return pa - pb;
    if (na !== nb) return na.localeCompare(nb, "pt-BR");
    return a[2].localeCompare(b[2]);
  });

  return { itens: casam.slice(0, limite), total: casam.length };
}

/**
 * Carrega a lista oficial sob demanda e guarda a promessa — o `import()` é o que mantém as ~197 KB
 * da tabela fora do bundle inicial. Duas telas abrindo ao mesmo tempo compartilham a mesma carga.
 *
 * ⚠ Isto NÃO é uma chamada de rede a terceiro: é um chunk do próprio build. A lista é versionada no
 * repositório de propósito (ver o cabeçalho de `municipiosIbge.data.js`).
 */
let promessaDaLista = null;
export function carregarMunicipiosIbge() {
  if (!promessaDaLista) {
    promessaDaLista = import("./municipiosIbge.data.js")
      .then((m) => m.MUNICIPIOS_IBGE || m.default || [])
      .catch((err) => {
        // Uma falha de carga não pode virar "lista vazia" permanente: sem zerar a promessa, a
        // próxima abertura da tela repetiria o erro sem nunca tentar de novo.
        promessaDaLista = null;
        throw err;
      });
  }
  return promessaDaLista;
}
