import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from './themed-text';
import { useTheme } from '../hooks/use-theme';
import { getAccessToken, getUserPhotoUrl } from '../lib/api';

export interface UserAvatarProps {
  userId: string;
  name: string;
  hasPhoto?: boolean;
  size?: number;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/**
 * `GET /users/:id/photo` (backend users/routes.ts) is a stable, user-id-keyed
 * URL -- never a presigned one -- so expo-image's disk cache keys on this
 * exact string and shows the cached bytes instantly on repeat views instead
 * of re-fetching. See auth-store.ts for the post-login `Image.prefetch` call
 * that warms this cache for the signed-in user's own photo before they ever
 * open the profile screen.
 */
export function UserAvatar({ userId, name, hasPhoto, size = 56 }: UserAvatarProps) {
  const theme = useTheme();
  const [errored, setErrored] = useState(false);
  const token = getAccessToken();
  const showPhoto = !!hasPhoto && !errored && !!token;

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.primarySubtle },
      ]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: getUserPhotoUrl(userId), headers: { Authorization: `Bearer ${token}` } }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          cachePolicy="disk"
          onError={() => setErrored(true)}
        />
      ) : (
        <ThemedText type="subtitle" style={{ color: theme.primary }}>
          {initials(name) || '?'}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
