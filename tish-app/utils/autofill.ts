import { Platform } from 'react-native';

/**
 * Browser autofill writes into a DOM input without firing the event React
 * derives onChangeText from, so a field can visibly hold credentials while the
 * component's state still says ''. Chrome only commits the fill to JS after a
 * user gesture — and pressing the submit button can be that first gesture, at
 * which point the state is still empty even though the form looks complete.
 *
 * Submit handlers on credential screens call this before concluding a field is
 * empty. Returns '' off web or when the input cannot be found, so callers can
 * use `stateValue || autofilledDomValue(testID)` unconditionally.
 */
export function autofilledDomValue(testID: string): string {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return '';
  const el = document.querySelector<HTMLInputElement>(`input[data-testid="${testID}"]`);
  return el?.value ?? '';
}
