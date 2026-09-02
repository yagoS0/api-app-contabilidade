import { onlyDigits, toBoolean, toNullableString } from "../../utils/normalizers.js";
import { parseDate } from "../../utils/date.js";
import { cpfTemDvValido } from "../../utils/cpf.js";
import { normalizarCodigoServicoNacional } from "../nfse/codigoServicoDaNota.js";

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

export function validateNfsePayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "payload_invalido" };
  }

  const companyId = toNullableString(body.companyId);
  if (!companyId) {
    return { ok: false, error: "company_id_obrigatorio" };
  }

  const tomador = body.tomador || {};
  const doc = onlyDigits(tomador.cnpjCpf || tomador.documento || tomador.doc);
  if (!doc || (doc.length !== 11 && doc.length !== 14)) {
    return { ok: false, error: "tomador_documento_invalido" };
  }
  // ⚠ O DÍGITO VERIFICADOR DO CPF — pedido do dono, 18/08/2026. Até aqui, 11 dígitos quaisquer
  // entravam: o projeto inteiro não tinha nenhuma checagem de DV (só `normalizeCpf`/`fmtCpf`, que
  // mexem em pontuação). Com o caminho ligado em PRODUÇÃO, um dígito trocado emite nota fiscal
  // contra outra pessoa — e a NFS-e não tem inutilização, então o conserto é cancelamento.
  //
  // ⚠ RECUSA NOMEADA E **DISTINTA** de `tomador_documento_invalido`: os dois têm conserto
  // diferente. "Documento ausente ou com comprimento errado" é campo não preenchido; "DV inválido"
  // é número digitado errado, e quem lê precisa saber que o problema está NO NÚMERO.
  //
  // ⚠ É VALIDAÇÃO **LOCAL**, e só. Nada é consultado: a BrasilAPI é base de CNPJ, consulta de CPF
  // é serviço pago e traz LGPD junto (o tomador é terceiro). Ver `utils/cpf.js`.
  // O CNPJ segue exatamente como estava — sua validação de DV não foi pedida e não foi inventada.
  if (doc.length === 11 && !cpfTemDvValido(doc)) {
    return { ok: false, error: "tomador_cpf_digito_invalido" };
  }
  const tomadorNome = toNullableString(tomador.nome || tomador.razaoSocial || tomador.name);
  if (!tomadorNome) {
    return { ok: false, error: "tomador_nome_obrigatorio" };
  }
  const tomadorEmail = toNullableString(tomador.email);
  if (tomadorEmail && !tomadorEmail.includes("@")) {
    return { ok: false, error: "tomador_email_invalido" };
  }
  const tomadorEnderecoRaw = tomador.endereco || tomador.address || {};
  const tomadorEndereco = {
    cMun: toNullableString(tomadorEnderecoRaw.cMun || tomadorEnderecoRaw.codMunicipio || tomadorEnderecoRaw.codigoMunicipio),
    CEP: toNullableString(tomadorEnderecoRaw.CEP || tomadorEnderecoRaw.cep),
    xLgr: toNullableString(tomadorEnderecoRaw.xLgr || tomadorEnderecoRaw.logradouro),
    nro: toNullableString(tomadorEnderecoRaw.nro || tomadorEnderecoRaw.numero),
    xCpl: toNullableString(tomadorEnderecoRaw.xCpl || tomadorEnderecoRaw.complemento),
    xBairro: toNullableString(tomadorEnderecoRaw.xBairro || tomadorEnderecoRaw.bairro),
  };
  const hasEnderecoTomador =
    tomadorEndereco.cMun && tomadorEndereco.CEP && tomadorEndereco.xLgr && tomadorEndereco.nro && tomadorEndereco.xBairro;

  const servico = body.servico || {};
  const descricao = toNullableString(servico.descricao || servico.descricaoServico || servico.xDescServ);
  if (!descricao) {
    return { ok: false, error: "servico_descricao_obrigatoria" };
  }
  const valorServicos = parseNumber(servico.valorServicos || servico.valor || servico.vServ);
  if (!valorServicos || valorServicos <= 0) {
    return { ok: false, error: "servico_valor_invalido" };
  }
  const aliquota = parseNumber(servico.aliquota || servico.pAliq || servico.pIss);
  const issRetido = toBoolean(servico.issRetido);
  const competencia = parseDate(body.competencia || servico.competencia || servico.dCompet);

  // ── O CÓDIGO DE SERVIÇO DESTA NOTA (`cTribNac`) ────────────────────────────────────────────
  //
  // ⚠ ANTES NÃO HAVIA CAMPO NENHUM AQUI, e isso era ponte deliberada: a empresa já podia cadastrar
  // N códigos (`Company.codigosServicoNacional`, 16/08/2026) e a tela já MOSTRAVA qual iria, mas
  // `buildDpsXml` lia só `company.codigoServicoNacional`. Um seletor que parecesse funcionar e
  // emitisse outro código é erro fiscal SILENCIOSO — pior que a ausência do seletor.
  //
  // ⚠ AQUI SÓ SE CONFERE A **FORMA** (6 dígitos). Quem decide se este código vale para ESTA
  // empresa é `escolherCodigoServicoNacional` (`application/nfse/codigoServicoDaNota.js`), no
  // pré-voo de `NfseService.issue`, porque a resposta depende do CADASTRO — que o validador não lê
  // e não deve ler. **O cadastro é a autoridade, nunca o payload.**
  //
  // Ausente = "não escolheram" ⇒ vale o cadastro, como sempre valeu. `null` é o valor que diz isso.
  const codigoServicoNacionalBruto =
    servico.codigoServicoNacional ?? servico.cTribNac ?? body.codigoServicoNacional ?? null;
  const codigoServicoNacional = normalizarCodigoServicoNacional(codigoServicoNacionalBruto);
  if (
    codigoServicoNacionalBruto !== null &&
    codigoServicoNacionalBruto !== undefined &&
    String(codigoServicoNacionalBruto).trim() !== "" &&
    !codigoServicoNacional
  ) {
    return { ok: false, error: "servico_codigo_nacional_invalido" };
  }

  // ⚠ LOCAL DA PRESTAÇÃO — agora é um campo, e antes não era. `buildDpsXml` cravava
  // `cLocPrestacao = cLocEmi` com o comentário "por enquanto assume igual", e não havia como
  // informar outro. É o campo que decide para QUAL MUNICÍPIO o ISSQN é devido.
  //
  // ⚠ Não se deduz do endereço do tomador: a regra é a LC 116/2003, art. 3º (estabelecimento do
  // prestador no `caput`, com lista fechada de exceções nos incisos). Ausente ⇒ o serviço aplica a
  // regra geral, explicitamente. 7 dígitos ou nada — código curto virava código plausível no
  // `padStart` de antes.
  const cLocPrestacaoRaw = onlyDigits(
    servico.cLocPrestacao || servico.codigoMunicipioPrestacao || body.cLocPrestacao
  );
  const cLocPrestacao = cLocPrestacaoRaw.length === 7 ? cLocPrestacaoRaw : null;
  if (cLocPrestacaoRaw && !cLocPrestacao) {
    return { ok: false, error: "servico_local_prestacao_invalido" };
  }

  const totTrib = body.totTrib || {};
  // ⚠ `totTrib.pTotTribSN || body.pTotTribSN` ENGOLIA O ZERO. `0 || undefined` é `undefined`, então
  // um `pTotTribSN` legítimo de 0,00 chegava ao serviço como ausente e a emissão era recusada por
  // "campo não informado" — quando ele tinha sido informado. `??` só cai para a segunda fonte
  // quando a primeira é nula/ausente, que é o que se queria dizer.
  const pTotTribSN = parseNumber(totTrib.pTotTribSN ?? body.pTotTribSN);
  if (pTotTribSN !== null && (pTotTribSN < 0 || pTotTribSN > 100)) {
    // É um PERCENTUAL. Fora de 0–100 não é "um número grande", é outra unidade — provavelmente o
    // valor em reais no lugar da alíquota efetiva.
    return { ok: false, error: "p_tot_trib_sn_invalido" };
  }
  // Empresa NÃO optante declara a carga aproximada em percentuais (Lei 12.741/2012). Este caminho
  // era inalcançável enquanto `opSimpNac` era cravado em 3, e o XML emitia `0.00` — que afirma
  // carga zero. Ver `MISSING_TOT_TRIB_NAO_SIMPLES` em `NfseService.buildDpsXml`.
  const pTotTribFed = parseNumber(totTrib.pTotTribFed);
  const pTotTribEst = parseNumber(totTrib.pTotTribEst);
  const pTotTribMun = parseNumber(totTrib.pTotTribMun);
  for (const [nome, v] of [
    ["pTotTribFed", pTotTribFed],
    ["pTotTribEst", pTotTribEst],
    ["pTotTribMun", pTotTribMun],
  ]) {
    if (v !== null && (v < 0 || v > 100)) {
      return { ok: false, error: `${nome}_invalido` };
    }
  }

  return {
    ok: true,
    data: {
      companyId,
      tomador: {
        doc,
        nome: tomadorNome,
        email: tomadorEmail,
        endereco: hasEnderecoTomador ? tomadorEndereco : undefined,
      },
      servico: {
        descricao,
        valorServicos,
        aliquota,
        issRetido: Boolean(issRetido),
        cLocPrestacao,
        codigoServicoNacional,
      },
      totTrib: {
        pTotTribSN,
        pTotTribFed,
        pTotTribEst,
        pTotTribMun,
      },
      competencia,
      referencia: toNullableString(body.referencia),
      // ⚠⚠ O PERFIL VIAJA COMO **ID**, NUNCA COMO VALORES. É a mesma razão pela qual
      // `pTotTribFed/Est/Mun` nunca viajam: se o valor vem no corpo, um valor velho preso no
      // formulário do cliente sobrescreve em silêncio a correção do contador. Com o id, quem lê a
      // configuração é o servidor, sempre a atual.
      //
      // ⚠ Ele é só uma ESCOLHA ENTRE OS QUE EXISTEM. Um `perfilId` de outra empresa não alcança
      // nada: `resolverPerfilDeEmissao` filtra por `portalClientId`, e o portal daquela emissão sai
      // da `Company` já autorizada — não do corpo.
      perfilId: toNullableString(body.perfilId),
    },
  };
}
