import React from 'react';
import { Settings } from 'lucide-react';

export function SettingsGear({ rotation }: { rotation: number }) {
  return <Settings key={rotation} className={`h-5 w-5 ${rotation ? 'gear-turn' : ''}`}
    style={{
      transform: `rotate(${rotation}deg)`,
      '--gear-start': `${rotation - 180}deg`,
      '--gear-end': `${rotation}deg`,
    } as React.CSSProperties} />;
}
