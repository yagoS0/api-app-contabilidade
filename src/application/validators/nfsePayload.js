import { onlyDigits, toBoolean, toNullableString } from "../../utils/normalizers.js";

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
      },
      competencia,
      referencia: toNullableString(body.referencia),
    },
  };
}
