// A ABA PRÓPRIA DA CONFIGURAÇÃO DE EMISSÃO DE NFS-e — decisão do dono, 19/08/2026:
//
// > *"configuração de notas na aba do contador está ficando muito grande, vamos separar ela em uma
// > aba própria."* … *"ele ganha o próprio salvar."*
//
// ⚠ O QUE MUDOU DE LUGAR E O QUE NÃO MUDOU. Os campos são os MESMOS (`CamposEmissaoNfse`, com as
// mesmas regras e os mesmos avisos); o que mudou é onde eles moram e QUEM os salva. Nada foi
// duplicado: o formulário do cadastro deixou de renderizar o bloco em modo edição e aponta para
// cá — dois lugares editando os mesmos campos seria o defeito, não a solução.
//
// ⚠ O SALVAR É PRÓPRIO, E MANDA SÓ OS CAMPOS DESTA TELA (`PATCH /firm/companies/:id/emissao-nfse`).
// O "Salvar alterações" do cadastro manda a empresa INTEIRA e exige CNPJ, razão social, CNAE e
// endereço — reusá-lo aqui significaria esta aba gravar (ou apagar) dados que ela não mostra. No
// backend, campo que não vem no corpo NÃO É TOCADO; campo vazio APAGA. São intenções diferentes.
//
// ⚠ A LIBERAÇÃO AO CLIENTE VEIO JUNTO, MAS COMO BLOCO À PARTE, depois do botão de salvar e com o
// próprio botão e a própria confirmação. Ela NÃO é campo do formulário e não entra no salvar desta
// aba: no backend é rota própria, com gate `ACCOUNTANT`+ e auditoria de quem/quando. Um campo a
// mais faria o ato fiscal viajar junto de troca de código de serviço.

import { useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { CamposEmissaoNfse } from "../../form/components/CamposEmissaoNfse";
import { mapCompanyToEmissaoNfseForm } from "../../form/hooks/useManageCompanyForm";

// Os campos que esta aba salva — e nada além deles. A lista é a mesma que a rota aceita
// (`CAMPOS_EMISSAO_NFSE`, em `routes/firm/index.js`): campo fora dela é RECUSADO nomeando-o, e
// campo que falte aqui simplesmente não é salvo, sem erro.
const CAMPOS = [
  "codigoServicoNacional",
  "codigosServicoNacional",
  "codigoServicoMunicipal",
  "rpsSerie",
  "pTotTribFed",
  "pTotTribEst",
  "pTotTribMun",
  // Benefício municipal do ISSQN (dono, 20/08/2026).
  "beneficioMunicipalNumero",
  "beneficioMunicipalTipoReducao",
  "beneficioMunicipalPRedBC",
];

function mesmoValor(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const la = Array.isArray(a) ? a : [];
    const lb = Array.isArray(b) ? b : [];
    return la.length === lb.length && la.every((v, i) => String(v) === String(lb[i]));
  }
  return String(a ?? "") === String(b ?? "");
}

export function EmissaoNfseTab({
  company,
  onSalvar,
  salvando = false,
  podeEditar = true,
  emissaoCliente = null,
  onSetEmissaoCliente = null,
  emissaoClienteSaving = false,
}) {
  // ⚠ O QUE ESTÁ GRAVADO vem da MESMA leitura que o formulário do cadastro usa
  // (`mapCompanyToEmissaoNfseForm`) — duas leituras dos mesmos valores divergiriam justamente nos
  // dois pontos em que errar é caro: o `!= null` do zero e a queda para o campo singular.
  const gravado = useMemo(() => mapCompanyToEmissaoNfseForm(company), [company]);
  // A aba tem estado PRÓPRIO, e não o do formulário do cadastro: se dependesse dele, salvar daqui
  // exigiria o cadastro carregado e uma refatoração daquele estado quebraria esta tela em silêncio.
  const [form, setForm] = useState(gravado);
  const [semear, setSemear] = useState(() => JSON.stringify(gravado));

  // Re-semeia quando o que está GRAVADO muda (troca de empresa, ou a recarga depois do salvar).
  // ⚠ Comparação por valor, não por referência: `loadCompanies` roda em segundo plano e troca o
  // objeto da empresa a cada volta — semear por referência apagaria o que está sendo digitado.
  const assinatura = JSON.stringify(gravado);
  if (assinatura !== semear) {
    setSemear(assinatura);
    setForm(gravado);
  }

  const alterado = CAMPOS.some((c) => !mesmoValor(form[c], gravado[c]));

  function onChange(campo, valor) {
    // ⚠ Só os campos desta aba entram no estado. O `CamposEmissaoNfse` chama `onChange(campo, v)`
    // com o nome da coluna, exatamente como fazia dentro do formulário — mas aqui um nome de fora
    // da lista seria um campo do cadastro escapando para um salvar que não é o dele.
    if (!CAMPOS.includes(campo)) return;
    setForm((old) => ({ ...old, [campo]: valor }));
  }

  async function submeter(event) {
    event.preventDefault();
    if (!onSalvar || salvando) return;
    // ⚠ MANDA OS SETE, SEMPRE — e é por isso que o backend distingue ausente de vazio. Mandar só
    // os que mudaram pareceria mais econômico e tiraria da tela a capacidade de APAGAR: limpar um
    // campo é uma intenção legítima (desfazer uma configuração errada), e ela viaja como `""`.
    const campos = {};
    for (const c of CAMPOS) campos[c] = form[c];
    await onSalvar(campos);
  }

  return (
    <section className="company-form-page__panel">
      <div className="company-form-page__intro">
        <h1 className="company-form-page__title">Emissão de NFS-e</h1>
        <p className="company-form-page__description">
          O que esta empresa precisa ter configurado para o sistema emitir nota de serviço em nome
          dela. ⚠ Esta tela <strong>não emite nada</strong> — ela guarda a configuração que a
          emissão usa.
        </p>
      </div>

      {!podeEditar ? (
        <p className="text-muted">Apenas admin ou contador pode alterar a configuração de emissão.</p>
      ) : (
        <form className="form-grid two-col" onSubmit={submeter}>
          <CamposEmissaoNfse
            codigoServicoNacional={form.codigoServicoNacional}
            codigosServicoNacional={form.codigosServicoNacional}
            codigoServicoMunicipal={form.codigoServicoMunicipal}
            rpsSerie={form.rpsSerie}
            pTotTribFed={form.pTotTribFed}
            pTotTribEst={form.pTotTribEst}
            pTotTribMun={form.pTotTribMun}
            beneficioMunicipalNumero={form.beneficioMunicipalNumero}
            beneficioMunicipalTipoReducao={form.beneficioMunicipalTipoReducao}
            beneficioMunicipalPRedBC={form.beneficioMunicipalPRedBC}
            onChange={onChange}
            /* ⚠ O botão fica ENTRE os campos e o portão do cliente. Embaixo de tudo, ele pareceria
               salvar também a liberação — que não passa por salvar nenhum: ela grava no clique da
               própria confirmação, por rota própria. */
            acoesDosCampos={
              <div className="full form-actions" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Button type="submit" variant="primary" disabled={salvando || !alterado}>
                  {salvando ? "Salvando..." : "Salvar configuração de emissão"}
                </Button>
                {/* ⚠ A tela diz o que este botão salva — e o que ele NÃO salva. Um botão de salvar
                    numa aba de cadastro é lido como "salva a empresa", e é justamente o que ele
                    não faz. */}
                <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {alterado
                    ? "Há alterações não salvas. O botão salva apenas os campos desta aba — o resto do cadastro tem o salvar dele, na aba Cadastro."
                    : "Nada para salvar: os campos estão como foram gravados. (Este botão salva apenas os campos desta aba.)"}
                </span>
              </div>
            }
            emissaoCliente={emissaoCliente}
            razaoSocial={company?.razao || company?.legacyCompany?.razaoSocial || null}
            onSetEmissaoCliente={onSetEmissaoCliente}
            emissaoClienteSaving={emissaoClienteSaving}
          />
        </form>
      )}
    </section>
  );
}
