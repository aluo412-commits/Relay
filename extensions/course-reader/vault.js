// AES-GCM local storage. Keys come from the authenticated account endpoint and
// are never persisted in local/session storage. Scope is authenticated as AAD.
function bytes(hex) {
  if (!/^[a-f0-9]{64}$/.test(hex || "")) throw new Error("Account key unavailable.");
  return Uint8Array.from(hex.match(/../g), x => parseInt(x, 16));
}
function encode(value) { const data = new Uint8Array(value), chunks = []; for (let i = 0; i < data.length; i += 8192) chunks.push(String.fromCharCode(...data.subarray(i, i + 8192))); return btoa(chunks.join("")); }
function decode(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export async function encryptLocal(value, hexKey, scope) {
  const key = await crypto.subtle.importKey("raw", bytes(hexKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`relay-local-v1:${scope}`) }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { version: 1, iv: encode(iv), ciphertext: encode(encrypted) };
}
export async function decryptLocal(value, hexKey, scope) {
  if (!value || value.version !== 1 || typeof value.ciphertext !== "string") throw new Error("Unowned/invalid saved data is not imported.");
  const key = await crypto.subtle.importKey("raw", bytes(hexKey), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(value.iv), additionalData: new TextEncoder().encode(`relay-local-v1:${scope}`) }, key, decode(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
