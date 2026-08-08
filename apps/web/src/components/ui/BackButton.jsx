import { Button } from "./Button";

/**
 * BackButton — o ÚNICO "voltar" do app.
 *
 * Não é um segundo componente de botão: é o `Button` com a decoração fixada num lugar só. Antes
 * havia SEIS voltares diferentes na mesma aplicação — pílula de 33px com raio 14 (PageShell), seta
 * solta de 40×40 com raio 12 (header da empresa), seta de 37px com raio 6 e sem rótulo acessível
 * (Planejamento), `Button` de 38px sem seta (ficha), o mesmo com seta (Obrigações) e um `<button>`
 * de estilo inline com raio 16 (Plano de contas). Quem tem seis formas para uma ação não tem
 * nenhuma: o olho perde o ponto de saída ao trocar de tela.
 *
 * Duas regras que a caixa garante:
 *  - A seta é `aria-hidden`. Ela é ornamento; quem lê por leitor de tela ouve o rótulo, não "seta
 *    para a esquerda Voltar". E o `aria-label` mantém o nome acessível igual ao rótulo, então
 *    `getByRole("button", { name: "Voltar" })` continua achando o botão em qualquer tela.
 *  - `label` existe para o voltar que diz PARA ONDE vai ("← Obrigações"). Isso é decisão de
 *    produto, não decoração — o componente preserva o texto de quem o passa.
 */
export function BackButton({ label = "Voltar", className = "", ...props }) {
  return (
    <Button
      type="button"
      variant="secondary"
      className={`btn-back${className ? ` ${className}` : ""}`}
      aria-label={label}
      {...props}
    >
      <span aria-hidden="true">←</span>
      {label}
    </Button>
  );
}

export default BackButton;
