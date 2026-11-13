# Ambiente de desenvolvimento da Altan

Neste workspace, o checkout principal é `api-app-contabilidade`. Novas worktrees ficam em `worktrees/<assunto>-<AAAAMMDD>`, ao lado do checkout principal. A branch deve identificar a entrega, por exemplo `codex/ajuste-cadastro-20261112`. Pastas antigas continuam nas localizações atuais. A pasta do chat pode guardar relatórios privados e evidências de trabalho. Não crie clones adicionais para o trabalho paralelo. Um checkout homônimo em outra pasta, por exemplo em `~/code`, pode ter o mesmo remoto e outra base Git.

## Escolher a árvore

1. No checkout de referência, confira `git remote -v`, `git worktree list --porcelain`, `git branch -vv` e a base de integração aprovada. Confira a atualidade da referência remota antes de escolher o SHA. Para retomar um PR, compare branch, SHA e destino com o PR. Use o título e a descrição do PR para a finalidade e a branch de origem para localizar o número no repositório. Até a abertura, o nome da branch e o pedido identificam a entrega. Evite criar um segundo cadastro de PRs.
2. Antes de reutilizar uma árvore, confira `git status --short --branch --untracked-files=all`, `git ls-files --others --ignored --directory --exclude-standard` e o trabalho em curso com o responsável. Reutilize a árvore da própria entrega quando puder preservar seu estado. Branch ocupada por outra worktree, mudança de escopo, origem incerta e trabalho concorrente pedem uma árvore independente.
3. Para nova entrega, use uma base explícita e registre seu SHA. Na árvore nova, confirme remoto, raiz, branch e SHA antes de editar. Abra essa mesma raiz no Zed pela ação de abrir pasta. Confira `git rev-parse --show-toplevel` e `git status --short --branch` no terminal do editor. Preserve as preferências e instruções globais do Zed.

### Exemplo de criação no Windows

No PowerShell, parta do checkout principal e substitua o assunto e a base pelos da entrega. O exemplo usa o layout local indicado acima. Informe a raiz física da instalação Altan autorizada. O exemplo exige a pasta `worktrees` já provisionada, verifica o diretório Git compartilhado da instalação, a identidade do remoto e a referência publicada. Uma base divergente exige reconciliação antes de criar a árvore. Para uma árvore existente, siga o procedimento de reutilização.

```powershell
$ErrorActionPreference = 'Stop'
$workspace = (Get-Item -LiteralPath (Read-Host 'Raiz física autorizada do workspace Altan')).FullName
function PhysicalPath([string]$path) {
    $physical = node -e "console.log(require('node:fs').realpathSync(process.argv[1]))" "$path"
    if ($LASTEXITCODE -ne 0) { throw "Caminho físico indisponível: $path" }
    return $physical
}
$repo = (git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { throw 'Checkout Git indisponível.' }
$authorizedRepo = Join-Path $workspace 'api-app-contabilidade'
if ((PhysicalPath $repo) -ne (PhysicalPath $authorizedRepo)) { throw 'Checkout fora da instalação autorizada.' }
$common = (git rev-parse --path-format=absolute --git-common-dir)
if ($LASTEXITCODE -ne 0 -or (PhysicalPath $common) -ne (PhysicalPath (Join-Path $authorizedRepo '.git'))) { throw 'Diretório Git compartilhado inesperado.' }
$remote = (git remote get-url origin)
if ($LASTEXITCODE -ne 0 -or $remote -cnotin @('https://github.com/yagoS0/api-app-contabilidade.git', 'git@github.com:yagoS0/api-app-contabilidade.git')) { throw 'Remoto inesperado.' }
$parent = Get-Item -LiteralPath (Join-Path $workspace 'worktrees') -ErrorAction Stop
if (!$parent.PSIsContainer -or $parent.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Confira o destino físico da pasta worktrees.' }
$slug = 'ajuste-cadastro-20261112'
if ($slug -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$' -or $slug -eq 'altan-regras-operacionais') { throw 'Nome inválido ou reservado.' }
$destino = Join-Path $parent.FullName $slug
if (Get-ChildItem -LiteralPath $parent.FullName -Force | Where-Object Name -eq $slug) { throw 'Destino ocupado. Confira a árvore existente.' }
$base = (git rev-parse --verify 'origin/main^{commit}')
if ($LASTEXITCODE -ne 0) { throw 'Base de integração indisponível.' }
$advertised = (git ls-remote --exit-code origin refs/heads/main)
if ($LASTEXITCODE -ne 0 -or ($advertised -split '\s+')[0] -ne $base) { throw 'Referência local diverge da main remota ou a consulta falhou.' }
git worktree add -b "codex/$slug" "$destino" "$base"
if ($LASTEXITCODE -ne 0) { throw 'Confira destino, branch e registro de worktrees.' }
Set-Location -LiteralPath $destino
git rev-parse --show-toplevel HEAD
git status --short --branch
```

## Verificar a referência operacional efetiva

O controlador escolhe a raiz da worktree quando ela contém `docs/governance/gates.json` e `domains.json` no mesmo diretório. Em checkouts anteriores à governança, pode usar a raiz do runtime que o iniciou. A referência `canonical` em `docs/governance/operational-reference.json` é relativa à raiz de governança escolhida. Em `worktrees/<assunto>`, `../altan-regras-operacionais` passa pela junção reservada `worktrees/altan-regras-operacionais`, que aponta para a pasta de regras ao lado do checkout principal.

Execute o exemplo na nova worktree com o runtime versionado. Ele confere o destino físico da referência contra a autoridade do workspace e valida a cópia versionada que a CI lê em um clone independente.

```powershell
node --input-type=module -e "import {realpathSync} from 'node:fs'; import {resolve} from 'node:path'; import {resolveOperationalReference as read} from './scripts/governance/operational.mjs'; const local=read(process.cwd()), ci=read(process.cwd(),{fallbackOnly:true}); const esperado=realpathSync(resolve('../../altan-regras-operacionais/REGRAS_OPERACIONAIS.md')); if(local.source!=='canonical'||realpathSync(local.path)!==esperado||local.sha256!==ci.sha256) throw Error('Reconciliar a referência operacional'); console.log(local.source, esperado, local.sha256, ci.source, ci.sha256)"
```

Na base `4b1b071`, a fonte canônica e a cópia versionada têm SHA-256 `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`. Em revisões posteriores, vale a impressão aprovada em `snapshotSha256` da base escolhida. Uma junção ausente pode levar o resolvedor a aceitar `repositoryFallback`. No workspace Altan, investigue essa ocorrência, um destino inesperado ou divergência de hash antes de alterar o produto. Preserve a junção e o arquivo de referência.

## Preservação e eventual arquivamento

Mantenha o material no local durante a triagem. Consideram-se também arquivos ignorados e não rastreados, alterações no índice, commits exclusivos, refs locais, cópias externas, históricos do controlador, evidências e bancos PostgreSQL. Um PR integrado ou um status limpo não identifica tudo isso. Não remova nem mova árvores, não faça limpeza de ignorados, poda de worktrees ou descarte de branches, caches, logs, patches e clusters como parte da organização. Mantenha arquivos .env, certificados, credenciais, logs e dados fiscais em área privada. Antes de arquivar um cluster, confira o serviço e o processo que o utilizam. A presença ou ausência de postmaster.pid não determina, isoladamente, que seja seguro removê-lo. Compare patches e diffs com sua base e reproduza sua aplicação em cópia isolada para verificar alterações exclusivas.

Para propor um arquivo, registre origem, destino privado proposto, responsável, relação com PR ou tarefa, conteúdo exclusivo e como verificar a restauração. Identifique processos que usem a pasta e diferenças entre a árvore, o índice e os commits. Qualquer transferência, remoção ou descarte exige decisão própria e cópia recuperável verificada. Este guia não executa arquivamento.

A entrega fica pronta para revisão quando o checkout, a base, o PR quando existente, o diff previsto, os testes e o destino das pendências estiverem identificados; na instalação local, confirme também o caminho e o hash operacionais. Registre pendências e trabalho local preservado no registro de impacto existente da entrega. A conclusão da tarefa não autoriza limpeza.
