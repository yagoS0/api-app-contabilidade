// O QUE O CADASTRO DE EMPRESA RECUSA, EM PORTUGUÊS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O DEFEITO QUE ISTO FECHA (relatado pelo dono, 30/08/2026: *"avisos que não aparecem"*)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `mapKnownError` (`apps/web/src/api/real/realApi.js`) é o único mapa código→português do
// projeto, e **não continha um único `company_*`**. O fallback dele devolve `payload.error` cru,
// e `Feedback.jsx` imprime a string — então o contador lia, na tela, literalmente
// `company_cnae_principal_required`. O backend também **não manda `message`** nesses casos.
//
// Medido: **48 códigos** saem do caminho do cadastro (`companyProfile.js`,
// `CompanyProvisioningService.js`, `routes/firm/index.js`), e nenhum tinha texto.
//
// ⚠ Foi por aqui que o erro da ALESSANDRO ficou ilegível: `owner_email_already_in_use` chegava
// como código, sem dizer de quem era a conta nem o que fazer.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠ AS REGRAS DESTE ARQUIVO
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// 1. **Ele mora em `packages/shared`**, não no front. As três apps já dependem do pacote, e
//    texto espelhado em dois arquivos diverge na primeira correção — precedente medido na
//    lista do IBGE (`municipiosIbgeCopiaUnica.test.js`).
// 2. **É PURO**: sem React, sem fetch, sem i18n. Entra código, sai frase.
// 3. ⚠⚠ **CÓDIGO DESCONHECIDO DEVOLVE `null`**, nunca uma frase genérica. Quem chama decide o
//    fallback. Uma frase inventada ("erro ao salvar") esconderia que existe um código novo sem
//    tradução — que é exatamente o estado que este arquivo existe para acabar.
// 4. **A frase diz O QUE FAZER**, não só o que houve. "CNPJ inválido" não ajuda quem digitou 13
//    dígitos; "confira o CNPJ — ele precisa ter 14 dígitos" ajuda.
// 5. ⚠ **A TRADUÇÃO NÃO DESCE PARA A API.** O padrão da casa é código nomeado no servidor, texto
//    no front (está escrito em `realApi.js`). Este arquivo é consumido pelo front.

/**
 * Os campos do endereço, em português, para nomear o que falta.
 * ⚠ As chaves são as que `companyProfile.normalizeEndereco` devolve em `details`.
 */
const CAMPO_DO_ENDERECO = Object.freeze({
  cep: "CEP",
  logradouro: "Rua",
  numero: "Número",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "UF",
});

const TEXTOS = Object.freeze({
  // ── identificação ────────────────────────────────────────────────────────────────────────
  company_cnpj_invalid:
    "CNPJ inválido. Confira o número — ele precisa ter 14 dígitos.",
  cnpj_imutavel:
    "O CNPJ não pode ser alterado depois que a empresa foi criada.",
  company_razao_social_required:
    "A razão social é obrigatória.",
  company_not_found: "Empresa não encontrada.",
  portal_company_not_found: "Empresa não encontrada no portal.",
  company_id_required: "Empresa não informada.",
  company_legada_ausente:
    "Esta empresa não tem cadastro completo no sistema antigo, e é lá que estes campos moram. "
    + "Fale com o suporte antes de salvar.",
  empresa_ja_cadastrada: "Já existe uma empresa com este CNPJ na carteira.",
  unique_constraint_violation:
    "Algum valor já está em uso por outro registro. Confira CNPJ e e-mails.",

  // ── atividade e regime ───────────────────────────────────────────────────────────────────
  company_cnae_principal_required:
    "O CNAE principal é obrigatório.",
  company_regime_tributario_invalid:
    "Regime tributário inválido. Escolha um da lista.",
  company_simples_anexo_required_or_invalid:
    "Anexo do Simples inválido. Use I, II, III, IV ou V.",
  company_simples_data_opcao_invalid:
    "Data de opção pelo Simples inválida. Use o formato AAAA-MM-DD.",
  company_simples_not_allowed_for_regime:
    "Só empresa do Simples Nacional pode ter anexo do Simples. Ajuste o regime antes.",
  company_regime_historico_invalid:
    "O histórico de regimes está com formato inválido.",
  company_regime_historico_vigencia_inicio_required:
    "Cada regime do histórico precisa de uma data de início.",
  company_regime_historico_vigencia_fim_invalid:
    "A data de fim de um regime do histórico é inválida.",
  company_regime_historico_vigencia_invertida:
    "No histórico de regimes, há um período que termina antes de começar.",

  // ── endereço ─────────────────────────────────────────────────────────────────────────────
  // ⚠ Este é o único que usa `details` — ver `mensagemDoErroDeCadastro`.
  company_endereco_required_fields_missing:
    "O endereço está incompleto.",
  company_endereco_uf_invalid:
    "UF inválida. Use a sigla de duas letras (ex.: RJ).",
  company_codigo_municipio_ibge_invalid:
    "Código do município (IBGE) inválido — ele tem 7 dígitos. "
    + "Escolha o município na lista em vez de digitar.",

  // ── e-mails ──────────────────────────────────────────────────────────────────────────────
  company_guide_notification_email_invalid:
    "O e-mail para envio das guias está inválido.",
  company_email_not_found: "E-mail não encontrado.",

  // ── responsável (o login do portal do cliente) ────────────────────────────────────────────
  owner_email_required:
    "O e-mail do responsável é obrigatório para criar a empresa — é com ele que o cliente entra "
    + "no portal.",
  owner_password_required_min_8:
    "A senha do responsável precisa ter pelo menos 8 caracteres.",
  // ⚠ Os dois abaixo NÃO são erro: são confirmação. A tela os intercepta ANTES
  //   (`detalhesDaConfirmacaoDoResponsavel`) e abre o painel que repete os dados. O texto aqui é
  //   a rede de segurança para o caso de alguém chamar a API por fora da tela.
  owner_email_conta_compartilhada:
    "Este e-mail responde por mais de uma empresa. Confirme na tela antes de trocar.",
  owner_email_conta_existente:
    "Este e-mail já é de uma conta existente. Confirme na tela para vincular esta empresa a ela.",

  // ── sócios ───────────────────────────────────────────────────────────────────────────────
  company_socio_participacao_invalid:
    "A participação de um sócio está inválida. Use um número entre 0 e 100.",
  company_socio_data_nascimento_invalid:
    "A data de nascimento de um sócio é inválida. Use AAAA-MM-DD.",
  company_socio_data_saida_invalid:
    "A data de saída de um sócio é inválida. Use AAAA-MM-DD.",

  // ── datas e valores da ficha ─────────────────────────────────────────────────────────────
  company_data_abertura_invalid: "Data de abertura inválida. Use AAAA-MM-DD.",
  company_alteracao_data_invalid: "Data da alteração inválida. Use AAAA-MM-DD.",
  company_inscricao_municipal_data_invalid:
    "Data da inscrição municipal inválida. Use AAAA-MM-DD.",
  company_inscricao_estadual_data_invalid:
    "Data da inscrição estadual inválida. Use AAAA-MM-DD.",
  company_capital_social_invalid:
    "Capital social inválido. Use um número (ex.: 10000,00).",

  // ── emissão de NFS-e ─────────────────────────────────────────────────────────────────────
  company_codigo_servico_nacional_invalid:
    "Código de serviço nacional inválido — ele tem exatamente 6 dígitos.",
  company_codigo_servico_nacional_fora_da_lista:
    "O código de serviço escolhido para as notas não está entre os habilitados desta empresa. "
    + "Acrescente-o à lista ou escolha um que já esteja nela.",
  company_codigo_servico_municipal_invalid:
    "Código de serviço municipal inválido — use apenas dígitos.",
  company_rps_serie_invalid:
    "Série da DPS inválida. Use um número entre 1 e 49999.",
  // ⚠ Os três abaixo são GERADOS por template no backend
  //   (`company_${snakeCasePercentual(campo)}_invalid`). Se o nome mudar lá, o teste
  //   `todoErroTemTexto` cai aqui — que é o ponto dele.
  company_p_tot_trib_fed_invalid:
    "Carga tributária federal inválida. Use um percentual entre 0 e 100.",
  company_p_tot_trib_est_invalid:
    "Carga tributária estadual inválida. Use um percentual entre 0 e 100.",
  company_p_tot_trib_mun_invalid:
    "Carga tributária municipal inválida. Use um percentual entre 0 e 100.",

  // ── benefício municipal ──────────────────────────────────────────────────────────────────
  company_beneficio_municipal_numero_invalid:
    "O número do benefício municipal está inválido.",
  company_beneficio_municipal_tipo_invalid:
    "O tipo do benefício municipal está inválido.",
  company_beneficio_municipal_p_red_bc_invalid:
    "O percentual de redução da base do benefício municipal está inválido (0 a 100).",
  company_beneficio_municipal_sem_numero:
    "O benefício municipal precisa do número que o município emitiu.",
  company_beneficio_municipal_percentual_fora_do_tipo:
    "Este tipo de benefício municipal não aceita percentual de redução.",
  company_beneficio_municipal_percentual_ausente:
    "Este tipo de benefício municipal exige o percentual de redução.",

  // ── permissão e infraestrutura ───────────────────────────────────────────────────────────
  forbidden_admin_or_contador_only:
    "Só administrador ou contador pode alterar o cadastro da empresa.",
  actor_user_id_required: "Sessão sem usuário identificado. Entre de novo.",
  referencia_invalida: "Há uma referência inválida no cadastro.",
  global_chart_of_accounts_not_configured:
    "O plano de contas global ainda não foi configurado — sem ele a empresa não pode ser criada.",

  // ⚠ ESTES DOIS FORAM ACRESCENTADOS PELO TESTE-ARMADILHA, na primeira execução dele. Eu tinha
  //   enumerado os códigos por grep e perdido os dois — que é exatamente o modo de falhar que o
  //   teste existe para pegar, e ele pegou antes de o commit sair.
  validation_failed:
    "Alguns campos não passaram na validação. Confira os destacados no formulário.",
  internal_error:
    "Não foi possível salvar por uma falha interna. Tente de novo; se repetir, avise o suporte.",
});

/**
 * A frase em português para um código de recusa do cadastro.
 *
 * @param {string} codigo   o `error` que o servidor devolveu
 * @param {object} payload  o corpo inteiro do 4xx/409 (usado só onde ele acrescenta FATO)
 * @returns {string|null}   `null` quando o código não é conhecido — de propósito
 */
export function mensagemDoErroDeCadastro(codigo, payload) {
  const chave = String(codigo || "").trim();
  const base = TEXTOS[chave];
  if (!base) return null;

  // ⚠⚠ O ENDEREÇO NOMEIA OS CAMPOS QUE FALTAM, e o `details` existe no backend desde sempre —
  //   ele é que não chegava à tela. "O endereço está incompleto" manda o contador procurar em
  //   seis campos; "Faltam CEP e Número" é a mesma recusa com o trabalho já feito.
  if (chave === "company_endereco_required_fields_missing") {
    const nomes = (Array.isArray(payload?.details) ? payload.details : [])
      .map((d) => CAMPO_DO_ENDERECO[String(d).split(".").pop()] || null)
      .filter(Boolean);
    if (!nomes.length) return base;
    const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
    return nomes.length === 1 ? `Falta ${lista} no endereço.` : `Faltam ${lista} no endereço.`;
  }

  return base;
}

/** Os códigos que este dicionário conhece. ⚠ É o que o teste-armadilha do backend confere. */
export function codigosDeCadastroConhecidos() {
  return Object.keys(TEXTOS);
}
