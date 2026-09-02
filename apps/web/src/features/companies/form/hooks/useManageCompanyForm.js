import { useMemo, useState } from "react";

export function getInitialCompanyFormState() {
  return {
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: "",
    email: "",
    guideNotificationEmail: "",
    hasProlabore: false,
    temFolha: false,
    empresaZerada: false,
    telefone: "",
    regimeTributario: "SIMPLES",
    // ⚠⚠ O ANEXO DO SIMPLES NAO TINHA CAMPO EM TELA NENHUMA, e mesmo assim a coluna existe, volta
    //   no payload e era APAGADA a cada salvar (ver o spread condicional em `routes/firm`).
    //   Parar de apagar sem dar por onde preencher deixaria a empresa nova nascendo sem anexo
    //   para sempre — decisao do dono (30/08/2026): criar o campo.
    simplesAnexo: "",
    atividadesGravadas: [],
    atividadesDescritas: [],
    simplesDataOpcao: "",
    cnaePrincipal: "",
    cnaesSecundarios: "", // string separada por vírgula; o realApi normaliza pra array
    enderecoRua: "",
    enderecoNumero: "",
    enderecoBairro: "",
    enderecoCidade: "",
    enderecoUf: "",
    enderecoCep: "",
    enderecoComplemento: "",
    // ── Ficha de cadastro ──
    inscricaoMunicipal: "",
    inscricaoMunicipalData: "",
    // Código IBGE (7 dígitos) do município EMISSOR da NFS-e — o `cLocEmi` da DPS. Nasce vazio e
    // NUNCA é pré-preenchido: o contador escolhe na lista oficial (ver `SeletorMunicipioIbge`).
    codigoMunicipioIbge: "",
    // Configuração da emissão de NFS-e (`cTribNac`, `cTribMun` e a série da DPS). ⚠ Nascem vazios e
    // NUNCA são pré-preenchidos — nem a série: ela entra no identificador de toda nota emitida, e um
    // valor escolhido pelo sistema seria indistinguível de um valor conferido pelo contador.
    codigoServicoNacional: "",
    // Os N códigos de serviço que a empresa pode usar (decisão do dono, 16/08/2026). Escolhidos na
    // lista oficial versionada — nunca derivados do CNAE.
    codigosServicoNacional: [],
    codigoServicoMunicipal: "",
    rpsSerie: "",
    // Carga tributária aproximada da empresa NÃO optante (Lei 12.741/2012). ⚠ Nascem vazios e
    // NUNCA são pré-preenchidos — nem com 0. Zero é uma AFIRMAÇÃO ("conferi, é zero") que vai
    // impressa ao tomador; um zero escolhido pelo sistema seria indistinguível de um zero
    // conferido pelo contador. Campo vazio é a verdade sobre uma empresa não configurada.
    pTotTribFed: "",
    pTotTribEst: "",
    pTotTribMun: "",
    // Benefício municipal do ISSQN (grupo `BM` da DPS). ⚠ Nascem vazios pelo mesmo motivo dos de
    // cima, e aqui com mais razão: benefício REDUZ IMPOSTO, e o número é concedido pelo município
    // — não existe lista neste sistema, nada é deduzido do CNAE e nada é sugerido.
    beneficioMunicipalNumero: "",
    beneficioMunicipalTipoReducao: "",
    beneficioMunicipalPRedBC: "",
    inscricaoEstadual: "",
    inscricaoEstadualData: "",
    porte: "",
    naturezaJuridica: "",
    capitalSocial: "",
    dataAbertura: "",
    abriuCom: "",
    numeroRegistro: "",
    tipoRegistro: "",
    diarioNumero: "",
    desoneracao: false,
    alteracaoNumero: "",
    alteracaoData: "",
    socios: [],
    regimeHistorico: [],
  };
}

// ISO/Date → "YYYY-MM-DD" pro <input type="date">.
function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * O QUE ESTÁ GRAVADO NA `Company` → os campos da ABA DE EMISSÃO DE NFS-e.
 *
 * ⚠ POR QUE ISTO É UMA FUNÇÃO (19/08/2026). A configuração de emissão saiu do formulário e virou
 * aba própria (com salvar próprio), e esta leitura passou a ter DOIS consumidores: a aba e o
 * `mapCompanyToEditForm` — que continua carregando os sete campos porque o "Salvar alterações" do
 * cadastro manda a empresa INTEIRA. ⚠ Tirá-los de lá faria o salvar do cadastro mandar `null` em
 * cada um e APAGAR a configuração de quem só mexeu no telefone.
 *
 * Duas armadilhas moram aqui, e as duas já custaram caro:
 *   • `!= null`, NUNCA `|| ""`: `0` é percentual legítimo e conferido (a NFS-e real declara
 *     `pTotTribEst 0.00`). Com `||`, o zero reabriria o campo em branco, o contador salvaria de
 *     novo, gravaria NULL e a empresa pararia de emitir sem nada na tela ter mudado;
 *   • a lista cai para o campo SINGULAR quando está vazia — é o MESMO dado no formato anterior à
 *     migration, não uma derivação. Sem isso o cadastro reabriria vazio e seria recadastrado.
 */
export function mapCompanyToEmissaoNfseForm(company) {
  const legacy = company?.legacyCompany && typeof company.legacyCompany === "object" ? company.legacyCompany : {};
  return {
    // ⚠ Só de `legacyCompany`: as três colunas vivem em `Company`, não em `PortalClient`. E nada de
    // fallback derivado (CNAE → código de serviço, ou uma série "1" quando vier vazio): campo vazio
    // aqui é a informação de que a empresa não está configurada para emitir.
    codigoServicoNacional: String(legacy?.codigoServicoNacional || "").trim(),
    // ⚠ CAI PARA O CAMPO SINGULAR quando a lista está vazia — e isso não é derivação, é o MESMO
    // dado no formato antigo. Uma empresa cadastrada antes de 16/08/2026 (ou antes de a migration
    // ser aplicada) tem só o campo de um código; abrir o formulário com a lista vazia faria o
    // contador achar que nada foi salvo e recadastrar.
    codigosServicoNacional: Array.isArray(legacy?.codigosServicoNacional) && legacy.codigosServicoNacional.length
      ? legacy.codigosServicoNacional.map((c) => String(c).trim()).filter(Boolean)
      : (String(legacy?.codigoServicoNacional || "").trim() ? [String(legacy.codigoServicoNacional).trim()] : []),
    codigoServicoMunicipal: String(legacy?.codigoServicoMunicipal || "").trim(),
    rpsSerie: String(legacy?.rpsSerie || "").trim(),
    // ⚠ `!= null`, NUNCA `|| ""`: a coluna é `Decimal?` e um `0` gravado é um percentual
    // LEGÍTIMO (serviço não tem ICMS — a NFS-e real de referência declara 0,00 no estadual).
    // Com `||` o zero conferido pelo contador reabriria o formulário em branco, ele salvaria de
    // novo, e a empresa voltaria a não emitir. Mesma armadilha do `?? ""` do FechamentoModal.
    pTotTribFed: legacy?.pTotTribFed != null ? String(legacy.pTotTribFed) : "",
    pTotTribEst: legacy?.pTotTribEst != null ? String(legacy.pTotTribEst) : "",
    pTotTribMun: legacy?.pTotTribMun != null ? String(legacy.pTotTribMun) : "",
    // ⚠ BENEFÍCIO MUNICIPAL — o `!= null` do percentual vale igual: `0` é um percentual de redução
    // legítimo (benefício que reduz zero por cento não existe na prática, mas quem decide isso é o
    // contador, não a leitura), e `|| ""` reabriria o campo em branco.
    beneficioMunicipalNumero: String(legacy?.beneficioMunicipalNumero || "").trim(),
    beneficioMunicipalTipoReducao: String(legacy?.beneficioMunicipalTipoReducao || "").trim(),
    beneficioMunicipalPRedBC:
      legacy?.beneficioMunicipalPRedBC != null ? String(legacy.beneficioMunicipalPRedBC) : "",
  };
}

export function mapCompanyToEditForm(company) {
  const legacy = company?.legacyCompany && typeof company.legacyCompany === "object" ? company.legacyCompany : {};
  const endereco = legacy?.enderecoJson && typeof legacy.enderecoJson === "object" ? legacy.enderecoJson : {};
  return {
    ownerName: String(company?.ownerName || "").trim(),
    // ⚠⚠ SEM FALLBACK PARA `company.email`. Ele fazia o campo "E-mail do responsável (login do
    //   portal)" nascer com o e-mail da EMPRESA quando não havia vínculo OWNER — e são coisas
    //   diferentes: `ownerEmail` vem do `CompanyClientUser` OWNER; `company.email` é
    //   `Company.email`, que recebe guias e não abre portal nenhum.
    //   Ao salvar, aquele valor viajava como `ownerEmail` e disparava o ramo de TROCA DE DONO sem
    //   ninguém ter tocado no campo.
    // ⚠ O branco não fica mudo: `estadoDoResponsavel` (lib/portal) diz na tela por que ele está
    //   vazio — célula vazia é proibida nesta casa.
    // ⚠ Medido em produção (30/08/2026): 0 de 34 empresas sem OWNER ativo, então isto é armadilha
    //   latente, não a causa do defeito relatado. Ver o commit que a mediu.
    ownerEmail: String(company?.ownerEmail || "").trim(),
    ownerPassword: "",
    razaoSocial: String(legacy?.razaoSocial || company?.razao || "").trim(),
    nomeFantasia: String(legacy?.nomeFantasia || "").trim(),
    cnpj: String(company?.cnpj || "").trim(),
    email: String(company?.email || "").trim(),
    guideNotificationEmail: String(company?.guideNotificationEmail || "").trim(),
    hasProlabore: Boolean(company?.hasProlabore),
    temFolha: Boolean(company?.temFolha),
    empresaZerada: Boolean(company?.empresaZerada),
    telefone: String(legacy?.telefone || company?.telefone || "").trim(),
    regimeTributario: String(legacy?.regimeTributario || "SIMPLES"),
    // ⚠ `simplesAnexo` e `anexoSimples` sao a MESMA coisa em duas colunas legadas; o backend grava
    //   as duas juntas. Lemos a que estiver preenchida — nunca inventamos uma terceira.
    simplesAnexo: String(legacy?.simplesAnexo || legacy?.anexoSimples || ""),
    // ⚠ SO LEITURA — alimenta a legenda do CNAE na EDICAO, onde a consulta ao CNPJ nao roda.
    //   `buildCompanyPayload` nao a envia; quem escreve `atividades` e o backend, mesclando.
    atividadesGravadas: Array.isArray(legacy?.atividades) ? legacy.atividades : [],
    // ⚠ Nasce VAZIA na edicao, de proposito: so a consulta ao CNPJ a preenche. Semea-la do que
    //   ja esta gravado faria o payload reenviar o texto antigo como se fosse da Receita.
    atividadesDescritas: [],
    simplesDataOpcao: String(legacy?.simplesDataOpcao || "").slice(0, 10),
    cnaePrincipal: String(legacy?.cnaePrincipal || "").trim(),
    cnaesSecundarios: Array.isArray(legacy?.cnaesSecundarios) ? legacy.cnaesSecundarios.join(", ") : "",
    enderecoRua: String(endereco?.rua || "").trim(),
    enderecoNumero: String(endereco?.numero || "").trim(),
    enderecoBairro: String(endereco?.bairro || "").trim(),
    enderecoCidade: String(endereco?.cidade || company?.municipio || "").trim(),
    enderecoUf: String(endereco?.uf || company?.uf || "").trim().toUpperCase(),
    enderecoCep: String(endereco?.cep || "").trim(),
    enderecoComplemento: String(endereco?.complemento || "").trim(),
    // ── Ficha de cadastro ──
    inscricaoMunicipal: String(company?.inscricaoMunicipal || legacy?.inscricaoMunicipal || "").trim(),
    inscricaoMunicipalData: toDateInput(legacy?.inscricaoMunicipalData),
    // ⚠ Só de `legacyCompany`: a coluna vive em `Company`, não em `PortalClient`. Ler o
    // `municipio`/`uf` do topo como fallback seria transformar o TEXTO do endereço em código.
    codigoMunicipioIbge: String(legacy?.codigoMunicipioIbge || "").trim(),
    // ── Configuração da emissão de NFS-e ──
    // ⚠ A LEITURA SAIU DAQUI e virou `mapCompanyToEmissaoNfseForm` (acima): a aba própria de
    // emissão lê os mesmos campos, e duas leituras dos mesmos valores divergiriam na primeira
    // correção — justamente nos dois pontos em que errar é caro (o `!= null` do zero e a queda
    // para o campo singular). ⚠ Eles CONTINUAM no formulário do cadastro: o "Salvar alterações"
    // manda a empresa inteira, e um campo ausente aqui viraria `null` no payload, apagando a
    // configuração de quem foi só trocar o telefone.
    ...mapCompanyToEmissaoNfseForm(company),
    inscricaoEstadual: String(legacy?.inscricaoEstadual || "").trim(),
    inscricaoEstadualData: toDateInput(legacy?.inscricaoEstadualData),
    porte: String(legacy?.porte || "").trim(),
    naturezaJuridica: String(legacy?.naturezaJuridica || "").trim(),
    capitalSocial: legacy?.capitalSocial != null ? String(legacy.capitalSocial) : "",
    dataAbertura: toDateInput(legacy?.dataAbertura),
    abriuCom: String(legacy?.abriuCom || "").trim(),
    numeroRegistro: String(legacy?.numeroRegistro || "").trim(),
    tipoRegistro: String(legacy?.tipoRegistro || "").trim(),
    diarioNumero: String(legacy?.diarioNumero || "").trim(),
    desoneracao: Boolean(legacy?.desoneracao),
    alteracaoNumero: String(legacy?.alteracaoNumero || "").trim(),
    alteracaoData: toDateInput(legacy?.alteracaoData),
    socios: Array.isArray(legacy?.partners)
      ? legacy.partners.map((p) => ({
          name: String(p.name || ""),
          documento: String(p.documento || ""),
          participacao: p.participacao != null ? String(p.participacao) : "",
          rg: String(p.rg || ""),
          rgOrgaoEmissor: String(p.rgOrgaoEmissor || ""),
          dataNascimento: toDateInput(p.dataNascimento),
          dataSaida: toDateInput(p.dataSaida),
          representante: Boolean(p.representante),
        }))
      : [],
    regimeHistorico: Array.isArray(legacy?.regimeHistorico)
      ? legacy.regimeHistorico.map((r) => ({
          regime: String(r.regime || "SIMPLES"),
          vigenciaInicio: toDateInput(r.vigenciaInicio),
          vigenciaFim: toDateInput(r.vigenciaFim),
          impostos: Array.isArray(r.impostos) ? r.impostos.join("/") : "",
          desoneracao: Boolean(r.desoneracao),
        }))
      : [],
  };
}

export function useCompanyForm(initialState = getInitialCompanyFormState()) {
  const [form, setForm] = useState(initialState);

  const actions = useMemo(
    () => ({
      setField(name, value) {
        setForm((old) => ({ ...old, [name]: value }));
      },
      replace(next) {
        setForm(next || getInitialCompanyFormState());
      },
      reset() {
        setForm(getInitialCompanyFormState());
      },
    }),
    []
  );

  return { form, setForm, ...actions };
}
