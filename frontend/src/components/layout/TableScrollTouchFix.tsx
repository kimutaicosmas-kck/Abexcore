import { useEffect } from 'react';

type TouchState = {
  startX: number;
  startY: number;
  axis: 'x' | 'y' | null;
};

const AXIS_LOCK_PX = 10;

function findTableScrollRoot(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest('.table-scroll-x');
  return node instanceof HTMLElement ? node : null;
}

/**
 * On touch devices, overflow-x scroll regions capture gestures and block vertical page scroll.
 * Detect swipe direction: vertical → release the table lock; horizontal → keep table scroll.
 */
export function TableScrollTouchFix() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    const states = new WeakMap<HTMLElement, TouchState>();
    const activeTouches = new Map<number, HTMLElement>();

    const reset = (node: HTMLElement) => {
      node.style.overflowX = '';
      states.delete(node);
    };

    const onTouchStart = (event: TouchEvent) => {
      const node = findTableScrollRoot(event.target);
      if (!node) return;
      const touch = event.changedTouches[0] ?? event.touches[0];
      if (!touch) return;

      activeTouches.set(touch.identifier, node);
      states.set(node, { startX: touch.clientX, startY: touch.clientY, axis: null });
    };

    const onTouchMove = (event: TouchEvent) => {
      for (let i = 0; i < event.touches.length; i += 1) {
        const touch = event.touches[i];
        const node = activeTouches.get(touch.identifier);
        if (!node) continue;

        const state = states.get(node);
        if (!state || state.axis) continue;

        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) continue;

        state.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
        if (state.axis === 'y') {
          node.style.overflowX = 'hidden';
        }
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      for (let i = 0; i < event.changedTouches.length; i += 1) {
        const touch = event.changedTouches[i];
        const node = activeTouches.get(touch.identifier);
        if (!node) continue;
        reset(node);
        activeTouches.delete(touch.identifier);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', onTouchEnd, true);
    };
  }, []);

  return null;
}
