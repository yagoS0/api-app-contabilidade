# Publicação do planejamento — 16/09/2026

Usuário aprovou a prévia e autorizou subir para main em produção. Esta autorização substitui a restrição de desenvolvimento em `planejamento-estudos-dev-2026-09-16.md`.

## Integração

- Estudos por operação, projeção mensal e reforma/créditos habilitados no cliente real e no fallback; exportação conjunta disponível nos cenários salvos.
- Preservados parâmetros em `entradas.formularioCenario.ajustes.estudos` e resultados em `resultado.estudosAvancados`.
- Gerador de Documentos do servidor passa a apresentar os estudos gravados, sem recalcular. Mantém compatibilidade com fotos anteriores, ausências, zeros, bases, alíquotas, créditos, procedência e pendências.
- PDFKit declarado diretamente no workspace web: o Docker instala somente esse workspace. Carregamento continua sob demanda.
- Sem nova migração ou rota. Permanecem os limites tributários registrados no documento da prévia. Endpoint agregado de carteira continua como evolução; consultas atuais por empresa preservadas.
- Main remota integrada antes da publicação, preservando os comunicados do WhatsApp e o contexto de ambos os lotes.

## Verificação e publicação

Testes de planejamento da API: 96 aprovados em oito suítes, incluindo compatibilidade e geração do PDF com estudos. Web: 482 testes aprovados em 33 suítes; um timeout sob concorrência passou isoladamente e na repetição completa. Build Vite aprovado, com os avisos preexistentes de tamanho de bundle. Parser JSX/no-undef e diff sem erros. PDF fictício do servidor gerado e conferido visualmente em cinco páginas, preservando detalhes dos três regimes e operações/créditos. CI do pull request será conferido antes da integração final.

Produção usa deploy automático do Railway a partir da main em `yagoS0/api-app-contabilidade`. Não usar `origin` local nem o workflow legado de DigitalOcean. A conclusão da publicação exige deployments de API e frontend no commit integrado e conferência de disponibilidade.
