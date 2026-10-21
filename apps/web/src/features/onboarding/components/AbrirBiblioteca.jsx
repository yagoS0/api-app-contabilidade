export function AbrirBiblioteca({ categoria }) {
  const categorias = { CONTRATO: "modelos de contrato", CATALOGO: "catálogo de honorários", INSTITUCIONAL: "dados do escritório", ORIENTACAO: "mensagens rápidas" };
  const nome = categorias[categoria];
  const titulo = nome ? `Gerenciar ${nome}` : "Gerenciar biblioteca compartilhada";
  return <a href={nome ? `/biblioteca#${categoria}` : "/biblioteca"} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" aria-label={`${titulo} (nova aba)`}>{titulo} <span aria-hidden="true">↗</span></a>;
}
