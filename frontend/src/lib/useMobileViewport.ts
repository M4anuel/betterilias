import { useEffect, useState } from 'react';

/** Keep mounted forms intact as the keyboard and browser chrome change size. */
export function useMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const updateMedia = () => setIsMobile(media.matches);
    const updateViewport = () => {
      const viewport = window.visualViewport;
      document.documentElement.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`);
    };
    media.addEventListener('change', updateMedia);
    window.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    updateViewport();
    return () => {
      media.removeEventListener('change', updateMedia);
      window.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
    };
  }, []);
  return isMobile;
}
