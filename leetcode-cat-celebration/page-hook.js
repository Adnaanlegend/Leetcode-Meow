/*
 * Runs in the page's main world (see manifest.json "world": "MAIN").
 * LeetCode reports pass/fail through the polling endpoint /check/{id}/,
 * which returns status_code 10 / status_msg "Accepted" once all test cases
 * pass. We watch fetch + XMLHttpRequest for that payload and re-announce
 * it as a DOM event the content script can hear.
 */
(() => {
  'use strict';

  if (window.__lcCatPageHook) return;
  window.__lcCatPageHook = true;

  function shouldWatch(url) {
    if (typeof url !== 'string') return false;
    return (
      /\/check\//.test(url) ||
      /\/problems\/[^/]+\/submit\/?$/.test(url) ||
      /\/problems\/[^/]+\/run\/?$/.test(url)
    );
  }

  function announce(json, url) {
    if (!json || typeof json !== 'object') return;
    const accepted = json.status_code === 10 || json.status_msg === 'Accepted';
    if (!accepted) return;
    try {
      window.dispatchEvent(
        new CustomEvent('lc-cat:accepted', {
          detail: {
            url: url,
            submissionId: json.submission_id || null
          }
        })
      );
    } catch (_) {
      /* ignore */
    }
  }

  // ---- fetch ----
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = function (input) {
      let url = '';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (_) {
        /* ignore */
      }
      const result = origFetch.apply(this, arguments);
      if (shouldWatch(url)) {
        result
          .then((res) => {
            try {
              const ct = res.headers.get('content-type') || '';
              if (ct.indexOf('json') === -1) return;
              res
                .clone()
                .json()
                .then((j) => announce(j, url))
                .catch(() => {});
            } catch (_) {
              /* ignore */
            }
          })
          .catch(() => {});
      }
      return result;
    };
  }

  // ---- XMLHttpRequest ----
  if (typeof window.XMLHttpRequest === 'function') {
    const proto = window.XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;

    proto.open = function (method, url) {
      try {
        this.__lcCatUrl = typeof url === 'string' ? url : String(url);
      } catch (_) {
        this.__lcCatUrl = '';
      }
      return origOpen.apply(this, arguments);
    };

    proto.send = function () {
      const url = this.__lcCatUrl || '';
      if (shouldWatch(url)) {
        this.addEventListener('load', function () {
          try {
            const ct = this.getResponseHeader('content-type') || '';
            if (ct.indexOf('json') === -1) return;
            announce(JSON.parse(this.responseText), url);
          } catch (_) {
            /* ignore */
          }
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
