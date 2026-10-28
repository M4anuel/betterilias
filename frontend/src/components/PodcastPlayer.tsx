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
      {error ? <p role="alert">{t('player.resolve_failed')}</p> : !data ? <p role="status">{t('player.loading')}</p>
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
    setPlaying(false); setBuffering(wanted.current);
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
      listen(video, 'canplay', () => { void resume(); });
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
  const frameStyle = (isAudio: boolean) => !slidesStream ? 'relative w-full' : layout === 'slides' && isAudio ? 'hidden'
    : layout === 'split' ? 'relative min-w-0 flex-1' : isAudio === primaryAudio ? 'relative w-full'
      : 'absolute bottom-2 right-2 z-10 w-[30%] overflow-hidden rounded-lg border border-white/60 shadow-lg';
  const activeChapter = data.chapters.findLastIndex(chapter => chapter.time <= time);
  return <div ref={playerArea} className="space-y-4 bg-white dark:bg-slate-950 [&:fullscreen]:overflow-y-auto [&:fullscreen]:p-4">
    <div data-player-layout={layout} className={`relative overflow-hidden rounded-xl bg-black ${layout === 'split' ? 'flex flex-col gap-1 sm:flex-row' : ''}`}>
      <div className={frameStyle(true)} style={layout === 'split' ? { order: swapped ? 1 : 2 } : undefined}><video ref={audio} data-stream="audio" aria-label={t('player.camera')} playsInline preload="metadata" poster={data.preview_url || undefined} className="aspect-video max-h-[55dvh] w-full bg-black object-contain" /></div>
      {slidesStream && <div className={frameStyle(false)} style={layout === 'split' ? { order: swapped ? 2 : 1 } : undefined}><video ref={slides} data-stream="slides" aria-label={t('player.slides')} playsInline muted preload="metadata" className="aspect-video max-h-[55dvh] w-full bg-black object-contain" /></div>}
    </div>
    {error && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{error}</p>}
    {buffering && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{t('player.buffering')}</p>}
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => controller.current?.toggle()} aria-label={t(playing || buffering ? 'player.pause' : 'player.play')} className={`${buttonStyle} w-11 shrink-0 !px-0`}>
        {playing || buffering ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
      <label className="min-w-0 flex-1"><span className="sr-only">{t('player.seek')}</span><input type="range" min={0} max={duration || 1} step={1} value={Math.min(time, duration || 1)} disabled={!duration}
        onChange={event => controller.current?.seek(Number(event.target.value))} className="min-h-11 w-full accent-teal-600" /></label>
      <span className="shrink-0 text-xs tabular-nums">{timestamp(time)} / {timestamp(duration)}</span>
      {document.fullscreenEnabled && <button type="button" aria-label={t(fullscreen ? 'player.exit_fullscreen' : 'player.fullscreen')} className={`${buttonStyle} w-11 shrink-0 !px-0`}
        onClick={() => { void (fullscreen ? document.exitFullscreen() : playerArea.current?.requestFullscreen())?.catch(() => setError(t('player.fullscreen_failed'))); }}><Maximize className="h-4 w-4" /></button>}
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <label className="min-w-0 text-sm">{t('player.speed')}<select value={rate} className={selectStyle} onChange={event => {
        const value = Number(event.target.value); setRate(value); speed.current = value;
        [audio.current, slides.current].forEach(video => { if (video) video.playbackRate = value; });
      }}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="min-w-0 text-sm">{t('player.volume')}<input type="range" min={0} max={1} step={0.05} value={volume} className="mt-1 min-h-12 w-full accent-teal-600" onChange={event => {
        const value = Number(event.target.value); setVolume(value); loudness.current = value; if (audio.current) audio.current.volume = value;
      }} /></label>
      <label className="col-span-2 min-w-0 text-sm sm:col-span-1">{t('player.camera_quality')}<select value={audioQuality} className={selectStyle} onChange={event => setAudioQuality(Number(event.target.value))}>
        {audioStream.renditions.map((source, index) => <option key={index} value={index}>{source.height ? `${source.height}p` : t('player.original')}</option>)}</select></label>
      {slidesStream && <>
        <label className="col-span-2 min-w-0 text-sm sm:col-span-1">{t('player.slides_quality')}<select value={slidesQuality} className={selectStyle} onChange={event => setSlidesQuality(Number(event.target.value))}>
          {slidesStream.renditions.map((source, index) => <option key={index} value={index}>{source.height ? `${source.height}p` : t('player.original')}</option>)}</select></label>
        <label className="col-span-2 min-w-0 text-sm sm:col-span-1">{t('player.layout')}<select value={layout} className={selectStyle} onChange={event => setLayout(event.target.value as typeof layout)}>
          <option value="inset">{t('player.inset')}</option><option value="split">{t('player.split')}</option><option value="slides">{t('player.slides_only')}</option></select></label>
        <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-1">
          <button type="button" disabled={layout === 'slides'} className={buttonStyle} onClick={() => setSwapped(value => !value)}><ArrowLeftRight className="h-4 w-4" /><span>{t('player.swap')}</span></button>
          <button type="button" className={buttonStyle} onClick={() => { setAudioQuality(0); setSlidesQuality(slidesStream.renditions.length - 1); setLayout('slides'); }}>{t('player.saver')}</button>
        </div>
      </>}
    </div>
    {data.chapters.length > 0 && <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <summary className="cursor-pointer py-2 text-sm font-semibold">{t('player.chapters', { count: data.chapters.length })}</summary>
      <div className="mt-3 grid max-h-64 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
        {data.chapters.map((chapter, index) => <button type="button" key={`${chapter.time}_${index}`} aria-current={index === activeChapter ? 'true' : undefined}
          aria-label={t('player.chapter', { number: index + 1, time: timestamp(chapter.time) })} onClick={() => controller.current?.seek(chapter.time)}
          className={`min-w-0 rounded-lg border p-1 text-left ${index === activeChapter ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-slate-200 dark:border-slate-700'}`}>
          <img src={chapter.image} alt="" loading="lazy" className="aspect-video w-full rounded object-contain" />
          <span className="block px-1 py-2 text-xs">{timestamp(chapter.time)}</span>
        </button>)}
      </div>
    </details>}
  </div>;
}
