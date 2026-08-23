import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as React from 'react';
import { Platform } from 'react-native';

/**
 * Paper's icon renderer, corrected for web.
 *
 * Paper's own default (`src/components/MaterialCommunityIcon.tsx`) branches on
 * platform: on native it sets `accessibilityElementsHidden` +
 * `importantForAccessibility: 'no-hide-descendants'`, which correctly keeps the
 * glyph out of the accessibility tree. On web it sets `role="img"` with no
 * label instead, so every icon surfaces as an unnamed image — and, worse, when
 * the icon sits inside a button the private-use codepoint is concatenated into
 * that button's accessible name. The login button announced as "󰯄 Authenticate".
 *
 * These icons are decorative throughout this app: each sits beside text, or
 * inside a control that now carries its own accessibilityLabel. So the fix is
 * to hide them, matching what Paper already does on native.
 *
 * Only web is overridden. Paper's native path is already correct and is left
 * alone, so this cannot regress iOS or Android.
 */
type PaperIconArgs = {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color?: string;
  size: number;
  direction?: 'rtl' | 'ltr';
  allowFontScaling?: boolean;
  testID?: string;
};

/**
 * Deliberately **not** a component, and deliberately not PascalCase.
 *
 * Paper invokes this as a plain function — `icon?.({ name, color, size, ... })`
 * in `Icon.tsx` — rather than rendering it as JSX. This project builds with the
 * React Compiler, which auto-memoises anything it infers to be a component by
 * injecting a `useMemoCache` call at the top of the body. Were this shaped like
 * a component, that injected hook would run inside Paper's render instead of
 * its own, and React throws "Invalid hook call" on the first icon drawn — which
 * takes the whole screen down, not just the icon.
 *
 * The lowercase name keeps the compiler from inferring a component, and the
 * directive below opts out explicitly in case it ever tries anyway.
 */
function renderWebPaperIcon({
  name,
  color,
  size,
  direction,
  allowFontScaling,
  testID,
}: PaperIconArgs) {
  'use no memo';

  return (
    <MaterialCommunityIcons
      name={name}
      color={color}
      size={size}
      allowFontScaling={allowFontScaling}
      testID={testID}
      style={[
        { transform: [{ scaleX: direction === 'rtl' ? -1 : 1 }], lineHeight: size },
        { backgroundColor: 'transparent' },
      ]}
      pointerEvents="none"
      selectable={false}
      // The one that matters: aria-hidden keeps the glyph out of the
      // accessibility tree and out of any ancestor's accessible name.
      // `pointerEvents="none"` above already keeps it out of the tab order.
      aria-hidden
    />
  );
}

/**
 * Pass to `<PaperProvider settings={...}>`. Empty on native so Paper keeps its
 * own (already correct) renderer.
 */
export const paperSettings = Platform.OS === 'web' ? { icon: renderWebPaperIcon } : {};
