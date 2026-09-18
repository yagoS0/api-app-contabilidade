// A Cloud API envia texto/legenda pelo número da empresa. A identificação do
// atendente faz parte desse conteúdo; nunca vem do nome informado no HTTP.
export function assinarMensagemHumana(texto, user, { limite = 4096 } = {}) {
  const nomeCadastrado = String(user?.name || "");
  const nomePublico = nomeCadastrado.includes("@") || nomeCadastrado === user?.id ? "" : nomeCadastrado;
  const nome = nomePublico.normalize("NFC")
    .replace(/[\p{C}*_~`]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim() || "Equipe Altan";
  const cabecalho = `*${nome}*`;
  const conteudo = String(texto || "").trim();
  const assinado = conteudo === cabecalho || conteudo.startsWith(cabecalho + "\n")
    ? conteudo : [cabecalho, conteudo].filter(Boolean).join("\n\n");
  if (assinado.length > limite) {
    throw Object.assign(new Error(`Reduza a mensagem para até ${limite - cabecalho.length - 2} caracteres para incluir o nome do atendente.`),
      { code: "MENSAGEM_ASSINADA_LONGA", status: 400 });
  }
  return assinado;
}
