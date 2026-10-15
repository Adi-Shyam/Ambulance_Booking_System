import { View } from 'react-native';
import { colors, radius, spacing } from '../lib/theme';
import { Small } from './ui';

/**
 * Says how a password is doing while it is being typed.
 *
 * The server decides what is acceptable; this only describes, and it exists
 * so that nobody meets the rules by submitting and being refused. Being told
 * "must not contain your name" before pressing the button is the difference
 * between a hint and a scolding.
 *
 * The rules it reflects follow NIST SP 800-63B: length and a blocklist, not
 * one-of-each-character-class. That formula reliably produces "Password1!",
 * which satisfies it and is guessed in seconds.
 */

const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwerty', 'qwerty123', 'qwertyuiop', 'abc12345', 'iloveyou', 'welcome1',
  'admin123', 'letmein', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'secret123',
  'driver123', 'user1234', 'ambulance', 'ambulance123', 'hospital', 'emergency',
]);

const CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
const MIN = 8;

const isRepeated = (s) => new Set(s).size === 1;

function isRun(s) {
  if (s.length < 4) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < s.length; i += 1) {
    const step = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
  }
  return up || down;
}

/**
 * Mirrors the server's rules so the feedback matches the eventual answer.
 * The server remains the authority - this is a courtesy, not a gate.
 */
export function assess(value, owner = {}) {
  const v = String(value || '');
  if (!v) return { score: 0, problem: null, label: null };

  const lower = v.toLowerCase();
  const classes = CLASSES.filter((re) => re.test(v)).length;

  const own = [owner.full_name, owner.phone_no, owner.email_id?.split('@')[0]]
    .filter(Boolean)
    .flatMap((p) => String(p).toLowerCase().split(/[^a-z0-9]+/))
    .filter((p) => p.length >= 4);

  const problem =
    v.length < MIN ? `At least ${MIN} characters`
    : COMMON.has(lower) ? 'That is one of the most commonly used passwords'
    : isRepeated(v) ? 'Not the same character repeated'
    : isRun(v) ? 'Not a run of consecutive characters'
    : own.some((p) => lower.includes(p)) ? 'Must not contain your name, number or email'
    : v.length < 12 && classes < 3 ? '12 characters or longer, or mix letters, digits and symbols'
    : null;

  if (problem) return { score: 0, problem, label: null };

  let score = 1;
  if (v.length >= 12) score += 1;
  if (v.length >= 16) score += 1;
  if (classes >= 3) score += 1;
  if (new Set(v).size >= Math.min(10, v.length)) score += 1;

  return {
    score: Math.min(score, 5),
    problem: null,
    label: ['', 'Acceptable', 'Fair', 'Good', 'Strong', 'Very strong'][Math.min(score, 5)],
  };
}

export default function PasswordStrength({ value, owner }) {
  const { score, problem, label } = assess(value, owner);
  if (!value) return null;

  const tone = problem ? colors.warn : score >= 4 ? colors.ok : score >= 2 ? colors.info : colors.muted;

  return (
    <View style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: radius.pill,
              backgroundColor: !problem && score >= i ? tone : colors.line,
            }}
          />
        ))}
      </View>
      <Small style={{ color: tone }}>{problem || label}</Small>
    </View>
  );
}
