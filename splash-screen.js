/**
 * OneReal Splash Screen - splash-screen.js
 * Self-contained, zero-dependency.
 * Include via <script src="/splash-screen.js"> in <head> (after app-logo.js).
 *
 * Public API:
 *   window.completeAppInitialization()  -- call from your app to signal init done.
 */
(function () {
  'use strict';

  /* CONFIG: only location to update branding/timing */
  var CONFIG = {
    appName:      'OneReal Report Generator',
    tagline:      'Smart • Accurate • Efficient',
    loadingText:  'Preparing your system…',
    version:      '1.0.0',
    copyright:    '© 2026 OneReal IT Consult',
    minDisplayMs: 5000,
    fadeOutMs:    400,
  };

  /* Guard: run once */
  if (document.getElementById('or-splash')) return;

  /* Reduced-motion preference */
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Inject styles */
  var styleEl = document.createElement('style');
  styleEl.id = 'or-splash-style';
  styleEl.textContent = [
    '@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");',
    '#or-splash{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;background:#0d1224;font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:#f8fafc;-webkit-font-smoothing:antialiased;opacity:0;pointer-events:all;will-change:opacity;}',
    '#or-splash-bg{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 60% at 20% 0%,rgba(79,70,229,.13) 0%,transparent 65%),radial-gradient(ellipse 60% 50% at 85% 90%,rgba(245,158,11,.07) 0%,transparent 60%),radial-gradient(ellipse 100% 100% at 50% 50%,rgba(30,27,75,.92) 0%,#0d1224 100%);}',
    '#or-splash-grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(129,140,248,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(129,140,248,.03) 1px,transparent 1px);background-size:52px 52px;opacity:0;transition:opacity .9s ease;}',
    '.or-orb{position:absolute;border-radius:50%;pointer-events:none;filter:blur(68px);opacity:0;transition:opacity 1.3s ease;}',
    '#or-orb-a{width:460px;height:460px;top:-200px;left:-140px;background:radial-gradient(circle,rgba(79,70,229,.18) 0%,transparent 70%);}',
    '#or-orb-b{width:360px;height:360px;bottom:-160px;right:-100px;background:radial-gradient(circle,rgba(245,158,11,.11) 0%,transparent 70%);}',
    '#or-splash-accent{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 0%,#818cf8 28%,#4f46e5 54%,#f59e0b 78%,transparent 100%);opacity:0;transform:scaleX(.2);transform-origin:left center;transition:opacity .6s ease,transform .8s cubic-bezier(.2,.8,.2,1);}',
    '#or-splash-main{position:relative;display:flex;flex-direction:column;align-items:center;flex:1;justify-content:center;padding:24px 20px 0;z-index:1;text-align:center;max-width:480px;width:100%;margin:0 auto;}',
    '#or-splash-logo{width:112px;height:112px;object-fit:contain;margin-bottom:28px;opacity:0;transform:scale(.93);flex-shrink:0;transition:opacity .7s ease-out,transform .7s cubic-bezier(.2,.8,.2,1);}',
    '#or-splash-name{font-size:clamp(1.3rem,4vw,1.9rem);font-weight:700;letter-spacing:-.025em;color:#fff;margin:0 0 10px;line-height:1.2;opacity:0;transform:translateY(14px);transition:opacity .5s ease-out,transform .5s ease-out;}',
    '#or-splash-tagline{font-size:clamp(.8rem,2.5vw,.95rem);font-weight:500;color:#94a3b8;letter-spacing:.06em;margin:0 0 44px;opacity:0;transition:opacity .5s ease-out;}',
    '#or-splash-loader{display:flex;flex-direction:column;align-items:center;gap:12px;opacity:0;transition:opacity .45s ease-out;}',
    '#or-splash-loader-text{font-size:.8rem;color:#64748b;letter-spacing:.03em;}',
    '#or-splash-dots{display:flex;gap:7px;align-items:center;}',
    '.or-dot{width:7px;height:7px;background:#818cf8;border-radius:50%;animation:orDotPulse 1.4s infinite ease-in-out both;}',
    '.or-dot:nth-child(1){animation-delay:-.32s;}',
    '.or-dot:nth-child(2){animation-delay:-.16s;}',
    '.or-dot:nth-child(3){animation-delay:0s;}',
    '@keyframes orDotPulse{0%,80%,100%{transform:scale(.55);opacity:.35;}40%{transform:scale(1);opacity:1;}}',
    '#or-splash-footer{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:0 20px 28px;opacity:0;transition:opacity .45s ease-out;}',
    '#or-splash-version,#or-splash-copyright{font-size:.72rem;color:#334155;letter-spacing:.04em;}',
    '@media(max-width:480px){#or-splash-logo{width:88px;height:88px;margin-bottom:22px;}#or-splash-tagline{margin-bottom:36px;}#or-splash-footer{padding-bottom:20px;}}',
    '@media(max-height:520px) and (orientation:landscape){#or-splash-logo{width:70px;height:70px;margin-bottom:14px;}#or-splash-main{padding-top:10px;}#or-splash-tagline{margin-bottom:24px;}}',
    '@media(prefers-reduced-motion:reduce){#or-splash-logo,#or-splash-name,#or-splash-tagline,#or-splash-loader,#or-splash-footer,#or-splash-grid,.or-orb,#or-splash-accent{transition:none!important;transform:none!important;animation:none!important;}.or-dot{animation:none!important;opacity:1!important;transform:scale(1)!important;}}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(styleEl);

  /* Build DOM */
  var el = document.createElement('div');
  el.id = 'or-splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', CONFIG.appName + ' \u2014 ' + CONFIG.loadingText);

  var logoErr = "this.onerror=null;this.src=window.DEFAULT_APP_LOGO||'';";
  el.innerHTML =
    '<div id="or-splash-bg"></div>' +
    '<div id="or-splash-grid" aria-hidden="true"></div>' +
    '<div id="or-orb-a" class="or-orb" aria-hidden="true"></div>' +
    '<div id="or-orb-b" class="or-orb" aria-hidden="true"></div>' +
    '<div id="or-splash-accent" aria-hidden="true"></div>' +
    '<main id="or-splash-main">' +
      '<img id="or-splash-logo" src="/icon-or.svg" alt="OneReal Logo" width="112" height="112" onerror="' + logoErr + '">' +
      '<h1 id="or-splash-name">' + CONFIG.appName + '</h1>' +
      '<p id="or-splash-tagline">' + CONFIG.tagline + '</p>' +
      '<div id="or-splash-loader">' +
        '<div id="or-splash-loader-text" aria-live="polite">' + CONFIG.loadingText + '</div>' +
        '<div id="or-splash-dots" aria-hidden="true">' +
          '<div class="or-dot"></div>' +
          '<div class="or-dot"></div>' +
          '<div class="or-dot"></div>' +
        '</div>' +
      '</div>' +
    '</main>' +
    '<footer id="or-splash-footer">' +
      '<div id="or-splash-version">Version ' + CONFIG.version + '</div>' +
      '<div id="or-splash-copyright">' + CONFIG.copyright + '</div>' +
    '</footer>';

  /* Mount & animate */
  function mount() {
    if (!document.body) { requestAnimationFrame(mount); return; }
    document.body.appendChild(el);

    if (reducedMotion) {
      el.style.opacity = '1';
      showAll(['or-splash-grid','or-orb-a','or-orb-b']);
      revealAccent();
      revealLogo();
      showAll(['or-splash-name','or-splash-tagline','or-splash-loader','or-splash-footer']);
      return;
    }

    requestAnimationFrame(function () {
      /* 0ms: background */
      el.style.transition = 'opacity .5s ease-out';
      el.style.opacity = '1';

      after(80,   function () { showAll(['or-orb-a','or-orb-b']); });
      after(120,  function () { showAll(['or-splash-grid']); });
      after(150,  revealAccent);
      after(300,  revealLogo);   /* 300-1000ms: logo */
      after(700,  revealName);   /* 700-1200ms: app name */
      after(900,  function () { showAll(['or-splash-tagline']); }); /* 900-1400ms: tagline */
      after(1100, function () { showAll(['or-splash-loader','or-splash-footer']); }); /* 1100ms+: loader */
    });
  }

  /* Exit control */
  var _initDone = false, _minDone = false;

  setTimeout(function () { _minDone = true; maybeExit(); }, CONFIG.minDisplayMs);

  if (document.readyState === 'complete') {
    scheduleInit();
  } else {
    window.addEventListener('load', scheduleInit);
  }

  function scheduleInit() {
    setTimeout(function () { _initDone = true; maybeExit(); }, 60);
  }

  /* Public API: call this from your app to exit early once initialised */
  window.completeAppInitialization = function () {
    _initDone = true;
    maybeExit();
  };

  function maybeExit() {
    if (_initDone && _minDone) removeSplash();
  }

  function removeSplash() {
    if (!el || el._removing) return;
    el._removing = true;
    el.style.transition = 'opacity ' + CONFIG.fadeOutMs + 'ms ease-out';
    el.style.opacity = '0';
    setTimeout(function () {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      delete window.completeAppInitialization;
    }, CONFIG.fadeOutMs + 60);
  }

  /* Helpers */
  function after(ms, fn) { setTimeout(fn, ms); }
  function ge(id) { return document.getElementById(id); }
  function showAll(ids) {
    ids.forEach(function (id) { var n = ge(id); if (n) n.style.opacity = '1'; });
  }
  function revealAccent() {
    var a = ge('or-splash-accent');
    if (a) { a.style.opacity = '1'; a.style.transform = 'scaleX(1)'; }
  }
  function revealLogo() {
    var logo = ge('or-splash-logo');
    if (logo) { logo.style.opacity = '1'; logo.style.transform = 'scale(1)'; }
  }
  function revealName() {
    var n = ge('or-splash-name');
    if (n) { n.style.opacity = '1'; n.style.transform = 'translateY(0)'; }
  }

  /* Boot */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

})();