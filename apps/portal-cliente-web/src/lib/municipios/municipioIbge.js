// A REGRA do código IBGE do município, no portal do CLIENTE. O DADO (a lista oficial) mora em
// `@contabilidade/shared/municipios-ibge` e entra por `import()` dinâmico — regra e dado separados
// porque a lista tem 5.571 linhas e não pode pesar no bundle inicial de uma tela de login.
//
// ⚠ O QUE ESTE MÓDULO DELIBERADAMENTE NÃO FAZ: converter NOME de município em código.
// Há cinco "Bom Jesus" e cinco "São Domingos" no Brasil. Derivar o código a partir do nome erra em
// homônimo, e o erro aparece só como NOTA EMITIDA COM O MUNICÍPIO ERRADO — silencioso e caro.
// `buscarMunicipios` existe para a pessoa ENCONTRAR a linha e escolher; nenhuma função aqui
// escolhe por ela, nem quando a busca devolve um resultado só.
//
// ⚠ ORIGEM: as funções puras abaixo são as de `apps/web/src/lib/municipios/municipioIbge.js`
// (portal do escritório). O que ficou de fora foi de propósito: lá o módulo carrega também os
// textos do CADASTRO da empresa ("cLocEmi", "Editar cadastro → Inscrições"), que são do contador e
// não fazem sentido na tela do cliente.
//
// ⚠ OS DOIS PONTOS DE ENTRADA CONTINUAM SEPARADOS DE PROPÓSITO, E ISSO NÃO É A DUPLICAÇÃO QUE FOI
// RESOLVIDA. O que estava em cópia era o DADO (a tabela de 5.571 linhas), e ele virou um arquivo só
// em 20/08/2026. Estas funções continuam duas porque os dois módulos NÃO são o mesmo módulo — ver o
// parágrafo acima. Unificá-las traria os textos de cadastro do contador para a tela do cliente.

export const TAMANHO_CODIGO_IBGE = 7;

/** "São Gonçalo" e "sao goncalo" precisam casar: ninguém digita acento com pressa. */
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
 * a tela precisa poder dizer "mostrando 40 de 132", senão a escolha acontece dentro de um recorte
 * sem que ninguém saiba que é um recorte, e o município certo pode estar fora dele.
 *
 * Casa por termo, em qualquer ordem, contra "nome + UF" (então "bom jesus rs" e "rs bom jesus"
 * funcionam) e também por prefixo do CÓDIGO, para quem já tem o número em mãos e só quer conferir
 * de quem ele é.
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
 * da tabela fora do bundle inicial. Dois campos abrindo ao mesmo tempo compartilham a mesma carga.
 *
 * ⚠ Isto NÃO é chamada de rede a terceiro: é um chunk do próprio build. A lista é versionada no
 * repositório de propósito (ver o cabeçalho do arquivo de dados).
 *
 * ⚠ O DADO MORA EM `@contabilidade/shared/municipios-ibge` DESDE 20/08/2026, e não mais ao lado
 * deste arquivo. Antes a tabela existia DUAS vezes — aqui e no portal do escritório —, com o
 * cabeçalho das duas mandando "regenerou uma, regenere a outra". Mover para o pacote ELIMINA a
 * segunda cópia; não confundir com a recusa de 19/08/2026, que foi contra uma TERCEIRA cópia
 * (embarcá-la também no `apps/api`).
 *
 * ⚠ **CONTINUA SENDO `import()` DINÂMICO, e isso é o ponto.** É ele que mantém as ~197 KB fora do
 * bundle inicial de uma tela de login. Trocar por `import` estático no topo do arquivo jogaria a
 * tabela inteira na primeira tela que importar qualquer função daqui — e o chunk separado sumiria
 * do build sem que nenhum teste caísse.
 */
let promessaDaLista = null;
export function carregarMunicipiosIbge() {
  if (!promessaDaLista) {
    promessaDaLista = import("@contabilidade/shared/municipios-ibge")
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
