/**
 * Drop-in replacements for svelte/transition's fade, fly and scale that respect the
 * "reduce motion" setting. Svelte's own transitions ignore it (the CSS rule in global.css
 * can't reach them), so here they finish at once when it's on.
 */
import { prefersReducedMotion } from 'svelte/motion';
import * as svelte from 'svelte/transition';
import type { FadeParams, FlyParams, ScaleParams, TransitionConfig } from 'svelte/transition';

// Read when each transition starts, so changing the setting mid-game takes effect straight away.
function still<P extends { delay?: number; duration?: number }>(params: P | undefined): P | undefined {
  return prefersReducedMotion.current ? { ...(params as P), delay: 0, duration: 0 } : params;
}

export function fade(node: Element, params?: FadeParams): TransitionConfig {
  return svelte.fade(node, still(params));
}

export function fly(node: Element, params?: FlyParams): TransitionConfig {
  return svelte.fly(node, still(params));
}

export function scale(node: Element, params?: ScaleParams): TransitionConfig {
  return svelte.scale(node, still(params));
}
