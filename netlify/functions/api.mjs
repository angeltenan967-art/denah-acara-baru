import { getStore } from "@netlify/blobs";

const CAP = 5;                                    // kursi per meja
const VVIP = [1, 2, 3, 4, 7];                     // biru  : tamu VVIP (diisi panitia)
const GURU = [5, 6, 8, 9, 10, 11];                // kuning: tamu VIP / guru rombongan
const SISWA = [12,13,14,15,16,17,18,19,20,21,22,23,24,25]; // hijau: siswa
const MAXT = { 5: 4, 6: 4, 8: 3, 9: 3 };          // meja guru SMP: batas kursi
const capOf = (t) => MAXT[t] ?? CAP;
const store = getStore({ name: "acara", consistency: "strong" });

const J = (o, c = 200) => new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json" } });
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const csvf = (v) => '"' + String(/^[=+\-@]/.test(String(v)) ? "'" + v : v).replace(/"/g, '""') + '"';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function usage(st) {
  const u = {};
  for (const r of st.regs) for (const x of [...r.plan.guru, ...r.plan.siswa]) u[x.t] = (u[x.t] || 0) + x.n;
  for (const g of st.guests) if (g.meja) u[g.meja] = (u[g.meja] || 0) + 1;
  return u;
}
function plan(n, pool, u) {
  if (n < 1) return [];
  for (const t of pool) if (capOf(t) - (u[t] || 0) >= n) return [{ t, n }];   // satu meja kalau muat
  const o = []; let left = n;
  for (const t of pool) {
    const f = capOf(t) - (u[t] || 0);
    if (f > 0) { const k = Math.min(f, left); o.push({ t, n: k }); left -= k; if (!left) return o; }
  }
  return null;
}
const pub = (r) => ({ school: r.school, siswa: r.siswa, guru: r.guru, plan: r.plan });

async function load() {
  const e = await store.getWithMetadata("state", { type: "json" });
  const d = e ? e.data : {};
  return { st: { regs: d.regs || [], guests: d.guests || [] }, etag: e ? e.etag : null };
}
// baca-ubah-tulis aman: kalau ada yang menulis bersamaan, diulang otomatis
async function mutate(fn) {
  for (let i = 0; i < 10; i++) {
    const { st, etag } = await load();
    const r = fn(st);
    if (r.err || r.skip) return r;
    const w = etag ? await store.setJSON("state", st, { onlyIfMatch: etag }) : await store.setJSON("state", st, { onlyIfNew: true });
    if (w.modified) return r;
    await wait(100 + Math.random() * 300);
  }
  return { err: "Server sibuk, coba lagi.", code: 503 };
}

// ---- kode halaman panitia (dijalankan di browser) ----
function client(KEY) {
  const $ = (s) => document.querySelector(s);
  const el = (t, txt, a) => { const e = document.createElement(t); if (txt != null) e.textContent = txt; if (a) Object.assign(e, a); return e; };
  async function act(op, d) {
    const r = await fetch("/api/act", { method: "POST", body: JSON.stringify({ key: KEY, op, ...d }) });
    const j = await r.json(); if (j.err) alert(j.err); return load();
  }
  async function load() { const r = await fetch("/api/admin?json=1&key=" + encodeURIComponent(KEY)); render(await r.json()); }
  function section(D, title, kat, pool, extra) {
    const box = el("div"); box.style.cssText = "border:1px solid #ccc;border-radius:8px;padding:10px;margin:14px 0";
    const rows = D.guests.filter((g) => g.kat === kat);
    const all = [...rows.map((g) => ({ k: "guest", id: g.id, nama: g.nama, ins: g.instansi, meja: g.meja, h: g.hadir })), ...extra];
    box.appendChild(el("h3", title + " — hadir " + all.filter((x) => x.h).length + " dari " + all.length));
    const t = el("table"); t.border = 1; t.cellPadding = 6; t.style.borderCollapse = "collapse"; t.style.width = "100%";
    const hr = el("tr"); ["Hadir", "Nama", "Instansi", "Meja", ""].forEach((h) => hr.appendChild(el("th", h))); t.appendChild(hr);
    for (const x of all) {
      const tr = el("tr"), c1 = el("td"), cb = el("input"); cb.type = "checkbox"; cb.checked = !!x.h; cb.style.width = "22px"; cb.style.height = "22px";
      cb.onchange = () => act("hadir", { type: x.k, id: x.id, value: cb.checked }); c1.appendChild(cb); tr.appendChild(c1);
      tr.appendChild(el("td", x.nama)); tr.appendChild(el("td", x.ins || "")); tr.appendChild(el("td", x.meja || "-"));
      const c5 = el("td"); if (x.k === "guest") { const b = el("button", "Hapus"); b.onclick = () => confirm("Hapus " + x.nama + "?") && act("del", { id: x.id }); c5.appendChild(b); } tr.appendChild(c5);
      t.appendChild(tr);
    }
    const w = el("div"); w.style.overflowX = "auto"; w.appendChild(t); box.appendChild(w);
    const f = el("div"); f.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:10px";
    const n = el("input"), i = el("input"), s = el("select"), b = el("button", "Tambah");
    n.placeholder = "Nama tamu"; i.placeholder = "Instansi / jabatan";
    for (const m of pool) { const o = el("option", "Meja " + m + " (sisa " + (D.caps[m] - (D.use[m] || 0)) + ")"); o.value = m; s.appendChild(o); }
    b.onclick = () => { if (!n.value.trim()) return alert("Isi nama tamu"); act("add", { nama: n.value, instansi: i.value, kat, meja: +s.value }); };
    f.append(n, i, s, b); box.appendChild(f); return box;
  }
  function render(D) {
    const root = $("#app"); root.innerHTML = "";
    const tot = D.regs.reduce((a, r) => a + r.siswa + r.guru, 0);
    root.appendChild(el("p", D.regs.length + " rombongan, " + tot + " orang (siswa + guru)."));
    const a = el("a", "Unduh CSV siswa", { href: "/api/admin?csv=1&key=" + encodeURIComponent(KEY) }); root.appendChild(a);
    root.appendChild(section(D, "Absen VVIP (meja biru)", "VVIP", D.vvip, []));
    root.appendChild(section(D, "Absen VIP (meja kuning)", "VIP", D.guru,
      D.regs.filter((r) => r.guru > 0).map((r) => ({ k: "reg", id: r.nm, nama: "Guru " + r.school + " (" + r.guru + " orang)", ins: "Rombongan", meja: r.plan.guru.map((x) => x.t).join("/"), h: r.hadirGuru }))));
    root.appendChild(el("h3", "Daftar rombongan"));
    const t = el("table"); t.border = 1; t.cellPadding = 6; t.style.borderCollapse = "collapse";
    const hr = el("tr"); ["Sekolah", "Siswa", "Guru", "Meja guru", "Meja siswa"].forEach((h) => hr.appendChild(el("th", h))); t.appendChild(hr);
    for (const r of D.regs) { const tr = el("tr"); [r.school, r.siswa, r.guru, r.plan.guru.map((x) => x.t).join("/"), r.plan.siswa.map((x) => x.t).join("/")].forEach((v) => tr.appendChild(el("td", v))); t.appendChild(tr); }
    const w = el("div"); w.style.overflowX = "auto"; w.appendChild(t); root.appendChild(w);
    root.appendChild(el("h3", "Terisi per meja"));
    root.appendChild(el("p", [...D.vvip, ...D.guru, ...D.siswa].map((m) => "Meja " + m + ": " + (D.use[m] || 0) + "/" + D.caps[m]).join("  |  ")));
  }
  load();
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\//, "");
  const pass = process.env.ADMIN_PASS;
  const isAdmin = (k) => !!pass && k === pass;

  if (path === "find") {
    const { st } = await load();
    const r = st.regs.find((x) => x.nm === norm(url.searchParams.get("q")));
    return r ? J({ ok: 1, data: pub(r) }) : J({ err: "Sekolah belum terdaftar." }, 404);
  }

  if (path === "reg" && req.method === "POST") {
    let d; try { d = await req.json(); } catch { return J({ err: "Data tidak valid." }, 400); }
    const school = String(d.school || "").trim(), ns = +d.siswa, ng = +d.guru || 0, gp = String(d.gp || "").trim();
    if (!school || school.length > 100 || !(ns >= 1 && ns <= 100) || !(ng >= 0 && ng <= 25)) return J({ err: "Data tidak valid. Periksa asal sekolah dan jumlah." }, 400);
    if (!Array.isArray(d.stu) || d.stu.length !== ns) return J({ err: "Data siswa harus lengkap." }, 400);
    const stu = [];
    for (const s of d.stu) {
      const n = String(s.n || "").trim(), p = String(s.p || "").trim();
      if (!n || !/^[0-9+\-\s]{8,16}$/.test(p)) return J({ err: "Nama dan no. HP siswa harus diisi dengan benar." }, 400);
      stu.push({ n: n.slice(0, 80), p });
    }
    const res = await mutate((st) => {
      const ex = st.regs.find((x) => x.nm === norm(school));
      if (ex) return { skip: 1, ok: 1, dup: 1, data: pub(ex) };
      const u = usage(st);
      const g = plan(ng, GURU, u);
      if (!g) return { err: "Kursi meja guru tidak cukup. Hubungi panitia.", code: 409 };
      for (const x of g) u[x.t] = (u[x.t] || 0) + x.n;
      const s = plan(ns, SISWA, u);
      if (!s) return { err: "Kursi meja siswa tidak cukup. Hubungi panitia.", code: 409 };
      const rec = { nm: norm(school), school, siswa: ns, guru: ng, gp, stu, plan: { guru: g, siswa: s }, hadirGuru: false, ts: Date.now() };
      st.regs.push(rec);
      return { ok: 1, data: pub(rec) };
    });
    return res.err ? J({ err: res.err }, res.code || 500) : J({ ok: 1, dup: res.dup, data: res.data });
  }

  if (path === "act" && req.method === "POST") {
    let d; try { d = await req.json(); } catch { return J({ err: "Data tidak valid." }, 400); }
    if (!isAdmin(d.key)) return J({ err: "Akses ditolak" }, 403);
    const res = await mutate((st) => {
      if (d.op === "add") {
        const kat = d.kat === "VVIP" ? "VVIP" : "VIP", meja = +d.meja, nama = String(d.nama || "").trim().slice(0, 80);
        if (!nama) return { err: "Isi nama tamu." };
        if (!(kat === "VVIP" ? VVIP : GURU).includes(meja)) return { err: "Meja tidak sesuai kategori." };
        if (capOf(meja) - (usage(st)[meja] || 0) < 1) return { err: "Meja " + meja + " sudah penuh." };
        st.guests.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nama, instansi: String(d.instansi || "").trim().slice(0, 80), kat, meja, hadir: false });
        return { ok: 1 };
      }
      if (d.op === "del") { st.guests = st.guests.filter((g) => g.id !== d.id); return { ok: 1 }; }
      if (d.op === "hadir") {
        const x = d.type === "reg" ? st.regs.find((r) => r.nm === d.id) : st.guests.find((g) => g.id === d.id);
        if (!x) return { err: "Data tidak ditemukan." };
        if (d.type === "reg") x.hadirGuru = !!d.value; else x.hadir = !!d.value;
        return { ok: 1 };
      }
      return { err: "Perintah tidak dikenal." };
    });
    return res.err ? J({ err: res.err }, res.code || 400) : J({ ok: 1 });
  }

  if (path === "admin") {
    const key = url.searchParams.get("key");
    if (!isAdmin(key)) return new Response("Akses ditolak", { status: 403 });
    const { st } = await load();
    if (url.searchParams.has("json")) {
      const caps = {}; for (const t of [...VVIP, ...GURU, ...SISWA]) caps[t] = capOf(t);
      return J({ regs: st.regs.map((r) => ({ nm: r.nm, school: r.school, siswa: r.siswa, guru: r.guru, plan: r.plan, hadirGuru: !!r.hadirGuru })), guests: st.guests, use: usage(st), caps, vvip: VVIP, guru: GURU, siswa: SISWA });
    }
    if (url.searchParams.has("csv")) {
      const mj = (p) => p.map((x) => x.t).join("/");
      let c = "Sekolah,Siswa,Guru,HP Pendamping,Meja Guru,Meja Siswa,Nama Siswa,HP Siswa\n";
      for (const r of st.regs) for (const s of r.stu) c += [csvf(r.school), r.siswa, r.guru, csvf(r.gp), csvf(mj(r.plan.guru)), csvf(mj(r.plan.siswa)), csvf(s.n), csvf(s.p)].join(",") + "\n";
      return new Response(c, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=peserta.csv" } });
    }
    const html = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:15px system-ui;padding:16px;max-width:900px;margin:auto"><h2>Panitia</h2><div id="app">Memuat…</div><script>(${client.toString()})(${JSON.stringify(key).replace(/</g, "\\u003c")})</script>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return J({ err: "Tidak ditemukan" }, 404);
};

export const config = { path: "/api/*" };
