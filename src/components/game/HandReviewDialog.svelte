<script lang="ts">
  import { onMount } from 'svelte';

  // The scoreboard's trick review. The page renders a plain button per hand (data-hand); this one
  // island listens for them, and loads the review's code and that hand's tricks only when one is tapped.
  // (Imported directly, the review's styles would join the page's and push them past the size Astro
  // inlines, adding a whole stylesheet to the CSS budget.)
  interface Props {
    gameId: string;
    /** Display names by seat. */
    names: string[];
  }
  let { gameId, names }: Props = $props();

  let dialog: HTMLDialogElement;
  let hand = $state<number | null>(null);
  let review: Promise<typeof import('./TrickReview.svelte')> | undefined;

  onMount(() => {
    const open = (e: MouseEvent) => {
      const button = (e.target as Element | null)?.closest?.('[data-hand]');
      const n = Number(button?.getAttribute('data-hand'));
      if (!n || !dialog.showModal) return;
      review ??= import('./TrickReview.svelte');
      hand = n;
      if (!dialog.open) dialog.showModal();
    };
    document.addEventListener('click', open);
    return () => document.removeEventListener('click', open);
  });

  // A tap on the dimmed page around the dialog closes it (Escape is built in). The backdrop counts as
  // the dialog itself, so check where the tap was; a key press on a button inside has no position.
  function closeOutside(e: MouseEvent) {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="panel" aria-labelledby="hand-review-title" onclose={() => !dialog.open && (hand = null)} onclick={closeOutside}>
  {#if hand !== null && review}
    <div class="stack">
      <div class="spread">
        <h2 id="hand-review-title" class="panel-title">Hand {hand}</h2>
        <button class="btn btn-ghost btn-sm" onclick={() => dialog.close()}>Close</button>
      </div>
      {#await review}
        <p class="faint">Loading the tricks…</p>
      {:then { default: TrickReview }}
        {#key hand}<TrickReview {gameId} {hand} {names} standalone />{/key}
      {:catch}
        <p class="faint">Couldn’t load the trick review. Refresh the page to try again.</p>
      {/await}
    </div>
  {/if}
</dialog>

<!-- The browser centres a modal dialog, fits it to the screen and scrolls it; this only sets its size and backdrop. -->
<style>
  dialog {
    width: 560px;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.72);
  }
</style>
