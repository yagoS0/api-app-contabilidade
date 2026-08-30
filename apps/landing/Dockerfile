# Landing page da Altan — HTML estatico servido pelo Caddy. NAO HA BUILD.
#
# ⚠ Diferente dos outros dois fronts: aqui nao existe Node, npm, Vite nem `packages/shared`.
# A pagina e um arquivo so, escrito a mao. Acrescentar um passo de build seria inventar cadeia
# de ferramenta para copiar quatro arquivos.
#
# ⚠ O CONTEXTO DE BUILD E A RAIZ DO MONOREPO, igual aos outros servicos — nao porque este precise
# alcancar `packages/`, mas para que o `Root Directory` deste servico no Railway seja o MESMO dos
# demais. Duas convencoes no mesmo projeto e o proximo build quebrado por configuracao.

FROM caddy:2-alpine
ENV PORT=8080
COPY apps/landing/Caddyfile /etc/caddy/Caddyfile
COPY apps/landing/index.html /usr/share/caddy/index.html
COPY apps/landing/assets /usr/share/caddy/assets
EXPOSE 8080
