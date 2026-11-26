/**
 * In the browser: check display-name fields as people type, counting characters the way the server
 * does. The inputs' maxlength can't do it, since browsers count an emoji as two or more.
 */
import { CAN_COUNT_CHARACTERS, displayNameError, normalizeDisplayName } from './names';

// Browsers that can't count characters would over-count emoji and block good names; the server
// still checks there.
if (CAN_COUNT_CHARACTERS) {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="displayName"]')) {
    input.addEventListener('input', () => {
      // An empty field is left to `required`.
      input.setCustomValidity(input.value && (displayNameError(normalizeDisplayName(input.value)) ?? ''));
    });
  }
}
