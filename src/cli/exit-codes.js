// Fixed exit codes for every mirai command. Codes are reserved before they are used,
// so their meaning never changes (unit 01 spec, "Exit codes").
export const EXIT = Object.freeze({
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  CONFIG: 3,
  BLOCKED: 4,
  NEEDS_HUMAN: 5,
  INTERRUPTED: 130,
});
