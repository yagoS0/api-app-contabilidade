export function ConsultaCnpjOnboarding({ consulta, carregando, cadastro }) {
  if (carregando) return <p role="status">Consultando CNPJ…</p>;
  if (consulta && !consulta.ok) return <p role="status">{consulta.mensagem} Você pode corrigir os campos e tentar novamente.</p>;
  if (!cadastro) return null;
  const e = cadastro.empresa || {};
  return <div className="onboarding-cnpj-resumo" role="status">
    <p>Dados preenchidos pela consulta de CNPJ. Confira e corrija o que precisar.</p>
    {e.endereco && <p>{[e.endereco.rua, e.endereco.numero, e.endereco.bairro, e.endereco.cidade, e.endereco.uf, e.endereco.cep].filter(Boolean).join(", ")}</p>}
    {e.cnaePrincipal && <p>CNAE principal: {e.cnaePrincipal}</p>}
    {cadastro.situacao?.texto && <p>Situação cadastral: {cadastro.situacao.texto}</p>}
  </div>;
}
