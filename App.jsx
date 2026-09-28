import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

// Palette alignée sur l'app IIB Pilot
const C = { ink: "#16202E", paper: "#F7F6F3", card: "#FFFFFF", line: "#E7E4DE", amber: "#D98A29", amberSoft: "#FBEFD9", green: "#2F9E6B", greenSoft: "#E3F3EC", red: "#D1495B", redSoft: "#FBE6E9", slate: "#5B6675" };
const UI = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const ROLES = [["owner", "Propriétaire"], ["admin", "Admin"], ["editor", "Éditeur"], ["viewer", "Lecture"]];
const inp = { fontFamily: UI, display: "block", width: "100%", boxSizing: "border-box", padding: "10px 12px", margin: "6px 0", border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 14, outline: "none" };
const btn = { fontFamily: UI, border: "none", background: C.amber, color: "#fff", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 700, fontSize: 14 };
const btnGhost = { fontFamily: UI, border: `1px solid ${C.line}`, background: "#fff", color: C.ink, borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13 };
const sel = { fontFamily: UI, border: `1px solid ${C.line}`, borderRadius: 8, padding: "4px 8px", fontSize: 12, background: "#fff", cursor: "pointer" };

function Login() {
  const [email, setEmail] = useState(""); const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const signIn = async () => { setBusy(true); setErr(""); const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd }); setBusy(false); if (error) setErr(error.message); };
  return (
    <div style={{ fontFamily: UI, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, padding: 24 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, width: "min(400px,100%)", boxShadow: "0 6px 24px rgba(0,0,0,.06)" }}>
        <div style={{ fontWeight: 700, fontSize: 22, color: C.ink, marginBottom: 4 }}>IIB — Back-office</div>
        <div style={{ color: C.slate, fontSize: 13, marginBottom: 18 }}>Console d'administration de la plateforme.</div>
        <input placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
        <input placeholder="Mot de passe" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && signIn()} style={inp} />
        {err && <div style={{ color: C.red, fontSize: 12, margin: "6px 0" }}>{err}</div>}
        <button onClick={signIn} disabled={busy} style={{ ...btn, width: "100%", marginTop: 8 }}>{busy ? "…" : "Se connecter"}</button>
      </div>
    </div>
  );
}

function MembersPanel({ orgId }) {
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState(""); const [role, setRole] = useState("editor");
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data: mems } = await supabase.from("memberships").select("user_id,role").eq("org_id", orgId);
    const ids = (mems || []).map((m) => m.user_id);
    let profs = []; if (ids.length) { const r = await supabase.from("profiles").select("id,email").in("id", ids); profs = r.data || []; }
    const byId = Object.fromEntries(profs.map((p) => [p.id, p]));
    setMembers((mems || []).map((m) => ({ user_id: m.user_id, role: m.role, email: byId[m.user_id]?.email || m.user_id })));
    const { data: inv } = await supabase.from("invitations").select("id,email,role").eq("org_id", orgId).is("accepted_at", null);
    setInvites(inv || []);
  };
  useEffect(() => { load(); }, [orgId]);
  const invite = async () => {
    if (!email.trim()) return; setMsg("");
    const { error } = await supabase.from("invitations").insert({ org_id: orgId, email: email.trim().toLowerCase(), role });
    if (error) { setMsg(error.message); return; }
    setEmail(""); load();
  };
  const changeRole = async (uid, r) => { const { error } = await supabase.from("memberships").update({ role: r }).eq("org_id", orgId).eq("user_id", uid); if (error) setMsg(error.message); else load(); };
  const removeMember = async (uid) => { const { error } = await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", uid); if (error) setMsg(error.message); else load(); };
  const cancelInv = async (id) => { await supabase.from("invitations").delete().eq("id", id); load(); };
  return (
    <div style={{ background: C.paper, borderRadius: 10, padding: 12, marginTop: 8 }}>
      {msg && <div style={{ color: C.red, fontSize: 12, marginBottom: 6 }}>{msg}</div>}
      <div style={{ fontWeight: 700, fontSize: 12, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Membres</div>
      {!members && <div style={{ color: C.slate, fontSize: 13 }}>Chargement…</div>}
      {members && members.length === 0 && <div style={{ color: C.slate, fontSize: 13 }}>Aucun membre.</div>}
      {(members || []).map((m) => (
        <div key={m.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
          <span style={{ fontSize: 13, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.email}</span>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <select value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value)} style={sel}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button onClick={() => removeMember(m.user_id)} title="Retirer" style={{ border: "none", background: "transparent", color: C.red, cursor: "pointer", fontWeight: 700 }}>✕</button>
          </div>
        </div>
      ))}
      {invites.length > 0 && (<>
        <div style={{ fontWeight: 700, fontSize: 12, color: C.slate, textTransform: "uppercase", margin: "8px 0 4px" }}>Invitations en attente</div>
        {invites.map((iv) => (
          <div key={iv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
            <span style={{ fontSize: 13, color: C.slate }}>{iv.email} · {iv.role}</span>
            <button onClick={() => cancelInv(iv.id)} title="Annuler" style={{ border: "none", background: "transparent", color: C.red, cursor: "pointer" }}>✕</button>
          </div>
        ))}
      </>)}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <input placeholder="inviter par e-mail…" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && invite()} style={{ ...inp, margin: 0, flex: 1, minWidth: 160 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={sel}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button onClick={invite} style={btnGhost}>Inviter</button>
      </div>
      <div style={{ color: C.slate, fontSize: 11, marginTop: 6 }}>L'invité rejoint la société à sa prochaine connexion (nouveau compte ou existant).</div>
    </div>
  );
}

function OrgRow({ o, onChange }) {
  const [name, setName] = useState(o.name || "");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const mods = o.modules || { reno: true, rental: true };
  const toggle = async (key) => { const next = { ...mods, [key]: mods[key] === false ? true : false }; const { error } = await supabase.from("organizations").update({ modules: next }).eq("id", o.id); if (error) { setMsg(error.message); return; } onChange({ ...o, modules: next }); };
  const saveName = async () => { if (name === o.name) return; const { error } = await supabase.from("organizations").update({ name }).eq("id", o.id); if (error) { setMsg(error.message); return; } onChange({ ...o, name }); };
  const chip = (on) => ({ fontFamily: UI, padding: "6px 12px", borderRadius: 8, border: `1px solid ${on ? C.green : C.line}`, cursor: "pointer", fontWeight: 600, fontSize: 12, background: on ? C.greenSoft : "#fff", color: on ? C.green : C.slate });
  return (
    <div style={{ padding: "12px 4px", borderTop: `1px solid #EEF0F2` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} style={{ fontFamily: UI, fontWeight: 600, fontSize: 14, color: C.ink, border: "1px solid transparent", borderRadius: 6, padding: "2px 4px", width: "100%", maxWidth: 320 }} />
          <div style={{ color: C.slate, fontSize: 11 }}>{o.members} membre(s) · créée le {new Date(o.created_at).toLocaleDateString("fr-FR")}</div>
          {msg && <div style={{ color: C.red, fontSize: 11 }}>{msg}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
          <button onClick={() => toggle("reno")} style={chip(mods.reno !== false)}>Rénovation {mods.reno !== false ? "✓" : "✕"}</button>
          <button onClick={() => toggle("rental")} style={chip(mods.rental !== false)}>Location {mods.rental !== false ? "✓" : "✕"}</button>
          <button onClick={() => setOpen(!open)} style={btnGhost}>{open ? "Fermer" : "Membres"}</button>
        </div>
      </div>
      {open && <MembersPanel orgId={o.id} />}
    </div>
  );
}

function Console({ email }) {
  const [orgs, setOrgs] = useState(null);
  const [q, setQ] = useState(""); const [msg, setMsg] = useState("");
  const load = async () => { const { data, error } = await supabase.from("org_overview").select("*").order("created_at", { ascending: true }); if (error) setMsg(error.message); else setOrgs(data || []); };
  useEffect(() => { load(); }, []);
  const createOrg = async () => {
    const nom = window.prompt("Nom de la nouvelle société :", ""); if (!nom) return;
    const { error } = await supabase.from("organizations").insert({ name: nom.trim() });
    if (error) { setMsg(error.message); return; } load();
  };
  const filtered = (orgs || []).filter((o) => !q || (o.name || "").toLowerCase().includes(q.toLowerCase()));
  const upd = (o) => setOrgs((os) => os.map((x) => (x.id === o.id ? { ...x, ...o } : x)));
  return (
    <div style={{ fontFamily: UI, minHeight: "100vh", background: C.paper }}>
      <div style={{ background: C.ink, color: "#fff", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>IIB — Back-office</div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 13 }}>
          <span style={{ opacity: 0.85 }}>{email}</span>
          <button onClick={() => supabase.auth.signOut()} style={{ border: "none", background: "rgba(255,255,255,.18)", color: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 600 }}>Se déconnecter</button>
        </div>
      </div>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Sociétés {orgs ? `(${orgs.length})` : ""}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, margin: 0, maxWidth: 220 }} />
            <button onClick={createOrg} style={btn}>+ Société</button>
          </div>
        </div>
        {msg && <div style={{ color: C.red, marginBottom: 8 }}>{msg}</div>}
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "4px 16px 16px" }}>
          {!orgs && <div style={{ color: C.slate, padding: 16 }}>Chargement…</div>}
          {orgs && filtered.length === 0 && <div style={{ color: C.slate, padding: 16 }}>Aucune société.</div>}
          {filtered.map((o) => <OrgRow key={o.id} o={o} onChange={upd} />)}
        </div>
        <div style={{ color: C.slate, fontSize: 12, marginTop: 12 }}>Crée une société, active ses modules (Rénovation / Location) et gère ses membres. Les changements de modules sont visibles après rechargement de l'app côté utilisateur.</div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session?.user) { setIsAdmin(undefined); return; }
    (async () => { const { data } = await supabase.from("platform_admins").select("user_id").eq("user_id", session.user.id).maybeSingle(); setIsAdmin(!!data); })();
  }, [session]);
  if (session === undefined) return <Center>Chargement…</Center>;
  if (!session) return <Login />;
  if (isAdmin === undefined) return <Center>Vérification des accès…</Center>;
  if (!isAdmin) return <Center><div style={{ fontWeight: 700, fontSize: 18, color: C.ink, marginBottom: 6 }}>Accès réservé</div><div style={{ color: C.slate, marginBottom: 12 }}>Ce compte n'est pas administrateur de la plateforme.</div><button onClick={() => supabase.auth.signOut()} style={btn}>Se déconnecter</button></Center>;
  return <Console email={session.user.email} />;
}
function Center({ children }) { return <div style={{ fontFamily: UI, minHeight: "100vh", display: "flex", flexDirection: "column", gap: 6, alignItems: "center", justifyContent: "center", background: C.paper, color: C.slate, padding: 24, textAlign: "center" }}>{children}</div>; }
