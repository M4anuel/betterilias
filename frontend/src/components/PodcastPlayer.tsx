import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ExternalLink, Maximize, Pause, Play, RefreshCw, X } from 'lucide-react';
import { api } from '../lib/api';
import { t, useLanguage } from '../lib/i18n';
import { VideoStreamInfo } from '../types';

const timestamp = (time: number) => {
  const seconds = Math.max(0, Math.floor(time));
  return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const buttonStyle = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800';
const selectStyle = 'player-select mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base dark:border-slate-700 dark:bg-slate-900 sm:text-sm';

function PlayerSkeleton() {
  return <div className="space-y-4" data-player-skeleton role="status" aria-label={t('player.loading')}>
    <div className="player-stage bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800">
      <div className="absolute inset-x-3 bottom-3 h-16 rounded-lg bg-slate-300 dark:bg-slate-700" />
    </div>
    <div className="player-settings grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map(value => <div key={value} className="col-span-2 h-[72px] rounded-lg bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800 sm:col-span-1" />)}
      <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-3">
        <span className={`${buttonStyle} bg-slate-200 !text-transparent dark:bg-slate-800`}><ArrowLeftRight className="h-4 w-4" /><span>{t('player.swap')}</span></span>
        <span className={`${buttonStyle} bg-slate-200 !text-transparent dark:bg-slate-800`}>{t('player.saver')}</span>
      </div>
    </div>
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
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <h2 className="min-w-0 break-words text-base font-bold sm:text-lg">{data?.title || title}</h2>
      <button type="button" aria-label={t('Schliessen')} onClick={onClose} className={`${buttonStyle} w-11 shrink-0 !px-0`}><X className="h-5 w-5" /></button>
    </div>
    <div className="space-y-4 p-3 sm:p-5">
      {error ? <p role="alert">{t('player.resolve_failed')}</p> : !data ? <PlayerSkeleton />
        : <SynchronizedPlayer key={`${url}_${revision}`} data={data} />}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => setRevision(value => value + 1)} className={buttonStyle}><RefreshCw className="h-4 w-4" /><span>{t('player.reload')}</span></button>
        <a href={url} target="_blank" rel="noreferrer" className={buttonStyle}><ExternalLink className="h-4 w-4" /><span>{t('In ILIAS öffnen')}</span></a>
      </div>
    </div>
  </dialog>;
}

function SynchronizedPlayer({ data }: { data: VideoStreamInfo }) {
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
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(data.duration || 0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsFocused, setControlsFocused] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const activity = useRef(Date.now());
  const lastInput = useRef<'pointer' | 'keyboard'>('pointer');
  const dragging = useRef(false);
  const audio = useRef<HTMLVideoElement>(null);
  const playerArea = useRef<HTMLDivElement>(null);
  const slides = useRef<HTMLVideoElement>(null);
  const wanted = useRef(false);
  const position = useRef(0);
  const speed = useRef(1);
  const loudness = useRef(1);
  const controller = useRef<{ toggle: () => void; seek: (value: number) => void } | null>(null);
  const audioUrl = audioStream.renditions[audioQuality].url;
  const slidesUrl = slidesStream?.renditions[slidesQuality].url;
  const revealControls = () => { activity.current = Date.now(); setControlsVisible(true); };

  useEffect(() => {
    revealControls();
    if (!playing || controlsFocused || scrubbing || error || buffering) return;
    const interval = window.setInterval(() => {
      if (Date.now() - activity.current >= 2500) { setControlsVisible(false); setPreviewTime(null); }
    }, 250);
    return () => window.clearInterval(interval);
  }, [playing, controlsFocused, scrubbing, error, buffering]);

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
    setError(null);
    setPlaying(false); setBuffering(wanted.current); setMediaReady(false);
    const pause = () => { videos.forEach(video => video.pause()); setPlaying(false); };
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
      pause();
      for (const video of videos) if (video.readyState >= 1) video.currentTime = position.current;
      setTime(position.current);
      void resume();
    };
    controller.current = {
      toggle: () => { wanted.current = !wanted.current; setError(null); if (wanted.current) void resume(); else { pause(); setBuffering(false); } },
      seek,
    };
    const removers: (() => void)[] = [];
    const listen = (video: HTMLVideoElement, event: string, callback: () => void) => {
      video.addEventListener(event, callback); removers.push(() => video.removeEventListener(event, callback));
    };
    videos.forEach(video => {
      listen(video, 'loadedmetadata', () => {
        if (Number.isFinite(video.duration) && video === master) setDuration(video.duration);
        video.currentTime = position.current;
        video.playbackRate = speed.current;
      });
      listen(video, 'canplay', () => { if (videos.every(item => item.readyState >= 2)) setMediaReady(true); void resume(); });
      listen(video, 'seeked', () => { void resume(); });
      listen(video, 'waiting', () => { if (wanted.current) { pause(); setBuffering(true); } });
      listen(video, 'error', () => { wanted.current = false; pause(); setBuffering(false); setError(t('player.media_failed')); });
    });
    listen(master, 'timeupdate', () => {
      position.current = master.currentTime; setTime(master.currentTime);
      if (follower && follower.readyState >= 1 && Math.abs(follower.currentTime - master.currentTime) > 0.3) follower.currentTime = master.currentTime;
    });
    listen(master, 'ended', () => { wanted.current = false; pause(); setBuffering(false); });
    master.muted = false; master.volume = loudness.current; master.src = audioUrl;
    if (follower && slidesUrl) { follower.muted = true; follower.src = slidesUrl; }
    videos.forEach(video => video.load());
    return () => {
      active = false; controller.current = null; removers.forEach(remove => remove());
      videos.forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    };
  }, [audioUrl, slidesUrl]);

  const primaryAudio = swapped && layout !== 'slides';
  const frameStyle = (isAudio: boolean) => !slidesStream ? 'relative h-full w-full' : layout === 'slides' && isAudio ? 'hidden'
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
  return <div ref={playerArea} className="space-y-4 bg-white dark:bg-slate-950 [&:fullscreen]:overflow-y-auto [&:fullscreen]:p-4">
    <div data-player-layout={layout} className="player-stage bg-black" tabIndex={0} role="group" aria-label={t('player.controls')}
      onPointerMove={revealControls} onPointerDown={revealControls} onPointerDownCapture={() => { lastInput.current = 'pointer'; setControlsFocused(false); }} onFocus={revealControls}
      onKeyDown={event => { lastInput.current = 'keyboard'; revealControls(); }}>
      <div className={`absolute inset-0 overflow-hidden rounded-xl ${layout === 'split' ? 'flex flex-col gap-1 sm:flex-row' : ''}`}>
        <div className={frameStyle(true)} style={layout === 'split' ? { order: swapped ? 1 : 2 } : undefined}><video ref={audio} data-stream="audio" aria-label={t('player.camera')} playsInline preload="metadata" poster={data.preview_url || undefined} className="h-full w-full bg-black object-contain" /></div>
        {slidesStream && <div className={frameStyle(false)} style={layout === 'split' ? { order: swapped ? 2 : 1 } : undefined}><video ref={slides} data-stream="slides" aria-label={t('player.slides')} playsInline muted preload="metadata" className="h-full w-full bg-black object-contain" /></div>}
      </div>
      {!mediaReady && !error && <div data-media-skeleton role="status" aria-label={t('player.loading')} className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />}
      {buffering && <p role="status" className="absolute left-3 top-3 z-10 rounded-lg bg-black/60 px-3 py-2 text-xs text-white">{t('player.buffering')}</p>}
      <div className="player-overlay" data-visible={controlsVisible} data-preview={previewTime !== null} data-scrubbing={scrubbing}
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
          <button type="button" onClick={() => controller.current?.toggle()} aria-label={t(playing || buffering ? 'player.pause' : 'player.play')} className={overlayButton}>
            {playing || buffering ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
          <label className="player-volume" title={t('player.volume')}><span className="sr-only">{t('player.volume')}</span>
            <span className="player-volume-cone" aria-hidden="true" style={{ background: `linear-gradient(to right, #2dd4bf ${volume * 100}%, rgb(255 255 255 / .3) ${volume * 100}%)` }} />
            <input type="range" min={0} max={1} step={0.05} value={volume} className="player-volume-range" aria-valuetext={t('player.volume_percent', { percent: Math.round(volume * 100) })} onChange={event => {
              const value = Number(event.target.value); setVolume(value); loudness.current = value; if (audio.current) audio.current.volume = value;
            }} /></label>
          <label className="min-w-0"><span className="sr-only">{t('player.speed')}</span><select value={rate} className="player-speed" onChange={event => {
            const value = Number(event.target.value); setRate(value); speed.current = value;
            if (lastInput.current === 'pointer') setControlsFocused(false);
            [audio.current, slides.current].forEach(video => { if (video) video.playbackRate = value; });
          }}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
          <span aria-hidden="true" />
          {document.fullscreenEnabled && <button type="button" aria-label={t(fullscreen ? 'player.exit_fullscreen' : 'player.fullscreen')} className={overlayButton}
            onClick={() => { void (fullscreen ? document.exitFullscreen() : playerArea.current?.requestFullscreen())?.catch(() => setError(t('player.fullscreen_failed'))); }}><Maximize className="h-4 w-4" /></button>}
        </div>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{error}</p>}
    <div className="player-settings grid grid-cols-2 gap-3 sm:grid-cols-3">
      <label className="col-span-2 min-w-0 text-sm sm:col-span-1">{t('player.camera_quality')}<select value={audioQuality} className={selectStyle} onChange={event => setAudioQuality(Number(event.target.value))}>
        {audioStream.renditions.map((source, index) => <option key={index} value={index}>{source.height ? `${source.height}p` : t('player.original')}</option>)}</select></label>
      {slidesStream && <>
        <label className="col-span-2 min-w-0 text-sm sm:col-span-1">{t('player.slides_quality')}<select value={slidesQuality} className={selectStyle} onChange={event => setSlidesQuality(Number(event.target.value))}>
          {slidesStream.renditions.map((source, index) => <option key={index} value={index}>{source.height ? `${source.height}p` : t('player.original')}</option>)}</select></label>
        <label className="col-span-2 min-w-0 text-sm sm:col-span-1">{t('player.layout')}<select value={layout} className={selectStyle} onChange={event => setLayout(event.target.value as typeof layout)}>
          <option value="inset">{t('player.inset')}</option><option value="split">{t('player.split')}</option><option value="slides">{t('player.slides_only')}</option></select></label>
        <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-3">
          <button type="button" disabled={layout === 'slides'} className={buttonStyle} onClick={() => setSwapped(value => !value)}><ArrowLeftRight className="h-4 w-4" /><span>{t('player.swap')}</span></button>
          <button type="button" className={buttonStyle} onClick={() => { setAudioQuality(0); setSlidesQuality(slidesStream.renditions.length - 1); setLayout('slides'); }}>{t('player.saver')}</button>
        </div>
      </>}
    </div>
  </div>;
}
