# Acesso do cliente por código e revisão de autenticação

## Escopo
Pedido do dono em 24/09/2026, após publicar os relatórios do cliente. Implementação em branch própria; não publicar este login automaticamente. A senha continua como alternativa. O código usa o e-mail do usuário de acesso, não o e-mail geral da empresa ou um contato de cobrança.

## Fluxo
Entrar com código por e-mail → informar endereço → código de 8 dígitos → sessão. Código criptograficamente aleatório, válido por 10 minutos, até cinco erros, um uso. Reenvio após 60 segundos, até cinco emissões por endereço em uma hora, persistido no banco e protegido contra concorrência. Um reenvio aceito invalida o anterior. Respostas não dizem se o usuário existe; envio ocorre após resposta e nunca há token/código no JSON público ou log.

Somente User ativo, accountType CLIENT, sem papel admin/contador e com CompanyClientUser ativo. Não cria usuários, não promove privilégios, não concede acesso FIRM. Na confirmação, revalida vínculo, e-mail, status e versão da senha. Cada rota da empresa mantém sua própria autorização.

## Revisão e correções
- Refresh JWT era aceito pelo verificador usado nas rotas comuns: separar tipo de token, fixar HS256, exigir expiração e sujeito, conservar validação de audiência.
- Tokens emitidos passam a carregar uma versão criptográfica da credencial: troca de senha invalida acesso e refresh anteriores. Não se guarda ou transmite o hash bcrypt no token.
- Sessões CLIENT novas têm vínculo com o token de acesso; revogação do dispositivo invalida também esse acesso.
- Rotação do refresh opaco usava leitura seguida de atualização incondicional: consumo condicional permite só um vencedor.
- Link de recuperação usava validação fora da transação: consumo condicional e transação serializável impedem dois usos simultâneos; usuário inativo é recusado.
- Autorizador retornava objeto HTTP em algumas recusas: retornar falso impede que chamadores tratem 403 como autorização.
- Login/código/logout/recuperação nunca usam fallback de API real para demonstração.
- Logout do portal passa a enviar seu refresh para revogar a sessão.
- Respostas de autenticação recebem Cache-Control no-store; troca de senha recebe limite de tentativas por IP.
- Signup responde de forma uniforme para conta existente e pedido novo, sem revelar status da conta.
- Entrada de e-mail/senha tem validação de tipo e limites de tamanho nas rotas.

## Implantação
Aplicar migration aditiva 20260924220000_email_login_challenges e gerar Prisma antes da API. Transporte de e-mail usa o EmailService já configurado, sem nova credencial. JWT_SECRET precisa permanecer estável e privado; rotação invalida códigos e versões de credencial.

Tokens antigos de banco sem versão da credencial serão recusados: sessões com refresh opaco ainda válido podem se renovar automaticamente; as demais precisam de novo login. Isso alcança autenticação compartilhada com o contador. Contas de bootstrap por ambiente mantêm senha; permissões são relidas da configuração. Não ativar em produção sem validar este comportamento.

## Limites explícitos
Esta é uma revisão das rotas e testes do repositório, não um pentest da infraestrutura. Código por e-mail depende da segurança da caixa postal e pode ser alvo de phishing; não equivale a passkey nem MFA. Usuários do escritório não recebem acesso por código. Contas Client legadas continuam no login por senha.

Limites por IP e o bloqueio do login por senha usam memória da instância; em múltiplas réplicas, precisam de armazenamento compartilhado. O limite por endereço e consumo do código novo é durável. O remetente e a entrega em spam precisam de validação operacional; testes não enviam mensagens reais. Falha do transporte após resposta fica registrada sem dados sensíveis e permite nova tentativa pelo usuário.

O portal conserva tokens no armazenamento do navegador: endurecimento completo contra XSS e migração para cookies HttpOnly exigem uma evolução separada de todos os consumidores. CORS e HTTPS dependem da configuração de produção. Nenhuma dessas propriedades foi presumida apenas porque os testes passaram.

## Validação
Testes de serviço, HTTP, JWT e interface adicionados. Ensaio verify-email-login-postgres.js usa somente banco local descartável terminado em _check, cria fixtures isoladas e não envia e-mails. Evidências executadas estão registradas abaixo.

Mensagens de autenticação exigem TLS no transporte SMTP; Gmail usa sua API HTTPS. O transporte omite o destinatário nos logs desses envios. A consulta de vínculo também é executada para endereço desconhecido, sem depender do tempo do provedor para responder.

## Evidências concluídas
- 55 testes locais de API, código, JWT, transporte e recuperação aprovados; 9 testes da tela e proibição de fallback aprovados.
- Schema Prisma válido; build do portal aprovado.
- CI 36064832583 aprovado integralmente, incluindo o ensaio com PostgreSQL real de concorrência de emissão, código, refresh e recuperação.
- Navegador local: código incorreto recusado, correto abre o portal. Tela a 390 px sem transbordamento, campos de 44 px e fonte de 16 px.
- Relatórios anteriores publicados na main pelo PR 85, commit 38a742ace7baec440ecfa451dad7dcc6b50fbcab, com sucesso dos três serviços Railway. Login fica no PR 87 em rascunho.

## Rotas conferidas
| Rota | Controle principal |
| --- | --- |
| POST /auth/signup | Tipos, senha forte, limite por IP e resposta uniforme |
| POST /auth/login | Bcrypt, limite por IP/conta, estado do usuário, sem fallback de demonstração |
| POST /auth/email-code/request | Endereço de acesso, elegibilidade, limite durável, resposta genérica |
| POST /auth/email-code/verify | Prazo, cinco erros, uso único serializável, vínculo e credencial revalidados |
| POST /auth/refresh | Tipo de token, versão da senha, sessão válida, rotação condicional |
| GET /auth/me | Token de acesso e usuário ativo; nenhuma chave de API como alternativa |
| POST /auth/logout | Revogação do refresh da própria pessoa, acesso vinculado à sessão |
| POST /auth/change-password | Sessão, senha atual/forte, limite por IP, revogação e auditoria |
| POST /auth/forgot-password | Resposta genérica antes do transporte, limite por IP, configuração do envio |
| POST /auth/reset-password | Token hash/expiração/uso único, estado ativo, transação e revogação |
