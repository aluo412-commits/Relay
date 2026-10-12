import { DISTRICTS } from "../../../extensions/course-reader/districts.js";
export { DISTRICTS };
export type StudentSession = { user: { id: string; name: string; email: string }; district: (typeof DISTRICTS)[number]; scope: string; binding: string; dataKey: string };
export function studentHeaders(session: StudentSession) { return { "X-Relay-Student-Binding": session.binding }; }
export function signalAccountChange() { localStorage.setItem("relay-student-account-changed", crypto.randomUUID()); window.dispatchEvent(new Event("relay-student-account-changed")); }
