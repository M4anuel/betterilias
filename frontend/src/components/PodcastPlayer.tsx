import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Captions, Maximize, Pause, Play, Settings2, VolumeX, X } from 'lucide-react';
import { api } from '../lib/api';
import { t, useLanguage } from '../lib/i18n';
import { VideoStreamInfo } from '../types';
import { cache } from '../lib/cache';
import { readVideoProgress, writeVideoProgress } from '../lib/videoProgress';

const timestamp = (time: number) => {
  const seconds = Math.max(0, Math.floor(time));
  return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const buttonStyle = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800';

function LayoutIcon({ mode }: { mode: 'inset' | 'split' | 'slides' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden="true">
    {mode === 'split' ? <><rect x="2" y="5" width="9" height="14" rx="1" /><rect x="13" y="5" width="9" height="14" rx="1" /></>
      : <><rect x="3" y="5" width="18" height="14" rx="1.5" />{mode === 'inset' && <rect x="13" y="5" width="8" height="6" rx="1" fill="currentColor" />}</>}
  </svg>;
}

function SpeakerIcon({ volume }: { volume: number }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4Z" />
    <path data-volume-wave="inner" opacity={volume > .15 ? 1 : .3} d="M15 8a5 5 0 0 1 0 8" />
    <path data-volume-wave="outer" opacity={volume > .5 ? 1 : .3} d="M18 5a9 9 0 0 1 0 14" />
  </svg>;
}

function PlayerSkeleton() {
  return <div className="player-stage bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" data-player-skeleton role="status" aria-label={t('player.loading')}>
    <div className="absolute inset-x-3 bottom-3 h-16 rounded-lg bg-slate-300 dark:bg-slate-700" />
  </div>;
}

export function PodcastPlayer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<VideoStreamInfo | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null); setError(false);
    api.getVideoStream(url).then(result => {
      if (active) { if (result.streams?.length) setData(result); else setError(true); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [url, revision]);
  return <dialog ref={dialog} aria-label={title} className="podcast-player-dialog rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/80 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
    onCancel={event => { event.preventDefault(); if (document.fullscreenElement) { void document.exitFullscreen(); } else onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <h2 className="min-w-0 break-words text-base font-bold sm:text-lg">{data?.title || title}</h2>
      <button type="button" aria-label={t('Schliessen')} onClick={onClose} className={`${buttonStyle} w-11 shrink-0 !px-0`}><X className="h-5 w-5" /></button>
    </div>
    <div className="space-y-4 p-3 sm:p-5">
      {error ? <p role="alert">{t('player.resolve_failed')} <button type="button" className={buttonStyle} onClick={() => setRevision(value => value + 1)}>{t('Erneut versuchen')}</button></p> : !data ? <PlayerSkeleton />
        : <SynchronizedPlayer key={`${cache.getSessionId()}_${url}_${revision}`} data={data} sourceUrl={url} onRetry={() => setRevision(value => value + 1)} />}
    </div>
  </dialog>;
}

function SynchronizedPlayer({ data, sourceUrl, onRetry }: { data: VideoStreamInfo; sourceUrl: string; onRetry: () => void }) {
  const [progressScope] = useState(() => cache.getSessionId());
  const [savedProgress] = useState(() => readVideoProgress(sourceUrl, progressScope));
  const initialPosition = savedProgress?.completed ? 0 : savedProgress?.position || 0;
  const audioStream = data.streams.find(stream => stream.main_audio) || data.streams[0];
  const slidesStream = data.streams.find(stream => stream !== audioStream && stream.content === 'presentation')
    || data.streams.find(stream => stream !== audioStream);
  const [audioQuality, setAudioQuality] = useState(() => Math.max(0, audioStream.renditions.findIndex(source => source.height === 720)));
  const [slidesQuality, setSlidesQuality] = useState((slidesStream?.renditions.length || 1) - 1);
  const [layout, setLayout] = useState<'inset' | 'split' | 'slides'>('inset');
  const [swapped, setSwapped] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(initialPosition);
  const [duration, setDuration] = useState(data.duration || 0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionIndex, setCaptionIndex] = useState(0);
  const [captionText, setCaptionText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'play' | 'pause'; id: number } | null>(null);
  const feedbackId = useRef(0);
  const mutedRef = useRef(false);
  const lastVolume = useRef(1);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsFocused, setControlsFocused] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const activity = useRef(Date.now());
  const lastInput = useRef<'pointer' | 'keyboard'>('pointer');
  const dragging = useRef(false);
  const canvasPress = useRef<{ id: number; x: number; y: number } | null>(null);
  const ignoreCanvasClick = useRef(false);
  const audio = useRef<HTMLVideoElement>(null);
  const playerArea = useRef<HTMLDivElement>(null);
  const slides = useRef<HTMLVideoElement>(null);
  const wanted = useRef(false);
  const position = useRef(initialPosition);
  const metadataReady = useRef(false);
  const knownDuration = useRef(data.duration);
  const lastSaved = useRef(0);
  const lastStartedAt = useRef(savedProgress?.lastStartedAt || null);
  const completed = useRef(savedProgress?.completed || false);
  const speed = useRef(1);
  const loudness = useRef(1);
  const controller = useRef<{ toggle: () => void; seek: (value: number) => void } | null>(null);
  const audioUrl = audioStream.renditions[audioQuality].url;
  const slidesUrl = slidesStream?.renditions[slidesQuality].url;
  const revealControls = () => { activity.current = Date.now(); setControlsVisible(true); };
  const saveProgress = (force = false) => {
    if (!metadataReady.current || (!force && Date.now() - lastSaved.current < 5000)) return;
    lastSaved.current = Date.now();
    writeVideoProgress(sourceUrl, progressScope, { position: position.current, duration: knownDuration.current,
      updatedAt: lastSaved.current, lastStartedAt: lastStartedAt.current, completed: completed.current });
  };

  useEffect(() => {
    const save = () => saveProgress(true);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => { window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save); save(); };
  }, []);

  function togglePlayback() {
    if (!controller.current) return;
    const next = !wanted.current;
    controller.current.toggle();
    setFeedback({ kind: next ? 'play' : 'pause', id: ++feedbackId.current });
    revealControls();
  }
  function toggleMute() {
    const next = !(mutedRef.current || loudness.current === 0);
    mutedRef.current = next; setMuted(next);
    if (!next && loudness.current === 0) { loudness.current = lastVolume.current; setVolume(lastVolume.current); }
    if (audio.current) { audio.current.muted = next; audio.current.volume = loudness.current; }
    revealControls();
  }
  function toggleFullscreen() {
    revealControls();
    if (document.fullscreenElement === playerArea.current) {
      void document.exitFullscreen().catch(() => setNotice(t('player.fullscreen_failed')));
    } else if (playerArea.current?.requestFullscreen && document.fullscreenEnabled) {
      void playerArea.current.requestFullscreen().catch(() => setNotice(t('player.fullscreen_failed')));
    } else setNotice(t('player.fullscreen_failed'));
  }
  function toggleCaptions() {
    revealControls();
    if (!data.captions?.length) { setNotice(t('player.no_captions')); return; }
    setCaptionsEnabled(value => !value);
  }
  function closeSettings(restore = true) {
    setSettingsOpen(false); setControlsFocused(false); revealControls();
    if (restore) settingsButton.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 850);
    return () => window.clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (settingsOpen) settingsPanel.current?.querySelector('select')?.focus();
  }, [settingsOpen]);
  useEffect(() => {
    setCaptionText('');
    const caption = data.captions?.[captionIndex];
    if (!captionsEnabled || !caption || !audio.current) return;
    let active = true;
    let track: HTMLTrackElement | null = null;
    let blobUrl: string | null = null;
    const abort = new AbortController();
    const update = () => {
      if (!active || !track) return;
      setCaptionText(Array.from(track.track.activeCues || []).map(cue => {
        const vtt = cue as VTTCue;
        return typeof vtt.getCueAsHTML === 'function' ? vtt.getCueAsHTML().textContent || '' : vtt.text;
      }).join('\n'));
    };
    api.getVideoCaptions(sourceUrl, captionIndex, abort.signal).then(text => {
      if (!active || !audio.current) return;
      blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      track = document.createElement('track');
      track.kind = 'subtitles'; track.label = caption.label; track.srclang = caption.language; track.src = blobUrl;
      track.addEventListener('load', update);
      track.addEventListener('error', () => { if (active) { setNotice(t('player.captions_failed')); setCaptionsEnabled(false); } });
      audio.current.appendChild(track);
      track.track.mode = 'hidden';
      track.track.addEventListener('cuechange', update);
    }).catch(() => { if (active) { setNotice(t('player.captions_failed')); setCaptionsEnabled(false); } });
    return () => {
      active = false; abort.abort();
      if (track) { track.track.removeEventListener('cuechange', update); track.remove(); }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [captionsEnabled, captionIndex, data.captions, sourceUrl]);

  // Capture shortcuts before native controls can turn Space into a second click.
  // Native arrows still operate focused sliders and selects.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.matches('textarea, input:not([type=range])')) return;
      const key = event.key.toLowerCase();
      const space = event.code === 'Space' || key === ' ';
      if (key === 'escape' && (settingsOpen || document.fullscreenElement === playerArea.current)) {
        event.preventDefault(); event.stopPropagation();
        if (settingsOpen) closeSettings(); else toggleFullscreen();
        return;
      }
      if (space || ['f', 'm', 'c'].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        lastInput.current = 'keyboard';
        if (space) togglePlayback(); else if (key === 'f') toggleFullscreen(); else if (key === 'm') toggleMute(); else toggleCaptions();
        return;
      }
      if (target.matches('input, select, button')) return;
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault(); revealControls();
        if (key === 'arrowleft' || key === 'arrowright') controller.current?.seek(Math.max(0, Math.min(duration, position.current + (key === 'arrowleft' ? -5 : 5))));
        else {
          const value = Math.max(0, Math.min(1, loudness.current + (key === 'arrowup' ? .05 : -.05)));
          loudness.current = value; setVolume(value); if (audio.current) audio.current.volume = value;
        }
      } else if (key === 'enter' && target === playerArea.current) { event.preventDefault(); togglePlayback(); }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); };
  });

  useEffect(() => {
    revealControls();
    if (controlsFocused || scrubbing || settingsOpen || error || buffering || (!playing && pointerInside)) return;
    const interval = window.setInterval(() => {
      if (Date.now() - activity.current >= 2500) { setControlsVisible(false); setPreviewTime(null); }
    }, 250);
    return () => window.clearInterval(interval);
  }, [playing, controlsFocused, scrubbing, settingsOpen, pointerInside, error, buffering]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === playerArea.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  useEffect(() => {
    if (!buffering) return;
    const timeout = window.setTimeout(() => {
      wanted.current = false;
      [audio.current, slides.current].forEach(video => video?.pause());
      setPlaying(false); setBuffering(false); setError(t('player.media_failed'));
    }, 20000);
    return () => window.clearTimeout(timeout);
  }, [buffering]);

  useEffect(() => {
    const master = audio.current!;
    const follower = slides.current;
    const videos = [master, ...(follower ? [follower] : [])];
    let active = true;
    let starting = false;
    metadataReady.current = false;
    setError(null);
    setPlaying(false); setBuffering(wanted.current); setMediaReady(false);
    const pause = () => { videos.forEach(video => video.pause()); setPlaying(false); saveProgress(true); };
    const resume = async () => {
      if (!active || !wanted.current || starting) return;
      if (!videos.every(video => video.readyState >= 3 && !video.seeking)) { setBuffering(true); return; }
      setBuffering(false);
      starting = true;
      try {
        await Promise.all(videos.map(video => video.play()));
        if (active && wanted.current) setPlaying(true);
        else videos.forEach(video => video.pause());
      } catch {
        if (active && wanted.current) { wanted.current = false; pause(); setBuffering(false); setError(t('player.play_failed')); }
      } finally { starting = false; }
    };
    const seek = (value: number) => {
      position.current = Math.max(0, value);
      completed.current = false;
      pause();
      for (const video of videos) if (video.readyState >= 1) video.currentTime = position.current;
      setTime(position.current);
      void resume();
    };
    controller.current = {
      toggle: () => {
        wanted.current = !wanted.current; setError(null);
        if (wanted.current) { completed.current = false; lastStartedAt.current = Date.now(); saveProgress(true); void resume(); }
        else { if (metadataReady.current && !master.seeking) position.current = master.currentTime; pause(); setBuffering(false); }
      },
      seek,
    };
    const removers: (() => void)[] = [];
    const listen = (video: HTMLVideoElement, event: string, callback: () => void) => {
      video.addEventListener(event, callback); removers.push(() => video.removeEventListener(event, callback));
    };
    videos.forEach(video => {
      listen(video, 'loadedmetadata', () => {
        if (Number.isFinite(video.duration) && video === master) {
          knownDuration.current = video.duration;
          position.current = Math.min(position.current, Math.max(0, video.duration - .25));
          setDuration(video.duration); setTime(position.current);
          metadataReady.current = true;
        }
        video.currentTime = position.current;
        video.playbackRate = speed.current;
      });
      listen(video, 'canplay', () => { if (videos.every(item => item.readyState >= 2)) setMediaReady(true); void resume(); });
      listen(video, 'seeked', () => { void resume(); });
      listen(video, 'waiting', () => { if (wanted.current) { pause(); setBuffering(true); } });
      listen(video, 'error', () => { wanted.current = false; pause(); setBuffering(false); setError(t('player.media_failed')); });
    });
    listen(master, 'timeupdate', () => {
      if (!metadataReady.current || master.seeking) return;
      position.current = completed.current ? 0 : master.currentTime; setTime(master.currentTime);
      saveProgress();
      if (follower && follower.readyState >= 1 && Math.abs(follower.currentTime - master.currentTime) > 0.3) follower.currentTime = master.currentTime;
    });
    listen(master, 'ended', () => { wanted.current = false; pause(); setBuffering(false); completed.current = true; position.current = 0; saveProgress(true); });
    master.muted = mutedRef.current; master.volume = loudness.current; master.src = audioUrl;
    if (follower && slidesUrl) { follower.muted = true; follower.src = slidesUrl; }
    videos.forEach(video => video.load());
    return () => {
      if (metadataReady.current && !master.seeking && !completed.current) position.current = master.currentTime;
      saveProgress(true); metadataReady.current = false;
      active = false; controller.current = null; removers.forEach(remove => remove());
      videos.forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    };
  }, [audioUrl, slidesUrl]);

  const primaryAudio = swapped;
  const frameStyle = (isAudio: boolean) => !slidesStream ? 'relative h-full w-full' : layout === 'slides' ? (isAudio === primaryAudio ? 'relative h-full w-full' : 'hidden')
    : layout === 'split' ? 'relative min-h-0 min-w-0 flex-1' : isAudio === primaryAudio ? 'relative h-full w-full'
      : 'absolute top-2 right-2 z-10 aspect-video w-[30%] overflow-hidden rounded-lg border border-white/60 shadow-lg';
  const displayedTime = scrubbing && previewTime !== null ? previewTime : time;
  const previewChapterIndex = previewTime === null ? -1 : data.chapters.findLastIndex(chapter => chapter.time <= previewTime);
  const previewChapter = data.chapters[previewChapterIndex];
  const previewPercent = duration && previewTime !== null ? 100 * previewTime / duration : 0;
  const overlayButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white';
  const previewAtPointer = (event: React.PointerEvent<HTMLInputElement>) => {
    if (!duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setPreviewTime(Math.max(0, Math.min(duration, (event.clientX - bounds.left - 8) / Math.max(1, bounds.width - 16) * duration)));
  };
  return <div>
    <div ref={playerArea} data-player-layout={layout} className="player-stage bg-black" tabIndex={0} role="group" aria-label={t('player.controls')}
      aria-keyshortcuts="Space f m c ArrowLeft ArrowRight" onClickCapture={event => {
        if (ignoreCanvasClick.current && (event.detail !== 0 || (event.nativeEvent as PointerEvent).pointerType)) { ignoreCanvasClick.current = false; event.preventDefault(); event.stopPropagation(); }
      }} onClick={event => {
        if ((event.target as Element).closest('.player-control-surface, .player-settings-popover')) return;
        if (settingsOpen) { closeSettings(); return; }
        togglePlayback();
      }}
      onPointerEnter={event => { if (event.pointerType === 'mouse') { setPointerInside(true); revealControls(); } }} onPointerLeave={() => setPointerInside(false)}
      onPointerMove={event => { if (event.pointerType === 'mouse' || dragging.current) revealControls(); }} onPointerDown={event => {
        if (!(event.target as Element).closest('.player-control-surface, .player-settings-popover') && event.button === 0) {
          canvasPress.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        revealControls();
      }} onPointerUp={event => {
        const press = canvasPress.current;
        canvasPress.current = null;
        if (!press || press.id !== event.pointerId) return;
        ignoreCanvasClick.current = true;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 12) {
          if (settingsOpen) closeSettings(); else togglePlayback();
        }
      }} onPointerCancel={() => { canvasPress.current = null; }}
      onPointerDownCapture={() => { ignoreCanvasClick.current = false; lastInput.current = 'pointer'; setControlsFocused(false); }} onFocus={revealControls}
      onKeyDown={event => { lastInput.current = 'keyboard'; revealControls(); }}>
      <div className={`absolute inset-0 overflow-hidden rounded-xl ${layout === 'split' ? 'flex flex-col gap-1 sm:flex-row' : ''}`}>
        <div className={frameStyle(true)} style={layout === 'split' ? { order: swapped ? 1 : 2 } : undefined}><video ref={audio} data-stream="audio" aria-label={t('player.camera')} playsInline preload="metadata" poster={data.preview_url || undefined} className="h-full w-full bg-black object-contain" /></div>
        {slidesStream && <div className={frameStyle(false)} style={layout === 'split' ? { order: swapped ? 2 : 1 } : undefined}><video ref={slides} data-stream="slides" aria-label={t('player.slides')} playsInline muted preload="metadata" className="h-full w-full bg-black object-contain" /></div>}
      </div>
      {feedback && <div key={feedback.id} className="player-feedback" data-feedback={feedback.kind} aria-hidden="true">
        {feedback.kind === 'pause' ? <Pause className="h-9 w-9 fill-white" /> : <Play className="h-9 w-9 fill-white" />}
      </div>}
      {captionsEnabled && captionText && <div className="player-caption-layer" data-controls-visible={controlsVisible}>{captionText}</div>}
      {notice && <p role="status" className="player-notice">{notice}</p>}
      <div className="player-top-controls player-control-surface" data-visible={controlsVisible} aria-hidden={!controlsVisible} inert={!controlsVisible}
        onFocusCapture={() => { if (lastInput.current === 'keyboard') setControlsFocused(true); }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setControlsFocused(false); }}
        onKeyDownCapture={() => setControlsFocused(true)}>
        {slidesStream && <>
          <div role="group" aria-label={t('player.layout')} className="flex">
            {(['inset', 'split', 'slides'] as const).map(mode => <button type="button" key={mode} aria-pressed={layout === mode}
              aria-label={t(mode === 'inset' ? 'player.inset' : mode === 'split' ? 'player.split' : 'player.single')}
              title={t(mode === 'inset' ? 'player.inset' : mode === 'split' ? 'player.split' : 'player.single')}
              className={`${overlayButton} ${layout === mode ? 'bg-white/20' : ''}`} onClick={() => { setLayout(mode); closeSettings(false); }}><LayoutIcon mode={mode} /></button>)}
          </div>
          <button type="button" className={overlayButton} aria-label={t('player.swap')} title={t('player.swap')} onClick={() => setSwapped(value => !value)}><ArrowLeftRight className="h-5 w-5" /></button>
        </>}
        <span className="flex-1" />
        <button type="button" className={overlayButton} aria-label={t('player.captions')} title={t(data.captions?.length ? 'player.captions' : 'player.no_captions')}
          aria-pressed={captionsEnabled} aria-keyshortcuts="c" onClick={toggleCaptions}><Captions className="h-5 w-5" /></button>
        <button ref={settingsButton} type="button" className={overlayButton} aria-label={t('player.settings')} title={t('player.settings')}
          aria-expanded={settingsOpen} aria-haspopup="dialog" aria-controls="player-settings-panel"
          onClick={() => { if (settingsOpen) closeSettings(); else { setSettingsOpen(true); revealControls(); } }}><Settings2 className="h-5 w-5" /></button>
      </div>
      {settingsOpen && <div ref={settingsPanel} id="player-settings-panel" role="dialog" aria-label={t('player.settings')} className="player-settings-popover player-control-surface">
        <div className="sticky -top-3 z-10 flex items-center justify-between gap-2 bg-slate-900 py-1">
          <h3 className="text-sm font-semibold">{t('player.settings')}</h3>
          <button type="button" className={overlayButton} aria-label={t('Schliessen')} onClick={() => closeSettings()}><X className="h-5 w-5" /></button>
        </div>
        <label className="block min-w-0 text-sm">{t('player.camera_quality')}<select value={audioQuality} className="player-menu-select" onChange={event => setAudioQuality(Number(event.target.value))}>
          {audioStream.renditions.map((source, index) => <option key={index} value={index}>{source.height ? `${source.height}p` : t('player.original')}</option>)}</select></label>
        {slidesStream && <label className="mt-3 block min-w-0 text-sm">{t('player.slides_quality')}<select value={slidesQuality} className="player-menu-select" onChange={event => setSlidesQuality(Number(event.target.value))}>
          {slidesStream.renditions.map((source, index) => <option key={index} value={index}>{source.height ? `${source.height}p` : t('player.original')}</option>)}</select></label>}
        {Boolean(data.captions?.length) && <label className="mt-3 block min-w-0 text-sm">{t('player.subtitle_language')}<select value={captionIndex} className="player-menu-select" onChange={event => setCaptionIndex(Number(event.target.value))}>
          {data.captions!.map((caption, index) => <option key={index} value={index}>{caption.label || caption.language}</option>)}</select></label>}
        <p className="mt-3 text-xs leading-relaxed text-slate-300">{t('player.shortcuts')}</p>
      </div>}
      <span id="player-shortcuts" className="sr-only">{t('player.shortcuts')}</span>
      {!mediaReady && !error && <div data-media-skeleton role="status" aria-label={t('player.loading')} className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />}
      {buffering && <p role="status" className="absolute left-3 top-3 z-10 rounded-lg bg-black/60 px-3 py-2 text-xs text-white">{t('player.buffering')}</p>}
      <div className="player-overlay player-control-surface" data-visible={controlsVisible} data-preview={previewTime !== null} data-scrubbing={scrubbing}
        aria-hidden={!controlsVisible} inert={!controlsVisible}
        onFocusCapture={event => { if (lastInput.current === 'keyboard' || event.target.tagName === 'SELECT') setControlsFocused(true); }}
        onKeyDownCapture={() => setControlsFocused(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setControlsFocused(false); }}>
        <div className="player-timeline">
          <span className="pointer-events-none absolute left-2 top-0 text-[10px] tabular-nums text-white">{timestamp(displayedTime)} / {timestamp(duration)}</span>
          <div className="player-timeline-track" aria-hidden="true">
            <div className="h-full rounded-full bg-teal-400" style={{ width: `${duration ? Math.min(100, displayedTime / duration * 100) : 0}%` }} />
            {duration > 0 && data.chapters.filter(chapter => chapter.time <= duration).map((chapter, index) =>
              <span key={index} data-chapter-time={chapter.time} className="player-chapter-marker" style={{ left: `${chapter.time / duration * 100}%` }} />)}
          </div>
          <input type="range" aria-label={t('player.seek')} aria-valuetext={timestamp(displayedTime)} min={0} max={duration || 1} step={0.1}
            value={Math.min(displayedTime, duration || 1)} disabled={!duration} className="player-seek" aria-describedby="player-seek-help"
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; setScrubbing(true); previewAtPointer(event); }}
            onPointerMove={previewAtPointer}
            onPointerUp={event => { dragging.current = false; setScrubbing(false); controller.current?.seek(Number(event.currentTarget.value)); if (event.pointerType !== 'mouse') setPreviewTime(null); }}
            onPointerCancel={() => { dragging.current = false; setScrubbing(false); setPreviewTime(null); }}
            onPointerLeave={() => { if (!dragging.current) setPreviewTime(null); }}
            onFocus={() => setPreviewTime(time)} onBlur={() => setPreviewTime(null)}
            onKeyDown={event => {
              if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
              event.preventDefault();
              const chapter = event.key === 'PageUp' ? data.chapters.find(item => item.time > time + 0.1)
                : data.chapters.findLast(item => item.time < time - 0.1);
              if (chapter) { setPreviewTime(chapter.time); controller.current?.seek(chapter.time); }
            }}
            onChange={event => { const value = Number(event.target.value); setPreviewTime(value); if (!dragging.current) controller.current?.seek(value); }} />
          <span id="player-seek-help" className="sr-only">{t('player.seek_help')}</span>
          {previewTime !== null && <div className="player-preview" data-preview-time={previewTime} style={{ left: `clamp(76px, ${previewPercent}%, calc(100% - 76px))` }}>
            {previewChapter && <img src={previewChapter.image} alt={t('player.chapter', { number: previewChapterIndex + 1, time: timestamp(previewChapter.time) })} className="aspect-video w-full rounded object-contain" />}
            <span className="block py-1 text-center text-[10px] tabular-nums text-white">{timestamp(previewTime)}</span>
          </div>}
        </div>
        <div className="player-toolbar">
          <button type="button" onClick={togglePlayback} aria-label={t(playing || buffering ? 'player.pause' : 'player.play')} aria-keyshortcuts="Space" className={overlayButton}>
            {playing || buffering ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
          <button type="button" aria-label={t(muted || volume === 0 ? 'player.unmute' : 'player.mute')} aria-pressed={muted || volume === 0} aria-keyshortcuts="m" className={overlayButton} onClick={toggleMute}>
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <SpeakerIcon volume={volume} />}</button>
          <label className="player-volume" title={t('player.volume')}><span className="sr-only">{t('player.volume')}</span>
            <span className="player-volume-bar" aria-hidden="true" style={{ background: `linear-gradient(to right, #2dd4bf ${(muted ? 0 : volume) * 100}%, rgb(255 255 255 / .3) ${(muted ? 0 : volume) * 100}%)` }} />
            <input type="range" min={0} max={1} step={0.05} value={volume} className="player-volume-range" aria-valuetext={t('player.volume_percent', { percent: Math.round(volume * 100) })} onChange={event => {
              const value = Number(event.target.value); setVolume(value); loudness.current = value;
              if (value > 0) { lastVolume.current = value; mutedRef.current = false; setMuted(false); }
              if (audio.current) { audio.current.volume = value; audio.current.muted = mutedRef.current; }
            }} /></label>
          <label className="min-w-0"><span className="sr-only">{t('player.speed')}</span><select value={rate} className="player-speed" onChange={event => {
            const value = Number(event.target.value); setRate(value); speed.current = value;
            if (lastInput.current === 'pointer') setControlsFocused(false);
            [audio.current, slides.current].forEach(video => { if (video) video.playbackRate = value; });
          }}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
          <span aria-hidden="true" />
          {document.fullscreenEnabled && <button type="button" aria-label={t(fullscreen ? 'player.exit_fullscreen' : 'player.fullscreen')} className={overlayButton}
            aria-keyshortcuts="f" onClick={toggleFullscreen}><Maximize className="h-4 w-4" /></button>}
        </div>
      </div>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{error} <button type="button" onClick={onRetry} className={buttonStyle}>{t('Erneut versuchen')}</button></p>}
  </div>;
}
