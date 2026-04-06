# Workers module

Processos assíncronos para envio de e-mails de guias (PDFs no PostgreSQL).

## Workers atuais

- `guideEmailWorker.js`: envio de e-mails pendentes/erro com retry.

## Regras operacionais

- O worker usa lock no banco para evitar execução concorrente.
- Execução em loop e modo `--once` para jobs sob demanda.
- Retentativa de envio usa backoff exponencial para erros transientes.

## Scripts npm

- `npm run worker:guide-emails`
- `npm run worker:guide-emails:once`
