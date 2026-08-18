// TOMADORES QUE JÁ APARECERAM — sugestão de digitação, e nada além disso.
//
// ⚠ ISTO NÃO É UM CADASTRO DE CLIENTES, E A TELA DIZ ISSO.
// O protótipo tem uma tabela `clientes` com e-mail, endereço e retenções padrão. **Este projeto não
// tem esse modelo** — não há tabela, rota nem tela de tomador em lugar nenhum, e inventar uma aqui
// seria construir cadastro fiscal por conta própria. O que existe é a lista de notas que a aba já
// carregou (captura do ADN, `PortalInvoice`), e nela cada nota traz `tomadorNome` e `tomadorDoc`.
//
// ⚠ A LISTA É PARCIAL, DE PROPÓSITO E POR CONSTRUÇÃO. Ela vem da PÁGINA visível da aba (100 notas,
// filtradas por competência e por papel). Chamá-la de "seus clientes" faria o contador concluir que
// um tomador ausente não existe — quando ele só não está nesta página. O rótulo diz de onde vem.
//
// ⚠ A BUSCA ENCONTRA, NUNCA ESCOLHE. Nada é pré-selecionado, resultado único não se autosseleciona
// e escolher uma sugestão preenche NOME e DOCUMENTO e mais nada — é a mesma regra do seletor de
// município e do de serviço nacional. E o que é preenchido continua editável: quem manda no que vai
// na nota é quem emite.

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/**
 * Consolida a lista de notas em tomadores únicos.
 *
 * Regras: só entra quem tem NOME e DOCUMENTO em forma (11 ou 14 dígitos) — sugestão pela metade
 * viraria nota pela metade. Repetido aparece uma vez só, mantendo a PRIMEIRA ocorrência (a lista
 * chega ordenada da mais recente para a mais antiga) e contando quantas notas ele tem.
 */
export function listarTomadoresRecentes(notas) {
  if (!Array.isArray(notas)) return [];
  const porDoc = new Map();
  for (const nota of notas) {
    const doc = soDigitos(nota?.tomadorDoc);
    const nome = String(nota?.tomadorNome ?? "").trim();
    if (!nome) continue;
    if (doc.length !== 11 && doc.length !== 14) continue;
    const existente = porDoc.get(doc);
    if (existente) {
      existente.notas += 1;
      continue;
    }
    porDoc.set(doc, { doc, nome, notas: 1 });
  }
  return Array.from(porDoc.values());
}

/**
 * Filtra por nome ou por documento. Termo vazio devolve os primeiros — abrir a lista sem digitar é
 * como se descobre que a sugestão existe.
 */
export function buscarTomadores(lista, termo, { limite = 8 } = {}) {
  const todos = Array.isArray(lista) ? lista : [];
  const t = String(termo ?? "").trim().toLowerCase();
  const digitos = soDigitos(t);
  const casam = !t
    ? todos
    : todos.filter(
        (c) =>
          c.nome.toLowerCase().includes(t)
          || (digitos.length >= 3 && c.doc.includes(digitos)),
      );
  return { itens: casam.slice(0, limite), total: casam.length };
}
