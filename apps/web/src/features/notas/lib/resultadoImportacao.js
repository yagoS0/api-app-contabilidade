const motivos = {
  mock_sem_gravacao: "Nenhuma nota foi gravada neste mock. A importação está disponível no ambiente conectado.",
  nfe_na_area_nfse: "Este XML é de NF-e de venda/compra, não de serviço. Importe na área de NF-e.",
  invalid_xml: "Arquivo inválido ou XML incompleto. Selecione o XML original da nota.",
  nao_e_xml: "O arquivo não é um XML de nota fiscal.",
  xml_ilegivel: "Não foi possível ler o XML. Confira se o arquivo está completo.",
  formato_nao_suportado: "O XML não contém uma NFS-e em formato compatível. Selecione o XML original da nota de serviço.",
  outro_documento: "Documento incompatível com NF-e. Se for uma nota de serviço, importe na área de NFS-e.",
  nota_nao_pertence: "A nota não pertence ao CNPJ desta empresa. Confira a empresa selecionada.",
  outro_estabelecimento: "A nota pertence a outro estabelecimento. Selecione a matriz ou filial correspondente.",
  modelo_65_nfce: "Este arquivo é uma NFC-e (modelo 65), ainda não suportada nesta importação de NF-e.",
  outro_modelo: "Modelo de documento incompatível. Esta área aceita NF-e modelo 55.",
  sem_chave_de_acesso: "O XML não contém a chave de acesso da nota.",
  sem_identificador: "Não foi encontrado o número ou a chave da nota no XML.",
  resumo_sem_titularidade: "Este resumo não permite confirmar a empresa destinatária. Importe o XML completo.",
  evento: "O arquivo é um evento fiscal, não uma nota. O evento não foi aplicado; confira a situação da nota.",
  zip_aninhado: "Há um ZIP dentro de outro ZIP. Extraia o arquivo interno e importe-o separadamente.",
  entrada_ilegivel: "Não foi possível ler este arquivo dentro do ZIP.",
  falha_ao_gravar: "Não foi possível gravar esta nota. Tente novamente; se persistir, contate o suporte.",
  import_failed: "Não foi possível importar este arquivo. Confira o XML e tente novamente.",
  duplicata_legado_sem_chave: "Já existe uma nota sem chave correspondente na base. Confira a nota antes de importar novamente.",
};

export function resultadoImportacao(out, type) {
  if (!out || typeof out !== "object") return { type, falhou: true, quantidadeProblemas: 0, problemas: [], mensagem: "Não foi possível confirmar o resultado da importação. Consulte as notas antes de tentar novamente." };
  const nfe = type === "NFE";
  const novas = Number(nfe ? out?.importadas || 0 : out?.created || 0);
  const atualizadas = Number(nfe ? 0 : out?.updated || 0);
  const duplicadas = Number(nfe ? out?.duplicadas || 0 : out?.duplicates || 0);
  const erros = nfe ? (out?.detalhes || []).filter(d => ["ignorada", "recusada"].includes(d.resultado)) : out?.errors || [];
  const problemas = erros.map(e => ({ arquivo: [e.arquivo || e.file, e.documento].filter(Boolean).join(" / "), mensagem: motivos[e.motivo || e.reason] || "Arquivo não importado. Confira a compatibilidade e os dados do XML.", codigo: e.motivo || e.reason }));
  const quantidadeProblemas = nfe ? Number(out?.ignoradas || 0) + Number(out?.recusadas || 0) : erros.length;
  const falhou = out?.ok === false || (!novas && !atualizadas && !duplicadas && quantidadeProblemas > 0);
  const mensagem = out?.ok === false ? out.mensagem || "Não foi possível importar os arquivos. Tente novamente."
    : out?.loteVazio ? out.mensagem || "O lote não trouxe documentos."
    : `${novas} nova(s), ${atualizadas} atualizada(s), ${duplicadas} duplicada(s) e ${quantidadeProblemas} não importada(s).${nfe ? ` No lote: ${out?.emitidas || 0} emitida(s) e ${out?.recebidas || 0} recebida(s).` : ""}`;
  return { type, mensagem, problemas, quantidadeProblemas, falhou, detalhesTruncados: out?.detalhesTruncados === true };
}
