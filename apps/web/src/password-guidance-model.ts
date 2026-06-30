import {
  containsCommonWeakPasswordPattern,
  containsCyrillicCharacters,
  containsPasswordIdentifier,
  maximumPasswordLength,
  minimumPasswordLength
} from "./password-policy";

export {
  maximumPasswordLength,
  minimumPasswordLength
} from "./password-policy";

export const passwordGuidanceRequirementIds = [
  "minimum_length",
  "digit",
  "uppercase",
  "symbol",
  "no_cyrillic",
  "no_surrounding_whitespace",
  "not_common_pattern",
  "no_account_identifier"
] as const;

export type PasswordGuidanceRequirementId =
  (typeof passwordGuidanceRequirementIds)[number];

export type PasswordGuidanceContext = {
  email?: string;
};

export type PasswordGuidanceRequirementState = {
  id: PasswordGuidanceRequirementId;
  valid: boolean;
  visible: boolean;
};

const generatedPasswordLength = 18;
const lowercaseCharacters = "abcdefghijkmnopqrstuvwxyz";
const uppercaseCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const digitCharacters = "23456789";
const symbolCharacters = "!@#$%^&*()-_=+[]{};:,.?";
const generatedPasswordCharacterSets = [
  lowercaseCharacters,
  uppercaseCharacters,
  digitCharacters,
  symbolCharacters
] as const;
const generatedPasswordCharacters = generatedPasswordCharacterSets.join("");

type RandomInt = (maxExclusive: number) => number;

export function evaluatePasswordGuidance(
  password: string,
  context: PasswordGuidanceContext = {}
): readonly PasswordGuidanceRequirementState[] {
  const hasPassword = password.length > 0;
  const hasAccountIdentifier = hasVisibleAccountIdentifier(context);

  return [
    {
      id: "minimum_length",
      valid: password.length >= minimumPasswordLength,
      visible: true
    },
    {
      id: "digit",
      valid: /\d/.test(password),
      visible: true
    },
    {
      id: "uppercase",
      valid: /[A-Z]/.test(password),
      visible: true
    },
    {
      id: "symbol",
      valid: hasPasswordSymbol(password),
      visible: true
    },
    {
      id: "no_cyrillic",
      valid: hasPassword && !containsCyrillicCharacters(password),
      visible: true
    },
    {
      id: "no_surrounding_whitespace",
      valid: hasPassword && password.trim() === password,
      visible: true
    },
    {
      id: "not_common_pattern",
      valid: hasPassword && !containsCommonWeakPasswordPattern(password),
      visible: true
    },
    {
      id: "no_account_identifier",
      valid:
        hasPassword &&
        hasAccountIdentifier &&
        !containsPasswordIdentifier(password, context),
      visible: hasAccountIdentifier
    }
  ];
}

export function generateStrongPassword(
  randomInt: RandomInt = secureRandomInt
): string {
  const requiredCharacters = generatedPasswordCharacterSets.map(
    (characters) => {
      return characters[randomInt(characters.length)];
    }
  );
  const remainingLength = Math.max(
    generatedPasswordLength,
    minimumPasswordLength
  );
  const characters = [...requiredCharacters];

  while (characters.length < remainingLength) {
    characters.push(
      generatedPasswordCharacters[randomInt(generatedPasswordCharacters.length)]
    );
  }

  return shuffleCharacters(characters, randomInt)
    .join("")
    .slice(0, maximumPasswordLength);
}

function hasPasswordSymbol(password: string): boolean {
  return [...password].some((character) =>
    symbolCharacters.includes(character)
  );
}

function hasVisibleAccountIdentifier(
  context: PasswordGuidanceContext
): boolean {
  const email = context.email?.trim();
  const localPart = email?.split("@")[0] ?? "";

  return localPart.length >= 4;
}

function shuffleCharacters(
  characters: string[],
  randomInt: RandomInt
): string[] {
  const shuffled = [...characters];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index]
    ];
  }

  return shuffled;
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) {
    throw new Error("maxExclusive must be positive.");
  }

  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues === undefined) {
    throw new Error("Crypto random generator is unavailable.");
  }

  const randomValues = new Uint32Array(1);
  const range = 0x100000000;
  const rejectionLimit = range - (range % maxExclusive);

  let value = range;
  while (value >= rejectionLimit) {
    crypto.getRandomValues(randomValues);
    value = randomValues[0] ?? 0;
  }

  return value % maxExclusive;
}
