// Utilitários estruturais compartilhados pelos preparadores offline; sem acesso externo.
export const NS = 'http://www.sped.fazenda.gov.br/nfse';
export const falhar = (code, message) => { throw Object.assign(new Error(message), { code }); };
const filhos = no => Array.from(no.childNodes).filter(n => n.nodeType === 1);
export function unico(no, nome, obrigatorio = true) {
  const encontrados = filhos(no).filter(n => n.localName === nome);
  if (encontrados.length > 1 || (obrigatorio && encontrados.length !== 1)) {
    falhar('XML_BASE_INVALIDO', `Esperado um único ${nome} em ${no.localName}.`);
  }
  return encontrados[0] || null;
}
export function somente(no, nomes) {
  if (filhos(no).some(n => !nomes.includes(n.localName))) {
    falhar('CENARIO_NAO_PREPARADO', `Grupo ${no.localName} contém campos fora do cenário local suportado.`);
  }
}
export function ordenar(no, nomes) {
  somente(no, nomes);
  for (const nome of nomes) {
    const filho = unico(no, nome, false);
    if (filho) no.appendChild(filho);
  }
}

