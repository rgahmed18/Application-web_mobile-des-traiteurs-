'use client';

import { useCallback } from 'react';

let observer: IntersectionObserver | null = null;

/** Observateur partagé par toute la page : chaque élément apparaît une fois, puis n'est plus suivi. */
function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-shown', '');
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  return observer;
}

/**
 * Apparition au défilement (classe « site-reveal ») : l'élément s'affiche en glissant quand il
 * entre à l'écran. Sans IntersectionObserver ou avec « réduire les animations » : affiché tout
 * de suite (le CSS neutralise aussi l'effet).
 */
export function useReveal<T extends HTMLElement>(): (element: T | null) => void {
  return useCallback((element: T | null) => {
    if (!element) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof IntersectionObserver === 'undefined' || reduced) {
      element.setAttribute('data-shown', '');
      return;
    }
    sharedObserver().observe(element);
  }, []);
}
