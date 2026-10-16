import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FONT, STATUS_COLOR, colors, radius, spacing, typo } from '../lib/theme';

export function Screen({ children, style }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children, style }) {
  return <Text style={[typo.h1, style]}>{children}</Text>;
}
export function H2({ children, style }) {
  return <Text style={[typo.h2, style]}>{children}</Text>;
}
export function Body({ children, style, numberOfLines }) {
  return <Text style={[typo.body, style]} numberOfLines={numberOfLines}>{children}</Text>;
}
export function Small({ children, style, numberOfLines }) {
  return <Text style={[typo.small, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style, icon }) {
  const tone = {
    primary: { bg: colors.accent, fg: colors.white },
    secondary: { bg: colors.surface2, fg: colors.text },
    // White on Liberty Green clears 4.5:1; the dark green it used to carry was
    // chosen for a dark surface that no longer exists.
    success: { bg: colors.ok, fg: colors.white },
    ghost: { bg: 'transparent', fg: colors.muted },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: tone.bg, opacity: disabled || loading ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.line },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone.fg} />
      ) : (
        <Text style={[styles.buttonText, { color: tone.fg }]}>
          {icon ? `${icon}  ` : ''}{title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...props}
      />
      {hint ? <Text style={[typo.tiny, { marginTop: 5 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Pill({ label, tone }) {
  const color = tone || STATUS_COLOR[label] || colors.muted;
  return (
    <View style={[styles.pill, { backgroundColor: `${color}26`, borderColor: `${color}66` }]}>
      <Text style={{ color, fontSize: 11.5, fontFamily: FONT.bold, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function Banner({ kind = 'info', children }) {
  if (!children) return null;
  const color = { info: colors.info, error: colors.accent, ok: colors.ok, warn: colors.warn }[kind];
  return (
    <View style={[styles.banner, { backgroundColor: `${color}1f`, borderColor: `${color}55` }]}>
      <Text style={{ color, fontSize: 13.5, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

export function Row({ label, value, valueStyle }) {
  return (
    <View style={styles.row}>
      <Text style={[typo.small, { flex: 1 }]}>{label}</Text>
      <Text style={[typo.body, { fontFamily: FONT.semibold, textAlign: 'right', flexShrink: 1 }, valueStyle]}>
        {value}
      </Text>
    </View>
  );
}

export function Loading({ text = 'Loading…' }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={[typo.small, { marginTop: spacing.md }]}>{text}</Text>
    </View>
  );
}

export function EmptyState({ icon = '🗒️', title, hint }) {
  return (
    <View style={styles.centered}>
      <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>{icon}</Text>
      <Text style={[typo.h3, { marginBottom: 6, textAlign: 'center' }]}>{title}</Text>
      {hint ? <Text style={[typo.small, { textAlign: 'center', paddingHorizontal: spacing.lg }]}>{hint}</Text> : null}
    </View>
  );
}

/** Vertical milestone tracker used on the tracking screen (F.9). */
export function StepTrail({ steps, currentIndex }) {
  return (
    <View>
      {steps.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const color = done ? colors.ok : active ? colors.info : colors.line;
        return (
          <View key={s.code} style={{ flexDirection: 'row' }}>
            <View style={{ alignItems: 'center', width: 26 }}>
              <View style={[styles.dot, { backgroundColor: color, borderColor: active ? colors.info : 'transparent' }]} />
              {i < steps.length - 1 ? (
                <View style={[styles.trail, { backgroundColor: done ? colors.ok : colors.line }]} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? spacing.md : 0 }}>
              <Text style={{
                fontSize: 14.5,
                color: active ? colors.text : done ? colors.text : colors.muted,
                fontFamily: active ? FONT.bold : FONT.medium,
              }}>
                {s.label}
              </Text>
              {s.detail ? <Text style={typo.tiny}>{s.detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  button: {
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonText: { fontSize: 16, fontFamily: FONT.bold },
  fieldLabel: { ...typo.small, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    paddingVertical: 13,
    color: colors.text,
    fontSize: 15.5,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  banner: {
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 7,
    gap: spacing.md,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  dot: { width: 13, height: 13, borderRadius: 7, borderWidth: 3, marginTop: 3 },
  trail: { width: 2, flex: 1, marginVertical: 2 },
});
