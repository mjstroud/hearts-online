<script lang="ts">
  /** A person's photo over their initials (the cats get 🐱). Same markup as Avatar.astro. */
  import { BOT_AVATAR, avatarColor, initials } from '../lib/ui';

  interface Props {
    name: string;
    /** The username: it picks the colour, so the colour stays put when the display name changes. */
    seed: string;
    isBot?: boolean;
    /** Photo URL from avatarSrc. Computer players never show one. */
    src?: string | null;
    /** Width and height in px. */
    size?: number;
  }
  let { name, seed, isBot = false, src = null, size = 36 }: Props = $props();

  // The initials sit under the photo, so one that's loading or broken just shows them.
  let broken = $state<string | null>(null);
  const photo = $derived(!isBot && src && src !== broken ? src : null);
</script>

<span class="avatar" class:has-photo={!!photo} style={`--size: ${size}px; --avatar: ${avatarColor(seed)}`}
  >{isBot ? BOT_AVATAR : initials(name)}{#if photo}<img
      src={photo}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable="false"
      onerror={() => (broken = photo)}
    />{/if}</span
>
