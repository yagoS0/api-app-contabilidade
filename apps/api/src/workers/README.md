# Workers module

Processos assincronos para ingestao e envio de guias.

## Workers atuais

- `guideInboxWorker.js`: legado (Drive desativado); retorna `skipped`; use upload no portal.
- `guideEmailWorker.js`: envio de e-mails pendentes/erro com retry.
- `guideScheduledEmailWorker.js`: disparo agendado por agenda de empresa.

## Regras operacionais

- Cada worker usa lock no banco para evitar execucao concorrente.
- Execucao em loop e modo `--once` para jobs sob demanda.
- Retentativa de envio usa backoff exponencial para erros transientes.

## Scripts npm

- `npm run worker:guides`
- `npm run worker:guides:once`
- `npm run worker:guide-emails`
- `npm run worker:guide-emails:once`
- `npm run worker:guide-emails-scheduled`
- `npm run worker:guide-emails-scheduled:once`
