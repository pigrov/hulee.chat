export type PasswordPolicyContext = {
  email?: string;
};

export type PasswordPolicyViolation =
  | "too_short"
  | "too_long"
  | "leading_or_trailing_whitespace"
  | "insufficient_complexity"
  | "contains_identifier"
  | "common_pattern";

export type PasswordPolicyResult =
  | {
      valid: true;
      password: string;
    }
  | {
      valid: false;
      violations: readonly PasswordPolicyViolation[];
    };

const minimumPasswordLength = 12;
const passphraseLength = 16;
const maximumPasswordLength = 256;
const commonWeakPatterns = ["password", "qwerty", "123456", "admin", "letmein"];

export function validatePasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {}
): PasswordPolicyResult {
  const violations: PasswordPolicyViolation[] = [];

  if (password.length < minimumPasswordLength) {
    violations.push("too_short");
  }

  if (password.length > maximumPasswordLength) {
    violations.push("too_long");
  }

  if (password.trim() !== password) {
    violations.push("leading_or_trailing_whitespace");
  }

  if (!hasSufficientComplexity(password)) {
    violations.push("insufficient_complexity");
  }

  if (containsIdentifier(password, context)) {
    violations.push("contains_identifier");
  }

  if (containsCommonWeakPattern(password)) {
    violations.push("common_pattern");
  }

  return violations.length === 0
    ? {
        valid: true,
        password
      }
    : {
        valid: false,
        violations
      };
}

export function requireValidPassword(
  password: string,
  context?: PasswordPolicyContext
): string {
  const result = validatePasswordPolicy(password, context);

  if (!result.valid) {
    throw new Error(`Password policy violation: ${result.violations[0]}.`);
  }

  return result.password;
}

function hasSufficientComplexity(password: string): boolean {
  const categories = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;

  return password.length >= passphraseLength
    ? categories >= 2
    : categories >= 3;
}

function containsIdentifier(
  password: string,
  context: PasswordPolicyContext
): boolean {
  const normalizedPassword = password.toLowerCase();
  const email = context.email?.trim().toLowerCase();

  if (email === undefined || email.length === 0) {
    return false;
  }

  const localPart = email.split("@")[0] ?? "";
  const terms = [email, localPart].filter((term) => term.length >= 4);

  return terms.some((term) => normalizedPassword.includes(term));
}

function containsCommonWeakPattern(password: string): boolean {
  const normalizedPassword = password.toLowerCase();

  if (/^(.)\1+$/.test(password)) {
    return true;
  }

  return commonWeakPatterns.some((pattern) => {
    return normalizedPassword.includes(pattern);
  });
}
