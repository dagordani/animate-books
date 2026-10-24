"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Scene } from "@/lib/book";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Illustration with slow pan/zoom while narrating, crossfading between scenes. */
export function Stage({
  scene,
  playing,
  duration,
  showTitle,
  children,
}: {
  scene: Scene;
  playing: boolean;
  duration: number;
  showTitle: boolean;
  children?: ReactNode;
}) {
  const [layers, setLayers] = useState<Scene[]>([scene]);
  useEffect(() => {
    setLayers((l) => (l[l.length - 1].id === scene.id ? l : [...l.slice(-1), scene]));
  }, [scene]);

  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-paper-2 shadow-[0_10px_40px_-12px_rgba(60,40,20,0.35)]">
      {layers.map((s) => (
        <div key={s.id} className="fade-in absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={s.image}
            alt={s.summary}
            className={`kb kb-${s.index % 4} h-full w-full object-cover`}
            style={{
              animationDuration: `${Math.max(12, duration + 4)}s`,
              animationPlayState: playing && s.id === scene.id ? "running" : "paused",
            }}
          />
        </div>
      ))}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      {showTitle && (
        <div key={`t-${scene.id}`} className="title-card pointer-events-none absolute inset-0 grid place-items-center bg-black/25">
          <div className="text-center text-white drop-shadow-lg">
            <div className="text-sm tracking-[0.35em] uppercase opacity-90">Chapter {ROMAN[scene.chapter] ?? scene.chapter}</div>
            <div className="mt-2 font-serif text-3xl sm:text-5xl">{scene.chapterTitle}</div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
