# Landing page da Altan — HTML estatico servido pelo Caddy. NAO HA BUILD.
#
# ⚠ Diferente dos outros dois fronts: aqui nao existe Node, npm, Vite nem `packages/shared`.
# A pagina e um arquivo so, escrito a mao.
#
# ⚠⚠ O CONTEXTO DE BUILD E ESTA PASTA, E ISSO E O CONTRARIO DOS OUTROS DOIS SERVICOS -- de
# proposito, e o motivo esta MEDIDO:
#
#   - `apps/portal-cliente-web` e `apps/web` PRECISAM da raiz do repo porque importam
#     `@contabilidade/shared` (a lista do IBGE). Um contexto menor nao alcanca `packages/`.
#   - Esta pagina nao importa NADA. E se o Root Directory dela fosse a raiz, o Railway leria o
#     **`railway.toml` DA RAIZ** -- que constroi a API (`dockerfilePath = "./Dockerfile"`) e exige
#     healthcheck em `/healthz`. O servico da landing construiria a API e falharia no healthcheck,
#     porque o Caddy nao serve essa rota.
#
# Ou seja: copiar a convencao dos outros aqui QUEBRA o deploy. Root Directory = `apps/landing`.

FROM caddy:2-alpine
ENV PORT=8080
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html /usr/share/caddy/index.html
COPY assets /usr/share/caddy/assets
EXPOSE 8080
