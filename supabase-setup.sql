-- Rode este script no Supabase: Dashboard > SQL Editor > New query > Run

-- Tabela de vendas
create table if not exists vendas (
  id uuid primary key,
  cliente text not null,
  entrada_servico date,
  ordem_servico text not null,
  status text not null default 'orcamento',
  data_faturamento date,
  valor numeric default 0,
  percentual numeric default 0,
  comissao numeric default 0,
  nota text,
  tem_foto boolean default false,
  updated_at timestamptz default now()
);

-- Tabela de configuração (uma única linha, id = 1)
create table if not exists config (
  id int primary key default 1,
  percentual_padrao text,
  dias_alerta_parado int default 15
);

-- Ativa Row Level Security
alter table vendas enable row level security;
alter table config enable row level security;

-- Só libera leitura/escrita para quem estiver LOGADO (usuário autenticado
-- via Supabase Auth) — quem não fez login não acessa os dados, mesmo tendo
-- a URL e a anon key do projeto (que ficam visíveis no código do site,
-- isso é normal, a proteção real é o login).
create policy "somente autenticados em vendas" on vendas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "somente autenticados em config" on config
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Bucket de storage para as fotos das notas fiscais
insert into storage.buckets (id, name, public)
values ('notas', 'notas', false)
on conflict (id) do nothing;

create policy "somente autenticados no bucket notas" on storage.objects
  for all using (bucket_id = 'notas' and auth.role() = 'authenticated')
  with check (bucket_id = 'notas' and auth.role() = 'authenticated');
