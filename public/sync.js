/* Shared cross-device sync layer for the host-console / big-screen games.
 *
 * A console (one laptop) pushes declarative `state` snapshots and imperative
 * `event` commands to the relay; displays (e.g. two iPads) subscribe over SSE.
 * Games keep their existing localStorage/BroadcastChannel paths as a same-device
 * fallback; this layer adds the cross-device path on top.
 *
 * window.Sync API:
 *   Sync.reachable()                       -> Promise<boolean>
 *   Sync.display(room, onState, onEvent)   -> EventSource   (big screen)
 *   Sync.console(room)                     -> { claim, pushState, pushEvent }
 */
(function () {
  // Default production relay; overridable for local testing or re-pointing
  // without editing this file: ?backend=… , window.SYNC_BACKEND, or
  // localStorage 'sync_backend'.
  var DEFAULT_BACKEND = "https://brain-aging-sync.ai-builders.space";
  var override = null;
  try {
    override = new URLSearchParams(location.search).get("backend") ||
      (typeof window !== "undefined" && window.SYNC_BACKEND) ||
      localStorage.getItem("sync_backend");
  } catch (_) {}
  var BACKEND = (override || DEFAULT_BACKEND).replace(/\/+$/, "");

  function reachable() {
    return fetch(BACKEND + "/healthz", { cache: "no-store" })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  // Big screen: subscribe to a room. EventSource auto-reconnects; on every
  // (re)connect the relay resends the current snapshot, so displays self-heal
  // after iPad sleep / network blips. onState(snapshot) / onEvent(evt).
  function display(room, onState, onEvent) {
    var es = new EventSource(BACKEND + "/r/" + room + "/sse");
    es.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.kind === "state") { if (onState) onState(msg.data); }
      else if (msg.kind === "event") { if (onEvent) onEvent(msg.data); }
    };
    return es;
  }

  // Console: push state/events and hold the single-console lock.
  function consoleRole(room) {
    var token = null;
    var hb = null;

    function post(path, body) {
      return fetch(BACKEND + "/r/" + room + "/" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      }).then(function (r) { return r.json(); });
    }

    function claim(force) {
      return post("claim", { force: !!force }).then(function (res) {
        if (res && res.ok) {
          token = res.token;
          if (hb) clearInterval(hb);
          hb = setInterval(function () { post("heartbeat", { token: token }); }, 4000);
        }
        return res; // { ok: true, token } or { ok: false, reason: "busy" }
      });
    }

    function pushState(s) { return post("state", s); }
    function pushEvent(e) { return post("event", e); }

    return { claim: claim, pushState: pushState, pushEvent: pushEvent };
  }

  window.Sync = {
    BACKEND: BACKEND,
    reachable: reachable,
    display: display,
    console: consoleRole,
  };
})();
