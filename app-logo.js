// Universal Brand Logo & Media Asset Helper
(function() {
    'use strict';

    // High-resolution Vector SVG Data URI for OneReal Logo (Zero-Network Fallback)
    const APP_OR_LOGO_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs><linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%231e1b4b"/><stop offset="50%" stop-color="%230f172a"/><stop offset="100%" stop-color="%231e293b"/></linearGradient><linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23818cf8"/><stop offset="50%" stop-color="%234f46e5"/><stop offset="100%" stop-color="%23f59e0b"/></linearGradient><linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23ffffff"/><stop offset="50%" stop-color="%23e0e7ff"/><stop offset="100%" stop-color="%23c7d2fe"/></linearGradient><linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23fbbf24"/><stop offset="100%" stop-color="%23d97706"/></linearGradient><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="%234f46e5" flood-opacity="0.4"/></filter></defs><rect x="24" y="24" width="464" height="464" rx="112" ry="112" fill="url(%23bgGrad)" filter="url(%23glow)"/><rect x="24" y="24" width="464" height="464" rx="112" ry="112" fill="none" stroke="url(%23borderGrad)" stroke-width="12" opacity="0.85"/><circle cx="256" cy="256" r="160" fill="none" stroke="%234f46e5" stroke-width="2" opacity="0.25" stroke-dasharray="8 8"/><g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" text-anchor="middle" dominant-baseline="central"><text x="256" y="260" font-size="210" fill="url(%23textGrad)" letter-spacing="-8">OR</text></g><g transform="translate(372, 140) scale(0.9)"><path d="M0 -22 L6 -6 L22 0 L6 6 L0 22 L-6 6 L-22 0 L-6 -6 Z" fill="url(%23goldGrad)"/><circle cx="0" cy="0" r="3" fill="%23fff"/></g><rect x="140" y="380" width="232" height="12" rx="6" fill="url(%23borderGrad)"/></svg>';

    window.DEFAULT_APP_LOGO = APP_OR_LOGO_SVG;

    // Self-healing function that repairs all logo elements across the DOM
    function repairAppLogos() {
        try {
            const images = document.querySelectorAll('img[src*="icon-or"], img[alt*="OR"], img[alt*="logo" i], .auth-logo img, .sidebar-logo img, .brand-mark img, .student-logo-wrap img');
            images.forEach(img => {
                // If the image naturalWidth is 0 (broken or not loaded) or src is empty
                if (!img.src || img.naturalWidth === 0 || img.getAttribute('src') === '/icon-or.svg' || img.getAttribute('src') === 'icon-or.svg') {
                    img.onerror = null;
                    img.src = APP_OR_LOGO_SVG;
                }
            });
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', repairAppLogos);
    } else {
        repairAppLogos();
    }

    // Secondary pass after full page load to catch late async renderings
    window.addEventListener('load', repairAppLogos);
    setTimeout(repairAppLogos, 250);
    setTimeout(repairAppLogos, 1000);
})();
