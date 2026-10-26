"use client";
import { useEffect, useRef, useState } from 'react';
import { encryptLocal, decryptLocal } from '../../../extensions/course-reader/vault.js';
import type { StudentSession } from '@/lib/student/accountTypes';
import { assertDistrictPages } from '@/lib/student/readerSync';
import { EMPTY_PLANNER, validatePlan, validatePlannerStore, type EveningPlan, type PlannerStore } from '@/lib/student/afterSchool';
import { dayKey } from '@/lib/student/types';

async function access<T>(key: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`relay-after-school-v1:${key}`, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('planner'); req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result, tx = db.transaction('planner', mode), result = run(tx.objectStore('planner')); tx.oncomplete = () => { db.close(); resolve(result.result); }; tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); }; };
  });
}
export function useAfterSchool(account: StudentSession) {
  const key = `${account.scope}:${account.school?.id || 'district'}`;
  const [state, setState] = useState<PlannerStore>(EMPTY_PLANNER), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), writing = useRef(false), revision = useRef(0);
  async function load() {
    const encrypted = await access(key, 'readonly', s => s.get('current'));
    const data = encrypted ? validatePlannerStore(await decryptLocal(encrypted, account.dataKey, `planner:${key}`)) : EMPTY_PLANNER;
    assertDistrictPages(data.plans.flatMap(p => p.input.tasks.filter(t => t.origin === 'reader').map(t => ({ url: t.sourceUrl! }))), account.district.schoology);
    return data;
  }
  useEffect(() => {
    const turn = ++epoch.current; setReady(false); setError(''); setState(EMPTY_PLANNER);
    void load().then(data => { if (turn === epoch.current) { revision.current = data.revision; setState(data); setReady(true); } }).catch(() => { if (turn === epoch.current) setError('Saved plans could not be opened. No data was overwritten.'); });
    return () => { epoch.current++; };
  }, [key, account.binding]);
  async function reload() {
    const turn = epoch.current;
    try { const data = await load(); if (turn !== epoch.current) return null; revision.current = data.revision; setState(data); setReady(true); setError(''); return data; }
    catch { if (turn === epoch.current) setError('Saved plans could not be opened.'); return null; }
  }
  async function update(change: (old: PlannerStore) => PlannerStore) {
    if (!ready || writing.current) return false;
    const turn = epoch.current, expected = revision.current; writing.current = true; setBusy(true); setError('');
    try {
      if (!navigator.locks) throw new Error('Use a browser with local storage and Web Locks enabled.');
      await navigator.locks.request(`relay-after-school:${key}`, async () => {
        const latest = await load();
        if (turn !== epoch.current) throw new Error('Account changed; save canceled.');
        if (latest.revision !== expected) throw new Error('Plans changed in another tab. Load saved plans before saving; your draft has not been overwritten.');
        const next = validatePlannerStore({ ...change(latest), revision: latest.revision + 1 });
        assertDistrictPages(next.plans.flatMap(p => p.input.tasks.filter(t => t.origin === 'reader').map(t => ({ url: t.sourceUrl! }))), account.district.schoology);
        const encrypted = await encryptLocal(next, account.dataKey, `planner:${key}`);
        if (turn !== epoch.current) throw new Error('Account changed; save canceled.');
        await access(key, 'readwrite', s => s.put(encrypted, 'current'));
        if (turn === epoch.current) { revision.current = next.revision; setState(next); }
      });
      return turn === epoch.current;
    } catch (e) { if (turn === epoch.current) setError(e instanceof Error ? e.message : 'This browser could not save the plan.'); return false; }
    finally { writing.current = false; if (turn === epoch.current) setBusy(false); }
  }
  function save(plan: EveningPlan) { return update(old => {
    validatePlan(plan);
    if (plan.input.date < dayKey(new Date())) throw new Error('This date is now in the past. Generate a plan for today instead.');
    const plans = [...old.plans.filter(p => p.input.date !== plan.input.date), plan].sort((a, b) => b.input.date.localeCompare(a.input.date));
    if (plans.length > 30) throw new Error('30 planning days are saved. Delete an older saved plan before adding another.');
    return { ...old, prefs: plan.input.prefs, plans };
  }); }
  function remove(date: string) { return update(old => ({ ...old, plans: old.plans.filter(p => p.input.date !== date) })); }
  return { state, ready, busy, error, reload, save, remove };
}
