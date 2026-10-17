import { districtById, DISTRICTS } from "./districts.js";
import { encryptLocal, decryptLocal } from "./vault.js";
let flight = null, writes = Promise.resolve();
export async function currentAccount() {
  if (!flight) flight = (async () => {
    const r = await fetch("https://relay.aaronluo.com/api/student/profile", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("Relay could not verify your account. Open guided setup and retry; no new course data is read.");
    const p = await r.json();
    if (!p.user) throw new Error("Open Relay and sign into your account before pairing.");
    if (!p.scope || !p.binding || !p.dataKey || !districtById(p.district?.id) || districtById(p.district.id).schoology !== p.district.schoology) throw new Error("No supported course reader is selected. Open Relay school setup; saving unlisted school links does not enable reading.");
    return p;
  })().finally(() => { flight = null; });
  return flight;
}
export async function pairedAccount() {
  const { readerPair } = await chrome.storage.local.get("readerPair");
  if (!readerPair) throw new Error("Pair the current Relay account before reading.");
  const p = await currentAccount();
  if (!readerPair || readerPair.scope !== p.scope || readerPair.binding !== p.binding || readerPair.districtId !== p.district.id) throw new Error("Relay account or district changed. Reading is paused: pair the current account before continuing.");
  return p;
}
export async function pairCurrentAccount(expectedBinding) {
  const p = await currentAccount();
  if (p.binding !== expectedBinding) throw new Error("Relay account changed. Check the current account and pair again.");
  {
    // Explicit pairing replaces only the extension's cache, never another
    // account's encrypted library in the website.
    await chrome.permissions.remove({ origins: [...DISTRICTS.map(d => d.schoology + "/*"), "https://docs.google.com/*"] });
    await chrome.alarms.clear("relay-daily-reader");
    await chrome.storage.local.remove(["ownedVault", "syncSettings", "syncPages", "syncRun"]);
    await chrome.storage.session.remove("pages");
    await chrome.storage.local.set({ readerPair: { scope: p.scope, binding: p.binding, districtId: p.district.id } });
  }
  return { scope: p.scope, binding: p.binding, districtId: p.district.id, email: p.user.email };
}
async function readVault(p) {
  const { ownedVault } = await chrome.storage.local.get("ownedVault");
  return ownedVault ? decryptLocal(ownedVault, p.dataKey, `extension:${p.scope}`) : {};
}
export async function ownedGet(keys) {
  await writes;
  const p = await pairedAccount(), data = await readVault(p);
  return { ...Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])), __binding: p.binding };
}
function update(change, expectedBinding) {
  const next = writes.then(async () => {
    const p = await pairedAccount();
    if (expectedBinding && expectedBinding !== p.binding) throw new Error("Account changed. The old operation was discarded.");
    const data = await readVault(p); change(data);
    const encrypted = await encryptLocal(data, p.dataKey, `extension:${p.scope}`);
    const current = await pairedAccount();
    if (current.binding !== p.binding) throw new Error("Account changed during sync. Result discarded.");
    await chrome.storage.local.set({ ownedVault: encrypted });
  });
  writes = next.catch(() => {}); return next;
}
export function ownedSet(values, binding = values.syncRun?.accountBinding) {
  if (values.syncPages && !binding) throw new Error("Snapshot owner is required.");
  return update(data => Object.assign(data, values), binding);
}
export function ownedRemove(keys, binding) { return update(data => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }, binding); }
