# INSS, baixa e circular — implementação em desenvolvimento

Data: 23/09/2026. Branch: `codex/inss-pagamento-circular-20260923`, base `96c046c8`.

## Comportamento

- Circular e fluxo priorizam o valor da baixa vigente. Documento atualizado, obrigação e pagamento são informações distintas.
- Comprovante com principal pago e juros/multa zero permite baixa automática. Sem composição ou data confiável, exige conferência; valor da guia não substitui comprovante.
- Nova captura preserva comprovante e estado de pagamento, com atualização condicional para evitar perder informação gravada simultaneamente.
- Pró-labore não preenche retenção individual com o total da guia consolidada e preserva edição manual durante nova renderização.
- Estornos, pagamentos parciais, diferentes datas, rascunhos e valores inválidos têm tratamento explícito. DARF consolidado não replica o pagamento total em cada tributo.
- Sem migração de dados, reabertura de competências ou correção automática de lançamentos exportados.

## Verificação

Revisão por agentes de origem fiscal e interface; juiz independente aprovou o código final. Rodada final direcionada da API: 29 suítes, 668 testes aprovados. Interface contábil e mock: 48 suítes, 648 testes aprovados. Compilação Vite concluída (avisos existentes de tamanho de pacote/importações). `git diff --check` sem erros.

Mock isolado em `http://127.0.0.1:5242`, empresa `04bf356c-cfe9-43fa-bee4-a0180cf8f114`, agosto/2026: baixa R$ 1.000 e documento R$ 1.100. Edição da baixa para R$ 980 refletiu imediatamente na circular e permaneceu após navegação. Pró-labore abriu com retenção vazia e guia apenas como referência; INSS digitado permaneceu ao editar remuneração e IRRF. Aparência conferida no navegador. A empresa no mock tem nome fictício.

Testes usam clientes de banco substituídos; não representam ensaio concorrente em PostgreSQL. Nenhum registro real foi corrigido ou auditado e não houve publicação.

## Diagnóstico de históricos

O script `apps/api/scripts/diagnosticar-pagamentos-guias.mjs` exige `--company <id>` e aceita `--competencia AAAA-MM`. Consulta somente a empresa informada, informa divergências, estornos, competência fechada e lançamentos exportados. É somente leitura e não foi executado em produção.
