// A small corner indicator preserves the logo instead of covering it with a
// browser-sized text badge. Draw every device scale for crisp toolbar icons.
globalThis.BetterIliasToolbar = (() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const colors = { synced: '#0AACA5', unauthenticated: '#dc2626', checking: '#d97706', error: '#d97706' };
  let artwork, revision = 0;
  function canvas(size) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
    const element = document.createElement('canvas');
    element.width = element.height = size;
    return element;
  }
  async function iconData(status) {
    artwork ||= fetch(api.runtime?.getURL('icon128.png') || new URL('icon128.png', location.href))
      .then(response => { if (!response.ok) throw new Error('Toolbar artwork unavailable'); return response.blob(); })
      .then(blob => createImageBitmap(blob))
      .catch(error => { artwork = null; throw error; });
    const image = await artwork, images = {};
    for (const size of [16, 32, 48, 64]) {
      const context = canvas(size).getContext('2d');
      context.scale(size / 16, size / 16);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      // Crop the existing icon's transparent margins, preserving its aspect ratio.
      context.drawImage(image, 20, 11, 88, 102, .5, .5, 15 * 88 / 102, 15);
      if (colors[status]) {
        context.beginPath();
        context.arc(13.4, 13.4, 2, 0, Math.PI * 2);
        context.fillStyle = colors[status];
        context.strokeStyle = '#ffffff';
        context.lineWidth = 1;
        context.stroke();
        context.fill();
      }
      images[size] = context.getImageData(0, 0, size, size);
    }
    return images;
  }
  async function setStatus(status) {
    const current = ++revision, action = api.action || api.browserAction;
    if (!action) return;
    try {
      await action.setBadgeText({ text: '' });
      const imageData = await iconData(status);
      if (current === revision) {
        await action.setIcon({ imageData });
        if (current === revision && action.setTitle && globalThis.BetterIliasI18n) {
          const { t } = BetterIliasI18n;
          const label = status === 'synced' ? t('Synchronisiert') : status === 'unauthenticated' ? t('Nicht angemeldet')
            : status === 'checking' ? t('Prüfe...') : status === 'error' ? t('Nicht verifiziert') : '';
          await action.setTitle({ title: label ? `BetterIlias – ${label}` : 'BetterIlias Companion' });
        }
      }
    } catch (error) { console.warn('[BetterIlias Toolbar] Could not draw status:', error); }
  }
  return { setStatus, iconData };
})();
