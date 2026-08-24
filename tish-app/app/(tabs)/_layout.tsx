import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { BottomNavigation, Divider, Text, useTheme } from 'react-native-paper';

import { COLORS, LAYOUT } from '../../constants/theme';
import { useIsDesktop } from '../../hooks/use-desktop-layout';
import { a11yLang } from '../../utils/accessibility';

export default function TabLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();

  return (
    // The row wrapper is always rendered, with the rail toggled inside it,
    // so the Tabs navigator keeps its identity (and its state) when a browser
    // window is resized across the breakpoint.
    <View style={styles.row}>
      {isDesktop && <DesktopRail />}
      <View style={styles.scene}>
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={({ navigation, state, descriptors, insets }) =>
            isDesktop ? null : (
              <BottomNavigation.Bar
                navigationState={state}
                safeAreaInsets={insets}
                activeColor={theme.colors.primary}
                style={{ backgroundColor: theme.colors.elevation.level2 }}
                onTabPress={({ route, preventDefault }) => {
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (state.index !== state.routes.indexOf(route) && !event.defaultPrevented) {
                    navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key });
                  }
                }}
                renderIcon={({ route, focused, color }) => {
                  const { options } = descriptors[route.key];
                  if (options.tabBarIcon) return options.tabBarIcon({ focused, color, size: 24 });
                  return null;
                }}
                getLabelText={({ route }) => {
                  const { options } = descriptors[route.key];
                  const label = options.tabBarLabel ?? options.title ?? route.name;
                  // Force return as string to prevent Symbol errors
                  return typeof label === 'string' ? label : route.name;
                }}
                // E2E selectors. Keyed on `route.name`, not the label, because the
                // labels are translated — a flow matching on "Medications" would
                // pass in English and fail the moment the device locale is zh-Hant.
                // Route names are what the filesystem router already guarantees.
                getTestID={({ route }) => `tab-${route.name}`}
              />
            )
          }
        >
          <Tabs.Screen
            name="index"
            options={{
              tabBarLabel: t('tabs.home'),
              tabBarIcon: ({ color, size }) => <MaterialCommunityIcons aria-hidden name="home" size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="appointments"
            options={{
              tabBarLabel: t('tabs.appointments'),
              tabBarIcon: ({ color, size }) => <MaterialCommunityIcons aria-hidden name="calendar-check" size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="medications"
            options={{
              tabBarLabel: t('tabs.medications'),
              tabBarIcon: ({ color, size }) => <MaterialCommunityIcons aria-hidden name="pill" size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="results"
            options={{
              tabBarLabel: t('tabs.results'),
              tabBarIcon: ({ color, size }) => <MaterialCommunityIcons aria-hidden name="flask" size={size} color={color} />,
            }}
          />
        </Tabs>
      </View>
    </View>
  );
}

type RailItem = {
  route: '/' | '/appointments' | '/medications' | '/results';
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  testID: string;
};

/**
 * Desktop replacement for the bottom tab bar: a fixed sidebar with the same
 * four destinations, plus the profile screen at the bottom. Navigates through
 * expo-router rather than the tab navigator's own dispatch so it works the
 * same regardless of which screen inside the group is focused.
 */
function DesktopRail() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();

  const items: RailItem[] = [
    { route: '/', icon: 'home', label: t('tabs.home'), testID: 'tab-index' },
    { route: '/appointments', icon: 'calendar-check', label: t('tabs.appointments'), testID: 'tab-appointments' },
    { route: '/medications', icon: 'pill', label: t('tabs.medications'), testID: 'tab-medications' },
    { route: '/results', icon: 'flask', label: t('tabs.results'), testID: 'tab-results' },
  ];

  return (
    <View style={styles.rail}>
      <View style={styles.brand}>
        <View style={styles.brandIconBox}>
          <Image source={require('../../assets/images/icon.png')} style={styles.brandIcon} resizeMode="contain" />
        </View>
        <Text style={styles.brandName} numberOfLines={2}>{t('common.appName')}</Text>
      </View>

      <View style={styles.navGroup}>
        {items.map((item) => (
          <RailLink
            key={item.route}
            item={item}
            active={pathname === item.route}
            onPress={() => router.navigate(item.route)}
          />
        ))}
      </View>

      <View style={styles.railFooter}>
        <Divider style={styles.railDivider} />
        <RailLink
          item={{ route: '/', icon: 'account-circle-outline', label: t('tabs.profile'), testID: 'rail-profile' }}
          active={false}
          onPress={() => router.push('/profile')}
        />
      </View>
    </View>
  );
}

function RailLink({ item, active, onPress }: { item: RailItem; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={item.testID}
      onPress={onPress}
      // The label already reads, but "active" is carried purely by colour —
      // without selected state a screen reader gives no way to tell which
      // section you are currently in.
      accessibilityRole="tab"
      accessibilityLabel={item.label} {...a11yLang()}
      accessibilityState={{ selected: active }}
      style={({ pressed, hovered }: any) => [
        styles.railItem,
        active && styles.railItemActive,
        !active && hovered && styles.railItemHovered,
        pressed && { opacity: 0.7 },
      ]}
    >
      <MaterialCommunityIcons aria-hidden name={item.icon} size={22} color={active ? COLORS.primary : COLORS.slate} />
      <Text style={[styles.railLabel, active && styles.railLabelActive]}>{item.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: COLORS.background },
  scene: { flex: 1 },

  rail: {
    width: LAYOUT.railWidth,
    backgroundColor: COLORS.surface,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    marginBottom: 28,
  },
  brandIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.ink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandIcon: { width: '70%', height: '70%' },
  brandName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.ink,
    letterSpacing: -0.3,
    lineHeight: 19,
  },

  navGroup: { flex: 1, gap: 4 },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  railItemActive: { backgroundColor: '#EEF2FF' },
  railItemHovered: { backgroundColor: COLORS.background },
  railLabel: { fontSize: 14, fontWeight: '600', color: COLORS.slate },
  railLabelActive: { color: COLORS.primary, fontWeight: '700' },

  railFooter: { gap: 4 },
  railDivider: { marginBottom: 12 },
});
