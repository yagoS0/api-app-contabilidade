// Restrições do pacote XSD 20260727. Não reescreve o texto declarado.
function recusar(campo, detalhe) {
  const erro = new Error(`${campo}: ${detalhe}`);
  erro.code = 'NFSE_CAMPO_XML_INVALIDO';
  erro.correcao = `Corrija ${campo} antes de emitir a nota.`;
  throw erro;
}

export function validarCamposXmlDaDps({ company, data, perfil }) {
  // Preserva a leitura legada do sufixo municipal; não inventa zeros ausentes.
  const municipal = String(String(perfil?.codigoServicoMunicipal ?? '').trim() || company.codigoServicoMunicipal || '').replace(/\D+/g, '').slice(-3);
  if (!/^\d{3}$/.test(municipal)) recusar('código de tributação municipal', 'o XML exige três dígitos.');
  const endereco = data.tomador?.endereco;
  const campos = [
    ['e-mail do tomador', data.tomador?.email, 80],
    ['logradouro do tomador', endereco?.xLgr, 255],
    ['número do endereço do tomador', endereco?.nro, 60],
    ['complemento do tomador', endereco?.xCpl, 156],
    ['bairro do tomador', endereco?.xBairro, 60],
  ];
  for (const [campo, valor, limite] of campos) {
    if (valor === null || valor === undefined || valor === '') continue;
    const texto = String(valor);
    if (texto.length > limite || !/^[\x21-\xFF](?:[\x20-\xFF]*[\x21-\xFF])?$/.test(texto)) {
      recusar(campo, `use até ${limite} caracteres compatíveis com o leiaute, sem espaços nas extremidades. Acentos são permitidos; aspas curvas e travessões não.`);
    }
  }
}
