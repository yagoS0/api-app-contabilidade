# CLAUDE.md — Portal Contábil

Instruções e contexto para o Claude Code neste projeto.

## Visão Geral

Portal contábil full-stack multi-tenant para gestão de documentos fiscais brasileiros (NFe, NFS-e, guias).

**Dois perfis de uso:**
- **Escritório:** gerencia carteira de empresas clientes
- **Cliente:** gerencia seus próprios documentos fiscais

## Monorepo — Estrutura

```
apps/api/         - Backend Node.js/Express (porta 3000)
apps/web/         - Frontend React/Vite
apps/pdf-reader/  - Serviço Python/FastAPI de parsing de PDF (porta 8000)
packages/shared/  - Contratos e tipos compartilhados
```

Cada app tem seu próprio `CLAUDE.md` com regras específicas.

## Tech Stack

| Camada     | Tecnologia                              |
|------------|-----------------------------------------|
| Backend    | Node.js 20, Express.js, Prisma, PostgreSQL |
| Frontend   | React 19, Vite, TailwindCSS             |
| Parser     | Python 3.12, FastAPI, pdfplumber        |
| Auth       | JWT + RBAC                              |
| Email      | Gmail API (delegação) / Nodemailer SMTP |
| Deploy     | Railway / DigitalOcean + Docker + GitHub Actions |

## RBAC

- **FIRM:** `ADMIN`, `ACCOUNTANT`, `STAFF`
- **CLIENT:** `OWNER`, `ADMIN`, `USER`

Rotas protegidas pelo middleware `requireRole`. Nunca bypassar sem motivo explícito.

## Progresso e Histórico de Mudanças

### Em andamento (branch `dev`)

- [x] Módulo de lançamentos contábeis — base completa
  - Schema Prisma + migrations `20260410`, `20260411`
  - Plano de contas (CRUD + importação CSV/PDF)
  - OFX import, export CSV, baixa de provisões, circular anual
- [ ] Sistema de históricos persistentes (`AccountingHistorico`)
  - Schema adicionado (migration `20260413`)
  - Backend: 4 rotas (`/historicos` GET, GET by-code, POST, DELETE)
  - Auto-save ao criar lançamento (scope COMPANY por padrão)
  - Frontend: autocomplete por API no campo histórico
  - Frontend: sugestão de histórico ao digitar código D/C
  - Campos D/C agora aceitam qualquer código (free-form)
  - Promoção de COMPANY → GLOBAL: pendente (tela de gerenciamento de históricos)

### Concluído (main)

- [x] Autenticação JWT com workflow de aprovação por admin
- [x] Sincronização NFe via XML (import + parsing)
- [x] Emissão e consulta de NFS-e com certificado A1
- [x] Integração ADN para sync de NFS-e
- [x] Upload e parsing automático de guias PDF
- [x] Envio em lote de guias por email (worker background)
- [x] Multi-tenant: `CompanyFirmAccess` vinculando empresas a escritórios
- [x] Rota `/firm` com gestão de clientes, guias, NFS-e
- [x] PDF reader Python integrado como serviço separado
- [x] Deploy Railway com Dockerfile e variáveis de ambiente

## Princípios de trabalho (INEGOCIÁVEIS)

> Definidos pelo dono do projeto. Valem pra qualquer tarefa, em qualquer arquivo.

1. **NÃO INVENTAR NADA.** Não chutar valores, IDs, nomes de campo, endpoints,
   regras fiscais, alíquotas, estruturas de payload de API, nem comportamento de
   integração. Se um dado é externo (SERPRO, SEFAZ, RFB, gov.br) e não está
   confirmado por documentação oficial ou pelo dono, **não preencher por suposição**.
2. **O QUE NÃO SOUBER, PERGUNTAR.** Diante de incerteza sobre um requisito, um
   dado fiscal, um ID de atividade, um campo de API ou o efeito de uma ação —
   **perguntar ao dono antes de codar/executar**, não adivinhar.
3. **MARCAR O NÃO-VERIFICADO.** Quando algo só puder ser confirmado em ambiente
   externo (ex: `idAtividade` do PGDAS-D no trial), deixar explícito no código
   (ex: flag `verificadoTrial: false`) e avisar — nunca tratar como certo.
4. **FONTE OFICIAL VENCE.** Documentação oficial (apicenter SERPRO, manuais RFB,
   LC 123/06) tem prioridade sobre memória, exemplos de terceiros ou inferência.
5. **NUNCA transmitir/gravar ato fiscal por suposição.** Transmissão PGDAS-D,
   manifestação, emissão — só com dados confirmados e confirmação explícita.

## Regras Gerais

- Sempre considerar o contexto fiscal brasileiro (NFe, NFS-e, SEFAZ)
- Respeitar multi-tenancy: nunca vazar dados entre escritórios/clientes
- Não remover validações de CNPJ, certificado A1, ou regras fiscais
- Preferir editar arquivos existentes a criar novos
- Não adicionar abstrações desnecessárias — três linhas duplicadas são melhores que uma abstração prematura
