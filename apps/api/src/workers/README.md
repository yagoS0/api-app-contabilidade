# Workers module

Processos assíncronos para envio e agendamento de e-mails de guias (PDFs no PostgreSQL).

## Workers atuais

- `guideEmailWorker.js`: envio de e-mails pendentes/erro com retry.
- `guideScheduledEmailWorker.js`: disparo agendado por agenda de empresa.
- `guideScheduledEmailManager.js`: aplica `guideScheduleCron` das settings no processo da API.

## Regras operacionais

- Cada worker usa lock no banco para evitar execução concorrente.
- Execução em loop e modo `--once` para jobs sob demanda.
- Retentativa de envio usa backoff exponencial para erros transientes.

## Scripts npm

- `npm run worker:guide-emails`
- `npm run worker:guide-emails:once`
- `npm run worker:guide-emails-scheduled`
- `npm run worker:guide-emails-scheduled:once`
