/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import('./lib/server/auth').User | null;
  }
}

/** This build's id (set in astro.config.mjs). "dev" under the dev server. */
declare const __BUILD_ID__: string;
