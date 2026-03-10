# Infrastructure module

Camada de adaptadores para recursos externos.

## Responsabilidades

- Acesso a banco de dados via Prisma.
- Integracao com Google Drive/Sheets/Gmail.
- Envio de e-mail via Gmail API ou SMTP.
- Storage de certificados e arquivos auxiliares.
- Persistencia de status/telemetria operacional.

## Principais pastas

- `db/`: repositorios e cliente Prisma.
- `drive/`: operacoes em pastas/arquivos de guias.
- `google/`: bootstrap de clientes Google.
- `mail/`: implementacao do `EmailService`.
- `storage/`: persistencia de certificado por empresa.
- `status/`: logs de execucao e indicadores.

## Contrato com a camada application

- `application` depende de interfaces/comportamentos.
- `infrastructure` implementa detalhes tecnicos (SDKs, drivers, I/O).
