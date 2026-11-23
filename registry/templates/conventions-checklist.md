# Conventions checklist

For the verifier, and for you before you approve. Each line is a yes / no question about one
`.mirai/context/conventions-<service>.md`. The lint has already checked that every rule is tagged,
that each "enforced by" names a check in the config, and that each judgment rule has an example.
These need judgement. Lines marked `[vera]` are Vera's (unit 40);
the unmarked one is yours.

- [vera] Does each rule tagged "enforced by" really get checked by that check, and fail when broken?
- [vera] Is a judgment rule really one no tool checks? If a linter could check it, should it?
- Is each judgment rule something this code does differently from the usual way, or a mistake an
  agent made before? A rule every developer already follows is noise.
- [vera] Does each example come from this code, with real names?
- [vera] Do two rules contradict each other, or a rule contradict the code as it is?
- [vera] Is anything left from the template: a guidance line, a placeholder, the sample id?
