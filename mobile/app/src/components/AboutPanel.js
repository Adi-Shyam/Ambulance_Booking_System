import { Linking, StyleSheet, View } from 'react-native';
import { TEAM, USER_MANUAL_URL } from '../lib/config';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';
import { Body, Button, Card, H2, Row, Small } from './ui';

/**
 * Who built this, and where the manual is.
 *
 * Shared by all three roles rather than written out three times, so a name or
 * a version is corrected in one place. DBIM Annexure D.1.5 asks every
 * government app to give people a clear way to reach whoever runs it; for a
 * course project that is the team, named.
 */
export default function AboutPanel({ title = 'About' }) {
  const haveManual = Boolean(USER_MANUAL_URL);

  return (
    <Card>
      <H2>{title}</H2>

      <View style={{ marginTop: spacing.sm }}>
        <Row label="App" value="Ambulance Booking v1.0.0" />
        <Row label="Course" value="IT303 · Software Engineering" />
        <Row label="Backend" value={api.url} />
      </View>

      <Small style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>Built by</Small>
      <View style={styles.team}>
        {TEAM.map((m) => (
          <View key={m.roll} style={styles.member}>
            <Body style={{ fontWeight: '600' }}>{m.name}</Body>
            <Small>{m.roll}</Small>
          </View>
        ))}
      </View>

      <Small style={{ marginTop: spacing.md }}>User manual</Small>
      {haveManual ? (
        <Button
          title="Open the user manual (PDF)"
          icon="📄"
          variant="secondary"
          style={{ marginTop: spacing.xs }}
          onPress={() => Linking.openURL(USER_MANUAL_URL)}
        />
      ) : (
        // A placeholder that says what it is waiting for, rather than a
        // button that opens nothing. Set EXPO_PUBLIC_USER_MANUAL_URL and this
        // becomes the real thing with no code change.
        <View style={styles.placeholder}>
          <Body style={{ fontWeight: '600' }}>📄  Not uploaded yet</Body>
          <Small style={{ marginTop: 2 }}>
            The manual will open here once its address is set in the build.
          </Small>
        </View>
      )}

      <Small style={{ textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 }}>
        Department of Information Technology{'\n'}
        National Institute of Technology Karnataka, Surathkal
      </Small>
    </Card>
  );
}

const styles = StyleSheet.create({
  team: { gap: spacing.xs },
  member: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.md,
    paddingVertical: 4,
  },
  placeholder: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
});
