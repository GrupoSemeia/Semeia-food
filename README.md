# Yracema Gestão (MVP)

Sistema integrado de gestão operacional para a rede **Hot Dog Yracema** (7 lojas próprias, cozinha central em Curitiba).
Substitui as planilhas de Excel/WhatsApp no **pedido diário de produção** e no **fechamento de caixa**, com **relatórios** exportáveis em Excel.

- **Stack:** Cloudflare Workers + [Hono](https://hono.dev) (API) · Cloudflare **D1** (banco SQLite) · PWA em JavaScript puro (instalável no celular, funciona offline). Sem etapa de build no front.
- **Desenvolvimento:** Claude Code + GitHub (`gruposemeia/semeia-food`).

## Módulos

| Módulo | Onde | O que faz no MVP |
|---|---|---|
| Autenticação e perfis | `src/auth.ts`, `src/modules/auth.ts` | Login (JWT), 5 perfis: gerente, financeiro, administração, diretor, proprietário. Gerente só vê a própria loja. |
| Cadastros | `src/modules/admin.ts` | Lojas (nova unidade = 1 cadastro), catálogo de ~85 produtos por categoria, usuários. |
| Pedido de produção | `src/modules/orders.ts` | Gerente lança o pedido da loja; trava na hora em que a produção do dia começa; **consolidação automática** por produto e por loja (acabou a planilha manual e a "limpeza" diária). |
| Fechamento de caixa | `src/modules/closings.ts` | Recebimentos por forma de pagamento (dinheiro, PIX, crédito, débito, voucher, iFood), sangrias, despesas, cancelamentos, estornos, totais do sistema/maquininha e **conferência automática de divergências**; financeiro confere e trava. |
| Relatórios | `src/modules/reports.ts`, `src/xlsx.ts` | Diário, semanal, mensal, por loja e por produto; **exportação em Excel (.xlsx)**. |
| Painel (dashboard) | `src/modules/reports.ts` | Lojas sem pedido / sem fechamento, faturamento do dia, divergências. |
| App mobile (PWA) | `public/` | Mobile-first, instalável, **offline** com fila de envio automática. |

### Regras de conferência do caixa
- `diferença sistema` = soma dos recebimentos − total do relatório do sistema (Connect Plug)
- `diferença maquininha` = (crédito + débito) − total do relatório da maquininha
- `diferença caixa` = dinheiro contado − (dinheiro recebido − sangrias − despesas)
- Cancelamentos e estornos são informativos (o sistema de caixa já os desconta das vendas).

> Premissas a validar com o cliente: horário em que o pedido trava (`ORDER_CUTOFF`, padrão 06:00 do dia da produção); que a maquininha cobre crédito+débito; que despesas saem do dinheiro do caixa.

## Fase 2 (fora do MVP)
Estoque central/por loja, inventário e perdas · produção por setor e lista do motorista · alertas (push/WhatsApp) · dashboard financeiro (lucro, despesas, consumo) · anexos de fotos/comprovantes (R2) · integração Connect Plug / iFood.
Veja [`docs/proposta-comercial.md`](docs/proposta-comercial.md) e a versão com a identidade visual do Grupo Semeia Digital: [`docs/proposta-comercial.html`](docs/proposta-comercial.html) / [PDF](docs/proposta-comercial-yracema-gestao.pdf).

## Rodando localmente
```bash
npm install
echo 'JWT_SECRET=troque-por-um-segredo-longo-local' > .dev.vars   # só para rodar localmente
npm run db:migrate:local     # cria o banco D1 local
npm run dev                  # http://localhost:8787
node scripts/seed-demo.mjs   # (opcional) lojas/produtos de exemplo; login dono@yracema.demo / demo123
npm test                     # teste de fumaça da API (use banco local limpo)
```
No primeiro acesso sem usuários, a tela de login pede para criar o **proprietário**.

## Deploy na Cloudflare
Publicado na conta **Grupo Semeia Digital**: https://yracema.gruposemeiadigital.workers.dev (Worker `yracema`, banco D1 `yracema`).

Para publicar de novo, ou em outra conta:
```bash
npx wrangler login
npx wrangler d1 create yracema            # copie o database_id para wrangler.toml
npm run db:migrate:remote
openssl rand -base64 48 | npx wrangler secret put JWT_SECRET   # obrigatório: sem ele o login não funciona
npm run deploy                            # embute public/ no Worker e publica
```
O front (`public/`) é embutido no Worker por `scripts/build-static.mjs` (gera `src/static.ts`, que não vai para o git).
Custo esperado nessa escala: dentro do plano gratuito/US$ 5 da Cloudflare.

## Estrutura
```
migrations/   schema D1 (SQL versionado)
src/          API (Worker): index.ts, auth.ts, xlsx.ts, modules/*
public/       PWA: index.html, app.js, style.css, sw.js, manifest.json
scripts/      smoke.test.mjs, seed-demo.mjs
docs/         requisitos e proposta comercial
```
