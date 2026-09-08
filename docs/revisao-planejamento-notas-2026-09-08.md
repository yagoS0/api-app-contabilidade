# Planejamento e notas — revisão local

## Correção do cenário

O cliente HTTP enviava um objeto diretamente ao fetch, apesar do cabeçalho JSON. A serialização explícita corrige esse contrato. A tela observada exibia `request_failed_400`; não foi encontrada evidência de 404 na rota de criação de cenários. Teste novo inspeciona o corpo enviado pelo cliente real e preservação dos valores editáveis.

Planejamento reabre o cenário salvo mais recente após carregar a empresa, sem substituir alterações feitas durante a busca. Salvar continua sendo explícito. A explicação de IBS/CBS separa recolhimento próprio, crédito do adquirente e opção pelo regime regular; a fonte oficial está em fontes-fiscais.md.

## Notas

Busca rotulada, direção e canceladas explícitas, CNPJ formatado e identificação dos ajustes locais. Emissão dividida em Tomador, Serviço e valores e Conferência; retorno mantém dados e erros direcionam à etapa correta. Nenhuma transmissão fiscal foi feita.

## Validação

- Suítes locais de notas, planejamento e contrato HTTP: 811 casos distintos aprovados, considerando as reexecuções dos casos de navegação atualizados.
- Rota de cenários: 8 testes aprovados (Express/Supertest, persistência simulada).
- Build Vite concluído; aviso existente de tamanho de bundle permanece.
- Prévia local com serviços simulados: navegação até conferência e inspeção visual em desktop e 390 px. Não equivale a emissão fiscal real.
- Não publicado na main nem em produção nesta etapa. A validação de salvar o cenário na instalação pública depende da publicação.
