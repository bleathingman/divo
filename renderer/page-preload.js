// Sandboxed preload (contextIsolation: true, sandbox: true)
// Tourne AVANT tout script de la page — injecte le patch fetch dans le monde principal
// Le guard window.__dvE empêche la double-exécution si dom-ready l'injecte aussi après.
;(function () {
  try {
    var href = location.href || ''
    if (!href.includes('youtube.com') && !href.includes('youtu.be')) return
    var s = document.createElement('script')
    s.textContent = `(function(){
  if (window.__dvE) return; window.__dvE = 1;

  var AD_KEYS = ['adPlacements','playerAds','adSlots','adBreakHeartbeatParams',
                 'externalAdsConfig','auxiliaryUi','paidContentOverlay',
                 'adCpns','adMetadata'];

  function cleanYT(obj, d) {
    if (!obj || typeof obj !== 'object' || d > 8) return;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) cleanYT(obj[i], d + 1);
      return;
    }
    for (var i = 0; i < AD_KEYS.length; i++) delete obj[AD_KEYS[i]];
    if (obj.playabilityStatus && obj.playabilityStatus.status &&
        obj.playabilityStatus.status !== 'OK' &&
        obj.playabilityStatus.status !== 'LIVE_STREAM_OFFLINE' &&
        obj.playabilityStatus.status !== 'LOGIN_REQUIRED') {
      if (!obj.playabilityStatus.reason) obj.playabilityStatus.status = 'OK';
    }
    for (var k in obj) {
      if (obj.hasOwnProperty(k) && obj[k] && typeof obj[k] === 'object') {
        cleanYT(obj[k], d + 1);
      }
    }
  }

  try {
    var cur = window.ytInitialPlayerResponse;
    if (cur) cleanYT(cur, 0);
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      get: function() { return cur; },
      set: function(v) { cleanYT(v, 0); cur = v; },
      configurable: true
    });
  } catch {}

  var _f = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var p = _f.apply(this, arguments);
    if (!url.includes('/youtubei/v1/player') && !url.includes('/youtubei/v1/next')) return p;
    return p.then(function(resp) {
      var fallback = resp.clone();
      return resp.text().then(function(text) {
        try {
          var json = JSON.parse(text);
          cleanYT(json, 0);
          var h = {};
          resp.headers.forEach(function(v, k) {
            if (k !== 'content-encoding' && k !== 'content-length' && k !== 'transfer-encoding') h[k] = v;
          });
          return new Response(JSON.stringify(json), { status: resp.status, statusText: resp.statusText, headers: h });
        } catch { return fallback; }
      }).catch(function() { return fallback; });
    });
  };
})()`
    ;(document.head || document.documentElement).appendChild(s)
    s.remove()
  } catch (e) {}
})()
