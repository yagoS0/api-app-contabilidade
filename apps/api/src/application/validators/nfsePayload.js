import { onlyDigits, toBoolean, toNullableString } from "../../utils/normalizers.js";
import { parseDate } from "../../utils/date.js";

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
      },
      totTrib: {
        pTotTribSN,
        pTotTribFed,
        pTotTribEst,
        pTotTribMun,
      },
      competencia,
      referencia: toNullableString(body.referencia),
    },
  };
}
