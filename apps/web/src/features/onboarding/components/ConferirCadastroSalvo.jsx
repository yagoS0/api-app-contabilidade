import { Button } from "../../../components/ui/Button";

export function ConferirCadastroSalvo({ onboarding, ocupado, acao }) {
  const cadastro = onboarding.dados?.cadastroCnpj;
  if (!cadastro || cadastro.cnpj !== onboarding.cnpj || !cadastro.empresa) return null;
  const e = cadastro.empresa;
  const endereco = Object.values(e.endereco || {}).filter(Boolean).join(", ");
  return <section aria-label="Cadastro já preenchido">
    <h4>Confira os dados já preenchidos</h4>
    <p>Dados trazidos pela consulta no formulário. Confira com os documentos disponíveis antes de continuar.</p>
    <dl>
      <div><dt>CNPJ</dt><dd>{onboarding.cnpj}</dd></div>
      <div><dt>Razão social</dt><dd>{onboarding.dados?.razaoSocial || e.razaoSocial || "Não informado"}</dd></div>
      <div><dt>Nome fantasia</dt><dd>{(onboarding.dados?.nomeFantasia ?? e.nomeFantasia) || "Não informado"}</dd></div>
      <div><dt>Endereço</dt><dd>{endereco || "Não informado"}</dd></div>
      <div><dt>CNAE principal</dt><dd>{e.cnaePrincipal || "Não informado"}</dd></div>
    </dl>
    <Button disabled={ocupado} onClick={() => acao("/jornada/conferencia", {
      tipo: "PUBLICA", versao: onboarding.versao,
      manual: {
        fonte: "Dados da consulta de CNPJ no formulário, conferidos pelo escritório",
        evidencia: `Conferi os dados cadastrais apresentados para o CNPJ ${onboarding.cnpj}, razão social ${onboarding.dados?.razaoSocial || e.razaoSocial || "não informada"}. Consulta informada em ${cadastro.consultadoEm || "data não informada"}. Conferência humana dos dados recebidos; não é consulta fiscal.`,
      },
    })}>Conferi os dados: continuar</Button>
  </section>;
}
