/** Exit codes (spec §11): 0 ok, 2 user/input, 3 validation, 4 not found/conflict, 5 policy. */
export const EXIT_OK = 0;
export const EXIT_USER = 2;
export const EXIT_VALIDATION = 3;
export const EXIT_NOT_FOUND = 4;
export const EXIT_POLICY = 5;

export function exitCodeForError(e: unknown): number {
  const code = (e as { code?: string })?.code;
  switch (code) {
    case "NOT_FOUND":
      return EXIT_NOT_FOUND;
    case "CONFLICT":
      return EXIT_NOT_FOUND;
    case "VALIDATION":
      return EXIT_VALIDATION;
    case "TRANSITION":
      return EXIT_USER;
    case "POLICY":
      return EXIT_POLICY;
    default:
      return EXIT_USER;
  }
}
