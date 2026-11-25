# Checkpoint — Apuração em Operações

Atualizado em 25/11/2026. Entrega incremental, sem aprovação integral da E2 ou de produção.

## Incremento concluído

- Operações mantém o imposto do cálculo transmitido quando há prova causal autenticada, B32/B33 e snapshot correspondente. Histórico somente de leitura não autoriza novo despacho.
- Confirmação fiscal permanece visível com pendência documental. Registro externo fica desabilitado quando a própria transmissão já está confirmada.
- Modal reconhece a resposta causal E2 aninhada, preserva retorno legado até PA10/2026 e recusa confirmação incompleta/2027.
- Impacto: cumprimento de R01/R02/R19/R22 e seção38; nenhuma nova regra operacional. Proteções fiscais, pagamento e contabilidade preservadas.

## Validação reutilizável

Evidências locais em `.altan-governance/e2-validation/final-focal/`:

- `history-api.json`: 35 aprovados, 2 condicionais ignorados; esses dois foram executados em `history-consultas-pg.json` (23 aprovados na suíte completa).
- `history-web.json`: 69 aprovados; `transmission-ui-contract.json`: 14 aprovados.
- `history-custody.json`: 21 aprovados e 2 recusados por configuração de ambiente; `history-custody-pg-explicit-env.json`: os 2 aprovados com URLs explícitas iguais, sem alterar testes.
- Navegador/API/PG reais, provedor fiscal simulado: `e2e-evidence/e2-20261125-256d2053/browser-confirmed-history-324ad9ac-c491-415a-af0d-5041597001e4/report.json` aprovado em desktop/mobile antes/depois de recarga.
- Revisões delimitadas existentes: `review-confirmed-history-static.json` e `review-transmission-ui-contract-static.json`; não repetir sem mudança relevante.

## Próximo incremento: cálculo em lote persistido

Campanha sintética `e2-20261125-256d2053`, casos T156.7/T156.2/T159.2, PA11/2026. FS12 revisão1 confirmada por API, XML sintético processado por extratores reais, auditoria completa.

O clique do lote chegou à API com três intenções; todas terminaram REVIEW antes da etapa fiscal pretendida. Evidência: `browser-batch-90958e52-e9f3-424b-9640-dcc2c42c6101/report.json`. Não apagar ledgers nem repetir o roteiro antigo.

Diagnóstico encerrado: RBT12 é PARCIAL_LOCAL porque o histórico configurado no provedor fake ainda não foi recuperado; T156.2/T159.2 têm classificação sintética não Fator R incompatível com seu CNAE sintético. Dados detalhados: `batch-read-diagnostic-1795624504211.json`. Não alterar guardas produtivas para contornar esses bloqueios.

Próximas ações: comprovar zero comandos/despachos por PG e log do provedor; recuperar PA10 pela rota real `circular/2026-10/sync-pgdas` com `somenteDocumentos:true`; ajustar insumos sintéticos coerentemente; reler contexto/FS12/auditoria/RBT e iniciar nova intenção explícita, preservando requests anteriores. Preparação parcial em `.altan-governance/prepared-operations-batch-reprepare/`; revisar o arquivo existente antes de executar, sem reconstruir diagnóstico.

Depois: uma empresa com sucesso, uma recusa fiscal e uma resposta desconhecida, recarga/reinício sem reenvio. Reaproveitar `prepared-operations-batch-journey`, `prepared-batch-reconciliation` e roteiro parcial `prepared-factor-r-ui-transmission`; não tratar preparação como teste aprovado.

## Estado de execução e limites

- Controlador `runs/2026-11-25T15-16-43-581Z-4fa57639` interrompido pelo Principal enquanto aguardava complementares, conforme nova orientação incremental. Nenhum gate integral foi iniciado/aprovado neste run; journal e evidências preservados.
- Servidores sintéticos encerrados; PG54661 e bancos preservados. Nunca usar PG57514, reservado ao chat Comunicação.
- Três revisores/executores nativos atingiram limite de uso; não contabilizar suas tarefas incompletas como aprovadas.
- Regressões integrais ficam para integração. Homologação com provedor real, permissões produtivas, E3 e 2027 continuam pendentes. Nenhum merge, deploy ou ato fiscal real autorizado.
- Método atual: diagnóstico reaproveitado, escopo limitado, testes focais e revisão proporcional. Relato curto com funcionalidade, arquivos, testes, pendências, próximo incremento e PR/commit.
