"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import StudentDashboard from "./StudentDashboard";
import { signalAccountChange, type StudentSession } from "@/lib/student/accountTypes";
import { RelayMark } from "./Icons";
import "./account.css";
import "./setup.css";
import SchoolChooser from "./SchoolChooser";
import { parseSchool, schoolStorageKey, type SchoolChoice } from "@/lib/student/schools";
type Profile = Omit<Partial<StudentSession>, "user"> & { user: StudentSession["user"] | null; googleEnabled: boolean };
export default function StudentAccountGate({ initialNow }: { initialNow: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [choosing, setChoosing] = useState(false);
  const [school, setSchool] = useState<{ userId: string; choice: SchoolChoice } | null>(null);
  const selectedSchool = school && school.userId === profile?.user?.id ? school.choice : null;
  useEffect(() => {
    const uid = profile?.user?.id; if (!uid) { setSchool(null); return; }
    const load = () => { try { const choice = parseSchool(JSON.parse(localStorage.getItem(schoolStorageKey(uid)) || "null")); setSchool(choice ? { userId: uid, choice } : null); } catch { setSchool(null); } };
    load(); const storage = (e: StorageEvent) => { if (e.key === schoolStorageKey(uid) || e.key === null) load(); };
    window.addEventListener("storage", storage); return () => window.removeEventListener("storage", storage);
  }, [profile?.user?.id]);
  const requests = useRef(0), controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const turn = ++requests.current; controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    try {
      const r = await fetch("/api/student/profile", { cache: "no-store", signal: abort.signal });
      const p = await r.json(); if (!r.ok) throw new Error(p.error);
      if (turn !== requests.current || abort.signal.aborted) return;
      setProfile(p); setError("");
      const tag = p.binding || "signed-out";
      if (localStorage.getItem("relay-student-active-account") !== tag) localStorage.setItem("relay-student-active-account", tag);
    } catch (e) { if (turn === requests.current && !abort.signal.aborted) { setProfile(null); setError(e instanceof Error ? e.message : "Account could not be verified."); } }
  }, []);
  useEffect(() => {
    const url = new URL(location.href), reason = url.searchParams.get("authError");
    if (reason) { setAuthNotice(reason === "google_link_required" ? "This email already has a Relay account. Sign into that account before linking Google; identities are not joined automatically." : "Google sign-in could not finish. Try again or use your Relay password."); url.searchParams.delete("authError"); history.replaceState(null, "", url); }
    void refresh();
    const focus = () => { if (!document.hidden) void refresh(); };
    const changed = () => { setProfile(null); void refresh(); };
    const storage = (e: StorageEvent) => { if (e.key === "relay-student-active-account" || e.key === "relay-student-account-changed") changed(); };
    const timer = setInterval(focus, 15000);
    window.addEventListener("focus", focus); window.addEventListener("storage", storage); window.addEventListener("relay-student-account-changed", changed);
    return () => { requests.current++; controller.current?.abort(); clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("storage", storage); window.removeEventListener("relay-student-account-changed", changed); };
  }, [refresh]);
  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error || "Sign-in failed.");
      signalAccountChange(); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function selectSchool(choice: SchoolChoice) {
    if (!profile?.binding || !profile.user) return;
    const districtId = choice.districtId;
    if (!districtId) {
      if (profile.district && !confirm("Stop the current school reader and save these links instead? The new portal is not supported for reading. Your old encrypted library will stay separate.")) return;
      setBusy(true);
      try {
        const r = await fetch("/api/student/profile", { method: "DELETE", headers: { "X-Relay-Student-Binding": profile.binding } });
        if (!r.ok) throw new Error("Could not stop the previous school connection. Refresh and try again.");
        localStorage.setItem(schoolStorageKey(profile.user.id), JSON.stringify(choice)); setSchool({ userId: profile.user.id, choice });
        signalAccountChange(); await refresh();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      return;
    }
    if (profile.district && profile.district.id !== districtId && !confirm("Switch districts? Connections and extension pairing must be renewed. Your previous district's encrypted local library is kept separate.")) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/student/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ districtId, binding: profile.binding }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.error);
      localStorage.setItem(schoolStorageKey(profile.user.id), JSON.stringify(choice)); setSchool({ userId: profile.user.id, choice });
      setChoosing(false); signalAccountChange(); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { const r = await fetch("/api/auth/logout", { method: "POST" }); if (!r.ok) throw new Error("Sign-out failed."); setProfile(null); setChoosing(false); signalAccountChange(); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (profile?.user && profile.district && profile.scope && profile.binding && profile.dataKey && !choosing && (!selectedSchool || !!selectedSchool.districtId)) return <StudentDashboard key={profile.binding} initialNow={initialNow} account={{ ...profile as StudentSession, school: selectedSchool?.districtId === profile.district.id ? selectedSchool : null }} onChooseDistrict={() => setChoosing(true)} onLogout={() => void logout()}/>;
  return <main className="sa-entry"><section className="sa-intro"><div className="sa-brand"><RelayMark/><strong>relay.</strong></div><span className="sa-eyebrow">YOUR ACCOUNT · YOUR SCHOOL DAY</span><h1>One school day.<br/>A little more clarity.</h1><p>Connect your courses once. Let Relay organize what changed, what’s due, and what deserves your attention.</p><div className="sa-steps"><span>1 · Your account</span><span>2 · Your school</span><span>3 · Your first course check</span></div></section><section className="sa-card">
    {!profile && !error ? <><h2>Checking your account…</h2><p>No private course data is opened before your account is verified.</p></> : profile?.user ? <><span className="sa-eyebrow">SIGNED IN AS {profile.user.email}</span><h2>Where do you go to school?</h2><p>Choose your school, not just its software. We’ll put its website and course portal where you can find them.</p>{selectedSchool && !selectedSchool.districtId && <div className="sg-unsupported" role="status"><strong>{selectedSchool.name} · reader unavailable</strong><p>Automatic reading is not supported for this school yet. Saving these links does not grant new site access or start course reading. No assignments can be generated from links alone.</p>{selectedSchool.website && <a href={selectedSchool.website} target="_blank" rel="noopener noreferrer">Open school website ↗ · supplied by you</a>}{selectedSchool.ncesId && <><a href={`https://nces.ed.gov/ccd/schoolsearch/school_detail.asp?ID=${selectedSchool.ncesId}`} target="_blank" rel="noopener noreferrer">Open official NCES school record ↗</a><p>This dataset does not supply school website or course portal addresses. Add verified links below; Relay will not guess them.</p></>}{selectedSchool.portal && <a href={selectedSchool.portal} target="_blank" rel="noopener noreferrer">Open course portal ↗</a>}<p>You can use those links now, edit them below, or choose a school with a supported reader. This is not a pending sync.</p></div>}<SchoolChooser key={`${profile.user.id}:${selectedSchool?.id || "choose"}`} initialName={selectedSchool?.name} busy={busy} onChoose={s => void selectSchool(s)}/>{profile.district && (!selectedSchool || !!selectedSchool.districtId) && <button className="sa-text" onClick={() => setChoosing(false)}>Keep current school settings</button>}<button className="sa-text" disabled={busy} onClick={() => void logout()}>Sign out</button></> : <><span className="sa-eyebrow">START WITH YOUR RELAY ACCOUNT</span><h2>{mode === "login" ? "Your schoolwork stays yours." : "Create your Relay account."}</h2><p>This is your Relay login, not your school password. Private sources are separated by account and district.</p>{profile?.googleEnabled && <a className="sa-primary" href="/api/auth/google">Continue with Google</a>}<form onSubmit={authenticate}>{mode === "signup" && <label>Your name<input name="name" autoComplete="name" maxLength={100} required/></label>}<label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required/></label><label>Relay password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={128} required/></label><button className="sa-primary" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form><button className="sa-text" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>{mode === "login" ? "New to Relay? Create an account" : "Already have an account? Sign in"}</button></>}
    {authNotice && <p className="sa-error" role="alert">{authNotice}</p>}
    {error && <div role="alert"><p className="sa-error">{error}</p><button className="sa-text" onClick={() => void refresh()}>Check account again</button></div>}<p className="sa-footnote">Course content stays encrypted in this browser; it is not a cloud-synced library. Older unassigned browser captures are not automatically attached to any account. AI processing needs separate permission.</p>
  </section></main>;
}
