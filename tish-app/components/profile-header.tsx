import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Divider, IconButton, Menu, Surface, Text } from 'react-native-paper';
import { COLORS, LAYOUT } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { a11yLang } from '../utils/accessibility';

interface ProfileHeaderProps {
  rightActions?: React.ReactNode;
}

export default function ProfileHeader({ rightActions }: ProfileHeaderProps) {
  const { user, activeDependent, setActiveDependent, dependents } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  const displayUser = activeDependent || user;
  const isManaging = !!activeDependent;

  return (
    <View style={styles.headerContainer}>
      <Menu
        visible={visible}
        onDismiss={() => setVisible(false)}
        anchor={
          <Pressable
            onPress={() => setVisible(true)}
            style={styles.profileSection}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.profileHeader.switchProfile', {
              name: displayUser?.full_name ?? '',
              scope: isManaging ? t('common.managing') : t('common.personal'),
            })} {...a11yLang()}
            accessibilityState={{ expanded: visible }}
          >
            <Surface style={[styles.avatarWrapper, isManaging && styles.managingBorder]} elevation={0}>
                <Avatar.Image 
                    size={40} 
                    source={{ uri: `https://api.dicebear.com/7.x/initials/svg?seed=${displayUser?.username}&backgroundColor=${isManaging ? '26ba9d' : '6366f1'}` }} 
                />
            </Surface>
            <View style={styles.textWrapper}>
              <Text style={styles.indicatorText}>{isManaging ? t('common.managing') : t('common.personal')}</Text>
              <Text style={styles.nameText} numberOfLines={1}>
                {displayUser?.full_name?.split(' ')[0]}
              </Text>
            </View>
            {/* Decorative: the Pressable above carries the name and the
                expanded state, so this would only add a second, nameless
                control to the accessibility tree. */}
            <IconButton
              icon="chevron-down"
              size={16}
              style={{ margin: 0, marginLeft: -4 }}
              accessible={false}
              importantForAccessibility="no"
            />
          </Pressable>
        }
      >
        <Menu.Item
            onPress={() => { setActiveDependent(null); setVisible(false); }}
            title={t('common.myself')}
            leadingIcon="account-circle"
            titleStyle={!activeDependent ? { color: COLORS.primary, fontWeight: 'bold' } : {}}
        />
        {dependents.map(dep => (
          <Menu.Item 
            key={dep.id} 
            onPress={() => { setActiveDependent(dep); setVisible(false); }} 
            title={dep.full_name} 
            leadingIcon="account-child"
            titleStyle={activeDependent?.id === dep.id ? { color: COLORS.primary, fontWeight: 'bold' } : {}}
          />
        ))}
        <Divider />
        <Menu.Item
            onPress={() => { setVisible(false); router.push('/managed-users'); }}
            title={t('common.editFamily')}
            leadingIcon="cog-outline"
        />
      </Menu>

      <View style={styles.rightActions}>
        {rightActions}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    // No status bar to clear in a browser; align with the clamped content
    // column instead of stretching across the window. The background matches
    // the page, so the clamp leaves no visible seam.
    paddingTop: Platform.OS === 'web' ? 24 : 60,
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: COLORS.background,
    ...Platform.select({
      web: { width: '100%' as const, maxWidth: LAYOUT.contentMaxWidth, alignSelf: 'center' as const },
    }),
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    borderRadius: 25,
    padding: 2,
  },
  managingBorder: {
    borderWidth: 2,
    borderColor: COLORS.accent, // Teal color for managing
  },
  textWrapper: {
    marginLeft: 10,
  },
  indicatorText: {
    fontSize: 8,
    fontWeight: '900',
    color: COLORS.slate,
    letterSpacing: 1,
  },
  nameText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.ink,
    marginTop: -2,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  }
});