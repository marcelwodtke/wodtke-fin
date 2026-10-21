# Wodtke Finanças

Planejador de fluxo de caixa: saldo projetado dia a dia por 12 meses, mapa de calor do ano,
resumo mensal, categorias, cartões de crédito e orçamento diário. Instalável no celular (PWA).

## Estrutura

| Pasta / arquivo | O que é |
|---|---|
| `planner/` | O app publicado (HTML/JS estático). É a pasta raiz do projeto na Vercel. |
| `planner/config.js` | URL do Supabase e chave **publishable** (pública por natureza). Nunca coloque a `service_role` aqui. |
| `planner/vercel.json` | Cabeçalhos de segurança (CSP, HSTS etc.) e cache. |
| `supabase/migrations/` | Schema do banco (`wf_*`) com row-level security. |
| `scripts/db.mjs` | Aplica as migrations e confere o RLS. |
| `scripts/rls-test.mjs` | Testa o isolamento entre contas (tudo dentro de uma transação desfeita). |
| `scripts/serve.mjs` | Servidor local que aplica os mesmos cabeçalhos da Vercel. |

## Rodar localmente

```bash
npm install
node scripts/serve.mjs 5178
```

Abra `http://localhost:5178`.

## Banco de dados

Crie um `.env` (veja `.env.example`) com `SUPABASE_DB_URL` — a URI do *Session pooler*. O `.env` nunca vai para o Git.

```bash
npm run db:migrate     # aplica supabase/migrations/*.sql que ainda não rodaram
npm run db:check       # confere RLS e políticas
npm run db:test-rls    # testa o isolamento entre usuários
```

## Publicar

A Vercel publica a pasta `planner/` a cada push na branch `main`.
Ao mudar arquivos do app, aumente `VERSION` em `planner/sw.js` para os celulares baixarem a versão nova.
