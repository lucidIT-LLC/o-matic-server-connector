// Volatile observation of Server kernel responses in this process.
// Not a grant, not a startup proof, and not durable memory.
// The Server ledger is the durable delegation row. This module never reads
// or writes it. Eviction, expiry, and startup reset are unresolved, not completed.

const ROUTES = new Set(["same_kernel", "same_conversation", "same_principal"]);
const MAX_AGE_MS = 3600 * 1000;

export function createPeerMemory({ maxOpen = 128 } = {}) {
  if (!Number.isInteger(maxOpen) || maxOpen < 1) throw new Error("invalid peer bound");
  const open = new Map();
  const byId = new Map();
  const order = [];
  const unresolved = [];
  let matchedReturns = 0;

  function noteUnresolved(rec, reason) {
    unresolved.push({ delegationId: rec.delegationId, connection: rec.connection, reason });
    if (unresolved.length > maxOpen) unresolved.shift();
  }
  function deleteRecord(id) {
    const rec = byId.get(id);
    if (!rec) return null;
    byId.delete(id);
    const index = order.indexOf(id);
    if (index >= 0) order.splice(index, 1);
    const set = open.get(rec.slot);
    if (set) {
      set.delete(id);
      if (set.size === 0) open.delete(rec.slot);
    }
    return rec;
  }
  function evictOldest(reason) {
    const id = order[0];
    const rec = id ? deleteRecord(id) : null;
    if (rec) noteUnresolved(rec, reason);
  }
  function tick(now) {
    if (!Number.isFinite(now)) return;
    for (const id of [...order]) {
      const rec = byId.get(id);
      if (rec && now - rec.observedAt > MAX_AGE_MS) {
        deleteRecord(id);
        noteUnresolved(rec, "expired");
      }
    }
  }
  return {
    rememberDelegation(slot, connection, result, now) {
      tick(now);
      if (!result || result.reason_code || result.kernel_state !== "active") return false;
      if (typeof result.delegation_id !== "string" || result.delegation_id.length === 0) return false;
      if (typeof result.kernel_session_id !== "string" || result.kernel_session_id.length === 0) return false;
      if (typeof connection !== "string" || typeof slot !== "string" || !Number.isFinite(now)) return false;
      const existing = byId.get(result.delegation_id);
      if (existing) {
        return existing.connection === connection
          && existing.originKernel === result.kernel_session_id
          && existing.slot === slot;
      }
      while (order.length >= maxOpen) evictOldest("evicted");
      const rec = { delegationId: result.delegation_id, connection, originKernel: result.kernel_session_id, slot, observedAt: now };
      byId.set(rec.delegationId, rec);
      order.push(rec.delegationId);
      let set = open.get(slot);
      if (!set) { set = new Map(); open.set(slot, set); }
      set.set(rec.delegationId, rec);
      return true;
    },
    // kernel_return.kernel_session_id is the closer. delegation_kernel_session_id is the origin.
    observeReturn(connection, result, now) {
      tick(now);
      if (!result || result.reason_code) return false;
      if (result.kernel_state !== "active" || result.delegation_state !== "returned") return false;
      if (typeof result.delegation_id !== "string" || result.delegation_id.length === 0) return false;
      const originField = result.delegation_kernel_session_id;
      const closer = result.closed_by_kernel_session_id;
      if (typeof originField !== "string" || originField.length === 0) return false;
      if (typeof closer !== "string" || closer.length === 0) return false;
      if (result.kernel_session_id !== closer) return false;
      if (!ROUTES.has(result.return_route)) return false;
      if (result.return_route === "same_kernel" ? closer !== originField : closer === originField) return false;
      const rec = byId.get(result.delegation_id);
      if (!rec || rec.connection !== connection || rec.originKernel !== originField) return false;
      deleteRecord(rec.delegationId);
      matchedReturns += 1;
      return true;
    },
    invalidateSlot(slot, reason) {
      const set = open.get(slot);
      if (!set) return 0;
      const ids = [...set.keys()];
      for (const id of ids) {
        const rec = deleteRecord(id);
        if (rec) noteUnresolved(rec, reason);
      }
      return ids.length;
    },
    tick,
    openCount(slot) { return open.get(slot)?.size ?? 0; },
    unresolvedCount() { return unresolved.length; },
    matchedReturnCount() { return matchedReturns; },
    snapshot() {
      return {
        open: [...byId.values()].map((rec) => ({ ...rec })),
        unresolved: unresolved.map((rec) => ({ ...rec })),
        matchedReturns,
      };
    },
    clear() { open.clear(); byId.clear(); order.length = 0; unresolved.length = 0; matchedReturns = 0; },
  };
}
