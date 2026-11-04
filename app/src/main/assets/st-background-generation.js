/*
 * Android-only generation lifecycle bridge.
 * The WebView still owns the native SillyTavern chat/network request; the
 * Android foreground service holds a bounded CPU wake lock while it runs.
 */
(() => {
    'use strict';
    if (window.__stBackgroundGenerationInstalled) return;
    window.__stBackgroundGenerationInstalled = true;
    if (!window.STAndroidGeneration?.setActive) return;

    let generating = false;
    let lastHeartbeat = 0;
    const notify = (active, force = false) => {
        // Streaming tokens may arrive many times per second. A heartbeat
        // every 45 seconds refreshes the bounded Android wake lock.
        const now = Date.now();
        if (generating === active && !(active && force && now - lastHeartbeat >= 45000)) {
            return;
        }
        generating = active;
        if (active) lastHeartbeat = now;
        try {
            window.STAndroidGeneration.setActive(active);
        } catch (error) {
            console.warn('[Background generation] Native bridge unavailable',error);
        }
    };

    import(new URL('script.js',document.baseURI).href).then(api => {
        const source = api.eventSource;
        const events = api.event_types;
        if (!source?.on || !events) return;
        source.on(events.GENERATION_STARTED,() => notify(true));
        source.on(events.GENERATION_ENDED,() => notify(false));
        source.on(events.GENERATION_STOPPED,() => notify(false));
        if (events.STREAM_TOKEN_RECEIVED) {
            source.on(events.STREAM_TOKEN_RECEIVED,() => {
                if (!generating) notify(true);
                else notify(true,true);
            });
        }
        // Navigation/reload destroys the pending fetch. Never retain
        // a wake lock after the original WebView generation is gone.
        window.addEventListener('pagehide',() => notify(false));
    }).catch(error => console.error(
        '[Background generation] SillyTavern events unavailable',error
    ));
})();
