# NFS-e compartilhada — consulta de resultado

## Contrato do componente — 13/10/2026, PR #163

`ConsultaResultadoNfse.jsx`, exportado em `@contabilidade/shared/nfse-conciliacao`, é usado nos portais do contador e cliente. Recebe empresa, ID da tentativa persistida, função de consulta e callback de recuperação. Não recebe nem chama função de emissão e não monta DPS.

- Só apresentar consulta com empresa, tentativa e função válidas.
- Trava imediata por referência impede chamadas duplicadas antes do próximo render.
- Vincular resposta ao contexto da chamada. Troca de empresa/tentativa e desmontagem invalidam o resultado anterior, inclusive seu callback.
- Aceitar somente `MESMA`, `OUTRA` e `INCONCLUSIVA`; resposta desconhecida é falha de consulta.
- `MESMA` mostra recuperação de nota existente. Outros estados mantêm orientação de conferência; não reabilitam emissão nem alteram numeração.
- Erro legível não expõe stack ou JSON bruto. “Consultar resultado” jamais deve se tornar um botão de retry de emissão.

As regras de prova fiscal ficam no backend: `apps/api/src/application/nfse/CLAUDE.md`. Testes compartilhados exercitados pelos consumidores: `apps/portal-cliente-web/src/features/emitir/__tests__/consultaResultadoNfse.test.jsx`, `duplicidadeDps.test.jsx` na mesma pasta e `apps/web/src/features/notas/components/__tests__/consultasContador.test.jsx`. Ao alterar o componente/export, validar ambos os portais e seus builds, sem emissão real.
