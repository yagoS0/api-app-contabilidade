# Portal do cliente no celular

Entrega para validação na branch `dev`. Não integrar na `main` nem publicar em produção antes da validação do usuário.

## O que mudou

- Paleta escura, superfícies, tipografia e acentos alinhados ao app do contador; logo adaptado ao fundo escuro.
- Navegação com ícones e nomes visíveis, lateral no desktop e inferior no celular/tablet, respeitando a área segura da tela.
- Cards, filtros, ações e formulários se reorganizam conforme a largura. Campos no celular usam fonte de 16px e controles principais têm alvo de 44px.
- Fluxo conserva valores e colunas com rolagem dentro da tabela e coluna do dia fixa. A DRE permite quebra da descrição para manter o valor visível no celular. Regiões acessíveis e focáveis pelo teclado.
- Notas, Guias e situação fiscal têm rolagem local; formulário/prévia de emissão e cancelamento se ajustam à tela estreita.
- Troca de empresa inclui busca por nome/CNPJ e identificação da empresa atual. Aviso de descarte do lote, foco preso no modal e permissões foram preservados.
- CLAUDEs atualizados com a decisão atual, que substitui a antiga paleta clara e a navegação somente por ícones.

## Verificação

Build do portal aprovado sobre a base da `dev`. Na suíte completa, 1.542 testes passaram e um teste de foco esperava a antiga lista sem o novo campo de busca. A expectativa foi corrigida para incluir o campo; os 13 testes de foco/tokens passaram na repetição. Os testes funcionais dos módulos alterados também passaram.

Conferência em Edge headless isolado, com dados fictícios: quatro abas principais em 360/390/768px, além de login, emissão, troca de empresa, Fluxo, DRE e gaveta do dia. Sem transbordamento horizontal da página nas medições; tabelas extensas mantêm rolagem própria. Corrigidos durante a revisão: identificação da empresa atual colada ao CNPJ, contraste dos placeholders e largura mínima da DRE que deslocava os valores para fora da área inicial. Isso não substitui teste em aparelho físico com teclado virtual e Safari/iOS. Não houve emissão de nota, consulta fiscal real ou alteração de cálculo/permissão.

## Roteiro para validar

1. No celular, entrar no portal e conferir logo, nome da empresa e navegação inferior.
2. Trocar empresa usando nome e CNPJ; fechar o modal e conferir retorno de foco.
3. No Início, conferir cards, trocar competência, alternar Fluxo/DRE e rolar as tabelas.
4. Em Notas, conferir filtros e abrir o formulário de emissão sem emitir uma nota real apenas para testar layout.
5. Conferir Guias e situação fiscal, inclusive tabelas longas e textos extensos.
6. Repetir no desktop para conferir a barra lateral e a distribuição dos cards.
