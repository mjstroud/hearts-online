import type { GameSettings } from '../engine/rules';

/** Turn a submitted RuleSettings form into raw settings input (checkboxes are absent when off). */
export function settingsFromForm(form: Record<string, string>): Partial<Record<keyof GameSettings, unknown>> {
  const out: Partial<Record<keyof GameSettings, unknown>> = {};
  if ('scoreLimit' in form) out.scoreLimit = form.scoreLimit === '' ? null : form.scoreLimit;
  if (form.rulesForm) {
    out.jackOfDiamonds = form.jackOfDiamonds === 'on';
    out.shootTheMoon = form.shootTheMoon === 'on';
    out.shootTheSun = form.shootTheSun === 'on';
    out.noPointsOnFirstTrick = form.noPointsOnFirstTrick === 'on';
  }
  return out;
}
