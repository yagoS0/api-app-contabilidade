

export function porteDaBrasilApi(data) {
  const raw = String(data.porte || data.descricao_porte || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("MICRO EMPRESA") || raw === "ME") return "MICROEMPRESA";
  if (raw.includes("PEQUENO PORTE") || raw === "EPP") return "EMPRESA DE PEQUENO PORTE";
  if (raw.includes("DEMAIS")) return "DEMAIS";
  return raw;
}

export function applyBrasilApiData(data, onChange) {
  const telefone = [data.ddd_telefone_1, data.ddd_telefone_2].filter(Boolean).join(" / ");
  const cnae = data.cnae_fiscal ? String(data.cnae_fiscal) : "";

  onChange("razaoSocial", data.razao_social || "");
  onChange("nomeFantasia", data.nome_fantasia || "");
  onChange("telefone", telefone);
  onChange("cnaePrincipal", cnae);
  onChange("enderecoRua", [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(" "));
  onChange("enderecoNumero", data.numero || "");
  onChange("enderecoBairro", data.bairro || "");
  onChange("enderecoCidade", data.municipio || "");
  onChange("enderecoUf", (data.uf || "").toUpperCase());
  onChange("enderecoCep", data.cep || "");
  onChange("enderecoComplemento", data.complemento || "");

  // A BrasilAPI já devolvia tudo abaixo e a gente jogava fora — o contador redigitava
  // (ou simplesmente ficava sem). Agora entra direto na ficha.
  onChange("porte", porteDaBrasilApi(data));
  onChange("naturezaJuridica", String(data.codigo_natureza_juridica || data.natureza_juridica || "").trim());
  onChange("dataAbertura", data.data_inicio_atividade || "");
  if (data.capital_social !== undefined && data.capital_social !== null) {
    onChange("capitalSocial", String(data.capital_social));
  }
  // Traz TODOS os CNAEs, com descrição. O classificador consolida a sugestão de anexo sobre o
  // CONJUNTO (principal + secundários): apoio administrativo que também faz obra e engenharia é
  // outro caso. Antes só o código era guardado, e a tela virava uma fileira de números sem
  // sentido — dava pra ter o dado certo e ainda assim não saber o que ele significa.
  if (Array.isArray(data.cnaes_secundarios)) {
    const secundarios = data.cnaes_secundarios
      .map((c) => String(c?.codigo || "").replace(/\D+/g, ""))
      .filter(Boolean);
    onChange("cnaesSecundarios", secundarios.join(", "));
  }

  // ⚠⚠ A DESCRICAO PASSOU A SER GRAVADA (decisao do dono, 30/08/2026). Antes ela vivia so num
  //   `useState` e morria com a tela: a consulta trazia o texto oficial e o cadastro guardava
  //   numero nu. O formato e o que JA existe em producao — "codigo - descricao" —, na coluna
  //   `Company.atividades`, que e a UNICA fonte de texto de atividade da carteira e alimenta a
  //   descricao do servico na NFS-e (`descricaoSugerida.js`).
  // ⚠ ELA NAO DECIDE CODIGO NENHUM: `cnaePrincipal`/`cnaesSecundarios` continuam sendo a
  //   autoridade sobre QUAIS atividades a empresa tem. Esta lista so acrescenta TEXTO a codigos
  //   que ja foram escolhidos — o backend descarta o que nao casar.
  const descritas = [];
  if (cnae && data.cnae_fiscal_descricao) descritas.push(`${cnae} - ${data.cnae_fiscal_descricao}`);
  for (const c of Array.isArray(data.cnaes_secundarios) ? data.cnaes_secundarios : []) {
    const codigo = String(c?.codigo || "").replace(/\D+/g, "");
    if (codigo && c?.descricao) descritas.push(`${codigo} - ${c.descricao}`);
  }
  onChange("atividadesDescritas", descritas);
}

export function aplicarConsultaEmpresaPreservandoEdicoes(data, inicio, atual, onChange) {
  applyBrasilApiData(data, (campo, valor) => {
    if (JSON.stringify(atual[campo]) === JSON.stringify(inicio[campo]) && valor !== '' && valor != null) onChange(campo, valor);
  });
}

export const ANCORAS_DO_FORMULARIO = [
  { id: "secao-responsavel-pelo-acesso", titulo: "Responsável" },
  { id: "secao-identificacao-da-empresa", titulo: "Identificação" },
  { id: "secao-regime-e-obrigacoes", titulo: "Regime" },
  { id: "secao-atividades-cnae", titulo: "Atividades" },
  { id: "secao-endereco", titulo: "Endereço" },
  { id: "secao-dados-da-ficha", titulo: "Ficha" },
  { id: "secao-inscricoes", titulo: "Inscrições" },
  { id: "secao-alteracoes-contratuais", titulo: "Alterações" },
  // ⚠ ESTAS DUAS FALTAVAM, e eram as que mais precisavam: são as ÚLTIMAS de ~700 linhas de campo,
  // exatamente o alvo declarado da trilha ("o que faltava era só CHEGAR"). A barra prometia o
  // conjunto (`aria-label="Seções do cadastro"`) e entregava 8 de 10.
  { id: "secao-socios", titulo: "Sócios" },
  { id: "secao-historico-de-regime", titulo: "Histórico de regime" },
];
