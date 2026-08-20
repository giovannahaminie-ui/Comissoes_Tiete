# Comissões — Retífica Tietê

App de controle de comissões (uso interno, Vinicius), com dados salvos no Supabase
e hospedado gratuitamente na Vercel.

Custo: **R$ 0,00** (Supabase free tier + Vercel Hobby + GitHub grátis).

---

## 1. Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com (dá pra entrar com GitHub).
2. Clique em **New project**. Escolha um nome (ex: `comissoes-tiete`), uma senha
   de banco (guarde num lugar seguro, mas você não vai precisar dela no dia a dia)
   e a região mais próxima (ex: São Paulo — `sa-east-1`).
3. Espere uns 2 minutos o projeto ser criado.
4. No menu lateral, vá em **SQL Editor** → **New query**, cole o conteúdo do
   arquivo `supabase-setup.sql` (que está nesta pasta) e clique em **Run**.
   Isso cria as tabelas `vendas` e `config` e o bucket de fotos `notas`.
5. Vá em **Project Settings** (ícone de engrenagem) → **API**. Copie:
   - **Project URL** → é o seu `VITE_SUPABASE_URL`
   - **anon public key** → é o seu `VITE_SUPABASE_ANON_KEY`
6. Crie o login do Vinicius: menu lateral → **Authentication** → **Users** →
   **Add user** → **Create new user**. Preencha um e-mail (pode ser o e-mail
   real dele ou um fictício tipo `vinicius@retificatiete.com.br`) e uma senha.
   Marque **Auto Confirm User** para não precisar de e-mail de confirmação.
   Essas serão as credenciais de login no app.

## 2. Testar localmente (opcional, mas recomendado)

Você vai precisar do [Node.js](https://nodejs.org) instalado (versão 18 ou mais nova).

```bash
# dentro da pasta do projeto
cp .env.example .env
# edite o .env e cole a URL e a anon key do Supabase

npm install
npm run dev
```

Abra o link que aparecer no terminal (algo como `http://localhost:5173`).
Se pedir e-mail/senha e, com as credenciais que você criou no passo 6, abrir
a tela normal do app, está tudo certo.

## 3. Subir para o GitHub

1. Crie uma conta em https://github.com se ainda não tiver.
2. Crie um repositório novo (pode ser **privado**) — ex: `comissoes-tiete`.
3. Dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "primeira versao"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/comissoes-tiete.git
git push -u origin main
```

(O arquivo `.gitignore` já garante que o `.env` com suas chaves **não** vai
para o GitHub — cada ambiente configura as suas próprias variáveis.)

## 4. Deploy na Vercel

1. Crie uma conta em https://vercel.com usando login do GitHub.
2. Clique em **Add New** → **Project** e selecione o repositório `comissoes-tiete`.
3. A Vercel detecta automaticamente que é um projeto Vite — não precisa mudar
   nada nas configurações de build.
4. Antes de clicar em Deploy, abra **Environment Variables** e adicione as duas:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (os mesmos valores que você colocou no `.env` local)
5. Clique em **Deploy**. Em cerca de 1 minuto você recebe uma URL tipo
   `https://comissoes-tiete.vercel.app` — essa é a URL final de acesso.

Toda vez que você (ou eu, te ajudando) alterar o código e der `git push`,
a Vercel atualiza o site sozinha em segundos.

## 5. No dia a dia

- Acesso pela URL da Vercel, de qualquer celular/computador.
- Pede e-mail e senha (as credenciais criadas no passo 6 do Supabase). O
  login fica salvo no navegador até o Vinicius clicar em "Sair".
- Os dados ficam no Supabase — se abrir em outro aparelho, é a mesma base.
- A proteção agora é de verdade: mesmo que alguém descubra a URL do site,
  sem login não acessa nem a tela nem os dados (as regras do banco — RLS —
  exigem usuário autenticado, então nem chamando a API do Supabase direto
  dá pra ler ou gravar nada sem login).
- Se precisar trocar a senha do Vinicius depois, é em **Authentication → Users**
  no painel do Supabase.

## O que mudou em relação à versão do Lovable

- `window.storage` (armazenamento interno do Claude) foi trocado por chamadas
  ao Supabase — veja `src/data.js`, que concentra toda a lógica de banco de
  dados separada da tela (`src/App.jsx`).
- A leitura automática da nota fiscal por foto (OCR via IA) foi **removida por
  enquanto**: ela dependia de chamar a API da Anthropic direto do navegador,
  o que só funciona dentro do ambiente do Claude. Pra reativar isso aqui fora,
  o caminho é criar uma **Supabase Edge Function** que guarda a chave de API
  em segredo no servidor e faz essa chamada por você — posso te ajudar a montar
  isso depois, se quiser.
- Adicionei uma tela de senha simples (`LoginGate` em `App.jsx`), já que o site
  agora fica público na internet (mesmo que só você saiba a URL).

## Se quiser trocar de host depois

O projeto é um Vite + React comum, então funciona igual em Netlify ou
Cloudflare Pages — é só repetir o passo 4 lá, apontando pro mesmo repositório
e as mesmas variáveis de ambiente.
