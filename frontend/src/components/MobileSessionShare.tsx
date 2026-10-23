import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { cache } from '../lib/cache';
import { mobileAppUrl, mobileSessionUrl } from '../lib/mobileSession';

const ADDRESS_KEY = 'betterilias_mobile_app_address';

export const MobileSessionShare: React.FC<{ isAuthenticated: boolean }> = ({ isAuthenticated }) => {
  const [expanded, setExpanded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [address, setAddress] = useState(() => {
    try { return localStorage.getItem(ADDRESS_KEY) || `${window.location.origin}${window.location.pathname}`; }
    catch { return `${window.location.origin}${window.location.pathname}`; }
  });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!isAuthenticated) { setSessionId(null); setExpanded(false); }
  }, [isAuthenticated]);
  let addressError: string | null = null;
  let shareUrl: string | null = null;
  try {
    mobileAppUrl(address);
    if (sessionId) shareUrl = mobileSessionUrl(address, sessionId);
  } catch (err: any) { addressError = err.message; }
  const showCode = async () => {
    setExpanded(true);
    setLoading(true);
    setError(null);
    try {
      const result = await api.prepareMobileSession();
      if (mounted.current) {
        if (!/^[a-zA-Z0-9_-]{1,256}$/.test(result.session_id) || result.session_id === 'default') throw new Error('Bitte synchronisiere deine ILIAS-Sitzung erneut.');
        // Also adopt generated keys for legacy desktop sessions, so both devices stay in sync.
        cache.setSessionId(result.session_id);
        setSessionId(result.session_id);
      }
    } catch (err: any) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setLoading(false); }
  };
  const rememberAddress = () => {
    try { localStorage.setItem(ADDRESS_KEY, mobileAppUrl(address).toString()); }
    catch { /* Invalid addresses are explained inline; no credentials are stored here. */ }
  };
  return <section className="border-t border-slate-100 pt-3 dark:border-slate-800 space-y-2" aria-label="Handy verbinden">
    <div className="flex items-center gap-2 text-xs font-semibold"><Smartphone className="h-4 w-4 text-[#0AACA5]" /><span>Handy verbinden</span></div>
    {!isAuthenticated ? <p className="text-xs text-slate-500 dark:text-slate-400">Synchronisiere zuerst deine ILIAS-Sitzung am Desktop.</p>
      : !expanded ? <button type="button" onClick={showCode} className="w-full rounded-xl bg-teal-50 dark:bg-teal-950/40 px-3 py-2 text-xs font-semibold text-teal-800 dark:text-teal-200">QR-Code anzeigen</button>
      : <>
        <label className="block text-xs font-medium" htmlFor="mobile-app-address">BetterIlias-Adresse für das Handy</label>
        <input id="mobile-app-address" type="url" autoComplete="off" value={address}
          placeholder="http://192.168.1.20:5173" onBlur={rememberAddress}
          onChange={(event) => { setAddress(event.target.value); setCopyState('idle'); }}
          aria-invalid={Boolean(addressError)} aria-describedby="mobile-address-help"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs" />
        <p id="mobile-address-help" className="text-[11px] text-slate-500 dark:text-slate-400">Beide Geräte müssen dieselbe BetterIlias-Installation erreichen. Bei lokaler Nutzung: Desktop im selben WLAN erreichbar halten.</p>
        {addressError && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{addressError}</p>}
        {loading && <p role="status" className="text-xs">Verbindung wird vorbereitet…</p>}
        {error && <div role="alert" className="text-xs text-red-600 dark:text-red-400">{error} <button type="button" disabled={loading} onClick={showCode} className="underline">Erneut versuchen</button></div>}
        {shareUrl && isAuthenticated && <>
          <div className="flex justify-center rounded-xl bg-white p-2">
            <QRCodeSVG value={shareUrl} size={216} level="M" marginSize={4} title="QR-Code zum Verbinden mit BetterIlias" role="img" />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">Mit der Handykamera scannen und den Link öffnen. Eine Erweiterung auf dem Handy ist nicht nötig.</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Der Code gewährt Zugriff auf deine aktuelle ILIAS-Sitzung. Nur selbst scannen. Beide Geräte teilen dieselbe Sitzung; nach deren Ablauf am Desktop erneut synchronisieren.</p>
          <button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(shareUrl); rememberAddress(); setCopyState('copied'); }
            catch { setCopyState('error'); }
          }} className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold"><Copy className="h-3.5 w-3.5" />Verbindungslink kopieren</button>
          <span role="status" className="block text-[11px] text-slate-500">{copyState === 'copied' ? 'Link kopiert.' : copyState === 'error' ? 'Kopieren ist hier nicht verfügbar. Scanne stattdessen den QR-Code.' : ''}</span>
        </>}
      </>}
  </section>;
};
