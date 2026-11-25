# Candidato E2: cifra e stage local de resposta FS12

Status: preparado, não executado, não integrado, não aprovado. Nenhum transporte, Prisma ou estado fiscal é liberado. Dono: Fiscal. Impacto operacional: concretiza proteção de evidência R01/R02/R05/R06/R20 e seção38; sem nova regra fiscal, ACL ou decisão de negócio. R25/R26 intactas. Referência canônica e cópia versionada SHA256 99a27e4a2191f8243cffa662e18074ea92216bb4cad4ec0b08caa42d650cb745.

## Portas e limites de autoridade

criarCifraFs12({resolveKey}): resolvedor interno assíncrono keyId → Buffer de 32 bytes. Retorna buffer emprestado; o adaptador copia e zera sua cópia. A chave histórica deve continuar resolvível; não há keyring produtivo, fallback, env ou reaproveitamento implícito de certificados. Se o resolvedor usa KMS, a composição futura decide envelope-DEK e versão sem mudar os sete campos SQL.

cifrar({corpo:Buffer,contexto,keyId}) e decifrar({envelope,contexto}) preservam bytes (inclusive não UTF8). Somente o envelope cifrado deve ser persistido. Envelope exato DDL: v=1, alg=AES-256-GCM, keyId, nonce base64 canônico12bytes, ciphertext <=16777216bytes, tag16bytes, aadVersion=1. Sem campos adicionais. Limite inclusivo; vazio é byte string válida, não sucesso fiscal.

AAD: JSON UTF8 do array ["ALTAN_FS12_RESPOSTA",1,keyId,contextoOrdenado]. Ordem do contexto está fixada no código; mudança requer nova versão. Inclui resposta/comando/tentativa/reserva, PortalClient/Company/CNPJ/PA/revisão/intenção, status, instante observado, custodiante/capacidade e hashes do corpo/envelope/marcador. Hashes são SHA256 hex dos bytes para corpo e envelope; a composição deve definir serialização canônica única do marcador para marcadorHash. Não recalcular o corpo com JSON.stringify após observar bytes. A implementação de captura dos bytes e a definição do hash do marcador ainda pertencem ao coordenador.

Hash, AAD e nomes das portas NÃO autenticam uma fonte oficial. Não expor estas fábricas a navegador/rota. A composição futura deve obter identidade/capacidade do transporte autorizado e cadeia persistida; contexto de arquivo nunca concede autoridade.

criarStageRespostaFs12({root,cifra,io?,syncDirectory?}):
- root absoluto, existente, privado, local, sem symlink; nenhum caminho vem do cliente. A implantação precisa proteger ACLs e ancestrais contra alterações concorrentes. Verificações lstat/realpath não são sandbox contra administrador/processo com acesso de escrita à pasta.
- id = SHA256 UTF8 de respostaId. Diretório exclusivo por id, temporário criado wx, writeFile completo, sync do arquivo, close, rename para record.json no mesmo diretório, sync do diretório.
- io é porta de filesystem para teste/infra, nunca payload. syncDirectory padrão abre/sincroniza diretório; erro de plataforma é erro explícito. Windows pode não suportar: testes injetam syncProcessOnly retornando false, registrado em resultado. Isso prova no máximo reinício de processo, não falha de SO/energia. Nenhum fallback silencioso produtivo.
- Arquivos contêm somente contexto allowlist e ciphertext; nenhum header, token, credencial ou chave. Metadados não são secretos por criptografia: acesso à pasta deve ser restrito. Corpo cifrado pode conter dados fiscais; não logar.
- replay exige mesmo contexto autenticado e mesmos bytes, não ciphertext igual (nonce aleatório). Conflitos/corrupção falham sem sobrescrever. Replay de final após rename/fsync falho resincroniza pai e filho; directorySynced=true exige ambos retornarem true, inclusive na recuperação.
- temporário, diretório sem registro e arquivo desconhecido são pendências. Recuperação pode ler record.tmp COMPLETO somente quando não há record.json: valida estrutura, sincroniza o handle, confere origem persistida e autentica cifra/AAD antes de importar. Truncamento/tamper/chave ausente conservam o arquivo e recusam importação. Não promover temporário por rename, não completar bytes faltantes e não limpar por idade.
- reinício com arquivo final íntegro permite recuperação; falha antes da primeira escrita ou arquivo parcial mantém incerteza. Não promete perda zero. O caller deve reportar falha de stage sem redespacho.

recuperar({id,resolveOrigin,importDurably}):
- resolveOrigin({stageId,respostaId,comandoId,tentativaId,reservaId}) recebe pistas do arquivo, não autoridade. Deve localizar e reler cadeia persistida ORIGINAL, conferindo marcador, capacidade e identidade. Retorna EXATAMENTE os 14 campos: respostaId,comandoId,tentativaId,reservaId,portalClientId,companyId,custodianteId,capacidadeId,envelopeHash,marcadorHash,cnpj,competencia,revisaoFs12,intencao. Stage compara cada campo. T1 futuro prealoca respostaId em esperado.custodia={respostaId,custodianteId,capacidadeId}; stageId=SHA256(respostaId), mas o resolvedor não depende de inverter esse hash. Não aceitar eco das pistas como cadeia conferida.
- corpoHash/httpStatus/recebidoEm são OBSERVAÇÃO: inexistem antes da resposta e não são exigidos do banco durante recuperação. Vêm do stage, autenticados por AAD/tag e hash dos bytes. O produtor deve ser capacidade interna confiável; criptografia não transforma entrada de navegador em prova oficial. Revisão antiga permanece custodiável sem promoção.
- importDurably recebe id, contexto, corpo, envelope e contextHash. contextHash é SHA256 do JSON UTF8 do contexto validado na ordem fixa. Deve gravar/COMMITAR custódia idempotente por identidade/hash e reler/verificar replay no banco. Receipt obrigatório: {durable:true,id,corpoHash,contextHash,custodiaId}.
- Receipt é contrato de porta interna, não comprovação independente de commit pelo filesystem; nunca aceitar do cliente.
- somente após receipt exato remove o nome lido (record.json ou record.tmp) e sincroniza pai e filho. Se o produtor publicar final enquanto um recuperador processa tmp, o final permanece para replay idempotente; recuperação não remove nome diferente por suposição. Erro de remoção deixa registro recuperável. Commit seguido de queda antes da remoção provoca nova chamada idempotente. Outro recuperador que já removeu o MESMO registro imutável torna ENOENT admissível somente depois do próprio receipt.
- diretório permanece como tombstone conservadora: vazio NÃO prova commit nem conclusão fiscal. Não permite republicação. Exige conferência na custódia durável para interpretar ausência.
- recuperadores não têm lock expirável; podem chamar importDurably simultaneamente. Uma custódia exige unicidade/atomicidade no futuro adaptador Prisma, ainda não implementado/provado aqui. Não prometer exactly-once callback.
- o buffer corpo é zerado após callback: se precisar reter bytes, consumidor faz sua cópia dentro da operação.

## Ensaios preparados, não executados

apps/api/scripts/fs12-custody/custody.unit.test.mjs: formato, bytes, chave histórica, adulteração/AAD, limites, rollback simulado, receipt incompleto, erro de remoção, conflito, contexto errado, corrupção, traversal, disco cheio e temporário parcial.

apps/api/scripts/fs12-custody/custody.process.test.mjs: fork de processos reais; produtor termina antes do recuperador; queda explícita código23 depois de commit sintético antes de receipt/remoção; dois recuperadores leem antes da barreira e importam simultaneamente; proibição de HTTP via stubs. Chaves sintéticas passam por IPC, não arquivo/env/log. Sink filesystem sintético usa publicação exclusiva por hardlink e compara bytes; não substitui transação PostgreSQL/T3a. Testes explicitamente limitados a reinício de processo. Dependência do fixture: filesystem local com hardlinks.

Comando futuro, somente após incorporação e janela autorizada:
node --test apps/api/scripts/fs12-custody/custody.unit.test.mjs apps/api/scripts/fs12-custody/custody.process.test.mjs

Nenhum resultado de execução anexado. Revisão independente, ensaio PG real, permissões/runtime keyring/volume, armazenamento durável do marcador, T1/T2/T3a/T3b e integração de transporte permanecem pendentes. Reverter código deve conservar qualquer evidência; não há rotina de descarte/migração neste candidato.

## Correção de contrato após revisão independente (candidato v2, não executado)

O candidato anterior exigia contexto completo do resolvedor, circular quando a observação não chegou ao DB. Esse contrato foi substituído pela origem preexistente mais observação autenticada. Fixtures agora gravam origin.json antes de iniciar produtor; nenhum corpoHash/httpStatus/recebidoEm consta nessa origem. Recuperadores leem esse arquivo em processo novo pelas pistas, sem hardcode de resposta no resolvedor. Sink continua filesystem sintético, não prova de PostgreSQL.

Ensaio adicional preparado encerra processo com código24 precisamente ao entrar em rename (depois de write/fsync/close), inicia dois recuperadores e importa tmp completo autenticado. Testes unitários preparados verificam dados observados diferentes dos defaults, propagação de false/erro no fsync e replay que resincroniza diretórios. Nenhuma execução efetuada.

DDL real integrado permanece referência: keyId string com trim length1..200; não existe restrição ASCII1..100 nesta migration. Cifra permanece inalterada, com texto limitado a200; teste explícito aceita200 e recusa201. SQL admite ciphertext vazio: novo teste preparado cobre bytes vazios com hash/tag. Envelope mantém sete campos, v/aadVersion1, AES-256-GCM, nonce12/tag16, base64 canônico e limite inclusivo16MiB (22369624 caracteres base64 no máximo). Não houve alteração de schema nem import de fixture em produto.
Limite de plataforma para E2E futuro: a injeção syncProcessOnly é somente fixture; não pode ser apresentada como infraestrutura real no navegador/API/PG. No Windows, o ensaio integrado precisará adaptador real de plataforma que execute file fsync e reporte explicitamente indisponibilidade de directory fsync, restringindo sua garantia a reinício de processo. Linux/volume produtivo com sincronização estrita exige validação e configuração próprias. Esta preparação não implementa nem homologa esse adaptador.
