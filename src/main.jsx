import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { supabase, isConfigured } from "./supabaseClient.js";

/*
  Multi-utilisateurs (Supabase)
  -----------------------------
  - Connexion par e-mail (lien magique). Chaque personne a son compte.
  - Données PARTAGÉES : stockées côté serveur (table app_state), auto-sauvegardées.
  - Rôles : "editor" (modifie) / "viewer" (lecture seule) — table "profiles".
  - Synchro TEMPS RÉEL : une modif d'un éditeur se propage aux autres écrans.
  - Écran d'admin des rôles intégré (réservé aux éditeurs).
  - Sans configuration Supabase, on retombe sur le stockage local (mono-poste).
*/

const CLIENT_ID = Math.random().toString(36).slice(2); // identifie cet onglet
const KEY_PREFIX = "iib_pilot";
const stateVersions = {}; // dernière version connue par clé (verrou optimiste anti-écrasement)

/* ---- Fallback local ---- */
const localShim = {
  async get(key) { const v = localStorage.getItem(key); return v == null ? null : { key, value: v }; },
  async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
  async delete(key) { localStorage.removeItem(key); return { key, deleted: true }; },
  async list(prefix = "") { return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)) }; },
};

/* ---- Stockage partagé Supabase ---- */
let ACTIVE_ORG = null; // organisation active (multi-tenant)
const supabaseStorage = {
  setOrg(o) { ACTIVE_ORG = o; },
  async get(key) {
    let q = supabase.from("app_state").select("value,version").eq("key", key);
    q = ACTIVE_ORG ? q.eq("org_id", ACTIVE_ORG) : q.is("org_id", null);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (data) stateVersions[key] = data.version ?? 0;
    return data ? { key, value: data.value } : null;
  },
  async set(key, value) {
    const expected = (key in stateVersions) ? stateVersions[key] : null;
    const { data, error } = await supabase.rpc("save_app_state", { p_key: key, p_value: value, p_expected: expected, p_client: CLIENT_ID, p_org: ACTIVE_ORG });
    if (error) throw error; // un "viewer" est bloqué par la sécurité (RLS)
    if (data === -1) { // conflit : la base a changé depuis notre chargement → on n'écrase PAS
      window.dispatchEvent(new CustomEvent("app_state_conflict", { detail: { key } }));
      const e = new Error("CONFLICT"); e.code = "conflict"; throw e;
    }
    stateVersions[key] = data;
    return { key, value };
  },
  async delete(key) { let q = supabase.from("app_state").delete().eq("key", key); q = ACTIVE_ORG ? q.eq("org_id", ACTIVE_ORG) : q.is("org_id", null); const { error } = await q; if (error) throw error; return { key, deleted: true }; },
  async list(prefix = "") { let q = supabase.from("app_state").select("key"); if (ACTIVE_ORG) q = q.eq("org_id", ACTIVE_ORG); const { data } = await q; return { keys: (data || []).map((r) => r.key).filter((k) => k.startsWith(prefix)) }; },
};

/* ---- Photos de matériaux (Supabase Storage) ---- */
async function compressImage(file, maxDim = 1000, quality = 0.72) {
  try {
    const url = URL.createObjectURL(file);
    const img = document.createElement("img");
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const r = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * r); height = Math.round(height * r);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    URL.revokeObjectURL(url);
    return blob || file;
  } catch { return file; } // en cas d'échec (format exotique), on envoie l'original
}
const photoApi = isConfigured ? {
  async upload(file) {
    const blob = await compressImage(file);
    const path = `mat/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error } = await supabase.storage.from("material-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from("material-photos").getPublicUrl(path);
    return data.publicUrl;
  },
} : null;

/* ---- API d'admin des rôles (éditeurs uniquement, via RLS) ---- */
const adminApi = {
  async list() {
    // Membres de l'organisation active (rôle par org) + permissions depuis profiles
    if (!ACTIVE_ORG) return [];
    const { data: mems, error } = await supabase.from("memberships").select("user_id,role").eq("org_id", ACTIVE_ORG);
    if (error) throw error;
    const ids = (mems || []).map((m) => m.user_id);
    let profs = [];
    if (ids.length) { const r = await supabase.from("profiles").select("id,email,permissions").in("id", ids); profs = r.data || []; }
    const byId = Object.fromEntries(profs.map((p) => [p.id, p]));
    return (mems || []).map((m) => ({ id: m.user_id, role: m.role, email: byId[m.user_id]?.email || "", permissions: byId[m.user_id]?.permissions || null }));
  },
  async setRole(id, role) {
    if (!ACTIVE_ORG) throw new Error("Aucune organisation active.");
    const { data, error } = await supabase.from("memberships").update({ role }).eq("org_id", ACTIVE_ORG).eq("user_id", id).select("user_id");
    if (error) throw error; if (!data || !data.length) throw new Error("Non enregistré (droits insuffisants). Il faut être admin/owner de l'organisation.");
  },
  async setPermissions(id, permissions) { const { data, error } = await supabase.from("profiles").update({ permissions }).eq("id", id).select("id"); if (error) throw error; if (!data || !data.length) throw new Error("Non enregistré : colonne 'permissions' absente ou droits insuffisants."); },
  async invite(email, role = "editor") {
    if (!ACTIVE_ORG) throw new Error("Aucune organisation active.");
    const { error } = await supabase.from("invitations").insert({ org_id: ACTIVE_ORG, email: (email || "").trim().toLowerCase(), role });
    if (error) throw error;
    return { invited: email };
  },
  async history(key, limit = 30) {
    const { data, error } = await supabase.from("app_state_history").select("id,version,saved_at,client_id").eq("key", key).order("id", { ascending: false }).limit(limit);
    if (error) throw error; return data || [];
  },
  async restore(key, id) {
    const { data, error } = await supabase.rpc("restore_app_state", { p_key: key, p_history_id: id });
    if (error) throw error; return data;
  },
  async invite(email, role, action = "invite") {
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { email, role, action, redirectTo: window.location.origin } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data; // { ok, id, tempPassword? }
  },
  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) throw error;
  },
  async remove(id) {
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "delete", id } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  },
};

const S = { ink: "#16202E", amber: "#D98A29", paper: "#F7F6F3", line: "#E7E4DE", slate: "#5B6675" };

function Login() {
  const [mode, setMode] = useState("password"); // "password" | "magic"
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [sent, setSent] = useState(false);

  const signIn = async () => {
    if (!email.trim() || !pwd) { setErr("E-mail et mot de passe requis."); return; }
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setBusy(false);
    if (error) setErr(error.message);
  };
  const signUp = async () => {
    if (!email.trim() || pwd.length < 8) { setErr("Choisis un mot de passe d'au moins 8 caractères."); return; }
    setBusy(true); setErr(""); setInfo("");
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pwd, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setErr(error.message);
    else if (!data.session) setInfo("Compte créé. Vérifie ta boîte mail pour confirmer l'adresse, puis connecte-toi — ton espace de travail sera prêt.");
  };
  const reset = async () => {
    if (!email.trim()) { setErr("Saisis d'abord ton e-mail."); return; }
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setBusy(false);
    if (error) setErr(error.message); else setInfo("Un e-mail de réinitialisation a été envoyé.");
  };
  const sendMagic = async () => {
    if (!email.trim()) { setErr("Saisis ton e-mail."); return; }
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  };

  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${S.line}`, fontSize: 14, marginBottom: 10, boxSizing: "border-box" };
  const tab = (m, label) => (
    <button onClick={() => { setMode(m); setErr(""); setInfo(""); setSent(false); }}
      style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: mode === m ? S.ink : "transparent", color: mode === m ? "#fff" : S.slate }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: S.paper, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", border: `1px solid ${S.line}`, borderRadius: 18, padding: 28, width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{ background: S.amber, borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 12 }}>IIB</div>
          <div style={{ fontWeight: 800, color: S.ink, fontSize: 18 }}>IIB Pilot</div>
        </div>

        <div style={{ display: "flex", gap: 4, background: S.paper, borderRadius: 10, padding: 4, marginBottom: 16 }}>
          {tab("password", "Mot de passe")}
          {tab("magic", "Lien e-mail")}
        </div>

        {mode === "password" ? (
          <>
            <input type="email" value={email} placeholder="ton.email@exemple.com" autoComplete="username" onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            <input type="password" value={pwd} placeholder="Mot de passe" autoComplete="current-password" onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()} style={inputStyle} />
            {err && <div style={{ color: "#9E2C3A", fontSize: 12, marginBottom: 8 }}>{err}</div>}
            {info && <div style={{ color: "#2E7D32", fontSize: 12, marginBottom: 8 }}>{info}</div>}
            <button onClick={signIn} disabled={busy} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "none", background: S.amber, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {busy ? "…" : "Se connecter"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <button onClick={signUp} disabled={busy} style={{ border: "none", background: "transparent", color: S.slate, fontSize: 12, cursor: "pointer", padding: 0 }}>Créer un compte</button>
              <button onClick={reset} disabled={busy} style={{ border: "none", background: "transparent", color: S.slate, fontSize: 12, cursor: "pointer", padding: 0 }}>Mot de passe oublié ?</button>
            </div>
          </>
        ) : sent ? (
          <p style={{ color: S.slate, fontSize: 14, lineHeight: 1.5 }}>Un lien de connexion a été envoyé à <b>{email}</b>. Ouvre-le sur cet appareil. (Vérifie les spams.)</p>
        ) : (
          <>
            <p style={{ color: S.slate, fontSize: 14, marginBottom: 14 }}>Reçois un lien de connexion par e-mail (sans mot de passe).</p>
            <input type="email" value={email} placeholder="ton.email@exemple.com" onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMagic()} style={inputStyle} />
            {err && <div style={{ color: "#9E2C3A", fontSize: 12, marginBottom: 8 }}>{err}</div>}
            {info && <div style={{ color: "#2E7D32", fontSize: 12, marginBottom: 8 }}>{info}</div>}
            <button onClick={sendMagic} disabled={busy} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "none", background: S.amber, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {busy ? "Envoi…" : "Recevoir le lien"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ResetPassword({ onDone }) {
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const save = async () => {
    if (pwd.length < 8) { setErr("8 caractères minimum."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) setErr(error.message); else setOk(true);
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F6F3", fontFamily: "system-ui", padding: 24 }}>
      <div style={{ background: "#fff", border: "1px solid #E7E4DE", borderRadius: 16, padding: 28, width: "min(400px,100%)" }}>
        <div style={{ fontWeight: 700, fontSize: 20, color: "#16202E", marginBottom: 12 }}>Nouveau mot de passe</div>
        {ok ? (
          <>
            <div style={{ color: "#2F9E6B", marginBottom: 12 }}>Mot de passe mis à jour. Tu peux maintenant te connecter (ici et sur le back-office).</div>
            <button onClick={onDone} style={{ border: "none", background: "#D98A29", color: "#fff", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 700, width: "100%" }}>Continuer</button>
          </>
        ) : (
          <>
            <input type="password" placeholder="Nouveau mot de passe (8+ caractères)" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "10px 12px", margin: "6px 0", border: "1px solid #E7E4DE", borderRadius: 10, fontSize: 14, outline: "none" }} />
            {err && <div style={{ color: "#D1495B", fontSize: 12, margin: "6px 0" }}>{err}</div>}
            <button onClick={save} disabled={busy} style={{ border: "none", background: "#D98A29", color: "#fff", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 700, width: "100%", marginTop: 8 }}>{busy ? "…" : "Enregistrer"}</button>
          </>
        )}
      </div>
    </div>
  );
}
function Root() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  const [role, setRole] = useState("viewer");
  const [perms, setPerms] = useState(null);
  const [org, setOrg] = useState(undefined); // undefined = en cours ; null = aucune
  const [orgs, setOrgs] = useState([]); // liste des sociétés du compte
  const [modules, setModules] = useState(null); // modules de l'org active
  const [remote, setRemote] = useState({ value: null, version: 0 });
  const [notice, setNotice] = useState("");

  // Conflit d'écriture : la base a changé ailleurs → on resynchronise sans écraser.
  useEffect(() => {
    const onConflict = async (e) => {
      const key = e.detail?.key;
      try {
        const r = await supabaseStorage.get(key); // déjà filtré par société active
        if (r) setRemote({ value: r.value, version: Date.now() });
      } catch {}
      setNotice("Des modifications ont été faites ailleurs. Les données ont été resynchronisées — votre dernière saisie n'a pas été enregistrée, vérifiez et refaites-la si besoin.");
      setTimeout(() => setNotice(""), 8000);
    };
    window.addEventListener("app_state_conflict", onConflict);
    return () => window.removeEventListener("app_state_conflict", onConflict);
  }, []);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setRecovery(true);
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => { if (ev === "PASSWORD_RECOVERY") setRecovery(true); setSession(s); });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    (async () => {
      // Rattache les invitations en attente à ce compte (sociétés partagées)
      try { await supabase.rpc("claim_invitations"); } catch (e) { /* ignore */ }
      // Société active + rôle (multi-tenant). On prend la 1re société du membre.
      const { data: mems } = await supabase.from("memberships").select("org_id,role,organizations(name)").order("created_at", { ascending: true });
      const list = (mems || []).map((m) => ({ id: m.org_id, role: m.role, name: m.organizations?.name || "Société" }));
      setOrgs(list);
      const saved = localStorage.getItem("iib_active_org");
      const chosen = list.find((m) => m.id === saved) || list[0] || null;
      supabaseStorage.setOrg(chosen ? chosen.id : null);
      setOrg(chosen ? chosen.id : null);
      if (chosen) { const { data: o } = await supabase.from("organizations").select("modules").eq("id", chosen.id).maybeSingle(); setModules(o?.modules || null); }
      setRole((chosen && chosen.role) || "viewer");
      // Permissions (accès projets/biens) restent sur profiles
      let { data, error } = await supabase.from("profiles").select("role,permissions").eq("id", session.user.id).maybeSingle();
      if (error) { const r = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle(); data = r.data; }
      // Le rôle effectif vient du membership de l'org active ; à défaut, du profil.
      setRole((chosen && chosen.role) || data?.role || "viewer");
      setPerms(data?.permissions || null);
    })();
  }, [session]);

  // Synchro temps réel : applique les changements venus des AUTRES clients — UNIQUEMENT pour la société active.
  useEffect(() => {
    if (!session || !org) return;
    const ch = supabase
      .channel("app_state_rt_" + org)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_state", filter: `org_id=eq.${org}` }, (payload) => {
        const row = payload.new;
        if (!row || !row.key || !row.key.startsWith(KEY_PREFIX)) return;
        if (row.version != null) stateVersions[row.key] = row.version; // adopter la version distante
        if (row.client_id === CLIENT_ID) return; // ne pas se réappliquer ses propres écritures
        setRemote({ value: row.value, version: Date.now() });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, org]);

  if (recovery) return <ResetPassword onDone={() => { setRecovery(false); try { history.replaceState(null, "", window.location.pathname); } catch (e) {} }} />;
  if (session === undefined) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: S.slate, fontFamily: "system-ui" }}>Chargement…</div>;
  if (!session) return <Login />;
  if (org === undefined) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: S.slate, fontFamily: "system-ui" }}>Préparation de votre espace…</div>;
  if (org === null) return <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", gap: 10, alignItems: "center", justifyContent: "center", color: S.slate, fontFamily: "system-ui", padding: 24, textAlign: "center" }}>
    <div style={{ fontWeight: 700, color: S.ink || "#1a2230" }}>Aucune société</div>
    <div>Ton compte n'est rattaché à aucune société. Demande une invitation, ou reconnecte-toi après avoir exécuté le script multi-tenant.</div>
    <button onClick={() => supabase.auth.signOut()} style={{ border: "none", background: "transparent", color: S.amber, fontWeight: 700, cursor: "pointer" }}>Se déconnecter</button>
  </div>;

  window.storage = supabaseStorage;
  const isAdmin = role === "admin" || role === "owner";
  const canEdit = ["admin", "owner", "editor"].includes(role);
  const roleLabel = isAdmin ? "admin" : role === "editor" ? "éditeur" : "lecture seule";

  return (
    <>
      {notice && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 60, background: "#9A5E12", color: "#fff", fontFamily: "system-ui", fontSize: 13, fontWeight: 600, padding: "10px 16px", textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,.2)" }}>
          {notice}
          <button onClick={() => setNotice("")} style={{ marginLeft: 12, border: "none", background: "rgba(255,255,255,.25)", color: "#fff", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontWeight: 700 }}>OK</button>
        </div>
      )}
      <App readOnly={!canEdit} admin={isAdmin} adminApi={adminApi} permissions={perms} modules={modules} orgs={orgs} activeOrg={org} remoteValue={remote.value} remoteVersion={remote.version} photoApi={photoApi} />
      <div style={{ position: "fixed", right: 10, bottom: 10, zIndex: 40, display: "flex", gap: 8, alignItems: "center", background: "#fff", border: `1px solid ${S.line}`, borderRadius: 10, padding: "6px 10px", fontSize: 12, color: S.slate, fontFamily: "system-ui", boxShadow: "0 2px 10px rgba(0,0,0,.08)" }}>
        <span>{session.user.email} · {roleLabel}</span>
        <button onClick={() => { if (window.confirm("Se déconnecter ?")) supabase.auth.signOut(); }} style={{ border: "none", background: "transparent", color: S.amber, fontWeight: 700, cursor: "pointer" }}>Se déconnecter</button>
      </div>
    </>
  );
}

if (!isConfigured) window.storage = localShim;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isConfigured ? <Root /> : <App />}
  </React.StrictMode>
);
