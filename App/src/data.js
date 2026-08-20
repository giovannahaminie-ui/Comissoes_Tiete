import { supabase } from "./supabaseClient";

/*
  Esta camada isola todo o acesso ao Supabase.
  A UI (App.jsx) não sabe como os dados são salvos — só chama estas funções.
  Isso facilita testar/entender cada parte separadamente.
*/

// ---------- vendas ----------

// Converte um registro do banco (snake_case) para o formato usado na UI (camelCase)
function fromRow(row) {
  return {
    id: row.id,
    cliente: row.cliente,
    entradaServico: row.entrada_servico,
    ordemServico: row.ordem_servico,
    status: row.status,
    dataFaturamento: row.data_faturamento,
    valor: row.valor,
    percentual: row.percentual,
    comissao: row.comissao,
    nota: row.nota,
    temFoto: row.tem_foto,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

// Converte um registro da UI (camelCase) para o formato do banco (snake_case)
function toRow(v) {
  return {
    id: v.id,
    cliente: v.cliente,
    entrada_servico: v.entradaServico,
    ordem_servico: v.ordemServico,
    status: v.status,
    data_faturamento: v.dataFaturamento,
    valor: v.valor,
    percentual: v.percentual,
    comissao: v.comissao,
    nota: v.nota,
    tem_foto: v.temFoto,
    updated_at: new Date().toISOString(),
  };
}

export async function fetchVendas() {
  const { data, error } = await supabase
    .from("vendas")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(fromRow);
}

export async function saveVenda(venda) {
  const { data, error } = await supabase
    .from("vendas")
    .upsert(toRow(venda))
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

export async function deleteVenda(id) {
  const { error } = await supabase.from("vendas").delete().eq("id", id);
  if (error) throw error;
}

// ---------- configuração (linha única, id = 1) ----------

export async function fetchConfig() {
  const { data, error } = await supabase
    .from("config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { percentualPadrao: "", diasAlertaParado: 15 };
  return {
    percentualPadrao: data.percentual_padrao ?? "",
    diasAlertaParado: data.dias_alerta_parado ?? 15,
  };
}

export async function saveConfig(config) {
  const { error } = await supabase.from("config").upsert({
    id: 1,
    percentual_padrao: config.percentualPadrao || null,
    dias_alerta_parado: Number(config.diasAlertaParado) || 15,
  });
  if (error) throw error;
}

// ---------- fotos das notas (Supabase Storage, bucket "notas") ----------

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function uploadFoto(id, dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const path = `${id}.jpg`;
  const { error } = await supabase.storage
    .from("notas")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
}

export async function getFotoUrl(id) {
  const path = `${id}.jpg`;
  // bucket privado: gera uma URL assinada válida por 1 hora
  const { data, error } = await supabase.storage
    .from("notas")
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function deleteFoto(id) {
  const path = `${id}.jpg`;
  await supabase.storage.from("notas").remove([path]);
}
