import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Plus, Search, X, ChevronLeft, ChevronRight, AlertTriangle, Check,
  Wrench, Download, Camera, Bell, BarChart3, FileText, Image as ImageIcon,
  MoreHorizontal, Mic, Upload, Settings, Clock, Lock, LogOut,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "./supabaseClient";
import {
  fetchVendas, saveVenda, deleteVenda,
  fetchConfig, saveConfig,
  uploadFoto, getFotoUrl, deleteFoto,
} from "./data";

// ---------- helpers ----------
const uid = () => crypto.randomUUID();

const toISODate = (d) => {
  const dt = new Date(d);
  const off = dt.getTimezoneOffset();
  const local = new Date(dt.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
};
const todayISO = () => toISODate(new Date());
const fmtDateBR = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const fmtBRL = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const getPeriodKey = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  let py = y, pm = m;
  if (d < 26) { pm -= 1; if (pm === 0) { pm = 12; py -= 1; } }
  return `${py}-${String(pm).padStart(2, "0")}`;
};
const getPeriodLabel = (key) => {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  let endY = y, endM = m + 1;
  if (endM === 13) { endM = 1; endY = y + 1; }
  const start = new Date(y, m - 1, 26);
  const end = new Date(endY, endM - 1, 25);
  const f = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return `${f(start)} — ${f(end)}`;
};
const shiftPeriod = (key, dir) => {
  const [y, m] = key.split("-").map(Number);
  let ny = y, nm = m + dir;
  if (nm === 0) { nm = 12; ny -= 1; }
  if (nm === 13) { nm = 1; ny += 1; }
  return `${ny}-${String(nm).padStart(2, "0")}`;
};
const lastNPeriods = (key, n) => {
  const arr = [];
  let k = key;
  for (let i = 0; i < n; i++) { arr.unshift(k); k = shiftPeriod(k, -1); }
  return arr;
};
const periodShortLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 26);
  return d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
};

const daysSince = (iso) => {
  if (!iso) return 0;
  const d = new Date(iso + "T00:00:00");
  const now = new Date();
  return Math.floor((now - d) / 86400000);
};

const compressImage = (file, maxWidth = 900, quality = 0.6) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const downloadBlob = (content, filename, mime) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const toCSV = (rows) => {
  const header = ["Cliente", "Ordem de Servico", "Nota", "Data Faturamento", "Valor", "Percentual", "Comissao"];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((v) =>
    [v.cliente, v.ordemServico, v.nota || "", fmtDateBR(v.dataFaturamento),
      (v.valor || 0).toFixed(2).replace(".", ","), v.percentual || 0, (v.comissao || 0).toFixed(2).replace(".", ",")]
      .map(esc).join(";")
  );
  return "\uFEFF" + [header.join(";"), ...lines].join("\r\n");
};

// entrada rápida (voz ou texto colado)
// aceita: "OS 4521 faturou 3200 a 5%" | "novo orçamento cliente João Silva os 4521"
function parseQuickEntry(raw) {
  const text = raw.toLowerCase();
  const result = { status: null, cliente: null, ordemServico: null, valor: null, percentual: null };

  const osMatch = text.match(/\b(?:os|o\.s\.?|ordem(?:\s+de\s+servi[cç]o)?)\s*n?[ºo°]?\s*(\d+)/i);
  if (osMatch) result.ordemServico = osMatch[1];

  if (/\bfaturou\b|\bfaturad[oa]\b/.test(text)) result.status = "faturado";
  else if (/\bor[çc]amento\b/.test(text)) result.status = "orcamento";

  const valorPctMatch = text.match(/faturou\s*(?:r\$)?\s*([\d.,]+)\s*(?:a|com)?\s*([\d.,]+)?\s*%?/i);
  if (valorPctMatch) {
    if (valorPctMatch[1]) result.valor = parseFloat(valorPctMatch[1].replace(/\./g, "").replace(",", "."));
    if (valorPctMatch[2]) result.percentual = parseFloat(valorPctMatch[2].replace(",", "."));
  }

  const clienteMatch = text.match(/cliente\s+([a-zà-ÿ\s]+?)(?=\s+(?:os|o\.s\.?|ordem|valor|faturou|a\s+\d|$))/i);
  if (clienteMatch) result.cliente = clienteMatch[1].trim();

  return result;
}

const isoFromBR = (br) => {
  const m = br.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return todayISO();
  return `${m[3]}-${m[2]}-${m[1]}`;
};

// ---------- money masked input ----------
function MoneyInput({ value, onChange, placeholder }) {
  const cents = useMemo(() => Math.round((Number(value) || 0) * 100).toString(), [value]);
  const display = useMemo(() => {
    const v = parseInt(cents || "0", 10) / 100;
    return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [cents]);
  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "");
    onChange(parseInt(digits || "0", 10) / 100);
  };
  return (
    <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-900 px-3 focus-within:border-amber-500 transition-colors">
      <span className="text-zinc-500 text-sm font-mono mr-1">R$</span>
      <input inputMode="numeric" value={display} onChange={handleChange} placeholder={placeholder}
        className="w-full bg-transparent py-2.5 text-right font-mono text-[15px] text-zinc-100 outline-none" />
    </div>
  );
}

// ---------- tela de login real (Supabase Auth — e-mail/senha) ----------
function LoginGate() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const entrar = async () => {
    if (!email.trim() || !senha.trim()) { setErro("Preencha e-mail e senha."); return; }
    setCarregando(true); setErro("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setCarregando(false);
    if (error) setErro("E-mail ou senha incorretos.");
    // se der certo, o onAuthStateChange no App cuida de liberar a tela
  };

  return (
    <div className="min-h-screen bg-[#19191b] flex items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center mx-auto mb-4">
          <Lock size={20} className="text-zinc-900" />
        </div>
        <h1 className="text-zinc-100 font-black uppercase tracking-wide text-sm mb-1">Retífica Tietê</h1>
        <p className="text-zinc-500 text-xs mb-5">Controle de Comissões — acesso restrito</p>
        <div className="space-y-2">
          <input
            type="email" value={email} autoFocus autoCapitalize="none"
            onChange={(e) => { setEmail(e.target.value); setErro(""); }}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
            placeholder="E-mail"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-center text-zinc-100 outline-none focus:border-amber-500"
          />
          <input
            type="password" value={senha}
            onChange={(e) => { setSenha(e.target.value); setErro(""); }}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
            placeholder="Senha"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-center text-zinc-100 outline-none focus:border-amber-500"
          />
        </div>
        {erro && <p className="text-red-400 text-xs mt-2">{erro}</p>}
        <button onClick={entrar} disabled={carregando} className="mt-3 w-full py-2.5 rounded-lg bg-amber-500 text-zinc-900 text-[13px] font-bold uppercase tracking-wide disabled:opacity-60">
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}

// ---------- main app ----------
export default function App() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [vendas, setVendas] = useState([]);
  const [config, setConfig] = useState({ percentualPadrao: "", diasAlertaParado: 15 });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [periodo, setPeriodo] = useState(getPeriodKey(todayISO()));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickTextOpen, setQuickTextOpen] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [printData, setPrintData] = useState(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [listening, setListening] = useState(false);
  const importRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const [v, c] = await Promise.all([fetchVendas(), fetchConfig()]);
        setVendas(v);
        setConfig(c);
      } catch (e) {
        setLoadError(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, [session]);

  const sair = async () => { await supabase.auth.signOut(); };

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const clientesConhecidos = useMemo(() => Array.from(new Set(vendas.map((v) => v.cliente).filter(Boolean))).sort(), [vendas]);
  const pendentes = useMemo(() => vendas.filter((v) => v.status === "orcamento"), [vendas]);
  const parados = useMemo(() => pendentes.filter((v) => daysSince(v.entradaServico) > (Number(config.diasAlertaParado) || 15)), [pendentes, config.diasAlertaParado]);

  const totalPeriodo = useMemo(() => vendas.filter((v) => v.status === "faturado" && getPeriodKey(v.dataFaturamento) === periodo).reduce((s, v) => s + (Number(v.comissao) || 0), 0), [vendas, periodo]);
  const countPeriodo = useMemo(() => vendas.filter((v) => v.status === "faturado" && getPeriodKey(v.dataFaturamento) === periodo).length, [vendas, periodo]);

  const chartData = useMemo(() => {
    const periods = lastNPeriods(periodo, 6);
    return periods.map((k) => ({
      label: periodShortLabel(k),
      total: vendas.filter((v) => v.status === "faturado" && getPeriodKey(v.dataFaturamento) === k).reduce((s, v) => s + (Number(v.comissao) || 0), 0),
    }));
  }, [vendas, periodo]);

  const listaFiltrada = useMemo(() => {
    let list = [...vendas];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((v) => (v.cliente || "").toLowerCase().includes(q) || (v.ordemServico || "").toLowerCase().includes(q) || (v.nota || "").toLowerCase().includes(q));
    } else {
      list = list.filter((v) => v.status === "orcamento" || getPeriodKey(v.dataFaturamento) === periodo);
    }
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [vendas, query, periodo]);

  const blankRecord = (patch = {}) => ({
    id: uid(), cliente: "", entradaServico: todayISO(), ordemServico: "", status: "orcamento",
    dataFaturamento: todayISO(), valor: 0, percentual: "", comissao: 0, nota: "", temFoto: false, isNew: true, ...patch,
  });

  const openNew = () => { setEditing(blankRecord()); setSheetOpen(true); };
  const openEdit = (v) => { setEditing({ ...v, isNew: false }); setSheetOpen(true); };

  const checkDuplicidade = (os, id) => os.trim() !== "" && vendas.some((v) => v.id !== id && v.ordemServico.trim().toLowerCase() === os.trim().toLowerCase());

  const saveEditing = async () => {
    if (!editing.cliente.trim()) { setToast({ type: "warn", msg: "Informe o nome do cliente." }); return; }
    if (!editing.ordemServico.trim()) { setToast({ type: "warn", msg: "Informe a Ordem de Serviço." }); return; }
    if (checkDuplicidade(editing.ordemServico, editing.id)) {
      const ok = window.confirm(`Já existe uma venda com a Ordem de Serviço "${editing.ordemServico}". Deseja salvar mesmo assim?`);
      if (!ok) return;
    }
    const comissao = editing.status === "faturado" ? Math.round(((Number(editing.valor) || 0) * (Number(editing.percentual) || 0)) / 100 * 100) / 100 : 0;
    const record = { ...editing, cliente: editing.cliente.toUpperCase().trim(), comissao };
    delete record.isNew;
    try {
      const saved = await saveVenda(record);
      setVendas((prev) => {
        const exists = prev.some((v) => v.id === saved.id);
        return exists ? prev.map((v) => (v.id === saved.id ? saved : v)) : [...prev, saved];
      });
      setSheetOpen(false); setEditing(null);
      setToast({ type: "ok", msg: "Venda salva." });
    } catch (e) {
      setToast({ type: "warn", msg: "Não foi possível salvar. Confira sua conexão." });
    }
  };

  const removeEditing = async () => {
    if (!editing || editing.isNew) return;
    const ok = window.confirm("Excluir esta venda? Essa ação não pode ser desfeita.");
    if (!ok) return;
    try {
      await deleteVenda(editing.id);
      await deleteFoto(editing.id);
      setVendas((prev) => prev.filter((v) => v.id !== editing.id));
      setSheetOpen(false); setEditing(null);
      setToast({ type: "ok", msg: "Venda excluída." });
    } catch (e) {
      setToast({ type: "warn", msg: "Não foi possível excluir. Tente de novo." });
    }
  };

  const exportCSV = () => {
    const rows = vendas.filter((v) => v.status === "faturado" && getPeriodKey(v.dataFaturamento) === periodo);
    downloadBlob(toCSV(rows), `comissoes_${periodo}.csv`, "text/csv;charset=utf-8;");
    setExportOpen(false);
  };
  const exportPDF = () => {
    const rows = vendas.filter((v) => v.status === "faturado" && getPeriodKey(v.dataFaturamento) === periodo).sort((a, b) => a.dataFaturamento.localeCompare(b.dataFaturamento));
    setPrintData({ rows, total: totalPeriodo, label: getPeriodLabel(periodo) });
    setExportOpen(false);
    setTimeout(() => window.print(), 150);
  };

  const handleQuickParsed = (text) => {
    const p = parseQuickEntry(text);
    if (!p.ordemServico && !p.cliente) { setToast({ type: "warn", msg: "Não entendi. Tente algo como: OS 4521 faturou 3200 a 5%." }); return; }
    const existente = p.ordemServico ? vendas.find((v) => v.ordemServico === p.ordemServico) : null;
    const base = existente || blankRecord();
    const patch = {};
    if (p.cliente) patch.cliente = p.cliente.toUpperCase();
    if (p.ordemServico) patch.ordemServico = p.ordemServico;
    if (p.status) patch.status = p.status;
    if (p.status === "faturado") {
      patch.dataFaturamento = base.dataFaturamento || todayISO();
      if (p.valor != null) patch.valor = p.valor;
      patch.percentual = p.percentual != null ? p.percentual : (base.percentual || config.percentualPadrao || "");
    }
    setEditing({ ...base, ...patch, isNew: !existente });
    setSheetOpen(true);
    setToast({ type: "ok", msg: "Confira os dados e salve." });
  };

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setToast({ type: "warn", msg: "Reconhecimento de voz não suportado neste navegador." }); return; }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => { setListening(false); setToast({ type: "warn", msg: "Não consegui ouvir. Tente de novo." }); };
    rec.onresult = (e) => { const transcript = e.results[0][0].transcript; setMenuOpen(false); handleQuickParsed(transcript); };
    rec.start();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const norm = (obj, keys) => { for (const k of Object.keys(obj)) { if (keys.includes(k.toLowerCase().trim())) return obj[k]; } return ""; };
      let novos = 0, duplicados = 0;
      const existentesOS = new Set(vendas.map((v) => v.ordemServico));
      const importados = [];
      rows.forEach((r) => {
        const os = String(norm(r, ["ordem de servico", "ordem de serviço", "os", "o.s."])).trim();
        if (!os) return;
        if (existentesOS.has(os)) { duplicados++; return; }
        const cliente = String(norm(r, ["cliente"])).toUpperCase().trim();
        const valor = parseFloat(String(norm(r, ["valor"])).replace(/\./g, "").replace(",", ".")) || 0;
        const percentual = parseFloat(String(norm(r, ["percentual", "%"])).replace(",", ".")) || 0;
        const nota = String(norm(r, ["nota", "nota fiscal"])).trim();
        const dataFat = String(norm(r, ["data faturamento", "data de faturamento"])).trim();
        importados.push({
          id: uid(), cliente, ordemServico: os, status: dataFat || valor ? "faturado" : "orcamento",
          entradaServico: todayISO(), dataFaturamento: dataFat ? isoFromBR(dataFat) : todayISO(),
          valor, percentual, comissao: Math.round(valor * percentual) / 100, nota, temFoto: false,
        });
        existentesOS.add(os); novos++;
      });
      for (const rec of importados) {
        try { await saveVenda(rec); } catch (e) {}
      }
      setVendas((prev) => [...prev, ...importados]);
      setToast({ type: "ok", msg: `${novos} importado(s), ${duplicados} duplicado(s) ignorado(s).` });
    } catch (err) {
      setToast({ type: "warn", msg: "Não foi possível ler o arquivo. Confira o formato." });
    } finally {
      setMenuOpen(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  if (!authChecked) {
    return <div className="min-h-screen bg-[#19191b]" />;
  }
  if (!session) return <LoginGate />;

  return (
    <div className="min-h-screen bg-[#19191b] text-zinc-100 font-sans pb-24">
      <style>{`@media print { body * { visibility: hidden; } #print-area, #print-area * { visibility: visible; } #print-area { position: absolute; top:0; left:0; width:100%; padding:24px; background:#fff; color:#111; } }`}</style>

      <div className="sticky top-0 z-20 bg-[#19191b]/95 backdrop-blur border-b border-zinc-800 px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-amber-500 flex items-center justify-center"><Wrench size={16} className="text-zinc-900" strokeWidth={2.5} /></div>
            <div>
              <h1 className="text-[13px] font-black tracking-[0.15em] uppercase text-zinc-100 leading-none">Retífica Tietê</h1>
              <p className="text-[11px] text-zinc-500 tracking-wide leading-none mt-1">Controle de Comissões — Vinicius</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setChartOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-md bg-zinc-900 border border-zinc-700 text-zinc-400 active:bg-zinc-800"><BarChart3 size={15} /></button>
            <button onClick={() => setExportOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-md bg-zinc-900 border border-zinc-700 text-zinc-400 active:bg-zinc-800"><Download size={15} /></button>
            <button onClick={() => setMenuOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-md bg-zinc-900 border border-zinc-700 text-zinc-400 active:bg-zinc-800"><MoreHorizontal size={15} /></button>
          </div>
        </div>

        {(parados.length > 0 || (pendentes.length > 0 && new Date().getDate() >= 20 && new Date().getDate() <= 25)) && !reminderDismissed && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5">
            <Bell size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-0.5">
              {new Date().getDate() >= 20 && new Date().getDate() <= 25 && pendentes.length > 0 && (
                <p className="text-[12px] text-amber-300 font-semibold leading-tight">{pendentes.length} orçamento(s) ainda não faturado(s) — fechamento dia 25.</p>
              )}
              {parados.length > 0 && (
                <p className="text-[12px] text-amber-300 font-semibold leading-tight">{parados.length} orçamento(s) parado(s) há mais de {config.diasAlertaParado} dias.</p>
              )}
            </div>
            <button onClick={() => setReminderDismissed(true)} className="text-zinc-500 shrink-0"><X size={14} /></button>
          </div>
        )}

        <div className="relative rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-850 border border-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] px-4 py-3.5">
          <div className="flex items-center justify-between">
            <button onClick={() => setPeriodo((p) => shiftPeriod(p, -1))} className="w-7 h-7 flex items-center justify-center rounded-md bg-zinc-900/60 text-zinc-400 active:bg-zinc-900"><ChevronLeft size={16} /></button>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-400 font-semibold">Período {getPeriodLabel(periodo)}</p>
              <p className="text-2xl font-black font-mono text-amber-400 tracking-tight mt-0.5">{fmtBRL(totalPeriodo)}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">{countPeriodo} venda(s) faturada(s)</p>
            </div>
            <button onClick={() => setPeriodo((p) => shiftPeriod(p, 1))} className="w-7 h-7 flex items-center justify-center rounded-md bg-zinc-900/60 text-zinc-400 active:bg-zinc-900"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3">
          <Search size={15} className="text-zinc-500 shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por cliente, O.S. ou nota..." className="w-full bg-transparent py-2.5 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-600" />
          {query && <button onClick={() => setQuery("")} className="text-zinc-500"><X size={15} /></button>}
        </div>
      </div>

      <div className="px-4 mt-4 space-y-2.5">
        {loadError && <div className="text-[12px] text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">Não foi possível conectar ao banco de dados agora. Confira sua internet e recarregue.</div>}
        {loaded && listaFiltrada.length === 0 && (
          <div className="text-center py-16 text-zinc-600">
            <p className="text-sm">Nenhuma venda por aqui ainda.</p>
            <p className="text-xs mt-1">Toque em + para lançar a primeira.</p>
          </div>
        )}
        {listaFiltrada.map((v) => {
          const dias = v.status === "orcamento" ? daysSince(v.entradaServico) : 0;
          const parado = v.status === "orcamento" && dias > (Number(config.diasAlertaParado) || 15);
          return (
            <button key={v.id} onClick={() => openEdit(v)} className="w-full text-left rounded-xl bg-zinc-900 border border-zinc-800 px-3.5 py-3 active:bg-zinc-850 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  {v.temFoto && <ImageIcon size={12} className="text-zinc-500 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-bold text-[14px] text-zinc-100 truncate">{v.cliente}</p>
                    <p className="text-[11px] text-zinc-500 font-mono mt-0.5">O.S. {v.ordemServico}</p>
                  </div>
                </div>
                <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${v.status === "faturado" ? "bg-sky-500/15 text-sky-400" : "bg-amber-500/15 text-amber-400"}`}>
                  {v.status === "faturado" ? "Faturado" : "Orçamento"}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-zinc-500">
                <span>Entrada: {fmtDateBR(v.entradaServico)}</span>
                {v.status === "faturado" ? (
                  <span className="font-mono font-semibold text-amber-400">{fmtBRL(v.comissao)}</span>
                ) : parado ? (
                  <span className="flex items-center gap-1 text-red-400 font-semibold"><Clock size={11} />{dias} dias parado</span>
                ) : (
                  <span className="text-zinc-600">aguardando faturamento</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <button onClick={openNew} className="fixed bottom-6 right-5 w-14 h-14 rounded-full bg-amber-500 text-zinc-900 shadow-lg shadow-amber-500/20 flex items-center justify-center active:scale-95 transition-transform"><Plus size={26} strokeWidth={2.5} /></button>
      <button onClick={startVoice} className={`fixed bottom-8 right-24 w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-transform ${listening ? "bg-red-500 animate-pulse" : "bg-zinc-800 border border-zinc-700"}`}>
        <Mic size={18} className={listening ? "text-white" : "text-zinc-300"} />
      </button>

      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 shadow-lg z-50 max-w-[88%] text-center ${toast.type === "warn" ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-900"}`}>
          {toast.type === "warn" ? <AlertTriangle size={14} className="shrink-0" /> : <Check size={14} className="shrink-0" />}{toast.msg}
        </div>
      )}

      {sheetOpen && editing && (
        <EditSheet editing={editing} setEditing={setEditing} clientes={clientesConhecidos} config={config}
          onClose={() => { setSheetOpen(false); setEditing(null); }} onSave={saveEditing} onDelete={removeEditing} setToast={setToast} />
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setExportOpen(false)} />
          <div className="relative w-full bg-[#1f1f22] rounded-t-2xl border-t border-zinc-700 p-4 pb-6">
            <p className="text-[13px] font-bold uppercase tracking-wide text-zinc-200 mb-3">Exportar período {getPeriodLabel(periodo)}</p>
            <button onClick={exportCSV} className="w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 mb-2 active:bg-zinc-800">
              <Download size={16} className="text-amber-400" /><div className="text-left"><p className="text-[13px] font-semibold text-zinc-100">Exportar CSV</p><p className="text-[11px] text-zinc-500">Abre direto no Excel</p></div>
            </button>
            <button onClick={exportPDF} className="w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 active:bg-zinc-800">
              <FileText size={16} className="text-amber-400" /><div className="text-left"><p className="text-[13px] font-semibold text-zinc-100">Exportar PDF</p><p className="text-[11px] text-zinc-500">Escolha "Salvar como PDF" na impressão</p></div>
            </button>
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <div className="relative w-full bg-[#1f1f22] rounded-t-2xl border-t border-zinc-700 p-4 pb-6 space-y-2">
            <p className="text-[13px] font-bold uppercase tracking-wide text-zinc-200 mb-1">Mais opções</p>
            <button onClick={() => { setMenuOpen(false); startVoice(); }} className="w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 active:bg-zinc-800">
              <Mic size={16} className="text-amber-400" /><div className="text-left"><p className="text-[13px] font-semibold text-zinc-100">Lançar por voz</p><p className="text-[11px] text-zinc-500">Ex: "OS 4521 faturou 3200 a 5%"</p></div>
            </button>
            <button onClick={() => { setMenuOpen(false); setQuickTextOpen(true); }} className="w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 active:bg-zinc-800">
              <FileText size={16} className="text-amber-400" /><div className="text-left"><p className="text-[13px] font-semibold text-zinc-100">Colar texto rápido</p><p className="text-[11px] text-zinc-500">Cole uma mensagem tipo WhatsApp</p></div>
            </button>
            <button onClick={() => importRef.current?.click()} className="w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 active:bg-zinc-800">
              <Upload size={16} className="text-amber-400" /><div className="text-left"><p className="text-[13px] font-semibold text-zinc-100">Importar planilha</p><p className="text-[11px] text-zinc-500">.xlsx ou .csv do relatório do ERP</p></div>
            </button>
            <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden" />
            <button onClick={() => { setMenuOpen(false); setSettingsOpen(true); }} className="w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 active:bg-zinc-800">
              <Settings size={16} className="text-amber-400" /><div className="text-left"><p className="text-[13px] font-semibold text-zinc-100">Configurações</p><p className="text-[11px] text-zinc-500">% padrão e alerta de orçamento parado</p></div>
            </button>
            <button onClick={() => { setMenuOpen(false); sair(); }} className="w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 active:bg-zinc-800">
              <LogOut size={16} className="text-red-400" /><div className="text-left"><p className="text-[13px] font-semibold text-zinc-100">Sair</p><p className="text-[11px] text-zinc-500">Encerrar sessão neste dispositivo</p></div>
            </button>
          </div>
        </div>
      )}

      {quickTextOpen && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setQuickTextOpen(false)} />
          <div className="relative w-full bg-[#1f1f22] rounded-t-2xl border-t border-zinc-700 p-4 pb-6">
            <p className="text-[13px] font-bold uppercase tracking-wide text-zinc-200 mb-3">Colar texto rápido</p>
            <textarea value={quickText} onChange={(e) => setQuickText(e.target.value)} rows={3} placeholder='Ex: "OS 4521 faturou 3200 a 5%" ou "novo orçamento cliente João Silva os 4521"'
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[14px] text-zinc-100 outline-none focus:border-amber-500" />
            <button onClick={() => { if (quickText.trim()) { handleQuickParsed(quickText); setQuickText(""); setQuickTextOpen(false); } }}
              className="mt-3 w-full py-3 rounded-lg bg-amber-500 text-zinc-900 text-[14px] font-bold uppercase tracking-wide">Interpretar</button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-full bg-[#1f1f22] rounded-t-2xl border-t border-zinc-700 p-4 pb-6 space-y-4">
            <p className="text-[13px] font-bold uppercase tracking-wide text-zinc-200">Configurações</p>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">% de comissão padrão</label>
              <div className="mt-1 flex items-center rounded-lg border border-zinc-700 bg-zinc-900 px-3">
                <input value={config.percentualPadrao} onChange={(e) => setConfig((c) => ({ ...c, percentualPadrao: e.target.value.replace(/[^0-9.,]/g, "") }))} inputMode="decimal" placeholder="ex: 5"
                  className="w-full bg-transparent py-2.5 text-[15px] font-mono text-zinc-100 outline-none" />
                <span className="text-zinc-500 text-sm font-mono">%</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">Preenche o campo % automaticamente ao faturar — você pode sempre alterar.</p>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Alertar orçamento parado após (dias)</label>
              <input value={config.diasAlertaParado} onChange={(e) => setConfig((c) => ({ ...c, diasAlertaParado: e.target.value.replace(/[^0-9]/g, "") }))} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[15px] font-mono text-zinc-100 outline-none" />
            </div>
            <button onClick={async () => { try { await saveConfig(config); setToast({ type: "ok", msg: "Configurações salvas." }); } catch (e) { setToast({ type: "warn", msg: "Não foi possível salvar." }); } setSettingsOpen(false); }}
              className="w-full py-3 rounded-lg bg-amber-500 text-zinc-900 text-[14px] font-bold uppercase tracking-wide">Salvar</button>
          </div>
        </div>
      )}

      {chartOpen && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setChartOpen(false)} />
          <div className="relative w-full bg-[#1f1f22] rounded-t-2xl border-t border-zinc-700 p-4 pb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-bold uppercase tracking-wide text-zinc-200">Evolução — últimos 6 períodos</p>
              <button onClick={() => setChartOpen(false)} className="text-zinc-500"><X size={18} /></button>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={{ stroke: "#3f3f46" }} tickLine={false} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 10 }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} />
                  <Tooltip contentStyle={{ background: "#242427", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e4e4e7" }} formatter={(v) => [fmtBRL(v), "Comissão"]} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]} fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {printData && (
        <div id="print-area" className="hidden print:block">
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 2 }}>Retífica Tietê — Comissões</h2>
          <p style={{ fontSize: 12, marginBottom: 12, color: "#555" }}>Vendedor: Vinicius | Período: {printData.label}</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
              <th style={{ padding: 4 }}>Cliente</th><th style={{ padding: 4 }}>O.S.</th><th style={{ padding: 4 }}>Nota</th>
              <th style={{ padding: 4 }}>Fatur.</th><th style={{ padding: 4 }}>Valor</th><th style={{ padding: 4 }}>%</th><th style={{ padding: 4 }}>Comissão</th>
            </tr></thead>
            <tbody>{printData.rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #ddd" }}>
                <td style={{ padding: 4 }}>{r.cliente}</td><td style={{ padding: 4 }}>{r.ordemServico}</td><td style={{ padding: 4 }}>{r.nota}</td>
                <td style={{ padding: 4 }}>{fmtDateBR(r.dataFaturamento)}</td><td style={{ padding: 4 }}>{fmtBRL(r.valor)}</td><td style={{ padding: 4 }}>{r.percentual}%</td><td style={{ padding: 4 }}>{fmtBRL(r.comissao)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p style={{ marginTop: 12, fontSize: 13, fontWeight: 800 }}>Total do período: {fmtBRL(printData.total)}</p>
        </div>
      )}
    </div>
  );
}

// ---------- edit sheet ----------
function EditSheet({ editing, setEditing, clientes, config, onClose, onSave, onDelete, setToast }) {
  const [showSuggest, setShowSuggest] = useState(false);
  const [foto, setFoto] = useState(null);
  const [fotoLoading, setFotoLoading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (editing.isNew || !editing.temFoto) return;
    (async () => {
      const url = await getFotoUrl(editing.id);
      if (url) setFoto(url);
    })();
  }, [editing.id, editing.isNew, editing.temFoto]);

  const suggestions = useMemo(() => {
    const q = editing.cliente.trim().toLowerCase();
    if (!q) return [];
    return clientes.filter((c) => c.toLowerCase().includes(q) && c.toLowerCase() !== q).slice(0, 5);
  }, [editing.cliente, clientes]);

  const set = (patch) => setEditing((prev) => ({ ...prev, ...patch }));
  const comissaoCalc = ((Number(editing.valor) || 0) * (Number(editing.percentual) || 0)) / 100;

  const handleFotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotoLoading(true);
    try {
      const dataUrl = await compressImage(file);
      await uploadFoto(editing.id, dataUrl);
      setFoto(dataUrl);
      set({ temFoto: true });
      setToast?.({ type: "ok", msg: "Foto da nota anexada." });
    } catch (err) {
      setToast?.({ type: "warn", msg: "Não foi possível anexar a foto." });
    } finally { setFotoLoading(false); }
  };

  const removeFoto = async () => {
    try { await deleteFoto(editing.id); } catch (e) {}
    setFoto(null); set({ temFoto: false });
  };

  const applyDefaultPercentual = () => {
    if (!editing.percentual && config.percentualPadrao) set({ percentual: config.percentualPadrao });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full bg-[#1f1f22] rounded-t-2xl border-t border-zinc-700 max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1f1f22] flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-zinc-800">
          <div className="w-10 h-1 rounded-full bg-zinc-700 absolute left-1/2 -translate-x-1/2 top-1.5" />
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-zinc-200 mt-2">{editing.isNew ? "Nova venda" : "Editar venda"}</h2>
          <button onClick={onClose} className="text-zinc-500 mt-2"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-zinc-900 border border-zinc-700 p-1">
            {["orcamento", "faturado"].map((s) => (
              <button key={s} onClick={() => { set({ status: s }); if (s === "faturado") applyDefaultPercentual(); }}
                className={`flex-1 py-2 rounded-md text-[12px] font-bold uppercase tracking-wide transition-colors ${editing.status === s ? (s === "faturado" ? "bg-sky-500 text-zinc-900" : "bg-amber-500 text-zinc-900") : "text-zinc-500"}`}>
                {s === "faturado" ? "Faturado" : "Orçamento"}
              </button>
            ))}
          </div>

          <div className="relative">
            <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Cliente</label>
            <input value={editing.cliente} onChange={(e) => { set({ cliente: e.target.value.toUpperCase() }); setShowSuggest(true); }} onFocus={() => setShowSuggest(true)} onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[15px] text-zinc-100 outline-none focus:border-amber-500" />
            {showSuggest && suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-lg overflow-hidden">
                {suggestions.map((c) => (
                  <button key={c} onMouseDown={() => { set({ cliente: c }); setShowSuggest(false); }} className="w-full text-left px-3 py-2 text-[13px] text-zinc-200 active:bg-zinc-800">{c}</button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Ordem de Serviço</label>
            <input value={editing.ordemServico} onChange={(e) => set({ ordemServico: e.target.value.replace(/\D/g, "") })} inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[15px] font-mono text-zinc-100 outline-none focus:border-amber-500" />
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Data de entrada</label>
            <input type="date" value={editing.entradaServico} onChange={(e) => set({ entradaServico: e.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[15px] text-zinc-100 outline-none focus:border-amber-500" />
          </div>

          {editing.status === "faturado" && (
            <>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Data de faturamento</label>
                <input type="date" value={editing.dataFaturamento} onChange={(e) => set({ dataFaturamento: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[15px] text-zinc-100 outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Nota fiscal</label>
                <input value={editing.nota} onChange={(e) => set({ nota: e.target.value.replace(/\D/g, "") })} inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[15px] font-mono text-zinc-100 outline-none focus:border-amber-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Valor</label>
                  <div className="mt-1"><MoneyInput value={editing.valor} onChange={(v) => set({ valor: v })} /></div>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">%</label>
                  <input value={editing.percentual} onChange={(e) => set({ percentual: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[15px] font-mono text-zinc-100 outline-none focus:border-amber-500" />
                </div>
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wide text-amber-400/80 font-semibold">Comissão calculada</p>
                <p className="text-lg font-black font-mono text-amber-400">{fmtBRL(comissaoCalc)}</p>
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Foto da nota (opcional)</label>
                {foto ? (
                  <div className="mt-1 relative">
                    <img src={foto} alt="Nota" className="w-full rounded-lg border border-zinc-700 max-h-52 object-cover" />
                    <button onClick={removeFoto} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 flex items-center justify-center text-white"><X size={14} /></button>
                  </div>
                ) : (
                  <button onClick={() => fileRef.current?.click()} disabled={fotoLoading}
                    className="mt-1 w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900 py-4 text-zinc-500 text-[13px]">
                    <Camera size={16} />{fotoLoading ? "Enviando..." : "Anexar foto da nota"}
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFotoSelect} className="hidden" />
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-[#1f1f22] border-t border-zinc-800 p-4 flex gap-2">
          {!editing.isNew && (
            <button onClick={onDelete} className="w-12 h-12 shrink-0 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center"><X size={18} /></button>
          )}
          <button onClick={onSave} className="flex-1 py-3 rounded-lg bg-amber-500 text-zinc-900 text-[14px] font-bold uppercase tracking-wide">Salvar</button>
        </div>
      </div>
    </div>
  );
}
