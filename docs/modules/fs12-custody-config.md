# Configuração da custódia FS12 — E2

Estado: preparação local não executada. Não representa ativação ou homologação produtiva.
Impacto operacional: implementação da seção38 e R02/R06/R19/R20; sem nova regra fiscal ou alteração de permissões.

A API prepara a capacidade antes de aceitar requisições. Configuração ausente, inválida ou armazenamento indisponível conserva os atos dependentes de FS12 bloqueados com motivo específico. Não encerra a API inteira, não altera competências antigas e não realiza chamada fiscal para testar a capacidade.

| Configuração central | Contrato |
| --- | --- |
| FS12_CUSTODY_ROOT | Caminho absoluto de diretório privado, previamente provisionado em volume persistente. Não usar diretório efêmero do container. |
| FS12_CUSTODY_ACTIVE_KEY_ID | Identificador exato da chave ativa, texto aparado de 1–200 caracteres sem controles. |
| FS12_CUSTODY_KEYRING_JSON | Array de objetos estritos id/keyBase64. Cada chave AES256 tem 32 bytes em base64 canônico; IDs duplicados recusados. Não registrar conteúdo nos logs. |
| FS12_CUSTODIAN_ID | Identidade estável do custodiante desta instalação, fornecida pelo servidor. |
| FS12_CAPABILITY_ID | Identidade estável da capacidade de custódia vinculada à cadeia original. |
| FS12_CUSTODY_DURABILITY | DIRECTORY_SYNC_REQUIRED por padrão. PROCESS_RESTART_ONLY só aceito em NODE_ENV=test. |

Rotação preserva todas as chaves históricas necessárias a envelopes/respostas existentes. Chave desconhecida não usa automaticamente a ativa. Não reutilizar CERT_SECRET_KEY. Não gravar chave junto do stage ou em documentação. Restaurar backup do banco sem as chaves e o volume correspondente pode impedir recuperação; essa dependência deve integrar o procedimento de implantação e recuperação.

O adaptador tenta sincronização real de diretórios. Em Windows, exclusivamente no modo de teste explícito, erros conhecidos de operação não suportada podem produzir directorySynced=false. Os testes de reinício de processo devem conservar essa limitação: não comprovam recuperação após pane do SO, disco ou energia. Não existe fallback produtivo que transforme false em true.

A verificação do diretório recusa links simbólicos e valida acesso, mas não provisiona ACL Windows, backup, volume físico ou exclusividade administrativa. Tais aspectos pertencem à implantação concreta. Não concluir prontidão produtiva a partir de mode bits ou ensaio local.

Configuração e status nunca expõem keyring, caminhos ou erro bruto. Uma falha do logger após instalação não destrói chaves do runtime. Leituras documentais e registros de intervenção permanecem separados de autorização para novo despacho.

Validação pendente: parser/rotação/chave histórica, configuração inválida, ciclo de vida do logger, armazenamento real da plataforma, stage→PostgreSQL com falha e reinício, bootstrap completo da API e regressão. Nenhum teste foi executado durante a preparação deste pacote.
