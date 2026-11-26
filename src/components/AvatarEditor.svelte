<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { devicePixelRatio, innerWidth } from 'svelte/reactivity/window';
  import { type Crop, MAX_ZOOM, type SourceRect, initialCrop, pan, sourceRect, zoomAt } from '../lib/avatar-crop';
  import {
    AvatarImageError,
    CANT_READ,
    type WorkingImage,
    decodeImage,
    drawCrop,
    encodeAvatar,
    makeWorkingImage,
    releaseCanvas,
    releaseWorkingImage,
    renderAvatar,
  } from '../lib/avatar-image';
  import { AVATAR_API, AVATAR_SIZE } from '../lib/avatars';
  import { avatarColor } from '../lib/ui';
  import Avatar from './Avatar.svelte';

  interface Props {
    username: string;
    displayName: string;
    /** The current photo's URL, or null for initials. */
    avatar: string | null;
  }
  let { username, displayName, avatar }: Props = $props();

  /** Largest the crop stage gets; it shrinks to fit narrow phones. */
  const STAGE_MAX = 280;
  /** Arrow keys move the photo this many stage pixels, or the bigger amount with Shift. */
  const NUDGE = 6;
  const BIG_NUDGE = 36;
  const ZOOM_STEP = 1.15;
  const OFFLINE = 'Couldn’t upload. Check your connection and try again.';

  /** Safari's trackpad pinch (it doesn't send ctrl+wheel like other browsers). */
  interface GestureEvent extends UIEvent {
    scale: number;
    clientX: number;
    clientY: number;
  }

  const uid = $props.id();
  let mode = $state<'idle' | 'cropping' | 'saving'>('idle');
  let opening = $state(false);
  let removing = $state(false);
  let error = $state('');
  let dragDepth = $state(0);
  let work = $state.raw<WorkingImage | null>(null);
  let crop = $state.raw<Crop>({ zoom: 1, x: 0, y: 0 });
  let bodyWidth = $state(STAGE_MAX);

  const side = $derived(Math.max(120, Math.min(STAGE_MAX, Math.floor(bodyWidth))));
  const color = $derived(avatarColor(username));
  const busy = $derived(opening || removing || mode === 'saving');

  let fileInput: HTMLInputElement;
  let uploadButton = $state<HTMLButtonElement>();
  let stage = $state<HTMLDivElement>();
  let stageCanvas = $state<HTMLCanvasElement>();
  let seatPreview = $state<HTMLCanvasElement>();
  let rowPreview = $state<HTMLCanvasElement>();

  // ----- Picking a photo

  let openId = 0;
  let destroyed = false;

  function choose() {
    if (!busy) fileInput.click();
  }

  function onPick(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // so picking the same file again still counts
    if (file) open(file);
  }

  async function open(file: File) {
    if (mode === 'saving' || removing) return;
    const id = ++openId;
    opening = true;
    error = '';
    let next: WorkingImage | null = null;
    try {
      const image = await decodeImage(file);
      try {
        if (id === openId && !destroyed) next = makeWorkingImage(image);
      } finally {
        image.close();
      }
    } catch (err) {
      if (id === openId) error = err instanceof AvatarImageError ? err.message : CANT_READ;
    }
    if (id !== openId || destroyed) {
      // Cancelled, or another photo was picked meanwhile.
      if (next) releaseWorkingImage(next);
      return;
    }
    opening = false;
    if (!next) return;
    clearWork();
    work = next;
    crop = initialCrop(next.width, next.height);
    mode = 'cropping';
    await tick();
    stage?.focus();
  }

  function clearWork() {
    pointers.clear();
    if (work) releaseWorkingImage(work);
    work = null;
  }

  async function cancel() {
    if (mode === 'saving') return;
    openId++; // drop a photo that's still opening
    opening = false;
    error = '';
    clearWork();
    mode = 'idle';
    await tick();
    uploadButton?.focus();
  }

  // ----- Saving and removing

  /** The server's own words for what went wrong, or a fallback when something else answered. */
  async function problem(res: Response): Promise<string> {
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // Not JSON: a proxy, or the server's request size limit.
    }
    if (res.status === 401) return 'You’ve been signed out. Sign in again, then try once more.';
    if (res.status === 413) return 'That photo is too big to upload. Try zooming in, or pick another one.';
    if (res.status === 429) return 'That’s a lot of new photos. Please wait a few minutes and try again.';
    return 'Something went wrong on our end. Please try again.';
  }

  async function save() {
    if (!work || mode !== 'cropping' || opening) return;
    mode = 'saving';
    error = '';
    let blob: Blob;
    try {
      const square = renderAvatar(work.levels[0], sourceRect(crop, work.width, work.height), AVATAR_SIZE, color);
      try {
        blob = await encodeAvatar(square);
      } finally {
        releaseCanvas(square);
      }
    } catch (err) {
      error = err instanceof AvatarImageError ? err.message : 'We couldn’t prepare that photo. Try another one.';
      mode = 'cropping';
      return;
    }
    let res: Response;
    try {
      res = await fetch(AVATAR_API, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
    } catch {
      error = OFFLINE;
      mode = 'cropping';
      return;
    }
    if (res.ok) {
      // Stays on "Saving…" while the page reloads. Replace, so Back doesn't return to this page mid-save.
      location.replace('/account?photo=saved');
      return;
    }
    error = await problem(res);
    mode = 'cropping';
  }

  async function remove() {
    if (busy || !avatar) return;
    removing = true;
    error = '';
    let res: Response;
    try {
      res = await fetch(AVATAR_API, { method: 'DELETE' });
    } catch {
      error = 'Couldn’t remove your photo. Check your connection and try again.';
      removing = false;
      return;
    }
    if (res.ok) {
      location.replace('/account?photo=removed');
      return;
    }
    error = await problem(res);
    removing = false;
  }

  /** Back/Forward can restore this page exactly as it was left. If that was mid-save, load it afresh to show how it went. */
  function onPageShow(e: PageTransitionEvent) {
    if (e.persisted && (mode === 'saving' || removing)) location.replace('/account');
  }

  // ----- Drawing: at most once per animation frame, and nothing is encoded until Save

  let frame = 0;

  function paint(canvas: HTMLCanvasElement | undefined, cssSide: number, ratio: number, rect: SourceRect) {
    if (!canvas || !work) return;
    const px = Math.round(cssSide * ratio);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) drawCrop(ctx, work, rect, color);
  }

  function draw() {
    frame = 0;
    if (!work || mode === 'idle') return;
    const rect = sourceRect(crop, work.width, work.height);
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    paint(stageCanvas, side, ratio, rect);
    // The sizes it'll appear at: seat plaques, then standings and score sheets.
    paint(seatPreview, 38, ratio, rect);
    paint(rowPreview, 26, ratio, rect);
  }

  $effect(() => {
    crop;
    work;
    side;
    mode;
    stageCanvas;
    seatPreview;
    rowPreview;
    // Browser zoom or a move to another monitor changes the pixel ratio without resizing the stage,
    // so redraw at the new sharpness. (Zoom always resizes the window, for browsers that don't report the ratio change.)
    devicePixelRatio.current;
    innerWidth.current;
    if (!frame) frame = requestAnimationFrame(draw);
  });

  // ----- Moving and zooming

  const pointers = new Map<number, { x: number; y: number }>();
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  function setZoom(zoom: number, focusX = side / 2, focusY = side / 2) {
    if (work) crop = zoomAt(crop, zoom, focusX, focusY, side, work.width, work.height);
  }

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLDivElement }) {
    if (mode !== 'cropping' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer already went away.
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e: PointerEvent & { currentTarget: HTMLDivElement }) {
    const last = pointers.get(e.pointerId);
    if (!last || !work || mode !== 'cropping') return;
    const now = { x: e.clientX, y: e.clientY };
    const [a, b] = pointers.keys();
    if (pointers.size === 1) {
      crop = pan(crop, now.x - last.x, now.y - last.y, side, work.width, work.height);
    } else if (e.pointerId === a || e.pointerId === b) {
      // Two fingers: the photo follows their midpoint and scales with their spread.
      const other = pointers.get(e.pointerId === a ? b : a)!;
      const from = mid(last, other);
      const to = mid(now, other);
      const box = e.currentTarget.getBoundingClientRect();
      let next = pan(crop, to.x - from.x, to.y - from.y, side, work.width, work.height);
      const before = dist(last, other);
      if (before > 0) {
        next = zoomAt(next, next.zoom * (dist(now, other) / before), to.x - box.left, to.y - box.top, side, work.width, work.height);
      }
      crop = next;
    }
    pointers.set(e.pointerId, now);
  }

  function onPointerEnd(e: PointerEvent) {
    pointers.delete(e.pointerId);
  }

  function onKeydown(e: KeyboardEvent) {
    if (mode !== 'cropping' || !work || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? BIG_NUDGE : NUDGE;
    const { width: w, height: h } = work;
    switch (e.key) {
      case 'ArrowLeft':
        crop = pan(crop, -step, 0, side, w, h);
        break;
      case 'ArrowRight':
        crop = pan(crop, step, 0, side, w, h);
        break;
      case 'ArrowUp':
        crop = pan(crop, 0, -step, side, w, h);
        break;
      case 'ArrowDown':
        crop = pan(crop, 0, step, side, w, h);
        break;
      case '+':
      case '=':
        setZoom(crop.zoom * ZOOM_STEP);
        break;
      case '-':
      case '_':
        setZoom(crop.zoom / ZOOM_STEP);
        break;
      case 'Escape':
        cancel();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function onWheel(e: WheelEvent) {
    if (mode !== 'cropping' || !stage) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? side : 1;
    // Trackpad pinches arrive as ctrl+wheel, in small steps.
    const speed = e.ctrlKey ? 0.01 : 0.002;
    const box = stage.getBoundingClientRect();
    setZoom(crop.zoom * Math.exp(-e.deltaY * unit * speed), e.clientX - box.left, e.clientY - box.top);
  }

  let gestureStartZoom = 1;
  function onGestureStart(e: Event) {
    e.preventDefault();
    gestureStartZoom = crop.zoom;
  }
  function onGestureChange(e: Event) {
    e.preventDefault();
    // iOS sends these alongside the touch pointers handled above; only a Mac trackpad needs them.
    if (pointers.size || mode !== 'cropping' || !stage) return;
    const g = e as GestureEvent;
    const box = stage.getBoundingClientRect();
    setZoom(gestureStartZoom * g.scale, g.clientX - box.left, g.clientY - box.top);
  }
  const prevent = (e: Event) => e.preventDefault();

  // These have to be non-passive to keep the page from scrolling or zooming, so they're added by hand.
  $effect(() => {
    const el = stage;
    if (!el) return;
    const opts = { passive: false };
    el.addEventListener('wheel', onWheel, opts);
    el.addEventListener('gesturestart', onGestureStart, opts);
    el.addEventListener('gesturechange', onGestureChange, opts);
    el.addEventListener('gestureend', prevent, opts);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', prevent);
    };
  });

  // ----- Dropping a file onto the panel

  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
  }

  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault(); // otherwise the browser opens the file in place of the page
    e.dataTransfer!.dropEffect = busy ? 'none' : 'copy';
  }

  function onDragLeave(e: DragEvent) {
    if (hasFiles(e)) dragDepth = Math.max(0, dragDepth - 1);
  }

  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    const file = e.dataTransfer!.files[0];
    if (file && !busy) open(file);
  }

  onMount(() => () => {
    destroyed = true;
    openId++;
    cancelAnimationFrame(frame);
    clearWork();
  });
</script>

<svelte:window onpageshow={onPageShow} />

<section
  class="panel panel-pad stack photo"
  class:dropping={dragDepth > 0 && !busy}
  aria-labelledby={`${uid}-title`}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  <h2 class="panel-title" id={`${uid}-title`}>Photo</h2>

  <div class="stack body" bind:clientWidth={bodyWidth}>
    {#if mode === 'idle'}
      <div class="current">
        <Avatar name={displayName} seed={username} src={avatar} size={88} />
        <div class="stack current-text">
          <div class="row buttons">
            <button bind:this={uploadButton} class="btn btn-primary" type="button" disabled={busy} onclick={choose}>
              {opening ? 'Opening…' : avatar ? 'Change photo' : 'Upload a photo'}
            </button>
            {#if avatar}
              <button class="btn btn-ghost" type="button" disabled={busy} onclick={remove}>{removing ? 'Removing…' : 'Remove photo'}</button>
            {/if}
          </div>
          <p class="hint">Shown next to your name at the table and on scoreboards. <span class="drop-hint">You can also drop a photo here.</span></p>
        </div>
      </div>
    {:else}
      <div class="cropper" style={`--side: ${side}px`}>
        <div class="stage-col">
          <!-- A custom keyboard widget: arrows and +/- are handled below, so it's an application region. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            bind:this={stage}
            class="stage"
            class:saving={mode === 'saving'}
            role="application"
            tabindex="0"
            aria-label="Crop your photo. Arrow keys move it, Shift with an arrow moves it further, and plus and minus zoom in and out."
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerEnd}
            onpointercancel={onPointerEnd}
            onlostpointercapture={onPointerEnd}
            onkeydown={onKeydown}
          >
            <canvas bind:this={stageCanvas} aria-hidden="true"></canvas>
          </div>
          <div class="zoom">
            <span aria-hidden="true">−</span>
            <input
              type="range"
              min="1"
              max={MAX_ZOOM}
              step="0.01"
              value={crop.zoom}
              aria-label="Zoom"
              aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
              disabled={mode === 'saving'}
              oninput={(e) => setZoom(Number(e.currentTarget.value))}
            />
            <span aria-hidden="true">+</span>
          </div>
          <p class="hint">Drag the photo to move it. Pinch, scroll or use the slider to zoom.</p>
        </div>

        <div class="stack side">
          <div class="stack preview">
            <span class="label">Preview</span>
            <div class="previews" aria-hidden="true">
              <span class="pv-felt">
                <span class="pv-seat"><canvas bind:this={seatPreview} class="pv" style="--size: 38px"></canvas><span class="pv-name">{displayName}</span></span>
              </span>
              <span class="pv-row"><canvas bind:this={rowPreview} class="pv" style="--size: 26px"></canvas><span class="pv-name">{displayName}</span></span>
            </div>
          </div>
          <div class="row buttons">
            <button class="btn btn-primary" type="button" disabled={busy} onclick={save}>{mode === 'saving' ? 'Saving…' : 'Save photo'}</button>
            <button class="btn" type="button" disabled={mode === 'saving'} onclick={cancel}>Cancel</button>
            <button class="btn btn-ghost" type="button" disabled={busy} onclick={choose}>{opening ? 'Opening…' : 'Choose another'}</button>
          </div>
        </div>
      </div>
    {/if}

    {#if error}<p class="alert" role="alert">{error}</p>{/if}
  </div>

  <input bind:this={fileInput} class="file" type="file" accept="image/*" tabindex="-1" aria-hidden="true" onchange={onPick} />
</section>

<style>
  .photo {
    position: relative;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .photo.dropping {
    border-color: rgb(242 196 109 / 0.55);
    box-shadow:
      0 0 0 3px rgb(242 196 109 / 0.14),
      var(--shadow);
  }

  .body {
    --gap: 16px;
  }

  .current {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .current-text {
    --gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .buttons {
    --gap: 8px;
  }

  @media (hover: none) {
    .drop-hint {
      display: none;
    }
  }

  /* ----- Cropping ----- */
  .cropper {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 20px 24px;
  }

  .stage-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: var(--side);
  }

  .stage {
    position: relative;
    width: var(--side);
    height: var(--side);
    border-radius: var(--radius);
    overflow: hidden;
    background: rgb(var(--lo) / 0.3);
    cursor: grab;
    /* Only the stage takes over touch: the rest of the page still scrolls normally. */
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .stage:active {
    cursor: grabbing;
  }

  .stage.saving {
    cursor: progress;
  }

  .stage:focus-visible {
    outline-offset: 3px;
    border-radius: var(--radius);
  }

  .stage canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* The circle is what people will see. The corners outside it are dimmed. */
  .stage::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow:
      0 0 0 var(--side) rgb(15 14 13 / 0.62),
      inset 0 0 0 1.5px rgb(255 255 255 / 0.75);
    pointer-events: none;
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted);
    font-weight: 600;
  }

  .zoom input {
    flex: 1;
    min-width: 0;
    margin: 0;
    accent-color: var(--heart);
  }

  .side {
    --gap: 18px;
    flex: 1 1 200px;
    min-width: 0;
  }

  .preview {
    --gap: 10px;
  }

  .previews {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .pv {
    display: block;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    box-shadow: 0 0 0 2px rgb(0 0 0 / 0.35);
  }

  .pv-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Like a seat at the table, on a swatch of the table's paper. */
  .pv-felt {
    display: flex;
    min-width: 0;
    max-width: 100%;
    padding: 10px;
    border-radius: 14px;
    background: var(--felt-bg);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.06);
  }

  .pv-seat {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    max-width: 190px;
    padding: 5px 14px 5px 5px;
    border-radius: 99px;
    background: var(--plaque-bg);
    box-shadow: var(--plaque-shadow);
    color: var(--text);
    font-size: 13.5px;
    font-weight: 650;
  }

  /* Like a line in the standings. */
  .pv-row {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 100%;
    padding: 7px 10px 7px 8px;
    border-radius: 10px;
    background: rgb(var(--hi) / 0.04);
    font-size: 14px;
  }

  /* Kept in the page so it can be clicked from script, but out of sight and out of the tab order. */
  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
    clip-path: inset(50%);
    pointer-events: none;
  }
</style>
