# Desenvolvimento local no Windows

Preparado em 05/10/2026, em `C:\Users\yagoa\code\api-app-contabilidade`.

## Regra de trabalho definida pelo usuário

Implementar e corrigir somente em desenvolvimento, na branch `codex/adequacao-nfse-rtc`. Não fazer merge/push para `main`, deploy ou alterações de produção sem autorização explícita posterior do usuário. A autorização de desenvolvimento não autoriza emissão fiscal externa.

## Validação completa do XML

Além da suíte estrutural, executar o job XSD completo com Python e `lxml`:

```powershell
python -m pip install -r scripts/requirements-nfse-xsd.txt
$env:NFSE_XSD_PYTHON = (Get-Command python).Source
$env:PYTHONIOENCODING = 'utf-8'
cd apps/api
node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns=dpsContraXsd
```

Neste computador foi usado o Python do runtime local, com `lxml 6.1.1`. O job valida as DPS geradas contra o pacote oficial de 27/07/2026 e inclui assinatura real com chave sintética de teste, conferência criptográfica e contraprova de adulteração. Não substitui validação de cadeia ICP-Brasil nem autorização da SEFIN. Sem `NFSE_XSD_PYTHON`, a suíte comum executa somente a verificação estrutural em JavaScript.

A migration `20261005220000_nfse_contrato_e_dps` foi aplicada apenas ao PostgreSQL local. Acrescenta contrato, DPS assinada e configuração fiscal à emissão. No Windows, parar a API antes de gerar novamente o Prisma Client evita bloqueio da DLL em uso.

## Ferramentas

- Node 20.20.2 e npm 10.8.2 em `C:\Users\yagoa\code\.tools\node-v20.20.2-win-x64`, compatíveis com `apps/api/package.json`. ZIP oficial conferido contra SHA-256 do nodejs.org. Node/npm e o Git existente foram adicionados ao PATH do usuário; abrir novo terminal para carregar.
- PostgreSQL 16.15 portátil em `C:\Users\yagoa\code\.tools\postgresql16`. Banco `contabilidade_dev` em `127.0.0.1:5433`, com autenticação SCRAM e dados em `.local/postgres-data`.
- Dependências npm instaladas por `npm ci`, preservando o lockfile. Prisma Client gerado e migrações aplicadas ao banco novo.
- Leitor de PDF em `apps/pdf-reader/.venv`, criado com o Python 3.12 fornecido pelo runtime local do Codex. Esse ambiente depende da instalação base em `C:\Users\yagoa\.cache\codex-runtimes\codex-primary-runtime\dependencies\python`; se ela mudar, recriar a venv.

## Uso

No PowerShell:

```powershell
cd C:\Users\yagoa\code\api-app-contabilidade
powershell -ExecutionPolicy Bypass -File .\scripts\dev-windows.ps1 start
powershell -ExecutionPolicy Bypass -File .\scripts\dev-windows.ps1 status
powershell -ExecutionPolicy Bypass -File .\scripts\dev-windows.ps1 stop
```

O script inicia processos ocultos sob demanda; não instala serviço automático de boot. Logs e PIDs ficam em `.local`, ignorada por `.git/info/exclude`. O backend exige reinício após alterações de código; Vite tem recarga automática.

| Serviço | Endereço | Modo |
|---|---|---|
| Contador | http://127.0.0.1:5173 | API local real, banco novo |
| Portal do cliente | http://127.0.0.1:5174 | Mock, dados fictícios |
| API | http://127.0.0.1:3000/healthz | Local |
| Readiness | http://127.0.0.1:3000/readyz | Banco e leitor PDF |
| PDF | http://127.0.0.1:8000/health | Local |

Usuário local criado: `admin@contabilidade.local`. A senha aleatória está somente em `apps/api/.env`, campo `ADMIN_PASSWORD`. Não versionar esse arquivo. O banco começa sem empresas/clientes de produção.

As configurações locais usam NFS-e em homologação, sem endpoint/certificado fiscal e sem credenciais de integrações. Flags fiscais externas permanecem desligadas. Os serviços de manutenção interna iniciados pelo servidor trabalham apenas sobre o banco local.

## Comandos de manutenção

```powershell
. .\scripts\dev-windows.ps1 shell
npm.cmd ci
npm.cmd run prisma:generate
npm.cmd run prisma:migrate:deploy -w @contabilidade/api
npm.cmd run build
cd apps/api
node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns=application/nfse
```

Para recriar o admin, em `apps/api`: `node --env-file=.env prisma/seed.js`. Isso usa exclusivamente o DATABASE_URL local configurado. Não restaurar dados ou credenciais de produção neste ambiente.

O plano fiscal fica em [plano-nfse-2026-10-05.md](plano-nfse-2026-10-05.md).

## Verificação realizada

- Migrações existentes aplicadas com sucesso ao PostgreSQL local vazio.
- Login do admin local validado, sem imprimir token ou senha.
- API `/healthz`, `/readyz`, leitor PDF e ambas as interfaces responderam HTTP 200. Readiness confirmou banco e leitor disponíveis.
- Ciclo `stop` → `start` validado; serviços deixados em execução.
- Backend: 41 suítes e 862 testes aprovados (NFS-e, IBS/CBS, NBS e payload).
- Interface do contador: 12 suítes e 261 testes aprovados (NFS-e e perfil).
- Build dos workspaces aprovado; permanecem avisos de bundles maiores que 500 kB.
- Logs em `.local/nfse-tests.log`, `.local/web-nfse-tests.log`, `.local/build.log`, `.local/migrations.log`. Dependências Python resolvidas registradas em `.local/pdf-reader-installed.txt`.

Essas verificações cobrem o ambiente e a base existente. Não houve emissão fiscal externa, homologação com certificado nem execução da suíte completa de todos os módulos.
