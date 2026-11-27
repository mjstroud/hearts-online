<!-- Only ever loaded with import(), so its CSS comes in its own JS chunk rather than on every game page. -->
<svelte:options css="injected" />

<script lang="ts">
  interface Props {
    kind: 'sun' | 'moon';
    /** Who shot it ("You" for yourself). */
    name: string;
  }
  let { kind, name }: Props = $props();
</script>

<!-- A sunrise or moonrise over the whole table, played once. Game.svelte takes it away, and a tap skips it. -->
<div class={`shot ${kind}`} role="status">
  <span class="orb" aria-hidden="true"></span>
  <p>
    <span class="glyph" aria-hidden="true">{kind === 'sun' ? '☀\uFE0E' : '☾'}</span>
    <strong class="display" title={name}>{name}</strong>
    <span>shot the {kind === 'sun' ? 'Sun' : 'Moon'}!</span>
  </p>
</div>

<style>
  .shot {
    --c: 255 197 49;
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: rgb(10 9 8 / 0.72);
    animation: shot 2.2s both;
  }

  .moon {
    --c: 124 180 255;
  }

  /* The sun or moon itself: a soft disc that rises from below the screen to the middle. */
  .orb {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 90vmin;
    height: 90vmin;
    border-radius: 50%;
    background: radial-gradient(rgb(var(--c) / 0.5), transparent 70%);
    animation: rise 1.4s var(--ease) both;
  }

  p {
    position: relative;
    display: grid;
    justify-items: center;
    max-width: calc(100vw - 32px);
    text-align: center;
  }

  span {
    color: rgb(var(--c));
    font-weight: 600;
  }

  .glyph {
    font-size: 64px;
    line-height: 1.1;
  }

  /* A 32-character name is cut short rather than pushed off a phone screen. */
  strong {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 30px;
  }

  @keyframes shot {
    0%,
    100% {
      opacity: 0;
    }
    12%,
    82% {
      opacity: 1;
    }
  }

  @keyframes rise {
    from {
      transform: translateY(50vh) scale(0.5);
    }
  }

  /* Reduced motion: no rise, just the words on a still backdrop, shown briefly. */
  @media (prefers-reduced-motion: reduce) {
    .shot {
      animation: none;
    }

    .orb {
      display: none;
    }
  }
</style>
